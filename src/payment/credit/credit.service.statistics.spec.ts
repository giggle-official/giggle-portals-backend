/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from "@nestjs/testing"

jest.mock("../../common/prisma.service")
jest.mock("../../user/user.service")
jest.mock("../order/order.service")
jest.mock("../../notification/notification.service")
jest.mock("../settle/settle.service")

import { CreditService } from "./credit.service"
import { PrismaService } from "../../common/prisma.service"
import { UserService } from "../../user/user.service"
import { OrderService } from "../order/order.service"
import { NotificationService } from "../../notification/notification.service"
import { SettleService } from "../settle/settle.service"

/**
 * The daily report is what suppliers are settled against, so the question it has
 * to answer correctly is when a credit line turns into revenue. Spending a
 * credit line is borrowing: no cash has arrived and it must not show up as paid
 * consumption. Repaying it is the cash arriving, and it counts on that day.
 */
describe("CreditService - credit line in the daily report", () => {
    let service: CreditService
    let prisma: any
    let capturedSql: string[]

    // What the existing `credit_statements` block returns, with no credit line
    // involved anywhere. Negative because consumption is stored negative.
    const baseAmounts = {
        daily_top_up: 5000,
        monthly_top_up: 20000,
        total_top_up: 100000,
        daily_free_consume: -300,
        monthly_free_consume: -900,
        total_free_consume: -4000,
        daily_paid_consume: -1000,
        monthly_paid_consume: -6000,
        total_paid_consume: -30000,
    }

    const noCreditLine = {
        daily_repay: 0,
        monthly_repay: 0,
        total_repay: 0,
        daily_consume: 0,
        monthly_consume: 0,
        total_consume: 0,
    }

    let creditLineRow: typeof noCreditLine
    let outstanding: number

    beforeEach(async () => {
        capturedSql = []
        creditLineRow = { ...noCreditLine }
        outstanding = 0

        const module: TestingModule = await Test.createTestingModule({
            providers: [CreditService, PrismaService, UserService, OrderService, NotificationService, SettleService],
        }).compile()

        service = module.get<CreditService>(CreditService)
        prisma = module.get(PrismaService) as any

        prisma.users = { findMany: jest.fn().mockResolvedValue([]) }
        // The statistics method fires eight aggregates in one pass. Routing by a
        // column unique to each keeps the test readable and order-independent.
        prisma.$queryRaw = jest.fn((strings: TemplateStringsArray) => {
            const sql = strings.join("?")
            capturedSql.push(sql)
            if (sql.includes("FROM credit_line_statements")) return Promise.resolve([creditLineRow])
            if (sql.includes("FROM user_credit_lines")) return Promise.resolve([{ outstanding }])
            if (sql.includes("daily_top_up")) return Promise.resolve([baseAmounts])
            if (sql.includes("daily_free_users")) return Promise.resolve([{}])
            if (sql.includes("daily_first_time")) return Promise.resolve([{}])
            if (sql.includes("total_free_rows")) return Promise.resolve([])
            if (sql.includes("FROM assets")) return Promise.resolve([{}])
            if (sql.includes("FROM free_credit_issues")) return Promise.resolve([])
            throw new Error(`unrouted query: ${sql}`)
        })
    })

    const paidConsumeSql = () => capturedSql.find((sql) => sql.includes("daily_paid_consume")) as string

    describe("spending a credit line", () => {
        it("does not touch paid consumption", async () => {
            creditLineRow = { ...noCreditLine, daily_consume: -800, monthly_consume: -800, total_consume: -800 }

            const stats = await service.getCreditStatictics("test_widget")

            expect(stats.dailyNoFreeCreditConsume._sum.amount).toBe(-1000)
            expect(stats.monthlyNoFreeCreditConsume._sum.amount).toBe(-6000)
            expect(stats.totalNoFreeCreditConsume._sum.amount).toBe(-30000)
        })

        it("is reported on its own, so the exposure is visible rather than hidden", async () => {
            creditLineRow = { ...noCreditLine, daily_consume: -800, monthly_consume: -2400, total_consume: -9000 }

            const stats = await service.getCreditStatictics("test_widget")

            expect(stats.dailyCreditLineConsume._sum.amount).toBe(-800)
            expect(stats.monthlyCreditLineConsume._sum.amount).toBe(-2400)
            expect(stats.totalCreditLineConsume._sum.amount).toBe(-9000)
        })
    })

    describe("repaying a credit line", () => {
        it("adds to paid consumption on the day the money lands", async () => {
            creditLineRow = { ...noCreditLine, daily_repay: -500, monthly_repay: -1500, total_repay: -7000 }

            const stats = await service.getCreditStatictics("test_widget")

            expect(stats.dailyNoFreeCreditConsume._sum.amount).toBe(-1500)
            expect(stats.monthlyNoFreeCreditConsume._sum.amount).toBe(-7500)
            expect(stats.totalNoFreeCreditConsume._sum.amount).toBe(-37000)
        })

        it("leaves free consumption alone", async () => {
            creditLineRow = { ...noCreditLine, daily_repay: -500, monthly_repay: -1500, total_repay: -7000 }

            const stats = await service.getCreditStatictics("test_widget")

            expect(stats.dailyFreeCreditConsume._sum.amount).toBe(-300)
            expect(stats.totalFreeCreditConsume._sum.amount).toBe(-4000)
        })

        it("is also broken out on its own, so the paid figure can be reconciled", async () => {
            creditLineRow = { ...noCreditLine, daily_repay: -500, monthly_repay: -1500, total_repay: -7000 }

            const stats = await service.getCreditStatictics("test_widget")

            expect(stats.dailyCreditLineRepay._sum.amount).toBe(-500)
            expect(stats.monthlyCreditLineRepay._sum.amount).toBe(-1500)
            expect(stats.totalCreditLineRepay._sum.amount).toBe(-7000)
        })

        it("is counted once, not once per ledger", async () => {
            await service.getCreditStatictics("test_widget")

            // A repayment writes a `repay_credit_line` row into `credit_statements`
            // too. That type sitting outside this filter is the only thing keeping
            // the paid bucket from counting the same repayment twice.
            expect(paidConsumeSql()).toContain("IN ('consume', 'refund')")
            expect(paidConsumeSql()).not.toContain("repay_credit_line")
        })
    })

    describe("outstanding debt", () => {
        it("is reported as a point in time figure", async () => {
            outstanding = 12000

            const stats = await service.getCreditStatictics("test_widget")

            expect(stats.creditLineOutstanding).toBe(12000)
        })

        it("counts debts only, so an overpaid line does not mask someone else's debt", async () => {
            await service.getCreditStatictics("test_widget")

            const outstandingSql = capturedSql.find((s) => s.includes("FROM user_credit_lines")) as string
            expect(outstandingSql).toContain("used > 0")
        })
    })

    describe("a widget with no credit line", () => {
        it("reports exactly what it reported before credit lines existed", async () => {
            const stats = await service.getCreditStatictics("test_widget")

            expect(stats.dailyNoFreeCreditConsume._sum.amount).toBe(baseAmounts.daily_paid_consume)
            expect(stats.monthlyNoFreeCreditConsume._sum.amount).toBe(baseAmounts.monthly_paid_consume)
            expect(stats.totalNoFreeCreditConsume._sum.amount).toBe(baseAmounts.total_paid_consume)
            expect(stats.creditLineOutstanding).toBe(0)
        })
    })

    describe("the email template", () => {
        const format = (data: any) => (service as any).formatCreditStatsForTemplate("test_widget", data)

        const statsWith = async () => await service.getCreditStatictics("test_widget")

        it("omits the credit line section entirely when there is nothing to show", async () => {
            const context = format(await statsWith())

            expect(context.hasCreditLine).toBe(false)
        })

        it("shows the section for a widget that has lent but not been repaid", async () => {
            outstanding = 3000

            const context = format(await statsWith())

            expect(context.hasCreditLine).toBe(true)
            expect(context.creditLineOutstanding).toBe(3000)
        })

        it("shows the section for a line that was borrowed and fully repaid", async () => {
            creditLineRow = { ...noCreditLine, total_consume: -2000, total_repay: -2000 }

            const context = format(await statsWith())

            expect(context.hasCreditLine).toBe(true)
        })

        it("displays consumption and repayment as positive numbers, like every other figure", async () => {
            creditLineRow = {
                daily_consume: -800,
                monthly_consume: -2400,
                total_consume: -9000,
                daily_repay: -500,
                monthly_repay: -1500,
                total_repay: -7000,
            }

            const context = format(await statsWith())

            expect(context.dailyCreditLineConsume).toBe(800)
            expect(context.monthlyCreditLineConsume).toBe(2400)
            expect(context.totalCreditLineConsume).toBe(9000)
            expect(context.dailyCreditLineRepay).toBe(500)
            expect(context.totalCreditLineRepay).toBe(7000)
        })

        it("keeps the repayment inside the paid figure it is broken out of", async () => {
            creditLineRow = { ...noCreditLine, daily_repay: -500 }

            const context = format(await statsWith())

            // 1000 spent as paid credit + 500 repaid, shown positive.
            expect(context.dailyNoFreeCreditConsume).toBe(1500)
            expect(context.dailyCreditLineRepay).toBe(500)
        })
    })
})
