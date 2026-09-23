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
        const result = await credit.adminReverseStatement(
            topUp.id,
            { amount: 10.5, reason: "itest phantom top-up" },
            admin,
        )

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
        const result = await credit.adminReverseStatement(topUp.id, { amount: 500, reason: "itest spent" }, admin)

        expect(result.balance_after).toBe(-490.25)
        expect(await balance()).toBe(-490.25)
        expect((await credit.getUserCredits(USER)).total_credit_balance).toBe(-491)
        expect(await chainBreaks()).toBe(0)
    })

    it("refuses to reverse twice, to reverse a reversal, or to reverse a consumption", async () => {
        const reversed = await db().credit_statements.findFirstOrThrow({
            where: { user: USER, reversed_by: { not: null } },
        })
        await expect(credit.adminReverseStatement(reversed.id, { amount: 1, reason: "x" }, admin)).rejects.toThrow(
            "already reversed",
        )

        const reversal = await db().credit_statements.findFirstOrThrow({
            where: { user: USER, reversal_of: { not: null } },
        })
        await expect(credit.adminReverseStatement(reversal.id, { amount: 1, reason: "x" }, admin)).rejects.toThrow(
            "A reversal cannot itself be reversed",
        )

        const consume = await db().credit_statements.findFirstOrThrow({ where: { user: USER, type: "consume" } })
        await expect(credit.adminReverseStatement(consume.id, { amount: 1, reason: "x" }, admin)).rejects.toThrow(
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

    /**
     * The 2026-09-23 case, in miniature: a top-up that was mostly right. Only the
     * over-issued part comes back, and the top-up itself has to survive it, or the
     * 933,400 that was legitimately bought stops counting as a top-up.
     */
    describe("clawing back part of a top-up", () => {
        let statementId: number
        let orderId: string

        beforeAll(async () => {
            orderId = await topUpOrder(1000)
            await issue(orderId)
            statementId = (await db().credit_statements.findFirstOrThrow({ where: { order_id: orderId } })).id
        })

        it("takes only the amount asked for and leaves the top-up standing", async () => {
            const before = await balance()

            const result = await credit.adminReverseStatement(
                statementId,
                { amount: 66.6, reason: "itest over-issued" },
                admin,
            )

            expect(result).toMatchObject({
                amount: 66.6,
                statement_amount: 1000,
                reversed_total: 66.6,
                fully_reversed: false,
                order_cancelled: false,
            })
            expect(await balance()).toBe(before - 66.6)

            const original = await db().credit_statements.findUniqueOrThrow({ where: { id: statementId } })
            expect(original.reversed_by).toBeNull()
            expect(num(original.amount_precise)).toBe(1000)
            const order = await db().orders.findUniqueOrThrow({ where: { order_id: orderId } })
            expect(order.current_status).toBe("completed")
        })

        /** Sums net to what should have been issued; the top-up still counts as one. */
        it("nets to the amount that should have been issued", async () => {
            const [row] = await db().$queryRaw<{ net: unknown; live: bigint | number }[]>`
                SELECT COALESCE(SUM(amount_precise), 0) net,
                       SUM(CASE WHEN reversal_of IS NULL AND reversed_by IS NULL THEN 1 ELSE 0 END) live
                  FROM credit_statements
                 WHERE user = ${USER} AND order_id = ${orderId}`
            expect(num(row.net)).toBe(933.4)
            expect(Number(row.live)).toBe(1)
            expect(await chainBreaks()).toBe(0)
        })

        it("refuses to claw back more than is left, and moves nothing when it refuses", async () => {
            const before = await balance()
            const rows = await db().credit_statements.count({ where: { user: USER } })

            await expect(
                credit.adminReverseStatement(statementId, { amount: 933.41, reason: "itest too much" }, admin),
            ).rejects.toThrow(/only 933.4 of statement .* is left unreversed/)

            expect(await balance()).toBe(before)
            expect(await db().credit_statements.count({ where: { user: USER } })).toBe(rows)
        })

        it("marks the top-up reversed and cancels its order only once nothing is left", async () => {
            const result = await credit.adminReverseStatement(
                statementId,
                { amount: 933.4, reason: "itest the rest" },
                admin,
            )

            expect(result).toMatchObject({ reversed_total: 1000, fully_reversed: true, order_cancelled: true })

            const original = await db().credit_statements.findUniqueOrThrow({ where: { id: statementId } })
            expect(original.reversed_by).toBe(result.reversal_id)
            const order = await db().orders.findUniqueOrThrow({ where: { order_id: orderId } })
            expect(order.current_status).toBe("cancelled")

            await expect(
                credit.adminReverseStatement(statementId, { amount: 1, reason: "itest again" }, admin),
            ).rejects.toThrow("already reversed")
            expect(await chainBreaks()).toBe(0)
        })
    })
})
