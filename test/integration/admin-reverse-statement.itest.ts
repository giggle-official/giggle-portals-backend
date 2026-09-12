import { closeApp, CreditService, get, OrderService } from "./helpers/app"
import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { EMAIL, seedOrder, seedWorld, USER, resetOrderSeq } from "./helpers/fixtures"
import { describeItest } from "./helpers/itest"

/**
 * Reversing a top-up on a real database.
 *
 * The 2026-09-04 ChinaPay replay was cleaned up by hand: delete the top_up
 * rows, decrement the balances. That rewrote history and left every statement
 * written between the phantom top-up and the cleanup with an after-balance
 * snapshot the user could see was wrong. This is the ledger's own way of doing
 * it: nothing deleted, nothing rewritten, and the assertion that matters is the
 * last one in each case — the user's ledger still chains, row by row, to the
 * balance.
 */
describeItest("admin reverse statement", () => {
    let credit: CreditService
    let orders: OrderService

    const asUser = { usernameShorted: USER, email: EMAIL } as never
    const admin = { usernameShorted: "zz_itest_admin" } as never

    const num = (value: unknown) => Number(value)
    const balance = async () =>
        num((await db().users.findUniqueOrThrow({ where: { username_in_be: USER } })).current_credit_balance_precise)
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
    const topUpOrder = (amount: number) =>
        seedOrder({
            amount: Math.floor(amount),
            amount_precise: amount,
            is_credit_top_up: true,
            current_status: "completed",
            supported_payment_method: [],
        })
    const issue = async (orderId: string) =>
        credit.issueCredit(await db().orders.findUniqueOrThrow({ where: { order_id: orderId } }))

    beforeAll(async () => {
        await cleanupFixtures()
        resetOrderSeq()
        credit = await get(CreditService)
        orders = await get(OrderService)
        // Balance 0, then a genuine top-up: the chain check sums the ledger from
        // zero, so the opening balance has to be on the ledger too.
        await seedWorld({ balance: 0 })
        await issue(await topUpOrder(100))
    })

    afterAll(async () => {
        await db().admin_logs.deleteMany({ where: { user: "zz_itest_admin" } })
        await cleanupFixtures()
        await closeApp()
        await closeDb()
    })

    it("reverses a fractional top-up that was already partly spent, without touching history", async () => {
        const phantom = await topUpOrder(10.5)
        await issue(phantom)
        await orders.payCreditOrder({ order_id: await seedOrder({ amount: 0, amount_precise: 0.25 }) }, asUser)
        await orders.payCreditOrder({ order_id: await seedOrder({ amount: 30, amount_precise: 30 }) }, asUser)
        expect(await balance()).toBe(80.25)
        const snapshotsBefore = (
            await db().credit_statements.findMany({ where: { user: USER }, orderBy: { id: "asc" } })
        ).map((r) => [r.id, num(r.balance_precise)])

        const topUp = await db().credit_statements.findFirstOrThrow({ where: { order_id: phantom } })
        const result = await credit.adminReverseStatement(topUp.id, { reason: "itest phantom top-up" }, admin)

        expect(result).toMatchObject({
            statement_id: topUp.id,
            user: USER,
            amount: 10.5,
            balance_before: 80.25,
            balance_after: 69.75,
            order_id: phantom,
            order_cancelled: true,
        })
        expect(await balance()).toBe(69.75)

        // The reversal: a top_up with the amount negated, the same order, linked both ways.
        const reversal = await db().credit_statements.findUniqueOrThrow({ where: { id: result.reversal_id } })
        expect(reversal).toMatchObject({
            user: USER,
            type: "top_up",
            amount: -11,
            order_id: phantom,
            reversal_of: topUp.id,
        })
        expect(num(reversal.amount_precise)).toBe(-10.5)
        expect(num(reversal.balance_precise)).toBe(69.75)
        expect(reversal.balance).toBe(69)
        expect((await db().credit_statements.findUniqueOrThrow({ where: { id: topUp.id } })).reversed_by).toBe(
            reversal.id,
        )

        // Every earlier row is exactly as it was.
        const snapshotsAfter = (
            await db().credit_statements.findMany({
                where: { user: USER, id: { lte: topUp.id + 2 } },
                orderBy: { id: "asc" },
            })
        ).map((r) => [r.id, num(r.balance_precise)])
        expect(snapshotsAfter).toEqual(snapshotsBefore)
        expect(await chainBreaks()).toBe(0)

        // The order is cancelled, not gone; sums over top_up net to the genuine 100.
        expect((await db().orders.findUniqueOrThrow({ where: { order_id: phantom } })).current_status).toBe("cancelled")
        const topUps = await db().credit_statements.aggregate({
            _sum: { amount_precise: true },
            where: { user: USER, type: "top_up" },
        })
        expect(num(topUps._sum.amount_precise)).toBe(100)

        const log = await db().admin_logs.findFirstOrThrow({ where: { user: "zz_itest_admin" } })
        expect(log.action).toBe("reverse_credit_statement")
        expect(log.data).toMatchObject({
            reason: "itest phantom top-up",
            reversal_id: reversal.id,
            balance_after: 69.75,
        })
    })

    it("drives the balance negative when the credit was fully spent, and reads it back as the debt it is", async () => {
        const phantom = await topUpOrder(500)
        await issue(phantom)
        await orders.payCreditOrder({ order_id: await seedOrder({ amount: 560, amount_precise: 560 }) }, asUser)
        expect(await balance()).toBe(9.75)

        const topUp = await db().credit_statements.findFirstOrThrow({ where: { order_id: phantom } })
        const result = await credit.adminReverseStatement(topUp.id, { reason: "itest spent" }, admin)

        expect(result.balance_after).toBe(-490.25)
        expect(await balance()).toBe(-490.25)
        expect((await credit.getUserCredits(USER)).total_credit_balance).toBe(-491)
        expect(await chainBreaks()).toBe(0)
    })

    it("refuses to reverse twice, to reverse a reversal, or to reverse a consumption", async () => {
        const reversed = await db().credit_statements.findFirstOrThrow({
            where: { user: USER, reversed_by: { not: null } },
        })
        await expect(credit.adminReverseStatement(reversed.id, { reason: "x" }, admin)).rejects.toThrow(
            "already reversed",
        )

        const reversal = await db().credit_statements.findFirstOrThrow({
            where: { user: USER, reversal_of: { not: null } },
        })
        await expect(credit.adminReverseStatement(reversal.id, { reason: "x" }, admin)).rejects.toThrow(
            "A reversal cannot itself be reversed",
        )

        const consume = await db().credit_statements.findFirstOrThrow({ where: { user: USER, type: "consume" } })
        await expect(credit.adminReverseStatement(consume.id, { reason: "x" }, admin)).rejects.toThrow(
            "Only top_up statements can be reversed",
        )
        expect(await chainBreaks()).toBe(0)
    })

    it("shows both rows in the user's statement list, the reversal marked as such", async () => {
        const list = await credit.getStatements({ page: 1, page_size: 50, type: "top_up" } as never, asUser)
        const rows = list.statements.map((s) => ({
            amount: s.amount_precise,
            reversal_of: s.reversal_of,
            reversed_by: s.reversed_by,
        }))
        expect(rows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ amount: 10.5, reversed_by: expect.any(Number) }),
                expect.objectContaining({ amount: -10.5, reversal_of: expect.any(Number) }),
                expect.objectContaining({ amount: 100, reversal_of: null, reversed_by: null }),
            ]),
        )
    })
})
