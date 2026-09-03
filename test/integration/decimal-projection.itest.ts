import { closeApp, CreditService, get, OrderService } from "./helpers/app"
import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { EMAIL, seedOrder, seedWorld, USER, WIDGET, resetOrderSeq } from "./helpers/fixtures"
import { describeItest } from "./helpers/itest"

/**
 * What the golden baseline cannot prove.
 *
 * The baseline shows that reading through the precise columns leaves today's
 * responses byte-identical — but every amount in it is a whole credit, so it
 * says nothing about the direction of the floor, and a `TRUNC` or a `ROUND`
 * would pass it just as happily.
 *
 * Requests still reject decimals, so the fractions here are planted straight
 * into the precise columns. That is the only way to exercise this before #29,
 * and doing it now is the point: the projection gets falsified while no
 * fractional credit is in circulation and rolling back costs nothing.
 */
describeItest("decimal projection", () => {
    let credit: CreditService
    let orders: OrderService

    const asUser = { usernameShorted: USER, email: EMAIL } as never

    const setBalance = (precise: string) =>
        db().users.update({
            where: { username_in_be: USER },
            data: { current_credit_balance_precise: precise },
        })

    beforeAll(async () => {
        await cleanupFixtures()
        resetOrderSeq()
        credit = await get(CreditService)
        orders = await get(OrderService)
        await seedWorld({ balance: 1000 })
    })

    afterAll(async () => {
        await cleanupFixtures()
        await closeApp()
        await closeDb()
    })

    describe("balance", () => {
        it("floors a positive balance down, so spendable never overstates", async () => {
            await setBalance("100.600000")
            const balance = await credit.getUserCredits(USER)
            expect(balance.total_credit_balance).toBe(100)
            expect(balance.total_credit_balance_precise).toBe(100.6)
        })

        /**
         * The case that rules out `TRUNC`. There are negative balances in
         * production, and `TRUNC(-5.5)` is `-5` — a debt reported smaller than it
         * is. `FLOOR` goes to `-6`.
         */
        it("floors a negative balance away from zero, so debt is never understated", async () => {
            await setBalance("-5.500000")
            const balance = await credit.getUserCredits(USER)
            expect(balance.total_credit_balance).toBe(-6)
            expect(balance.total_credit_balance_precise).toBe(-5.5)
        })

        /** The case that rules out `ROUND`: 0.6 must not read as a spendable 1. */
        it("never rounds a sub-credit balance up to a spendable credit", async () => {
            await setBalance("0.600000")
            expect((await credit.getUserCredits(USER)).total_credit_balance).toBe(0)
        })

        it("reports the exact balance to the guard that sizes a spend", async () => {
            await setBalance("0.600000")
            const spendable = await credit.getSpendableBalance(USER)
            expect(spendable.total).toBe(0.6)
            expect(spendable.spendable).toBe(0.6)
        })
    })

    describe("aggregation", () => {
        /**
         * The reason the whole issue exists. Three sub-credit consumptions sum to
         * 1.2; flooring each row first sums them to 0. A report built the second
         * way loses a credit per row, without bound.
         */
        it("sums the exact column rather than the floored field", async () => {
            await setBalance("1000.000000")
            const orderId = await seedOrder({ amount: 1, current_status: "completed", paid_method: "credit" })
            for (const amount of ["-0.400000", "-0.400000", "-0.400000"]) {
                await db().credit_statements.create({
                    data: {
                        user: USER,
                        type: "consume",
                        amount: -1,
                        amount_precise: amount,
                        balance: 999,
                        balance_precise: "999.000000",
                        order_id: orderId,
                    } as never,
                })
            }

            const stats = await credit.getCreditStatictics(WIDGET)
            expect(stats.totalNoFreeCreditConsume._sum.amount).toBeCloseTo(-1.2, 6)

            const listed = await credit.getStatements({ page: "1", page_size: "10" } as never, asUser)
            const row = listed.statements.find((s) => s.amount_precise === -0.4)
            expect(row).toBeDefined()
            expect(row?.amount).toBe(-1)
        })
    })

    describe("order", () => {
        it("floors the legacy amount and keeps null a null", async () => {
            // The integer column is deliberately seeded to 8 — what a rounding write
            // would have left — so that reading 7 proves the response came from the
            // precise column and not from the integer one.
            const orderId = await seedOrder({ amount: 8, amount_precise: "7.900000" })
            const detail = await orders.getOrderDetail(orderId, asUser)
            expect(detail.amount).toBe(7)
            expect(detail.amount_precise).toBe(7.9)
            // Never paid with credit: the column is null and must stay null rather
            // than become a floored 0.
            expect(detail.credit_paid_amount).toBeNull()
            expect(detail.credit_paid_amount_precise).toBe(0)
        })
    })
})
