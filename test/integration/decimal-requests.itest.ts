import { closeApp, CreditLineService, CreditService, get, OrderService } from "./helpers/app"
import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { EMAIL, seedOrder, seedWorld, USER, WIDGET, resetOrderSeq } from "./helpers/fixtures"
import { describeItest, itestId } from "./helpers/itest"

/**
 * Fractional credit, end to end, on a real database.
 *
 * `decimal-projection.itest.ts` planted fractions straight into the precise
 * columns to prove the read side. This is the write side: fractions arrive
 * through the services, and the question is whether the legacy integer column
 * beside every precise column still equals its floor afterwards.
 *
 * That is the invariant that replaces the old "the two columns are equal"
 * reconciliation. It is easy to keep on a row that is written once, and easy to
 * lose on a balance that accumulates: `{ decrement: 0.5 }` applied ten times to
 * an integer column takes it down by 10 or by 0, never by 5. The balance walks
 * below exercise exactly that.
 */
describeItest("decimal requests", () => {
    let credit: CreditService
    let creditLine: CreditLineService
    let orders: OrderService

    const asUser = { usernameShorted: USER, email: EMAIL } as never
    const asWidget = { usernameShorted: USER, email: EMAIL, developer_info: { tag: WIDGET } } as never

    const num = (value: unknown) => Number(value)
    const user = () => db().users.findUniqueOrThrow({ where: { username_in_be: USER } })
    const setBalance = (precise: number) =>
        db().users.update({
            where: { username_in_be: USER },
            data: { current_credit_balance_precise: precise, current_credit_balance: Math.floor(precise) },
        })
    /** A pending order worth a fraction of a credit, integer column already at the floor. */
    const fractionalOrder = (amount: number, overrides: Record<string, unknown> = {}) =>
        seedOrder({ amount: Math.floor(amount), amount_precise: amount, ...overrides })

    beforeAll(async () => {
        await cleanupFixtures()
        resetOrderSeq()
        credit = await get(CreditService)
        creditLine = await get(CreditLineService)
        orders = await get(OrderService)
        await seedWorld({ balance: 1000 })
    })

    afterAll(async () => {
        await cleanupFixtures()
        await closeApp()
        await closeDb()
    })

    describe("paying with credit", () => {
        it("ten payments of 0.5 take exactly 5 off the balance, and the integer column follows the floor", async () => {
            for (let i = 0; i < 10; i++) {
                await orders.payCreditOrder({ order_id: await fractionalOrder(0.5) }, asUser)
            }

            const u = await user()
            expect(num(u.current_credit_balance_precise)).toBe(995)
            expect(u.current_credit_balance).toBe(995)

            const rows = await db().credit_statements.findMany({
                where: { user: USER, type: "consume" },
                orderBy: { id: "asc" },
            })
            expect(rows.map((r) => num(r.balance_precise))).toEqual([
                999.5, 999, 998.5, 998, 997.5, 997, 996.5, 996, 995.5, 995,
            ])
            for (const row of rows) {
                expect(num(row.amount_precise)).toBe(-0.5)
                // Floor, not trunc: half a credit spent is recorded as a whole one.
                expect(row.amount).toBe(-1)
                expect(row.balance).toBe(Math.floor(num(row.balance_precise)))
            }
        })

        it("records the exact amount on the order and its floor beside it", async () => {
            const id = await fractionalOrder(0.75)
            const detail = await orders.payCreditOrder({ order_id: id }, asUser)

            expect(detail.credit_paid_amount_precise).toBe(0.75)
            expect(detail.credit_paid_amount).toBe(0)

            const row = await db().orders.findUniqueOrThrow({ where: { order_id: id } })
            expect(num(row.credit_paid_amount_precise)).toBe(0.75)
            expect(row.credit_paid_amount).toBe(0)
            expect(num((await user()).current_credit_balance_precise)).toBe(994.25)
        })
    })

    describe("issuing", () => {
        it("issues a fractional top-up", async () => {
            const id = await fractionalOrder(10.25, {
                is_credit_top_up: true,
                current_status: "completed",
                supported_payment_method: [],
            })
            await credit.issueCredit(await db().orders.findUniqueOrThrow({ where: { order_id: id } }))

            const statement = await db().credit_statements.findFirstOrThrow({ where: { order_id: id } })
            expect(num(statement.amount_precise)).toBe(10.25)
            expect(statement.amount).toBe(10)
            expect(num((await user()).current_credit_balance_precise)).toBe(1004.5)
            expect((await user()).current_credit_balance).toBe(1004)
        })

        it("issues fractional subscription credit from the precise column, not the integer one", async () => {
            await db().widget_subscription_credit_issues.create({
                data: {
                    user_id: USER,
                    widget_tag: WIDGET,
                    subscription_id: itestId("sub"),
                    is_issue: false,
                    issue_credits: 2,
                    issue_credits_precise: 2.5,
                    current_balance: 2,
                    current_balance_precise: 2.5,
                    issue_date: new Date(Date.now() - 60_000),
                    expire_date: new Date("2099-01-01"),
                } as never,
            })

            await credit.issueWidgetSubscriptionCredit(itestId("sub"))

            const statement = await db().credit_statements.findFirstOrThrow({
                where: { user: USER, type: "issue_subscription_credit" },
            })
            expect(num(statement.amount_precise)).toBe(2.5)
            expect(statement.amount).toBe(2)
            expect(num((await user()).current_credit_balance_precise)).toBe(1007)
        })

        it("spends a fraction of the subscription bucket and mirrors the floor on the issue row", async () => {
            await orders.payCreditOrder({ order_id: await fractionalOrder(1.25) }, asUser)

            const issue = await db().widget_subscription_credit_issues.findFirstOrThrow({
                where: { user_id: USER, subscription_id: itestId("sub") },
            })
            expect(num(issue.current_balance_precise)).toBe(1.25)
            expect(issue.current_balance).toBe(1)
        })
    })

    describe("free credit", () => {
        let paidOrder: string

        beforeAll(async () => {
            // Free credit burns last, so the paid and subscription balance has to be
            // gone for these to reach the free bucket. Set the balance to exactly
            // the free credit about to be issued, on top of nothing.
            await db().widget_subscription_credit_issues.updateMany({
                where: { user_id: USER },
                data: { current_balance: 0, current_balance_precise: 0 },
            })
            await setBalance(0)
        })

        it("issues a fraction and keeps the bucket findable once it drops below one credit", async () => {
            await credit.issueFreeCredit({ email: EMAIL, amount: 1.5, description: "decimal" } as never, asWidget)

            const issue = await db().free_credit_issues.findFirstOrThrow({ where: { user: USER } })
            expect(num(issue.balance_precise)).toBe(1.5)
            expect(issue.balance).toBe(1)

            paidOrder = await fractionalOrder(0.7)
            await orders.payCreditOrder({ order_id: paidOrder }, asUser)

            const after = await db().free_credit_issues.findUniqueOrThrow({ where: { id: issue.id } })
            expect(num(after.balance_precise)).toBe(0.8)
            // The integer column now reads 0 for a bucket that still holds 0.8.
            // Everything that looks for spendable free credit has to filter on the
            // precise column, or this bucket becomes unspendable and unrefundable.
            expect(after.balance).toBe(0)

            const detail = await orders.payCreditOrder({ order_id: await fractionalOrder(0.3) }, asUser)
            expect(detail.free_credit_paid_precise).toBe(0.3)
            expect(
                num((await db().free_credit_issues.findUniqueOrThrow({ where: { id: issue.id } })).balance_precise),
            ).toBe(0.5)
        })

        it("refunds fractions back into the bucket and walks the order to REFUNDED on the precise total", async () => {
            const partial = await orders.refundOrder({ order_id: paidOrder, refund_amount: 0.3 })
            expect(partial.current_status).toBe("partial_refunded")
            expect(partial.refunded_amount_precise).toBe(0.3)
            expect(partial.refunded_amount).toBe(0)

            const full = await orders.refundOrder({ order_id: paidOrder, refund_amount: 0.4 })
            expect(full.current_status).toBe("refunded")
            expect(full.refunded_amount_precise).toBe(0.7)
            expect(full.refunded_amount).toBe(0)

            const issue = await db().free_credit_issues.findFirstOrThrow({ where: { user: USER } })
            expect(num(issue.balance_precise)).toBe(1.2)
            expect(issue.balance).toBe(1)

            const refunds = await db().credit_statements.findMany({
                where: { user: USER, type: "refund", order_id: paidOrder },
                orderBy: { id: "asc" },
            })
            expect(refunds.map((r) => num(r.amount_precise))).toEqual([0.3, 0.4])
            expect(refunds.map((r) => r.amount)).toEqual([0, 0])
        })
    })

    describe("credit line", () => {
        it("grants, charges and repays fractions", async () => {
            await setBalance(10)
            const granted = await creditLine.grantCreditLine({ email: EMAIL, credit_limit: 0.5 } as never, asWidget)
            expect(granted.credit_limit).toBe(0.5)

            await orders.payCreditLineOrder({ order_id: await fractionalOrder(0.25) }, asUser)
            const line = await db().user_credit_lines.findFirstOrThrow({ where: { user: USER, widget_tag: WIDGET } })
            expect(num(line.used)).toBe(0.25)

            await creditLine.repayCreditLine({ widget_tag: WIDGET, amount: 0.25, request_id: itestId("repay") }, asUser)
            const repaid = await db().user_credit_lines.findUniqueOrThrow({ where: { id: line.id } })
            expect(num(repaid.used)).toBe(0)
            expect(num((await user()).current_credit_balance_precise)).toBe(9.75)
        })
    })

    describe("the invariant that replaces reconciliation", () => {
        /**
         * The old check was `legacy = precise` on every pair. From this step on it
         * is `COALESCE(legacy, 0) = FLOOR(precise)`, and after everything above has
         * run there must not be a single row of the fixture user's that breaks it.
         */
        it("every legacy integer column is the floor of its precise twin", async () => {
            const count = async (sql: Promise<{ n: bigint | number }[]>) => Number((await sql)[0].n)

            expect(
                await count(db().$queryRaw`
                    SELECT COUNT(*) n FROM users
                    WHERE username_in_be = ${USER}
                      AND COALESCE(current_credit_balance, 0) <> FLOOR(current_credit_balance_precise)`),
            ).toBe(0)
            expect(
                await count(db().$queryRaw`
                    SELECT COUNT(*) n FROM credit_statements
                    WHERE user = ${USER}
                      AND (COALESCE(amount, 0) <> FLOOR(amount_precise) OR COALESCE(balance, 0) <> FLOOR(balance_precise))`),
            ).toBe(0)
            expect(
                await count(db().$queryRaw`
                    SELECT COUNT(*) n FROM orders
                    WHERE owner = ${USER}
                      AND (COALESCE(amount, 0) <> FLOOR(amount_precise)
                        OR COALESCE(credit_paid_amount, 0) <> FLOOR(credit_paid_amount_precise)
                        OR COALESCE(free_credit_paid, 0) <> FLOOR(free_credit_paid_precise)
                        OR COALESCE(refunded_amount, 0) <> FLOOR(refunded_amount_precise))`),
            ).toBe(0)
            expect(
                await count(db().$queryRaw`
                    SELECT COUNT(*) n FROM free_credit_issues
                    WHERE user = ${USER}
                      AND (COALESCE(amount, 0) <> FLOOR(amount_precise) OR COALESCE(balance, 0) <> FLOOR(balance_precise))`),
            ).toBe(0)
            expect(
                await count(db().$queryRaw`
                    SELECT COUNT(*) n FROM widget_subscription_credit_issues
                    WHERE user_id = ${USER}
                      AND (COALESCE(issue_credits, 0) <> FLOOR(issue_credits_precise)
                        OR COALESCE(current_balance, 0) <> FLOOR(current_balance_precise))`),
            ).toBe(0)
        })
    })
})
