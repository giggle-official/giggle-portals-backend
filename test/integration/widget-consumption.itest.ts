import { closeApp, CreditService, get } from "./helpers/app"
import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { seedOrder, seedWorld, USER, WIDGET, resetOrderSeq } from "./helpers/fixtures"
import { describeItest, itestId } from "./helpers/itest"
import { WidgetConsumptionSort } from "src/payment/credit/credit.dto"

const OTHER_WIDGET = itestId("wg2")

/**
 * The report answers "what did this widget's users get, and what did they spend
 * here" — and the two halves are scoped differently on purpose. Grant is global,
 * consumption is per widget. Every case below exists because the obvious
 * alternative (scope both to the widget) produces a wrong number somewhere.
 */
describeItest("widget consumption report", () => {
    let credit: CreditService

    const spend = (widget: string, amount: number, orderId: string) =>
        db().credit_statements.create({
            data: {
                user: USER,
                type: "consume",
                amount: -amount,
                amount_precise: `-${amount}`,
                balance: 0,
                balance_precise: "0",
                order_id: orderId,
            } as never,
        })

    beforeAll(async () => {
        await cleanupFixtures()
        resetOrderSeq()
        credit = await get(CreditService)
        await seedWorld({ balance: 0 })

        await db().widgets.create({
            data: { tag: OTHER_WIDGET, name: OTHER_WIDGET, author: USER } as never,
        })

        // Bought 1000 credits through the first widget.
        const topUpOrder = await seedOrder({ amount: 1000, is_credit_top_up: true })
        await db().credit_statements.create({
            data: {
                user: USER,
                type: "top_up",
                amount: 1000,
                amount_precise: "1000",
                balance: 1000,
                balance_precise: "1000",
                order_id: topUpOrder,
            } as never,
        })

        // Spent 700 of it here, 200 of it on the other widget.
        await spend(WIDGET, 700, await seedOrder({ amount: 700 }))
        await spend(OTHER_WIDGET, 200, await seedOrder({ amount: 200, widget_tag: OTHER_WIDGET }))
    })

    afterAll(async () => {
        await db().widgets.deleteMany({ where: { tag: OTHER_WIDGET } })
        await cleanupFixtures()
        await closeApp()
        await closeDb()
    })

    /**
     * The report reads a snapshot, so every case rebuilds it first. The cron is
     * called directly rather than waited for — what is under test is the SQL it
     * runs, not the schedule.
     */
    const refresh = async () => {
        const slot = process.env.TASK_SLOT
        process.env.TASK_SLOT = "1"
        try {
            await credit.refreshWidgetConsumption()
        } finally {
            if (slot === undefined) delete process.env.TASK_SLOT
            else process.env.TASK_SLOT = slot
        }
    }

    const reportFor = async (widget_tag: string, extra: Record<string, unknown> = {}) => {
        await refresh()
        return credit.getWidgetConsumption({ widget_tag, ...extra } as never)
    }

    const rowFor = async (widget_tag: string) => (await reportFor(widget_tag)).users[0]

    it("counts only this widget's spending as consumed", async () => {
        expect((await rowFor(WIDGET))?.consumed).toBe(700)
    })

    /**
     * The case that decides the whole design. This user never bought anything
     * through the second widget, but spent 200 there. Scoping the grant to the
     * widget would report 200 consumed against 0 granted — a user spending credit
     * they were never given. Counting the grant globally reports the truth.
     */
    it("counts credit bought anywhere as granted, so cross-widget spending still balances", async () => {
        const row = await rowFor(OTHER_WIDGET)
        expect(row.consumed).toBe(200)
        expect(row.granted).toBe(1000)
        expect(row.granted_paid).toBe(1000)
        // The balance is global: 1000 bought, 900 spent across both widgets.
        expect(row.remaining).toBe(100)
    })

    it("never reports more consumed than granted", async () => {
        for (const widget of [WIDGET, OTHER_WIDGET]) {
            const { users } = await reportFor(widget)
            for (const row of users) {
                expect(row.consumed).toBeLessThanOrEqual(row.granted)
            }
        }
    })

    /**
     * `balance` is the ledger's own sum — 1000 bought, 700 spent here, 200
     * elsewhere — not the `users` row, which the report no longer reads. With no
     * credit line, spending power is that balance.
     */
    it("reports the account balance separately from what is left to spend", async () => {
        const row = await rowFor(WIDGET)
        expect(row.balance).toBe(100)
        expect(row.remaining).toBe(100)
    })

    /**
     * Expired free credit is a negative row in the ledger, so it leaves `balance`
     * on its own. It was still granted, so it stays in `granted` — which is why
     * `granted - consumed` is not the balance and never was.
     */
    it("does not count expired free credit as still available", async () => {
        await db().credit_statements.create({
            data: {
                user: USER,
                type: "issue_free_credit",
                amount: 500,
                amount_precise: "500",
                balance: 800,
                balance_precise: "800",
            } as never,
        })
        const expiry = await db().credit_statements.create({
            data: {
                user: USER,
                type: "expire_free_credit",
                amount: -500,
                amount_precise: "-500",
                balance: 300,
                balance_precise: "300",
            } as never,
        })
        try {
            const row = await rowFor(WIDGET)
            expect(row.granted_free).toBe(500)
            expect(row.balance).toBe(100)
            expect(row.granted - row.consumed).not.toBe(row.balance)
        } finally {
            await db().credit_statements.deleteMany({
                where: { user: USER, type: { in: ["issue_free_credit", "expire_free_credit"] } },
            })
            void expiry
        }
    })

    /**
     * A credit line counts on both sides: the limit adds to `granted`, the draw
     * adds to `consumed`, and `remaining` is the unused part plus the balance. This
     * is the case where `remaining` and `balance` must come apart.
     */
    it("counts a credit line on both sides and separates remaining from balance", async () => {
        await db().user_credit_lines.create({
            data: { user: USER, widget_tag: WIDGET, credit_limit: "1000", used: "400" } as never,
        })
        try {
            const row = await rowFor(WIDGET)
            expect(row.granted_credit_line).toBe(1000)
            expect(row.credit_line_used).toBe(400)
            // 700 spent here plus 400 drawn on the line.
            expect(row.consumed).toBe(1100)
            // 1000 bought plus the 1000 limit.
            expect(row.granted).toBe(2000)
            expect(row.balance).toBe(100)
            // 1000 - 400 + 100
            expect(row.remaining).toBe(700)
        } finally {
            await db().user_credit_lines.deleteMany({ where: { user: USER } })
        }
    })

    it("adds the four buckets up to the granted total", async () => {
        const row = await rowFor(WIDGET)
        expect(row.granted_paid + row.granted_free + row.granted_subscription + row.granted_credit_line).toBe(
            row.granted,
        )
    })

    it("masks the email and never returns the raw address", async () => {
        const report = await reportFor(WIDGET)
        expect(report.users[0].email).toMatch(/^.{1,3}\*\*\*\*@\*\*\*\*\.[a-z]+$/)
        expect(JSON.stringify(report)).not.toContain("@example.com")
    })

    /**
     * A credit line counts at its full limit whether or not it was drawn on, so a
     * user granted a line and a user who spent one look the same in `granted`.
     */
    it("counts a credit line at its limit, undrawn", async () => {
        await db().user_credit_lines.create({
            data: { user: USER, widget_tag: WIDGET, credit_limit: "1000000", used: "0" } as never,
        })
        try {
            const row = await rowFor(WIDGET)
            expect(row.granted_credit_line).toBe(1_000_000)
            expect(row.granted).toBe(1_001_000)
            // Nothing drawn, so the whole limit is still spendable on top of the balance.
            expect(row.remaining).toBe(1_000_100)
        } finally {
            await db().user_credit_lines.deleteMany({ where: { user: USER } })
        }
    })

    it("includes a user who was granted credit here but has spent none of it", async () => {
        const idle = itestId("u2")
        await db().users.create({
            data: {
                username_in_be: idle,
                username: idle,
                email: `${idle}@example.com`,
                password: itestId("not_a_login"),
            } as never,
        })
        // Two rows, as production writes them: the issue attributes the grant to
        // this widget, the statement is what the report sums.
        await db().free_credit_issues.create({
            data: {
                user: idle,
                widget_tag: WIDGET,
                amount: 50,
                amount_precise: "50",
                balance: 50,
                balance_precise: "50",
                expire_date: new Date("2099-12-31"),
            } as never,
        })
        await db().credit_statements.create({
            data: {
                user: idle,
                type: "issue_free_credit",
                amount: 50,
                amount_precise: "50",
                balance: 50,
                balance_precise: "50",
                is_free_credit: true,
            } as never,
        })

        const { users } = await reportFor(WIDGET)
        const row = users.find((u) => u.granted_free === 50)
        expect(row).toBeDefined()
        expect(row?.consumed).toBe(0)
    })

    /**
     * The report is handed to the widget's operator, so our own accounts must not
     * be in it. Excluded before ranking, so a `limit` still returns that many
     * customers rather than a page a few of ours fell out of.
     */
    it("leaves internal staff accounts out entirely", async () => {
        const staff = itestId("u3")
        await db().users.create({
            data: {
                username_in_be: staff,
                username: staff,
                email: `${staff}@cobra37.com`,
                password: itestId("not_a_login"),
            } as never,
        })
        await db().free_credit_issues.create({
            data: {
                user: staff,
                widget_tag: WIDGET,
                amount: 999,
                amount_precise: "999",
                balance: 999,
                balance_precise: "999",
                expire_date: new Date("2099-12-31"),
            } as never,
        })
        await db().credit_statements.create({
            data: {
                user: staff,
                type: "issue_free_credit",
                amount: 999,
                amount_precise: "999",
                balance: 999,
                balance_precise: "999",
                is_free_credit: true,
            } as never,
        })

        const originalDomains = process.env.INTERNAL_EMAIL_DOMAINS
        process.env.INTERNAL_EMAIL_DOMAINS = "cobra37.com,3bodylabs.ai"

        try {
            const report = await reportFor(WIDGET, { sort: WidgetConsumptionSort.GRANTED_DESC })
            expect(report.users.some((u) => u.granted_free === 999)).toBe(false)
            expect(JSON.stringify(report)).not.toContain("cob")
        } finally {
            if (originalDomains === undefined) delete process.env.INTERNAL_EMAIL_DOMAINS
            else process.env.INTERNAL_EMAIL_DOMAINS = originalDomains
            await db().free_credit_issues.deleteMany({ where: { user: staff } })
            await db().users.deleteMany({ where: { username_in_be: staff } })
        }
    })

    /**
     * Omitting `widget_tag` reports every widget together. Consumption and credit
     * lines are per widget and must be summed; the grant and the balance are
     * already global and must not be — adding a user's rows would multiply them by
     * the number of widgets they used.
     */
    it("reports every widget together when widget_tag is omitted", async () => {
        await refresh()
        const all = await credit.getWidgetConsumption({} as never)
        expect(all.widget_tag).toBeNull()

        const row = all.users.find((u) => u.granted_paid === 1000)
        expect(row).toBeDefined()
        // 700 here plus 200 on the other widget.
        expect(row?.consumed).toBe(900)
        expect(row?.granted).toBe(1000)
        expect(row?.balance).toBe(100)
        expect(row?.remaining).toBe(100)
    })

    it("honours sort and limit", async () => {
        const desc = await reportFor(WIDGET, { sort: WidgetConsumptionSort.CONSUMED_DESC })
        expect(desc.users[0].consumed).toBe(700)

        const asc = await reportFor(WIDGET, { sort: WidgetConsumptionSort.CONSUMED_ASC })
        expect(asc.users[0].consumed).toBe(0)

        const capped = await reportFor(WIDGET, { limit: "1" })
        expect(capped.users).toHaveLength(1)
        expect(capped.count).toBe(1)
    })

    it("rejects a limit outside the allowed range rather than clamping it", async () => {
        for (const limit of ["0", "1001", "abc", "1.5"]) {
            await expect(credit.getWidgetConsumption({ widget_tag: WIDGET, limit })).rejects.toThrow(
                "limit must be an integer",
            )
        }
    })

    it("reports when the snapshot was built", async () => {
        const before = new Date(Date.now() - 1000)
        const report = await reportFor(WIDGET)
        expect(report.generated_at).toBeInstanceOf(Date)
        expect(report.generated_at!.getTime()).toBeGreaterThanOrEqual(before.getTime())
    })

    /**
     * Rebuilt whole, not merged: a user who stops belonging to the widget has to
     * leave the snapshot, and a refresh that only upserts would leave them behind
     * forever.
     */
    it("drops rows for activity that no longer exists", async () => {
        const gone = itestId("u4")
        await db().users.create({
            data: {
                username_in_be: gone,
                username: gone,
                email: `${gone}@example.com`,
                password: itestId("not_a_login"),
            } as never,
        })
        const issue = await db().free_credit_issues.create({
            data: {
                user: gone,
                widget_tag: WIDGET,
                amount: 42,
                amount_precise: "42",
                balance: 42,
                balance_precise: "42",
                expire_date: new Date("2099-12-31"),
            } as never,
        })
        await db().credit_statements.create({
            data: {
                user: gone,
                type: "issue_free_credit",
                amount: 42,
                amount_precise: "42",
                balance: 42,
                balance_precise: "42",
                is_free_credit: true,
            } as never,
        })

        try {
            expect((await reportFor(WIDGET)).users.some((u) => u.granted_free === 42)).toBe(true)

            await db().free_credit_issues.delete({ where: { id: issue.id } })

            expect((await reportFor(WIDGET)).users.some((u) => u.granted_free === 42)).toBe(false)
        } finally {
            await db().credit_statements.deleteMany({ where: { user: gone } })
            await db().free_credit_issues.deleteMany({ where: { user: gone } })
            await db().users.deleteMany({ where: { username_in_be: gone } })
        }
    })

    it("returns an empty report for a widget nobody has used", async () => {
        const report = await reportFor(itestId("wg_unused"))
        expect(report).toEqual({
            widget_tag: itestId("wg_unused"),
            count: 0,
            generated_at: null,
            users: [],
        })
    })
})
