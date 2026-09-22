import { closeApp, CreditService, get } from "./helpers/app"
import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { EMAIL, seedOrder, seedWorld, USER, WIDGET, resetOrderSeq } from "./helpers/fixtures"
import { describeItest, itestId } from "./helpers/itest"

/**
 * Credit transfer, on a real database.
 *
 * The thing worth proving here is not that the balance moves. It is that the
 * sender's *buckets* move with it. Subscription credit is held per issue row,
 * and a transfer that took the amount off `current_credit_balance` alone would
 * leave those rows holding credit the balance no longer has, which the spend
 * path would then hand out a second time. A mock cannot catch that; only the
 * ledger can.
 *
 * The other half is that the two accounts stay in step: what leaves one arrives
 * at the other, exactly once, however many times the request is retried.
 */
describeItest("credit transfer", () => {
    let credit: CreditService

    const PEER = itestId("u2")
    const PEER_EMAIL = `${PEER}@example.com`
    const asSender = { usernameShorted: USER, email: EMAIL } as never

    const num = (value: unknown) => Number(value)
    const balanceOf = async (user: string) =>
        num((await db().users.findUniqueOrThrow({ where: { username_in_be: user } })).current_credit_balance_precise)

    /** Every statement row of one user, oldest first. */
    const statementsOf = (user: string) => db().credit_statements.findMany({ where: { user }, orderBy: { id: "asc" } })

    /**
     * The invariant the whole ledger rests on: walking the statements in order
     * and adding up `amount_precise` must reproduce every `balance_precise`
     * snapshot along the way. Counts the rows where it does not.
     */
    const chainBreaks = async (user: string) => {
        const [row] = await db().$queryRaw<{ n: bigint | number }[]>`
            SELECT COUNT(*) n FROM (
                SELECT balance_precise,
                       SUM(amount_precise) OVER (ORDER BY id) AS running
                  FROM credit_statements WHERE user = ${user}
            ) walk WHERE balance_precise <> running`
        return Number(row.n)
    }

    beforeAll(async () => {
        await cleanupFixtures()
        resetOrderSeq()
        credit = await get(CreditService)
        // Balance seeded at zero and then bought: `seedWorld({ balance })` moves the
        // balance without writing a statement, which would break the chain check
        // above before the first transfer ever ran.
        await seedWorld({ balance: 0 })
        await db().users.create({
            data: {
                username_in_be: PEER,
                username: PEER,
                email: PEER_EMAIL,
                password: itestId("not_a_login"),
                current_credit_balance: 0,
                current_credit_balance_precise: 0,
            } as never,
        })
    })

    afterAll(async () => {
        await cleanupFixtures()
        await closeApp()
        await closeDb()
    })

    /** A completed top-up order, issued as real paid credit through the service. */
    const buyCredit = async (amount: number) => {
        const id = await seedOrder({
            amount: Math.floor(amount),
            amount_precise: amount,
            is_credit_top_up: true,
            current_status: "completed",
            supported_payment_method: [],
        })
        await credit.issueCredit(await db().orders.findUniqueOrThrow({ where: { order_id: id } }))
    }

    describe("a transfer out of mixed buckets", () => {
        let transferId: string

        beforeAll(async () => {
            await buyCredit(100)
            // 40 credits of subscription on top, held on its own issue row.
            await db().widget_subscription_credit_issues.create({
                data: {
                    user_id: USER,
                    widget_tag: WIDGET,
                    subscription_id: itestId("sub"),
                    is_issue: false,
                    issue_credits: 40,
                    issue_credits_precise: 40,
                    current_balance: 40,
                    current_balance_precise: 40,
                    issue_date: new Date(Date.now() - 60_000),
                    expire_date: new Date("2099-01-01"),
                } as never,
            })
            await credit.issueWidgetSubscriptionCredit(itestId("sub"))
            // 25 free credits, which must not move.
            await credit.issueFreeCredit(
                { email: EMAIL, amount: 25, description: "gift" } as never,
                { usernameShorted: USER, email: EMAIL, developer_info: { tag: WIDGET } } as never,
            )
        })

        it("moves paid and subscription credit but leaves the gift behind", async () => {
            expect(await balanceOf(USER)).toBe(165)
            // 140 of the 165 is transferable: everything except the 25 free.
            await expect(
                credit.transferCredit(
                    { to_email: PEER_EMAIL, amount: 140.5, request_id: itestId("over") } as never,
                    asSender,
                ),
            ).rejects.toThrow(/Free credit cannot be transferred/)

            const result = await credit.transferCredit(
                { to_email: PEER_EMAIL, amount: 60.5, request_id: itestId("r1"), memo: "lunch" } as never,
                asSender,
            )
            transferId = result.transfer_id

            expect(result).toMatchObject({ to_email: PEER_EMAIL, amount_precise: 60.5, amount: 60, duplicate: false })
            expect(await balanceOf(USER)).toBe(104.5)
            expect(await balanceOf(PEER)).toBe(60.5)
        })

        /**
         * The point of the whole exercise. Subscription is spent first, so 40 of the
         * 60.5 comes off the issue row and the remaining 20.5 off the paid residual.
         * An issue row left at 40 here would mean the sender can spend that credit
         * again, having already given it away.
         */
        it("takes the subscription issue row down with the balance", async () => {
            const issue = await db().widget_subscription_credit_issues.findFirstOrThrow({
                where: { user_id: USER, subscription_id: itestId("sub") },
            })
            expect(num(issue.current_balance_precise)).toBe(0)
            expect(issue.current_balance).toBe(0)

            const free = await db().free_credit_issues.findFirstOrThrow({ where: { user: USER } })
            expect(num(free.balance_precise)).toBe(25)
        })

        it("writes one leg per bucket on the way out and a single row on the way in", async () => {
            const out = (await statementsOf(USER)).filter((row) => row.type === "transfer_out")
            expect(out.map((row) => num(row.amount_precise))).toEqual([-40, -20.5])
            expect(out.every((row) => row.transfer_peer === PEER)).toBe(true)
            expect(out.every((row) => row.order_id === transferId)).toBe(true)
            // Floor, not trunc: half a credit given away is recorded as a whole one.
            expect(out.map((row) => row.amount)).toEqual([-40, -21])

            const incoming = (await statementsOf(PEER)).filter((row) => row.type === "transfer_in")
            expect(incoming).toHaveLength(1)
            expect(num(incoming[0].amount_precise)).toBe(60.5)
            expect(incoming[0].transfer_peer).toBe(USER)
            expect(incoming[0].order_id).toBe(transferId)
            // The recipient never subscribed to anything, so this is plain paid credit.
            expect(incoming[0].is_subscription_credit).toBeFalsy()
            expect(incoming[0].is_free_credit).toBeFalsy()
        })

        it("leaves both ledgers walkable, and logs the transfer once", async () => {
            expect(await chainBreaks(USER)).toBe(0)
            expect(await chainBreaks(PEER)).toBe(0)

            const log = await db().credit_transfers.findUniqueOrThrow({ where: { transfer_id: transferId } })
            expect(log).toMatchObject({ from_user: USER, to_user: PEER, amount: 60, memo: "lunch" })
            expect(num(log.amount_precise)).toBe(60.5)
        })

        /** What arrived is spendable like any other paid credit, including onward. */
        it("lets the recipient send it on again", async () => {
            await credit.transferCredit(
                { to_email: EMAIL, amount: 0.5, request_id: itestId("back") } as never,
                { usernameShorted: PEER, email: PEER_EMAIL } as never,
            )
            expect(await balanceOf(PEER)).toBe(60)
            expect(await balanceOf(USER)).toBe(105)
            expect(await chainBreaks(PEER)).toBe(0)
        })
    })

    describe("retries", () => {
        it("replays the same request_id instead of sending twice", async () => {
            const before = await balanceOf(USER)
            const first = await credit.transferCredit(
                { to_email: PEER_EMAIL, amount: 5, request_id: itestId("once") } as never,
                asSender,
            )
            const again = await credit.transferCredit(
                { to_email: PEER_EMAIL, amount: 5, request_id: itestId("once") } as never,
                asSender,
            )

            expect(again.transfer_id).toBe(first.transfer_id)
            expect(first.duplicate).toBe(false)
            expect(again.duplicate).toBe(true)
            expect(await balanceOf(USER)).toBe(before - 5)
        })

        /**
         * Two retries fired without awaiting the first. Whether the pool lets them
         * overlap or serialises them, the assertion is the same and is the one that
         * matters: one transfer, one debit.
         */
        it("sends once when two identical requests are fired together", async () => {
            const before = await balanceOf(USER)
            const send = () =>
                credit.transferCredit(
                    { to_email: PEER_EMAIL, amount: 7, request_id: itestId("race") } as never,
                    asSender,
                )

            const results = await Promise.allSettled([send(), send()])
            expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2)

            expect(await balanceOf(USER)).toBe(before - 7)
            expect(await db().credit_transfers.count({ where: { from_user: USER, request_id: itestId("race") } })).toBe(
                1,
            )
            expect(await chainBreaks(USER)).toBe(0)
        })

        /**
         * The last line of defence, checked against the database rather than the
         * service: even if two callers got past every check above, the index will
         * not hold two transfers with one sender's request id.
         */
        it("cannot store two transfers under one sender's request id", async () => {
            const existing = await db().credit_transfers.findFirstOrThrow({
                where: { from_user: USER, request_id: itestId("once") },
            })
            await expect(
                db().credit_transfers.create({
                    data: {
                        transfer_id: itestId("dup"),
                        from_user: existing.from_user,
                        to_user: existing.to_user,
                        amount: 1,
                        amount_precise: 1,
                        request_id: itestId("once"),
                    } as never,
                }),
            ).rejects.toThrow()
        })
    })

    describe("limits and refusals", () => {
        it("refuses an unknown recipient rather than creating an account for it", async () => {
            await expect(
                credit.transferCredit(
                    { to_email: "nobody@example.invalid", amount: 1, request_id: itestId("ghost") } as never,
                    asSender,
                ),
            ).rejects.toThrow(/Recipient account not found/)
            expect(await db().users.count({ where: { email: "nobody@example.invalid" } })).toBe(0)
        })

        it("refuses a transfer to yourself", async () => {
            await expect(
                credit.transferCredit({ to_email: EMAIL, amount: 1, request_id: itestId("self") } as never, asSender),
            ).rejects.toThrow(/yourself/)
        })

        it("honours a per-account cap over the global default", async () => {
            await db().users.update({
                where: { username_in_be: USER },
                data: { transfer_max_amount: 2 } as never,
            })
            await expect(
                credit.transferCredit(
                    { to_email: PEER_EMAIL, amount: 3, request_id: itestId("capped") } as never,
                    asSender,
                ),
            ).rejects.toThrow(/may not exceed 2/)

            const limit = await credit.getTransferLimit(USER)
            expect(limit.max_amount).toBe(2)
            expect(limit.used_today).toBeGreaterThan(0)

            await db().users.update({
                where: { username_in_be: USER },
                data: { transfer_max_amount: null } as never,
            })
        })

        it("stops the account once it has used its allowance of transfers for the day", async () => {
            await db().users.update({
                where: { username_in_be: USER },
                data: { transfer_max_daily_count: 1 } as never,
            })
            await expect(
                credit.transferCredit(
                    { to_email: PEER_EMAIL, amount: 1, request_id: itestId("daily") } as never,
                    asSender,
                ),
            ).rejects.toThrow(/Daily transfer limit/)

            await db().users.update({
                where: { username_in_be: USER },
                data: { transfer_max_daily_count: null } as never,
            })
        })

        /** A refusal must leave nothing behind: no statement, no log row, no balance move. */
        it("moves nothing at all when it refuses", async () => {
            const before = await balanceOf(USER)
            const rows = (await statementsOf(USER)).length

            await expect(
                credit.transferCredit(
                    { to_email: PEER_EMAIL, amount: 1_000_000, request_id: itestId("huge") } as never,
                    asSender,
                ),
            ).rejects.toThrow()

            expect(await balanceOf(USER)).toBe(before)
            expect((await statementsOf(USER)).length).toBe(rows)
            expect(await db().credit_transfers.count({ where: { request_id: itestId("huge") } })).toBe(0)
        })
    })

    describe("what the two sides add up to", () => {
        /**
         * No money enters or leaves the system in a transfer, so the two accounts'
         * balances together must be exactly what was bought and granted between
         * them, and every legacy integer column must still be the floor of its
         * precise twin.
         */
        it("conserves credit across both accounts and keeps the floors honest", async () => {
            const [senderBalance, peerBalance] = [await balanceOf(USER), await balanceOf(PEER)]
            const [issued] = await db().$queryRaw<{ total: unknown }[]>`
                SELECT COALESCE(SUM(amount_precise), 0) total FROM credit_statements
                 WHERE user IN (${USER}, ${PEER})`
            expect(num(issued.total)).toBe(senderBalance + peerBalance)

            const [broken] = await db().$queryRaw<{ n: bigint | number }[]>`
                SELECT COUNT(*) n FROM credit_statements
                 WHERE user IN (${USER}, ${PEER})
                   AND (COALESCE(amount, 0) <> FLOOR(amount_precise)
                     OR COALESCE(balance, 0) <> FLOOR(balance_precise))`
            expect(Number(broken.n)).toBe(0)

            const [users] = await db().$queryRaw<{ n: bigint | number }[]>`
                SELECT COUNT(*) n FROM users
                 WHERE username_in_be IN (${USER}, ${PEER})
                   AND COALESCE(current_credit_balance, 0) <> FLOOR(current_credit_balance_precise)`
            expect(Number(users.n)).toBe(0)
        })
    })
})
