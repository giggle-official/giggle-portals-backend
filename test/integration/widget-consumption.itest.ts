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

    const rowFor = async (widget_tag: string) => {
        const report = await credit.getWidgetConsumption({ widget_tag })
        return report.users[0]
    }

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
        expect(row.remaining).toBe(800)
    })

    it("never reports more consumed than granted", async () => {
        for (const widget of [WIDGET, OTHER_WIDGET]) {
            const { users } = await credit.getWidgetConsumption({ widget_tag: widget })
            for (const row of users) {
                expect(row.consumed).toBeLessThanOrEqual(row.granted)
            }
        }
    })

    it("adds the four buckets up to the granted total", async () => {
        const row = await rowFor(WIDGET)
        expect(row.granted_paid + row.granted_free + row.granted_subscription + row.granted_credit_line).toBe(
            row.granted,
        )
    })

    it("masks the email and never returns the raw address", async () => {
        const report = await credit.getWidgetConsumption({ widget_tag: WIDGET })
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

        const { users } = await credit.getWidgetConsumption({ widget_tag: WIDGET })
        const row = users.find((u) => u.granted_free === 50)
        expect(row).toBeDefined()
        expect(row?.consumed).toBe(0)
    })

    it("honours sort and limit", async () => {
        const desc = await credit.getWidgetConsumption({
            widget_tag: WIDGET,
            sort: WidgetConsumptionSort.CONSUMED_DESC,
        })
        expect(desc.users[0].consumed).toBe(700)

        const asc = await credit.getWidgetConsumption({
            widget_tag: WIDGET,
            sort: WidgetConsumptionSort.CONSUMED_ASC,
        })
        expect(asc.users[0].consumed).toBe(0)

        const capped = await credit.getWidgetConsumption({ widget_tag: WIDGET, limit: "1" })
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

    it("returns an empty report for a widget nobody has used", async () => {
        const report = await credit.getWidgetConsumption({ widget_tag: itestId("wg_unused") })
        expect(report).toEqual({ widget_tag: itestId("wg_unused"), count: 0, users: [] })
    })
})
