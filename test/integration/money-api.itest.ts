import { closeApp, CreditLineService, CreditService, get, OrderService } from "./helpers/app"
import { cleanupFixtures, closeDb, db, waitPastFixtureClock } from "./helpers/db"
import { EMAIL, seedOrder, seedWorld, USER, WIDGET, resetOrderSeq } from "./helpers/fixtures"
import { describeItest } from "./helpers/itest"
import { matchGolden } from "./helpers/snapshot"

/**
 * The baseline that the decimal-credit work has to stay identical to.
 *
 * Everything here runs on whole-credit amounts, which is what every integrator
 * sends today. Once credit amounts move to `DECIMAL` internally, these
 * responses must still serialise byte-for-byte the same — that is the entire
 * promise of the first phase, and eyeballing a diff is not a way to keep it.
 *
 * The comparison is on `JSON.stringify` output rather than the objects, because
 * the failure this is guarding against is invisible in memory: a Prisma
 * `Decimal` passes every value assertion and only shows itself on the wire, as
 * `"100"` where `100` used to be.
 */
describeItest("money API golden baseline", () => {
    let credit: CreditService
    let creditLine: CreditLineService
    let orders: OrderService

    const asUser = { usernameShorted: USER, email: EMAIL } as never
    const asWidget = { usernameShorted: USER, email: EMAIL, developer_info: { tag: WIDGET } } as never

    beforeAll(async () => {
        await cleanupFixtures()
        resetOrderSeq()
        credit = await get(CreditService)
        creditLine = await get(CreditLineService)
        orders = await get(OrderService)
        await seedWorld({ balance: 5000 })
    })

    afterAll(async () => {
        await cleanupFixtures()
        await closeApp()
        await closeDb()
    })

    describe("credit balance and statement", () => {
        it("balance", async () => {
            matchGolden("credit.balance", await credit.getUserCredits(USER))
        })

        it("spendable balance breakdown", async () => {
            matchGolden("credit.spendable", await credit.getSpendableBalance(USER))
        })

        it("repayable balance", async () => {
            matchGolden("credit.repayable", { repayable: await credit.getRepayableBalance(USER) })
        })
    })

    describe("paying an order with credit", () => {
        it("order detail after payment", async () => {
            const id = await seedOrder({ amount: 300 })
            const detail = await orders.payCreditOrder({ order_id: id }, asUser)
            matchGolden("order.pay-with-credit", detail)
        })

        it("the statement rows it produced", async () => {
            const rows = await db().credit_statements.findMany({
                where: { user: USER },
                orderBy: { id: "asc" },
                select: { type: true, amount: true, balance: true, is_free_credit: true },
            })
            matchGolden("credit.statement-rows", rows)
        })

        it("balance after payment", async () => {
            matchGolden("credit.balance-after-pay", await credit.getUserCredits(USER))
        })
    })

    describe("refunding a credit order", () => {
        it("order detail after a partial refund", async () => {
            const id = await seedOrder({ amount: 400 })
            await orders.payCreditOrder({ order_id: id }, asUser)
            matchGolden("order.refund-partial", await orders.refundOrder({ order_id: id, refund_amount: 150 }))
        })
    })

    describe("credit line", () => {
        it("grant", async () => {
            matchGolden("credit-line.grant", await creditLine.grantCreditLine({ email: EMAIL, credit_limit: 1000 }, asWidget))
        })

        it("widget view of a user's line", async () => {
            matchGolden("credit-line.widget", await creditLine.getWidgetCreditLine(EMAIL, asWidget))
        })

        it("user's list of lines", async () => {
            matchGolden("credit-line.list", await creditLine.getUserCreditLines(asUser))
        })

        it("paying an order with the line", async () => {
            const id = await seedOrder({ amount: 250 })
            matchGolden("order.pay-with-credit-line", await orders.payCreditLineOrder({ order_id: id }, asUser))
        })

        it("repayment", async () => {
            matchGolden(
                "credit-line.repay",
                await creditLine.repayCreditLine({ widget_tag: WIDGET, amount: 100, request_id: "golden" }, asUser),
            )
        })

        it("statement", async () => {
            matchGolden("credit-line.statement", await creditLine.getStatements({ widget_tag: WIDGET } as never, asUser))
        })
    })

    describe("free credit", () => {
        it("issue", async () => {
            matchGolden(
                "credit.issue-free",
                await credit.issueFreeCredit({ email: EMAIL, amount: 50, description: "golden" } as never, asWidget),
            )
        })
    })

    describe("settlement report", () => {
        it("widget statistics", async () => {
            // The free credit issued above may carry a timestamp rounded into the
            // future; the report would then not count it. See `waitPastFixtureClock`.
            await waitPastFixtureClock(USER)
            matchGolden("credit.statistics", await credit.getCreditStatictics(WIDGET))
        })
    })
})
