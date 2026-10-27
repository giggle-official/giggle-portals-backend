import { closeApp, CreditService, get, OrderService } from "./helpers/app"
import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { EMAIL, seedOrder, seedWorld, USER, WIDGET, resetOrderSeq } from "./helpers/fixtures"
import { describeItest } from "./helpers/itest"

/**
 * Free credit given for one product: issued with a short life, spent first by
 * the orders that name it, taken back early when the trial ends.
 *
 * On a real database because the parts that matter are the stored date, the
 * JSON column round-trip, and two take-backs racing on one row. Every case ends
 * on the same check: the user's ledger still chains, row by row, to the balance.
 */
describeItest("free credit priority and take-back", () => {
    let credit: CreditService
    let orders: OrderService

    const ADMIN = "zz_itest_admin"
    const asUser = { usernameShorted: USER, email: EMAIL } as never
    const asWidget = { usernameShorted: USER, email: EMAIL, developer_info: { tag: WIDGET } } as never
    const admin = { usernameShorted: ADMIN } as never

    const num = (value: unknown) => Number(value)
    const balance = async () =>
        num((await db().users.findUniqueOrThrow({ where: { username_in_be: USER } })).current_credit_balance_precise)
    const issueBalance = async (id: number) =>
        num((await db().free_credit_issues.findUniqueOrThrow({ where: { id } })).balance_precise)
    const chainBreaks = async () =>
        Number(
            (
                await db().$queryRaw<{ n: bigint | number }[]>`
                    SELECT COUNT(*) n FROM (
                        SELECT balance_precise,
                               SUM(amount_precise) OVER (PARTITION BY user ORDER BY id) AS running
                        FROM credit_statements WHERE user = ${USER}
                    ) r WHERE ABS(running - balance_precise) > 0.000001`
            )[0].n,
        )
    const orderLegs = async (orderId: string) =>
        (
            await db().credit_statements.findMany({
                where: { order_id: orderId },
                orderBy: { id: "asc" },
            })
        ).map((row) => ({
            type: row.type,
            amount: num(row.amount_precise),
            free_credit_issue_id: row.free_credit_issue_id,
        }))
    const issueFree = async (amount: number, expire_date?: string) =>
        (await credit.issueFreeCredit({ email: EMAIL, amount, expire_date } as never, asWidget)).issue_id
    /** `YYYY-MM-DD`, `days` from now in Beijing, the calendar callers state dates in. */
    const beijingDay = (days: number) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(Date.now() + days * 86_400_000))
    const cleanupLogs = () => db().admin_logs.deleteMany({ where: { user: { in: [ADMIN, USER] } } })

    beforeAll(async () => {
        await cleanupLogs()
        await cleanupFixtures()
        resetOrderSeq()
        credit = await get(CreditService)
        orders = await get(OrderService)
        // Balance 0, then 100 of paid credit through a real top-up: the chain
        // check sums the ledger from zero, so the opening balance is on it too.
        await seedWorld({ balance: 0 })
        const topUp = await seedOrder({
            amount: 100,
            is_credit_top_up: true,
            current_status: "completed",
            supported_payment_method: [],
        })
        await credit.issueCredit(await db().orders.findUniqueOrThrow({ where: { order_id: topUp } }))
    })

    afterAll(async () => {
        await cleanupLogs()
        await cleanupFixtures()
        await closeApp()
        await closeDb()
    })

    it("stores the day after the stated last day and returns the issue's id", async () => {
        const lastDay = beijingDay(30)
        const id = await issueFree(1, lastDay)

        const row = await db().free_credit_issues.findUniqueOrThrow({ where: { id } })
        const dayAfter = new Date(new Date(`${lastDay}T00:00:00Z`).getTime() + 86_400_000)
        expect(row.expire_date?.toISOString()).toBe(dayAfter.toISOString())
        expect(row.user).toBe(USER)

        // Out of the way of the cases below, which count free credit exactly.
        await credit.expireFreeCreditIssue(id, { reason: "itest cleanup" }, admin)
        expect(await chainBreaks()).toBe(0)
    })

    it("spends the named issue first, then the usual order, and a refund unwinds it last", async () => {
        const trial = await issueFree(100, beijingDay(30)) // expires soonest: the plain walk would take it first
        const named = await issueFree(100) // 730 days
        expect(await balance()).toBe(300)

        const orderId = await seedOrder({ amount: 150, priority_free_credit_issue_ids: [named] })
        await orders.payCreditOrder({ order_id: orderId }, asUser)

        expect(await orderLegs(orderId)).toEqual([
            { type: "consume", amount: -100, free_credit_issue_id: named },
            { type: "consume", amount: -50, free_credit_issue_id: null },
        ])
        expect(await issueBalance(named)).toBe(0)
        expect(await issueBalance(trial)).toBe(100)
        expect(await balance()).toBe(150)

        // A partial refund returns the paid leg first; the named credit is last.
        await db().$transaction((tx) => credit.refundCredit(70, orderId, USER, tx))
        const refunds = (await orderLegs(orderId)).filter((leg) => leg.type === "refund")
        expect(refunds).toEqual([
            { type: "refund", amount: 50, free_credit_issue_id: null },
            { type: "refund", amount: 20, free_credit_issue_id: named },
        ])
        expect(await issueBalance(named)).toBe(20)
        expect(await balance()).toBe(220)
        expect(await chainBreaks()).toBe(0)
    })

    it("takes back what is left, and a later refund does not put it back", async () => {
        const id = await issueFree(80)
        const orderId = await seedOrder({ amount: 30, priority_free_credit_issue_ids: [id] })
        await orders.payCreditOrder({ order_id: orderId }, asUser)
        expect(await issueBalance(id)).toBe(50)
        const before = await balance()

        const result = await credit.expireFreeCreditIssue(id, { reason: "itest trial ended" }, asWidget, {
            widgetTag: WIDGET,
        })

        expect(result.expired_amount).toBe(50)
        expect(await issueBalance(id)).toBe(0)
        expect(await balance()).toBe(before - 50)

        await db().$transaction((tx) => credit.refundCredit(30, orderId, USER, tx))
        expect(await issueBalance(id)).toBe(0)
        expect(await balance()).toBe(before - 50)
        expect(await chainBreaks()).toBe(0)
    })

    it("deducts once when two take-backs of one issue race", async () => {
        const id = await issueFree(40)
        const before = await balance()

        const results = await Promise.allSettled([
            credit.expireFreeCreditIssue(id, { reason: "itest race a" }, admin),
            credit.expireFreeCreditIssue(id, { reason: "itest race b" }, asWidget, { widgetTag: WIDGET }),
        ])

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
        expect(
            await db().credit_statements.count({ where: { free_credit_issue_id: id, type: "expire_free_credit" } }),
        ).toBe(1)
        expect(await balance()).toBe(before - 40)
        expect(await chainBreaks()).toBe(0)
    })

    it("skips a named issue that has run out and pays the usual way", async () => {
        const spent = await issueFree(10)
        await credit.expireFreeCreditIssue(spent, { reason: "itest spent" }, admin)
        const before = await balance()

        const orderId = await seedOrder({ amount: 5, priority_free_credit_issue_ids: [spent] })
        await orders.payCreditOrder({ order_id: orderId }, asUser)

        expect(await orderLegs(orderId)).toEqual([{ type: "consume", amount: -5, free_credit_issue_id: null }])
        expect(await balance()).toBe(before - 5)
        expect(await chainBreaks()).toBe(0)
    })

    it("refuses to pay an order that carries ids and allow_free_credit: false, moving nothing", async () => {
        const id = await issueFree(10)
        const before = await balance()
        const orderId = await seedOrder({ amount: 5, allow_free_credit: false, priority_free_credit_issue_ids: [id] })

        await expect(orders.payCreditOrder({ order_id: orderId }, asUser)).rejects.toThrow("does not allow free credit")
        expect(await orderLegs(orderId)).toEqual([])
        expect(await balance()).toBe(before)
    })
})
