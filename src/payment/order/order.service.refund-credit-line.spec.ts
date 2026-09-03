/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException } from "@nestjs/common"
import { stripeToken } from "nestjs-stripe"
import { Test, TestingModule } from "@nestjs/testing"
import { HttpService } from "@nestjs/axios"
import { JwtService } from "@nestjs/jwt"

jest.mock("../../common/prisma.service")
jest.mock("../../user/user.service")
jest.mock("../../web3/giggle/giggle.service")
jest.mock("../../open-app/link/link.service")
jest.mock("../rewards-pool/rewards-pool.service")
jest.mock("../credit/credit.service")
jest.mock("../credit-2c/credit-2c.service")
jest.mock("../credit-line/credit-line.service")

import { PrismaService } from "../../common/prisma.service"
import { UserService } from "../../user/user.service"
import { GiggleService } from "../../web3/giggle/giggle.service"
import { LinkService } from "../../open-app/link/link.service"
import { RewardsPoolService } from "../rewards-pool/rewards-pool.service"
import { CreditService } from "../credit/credit.service"
import { Credit2cService } from "../credit-2c/credit-2c.service"
import { CreditLineService } from "../credit-line/credit-line.service"
import { OrderService } from "./order.service"
import { OrderStatus, PaymentMethod } from "./order.dto"

/**
 * Refunding a credit line order puts the money back on the credit line and must
 * leave the credit balance alone. Nothing else in the repo asserts that split,
 * and getting it wrong would hand the user real credit for an order they never
 * paid real credit for.
 */
describe("OrderService - refunding a credit line order", () => {
    let service: OrderService
    let prisma: any
    let creditService: any
    let creditLineService: any
    let mockTx: any

    const baseOrder = {
        order_id: "order_1",
        owner: "test_user_123",
        widget_tag: "test_widget",
        amount: 1000,
        refunded_amount: 0,
        current_status: OrderStatus.COMPLETED,
        paid_method: PaymentMethod.CREDIT_LINE,
        paid_time: new Date(),
        is_credit_top_up: false,
        refund_detail: null,
    }

    /**
     * The precise columns are derived after the spread, never declared beside the
     * defaults: an `amount` or `refunded_amount` override has to move both columns.
     * A fixture where they disagree is not a state production can reach, and the
     * service reads the precise ones.
     */
    const givenOrder = (overrides: Partial<typeof baseOrder> = {}) => {
        const merged = { ...baseOrder, ...overrides }
        const order = {
            ...merged,
            amount_precise: merged.amount,
            refunded_amount_precise: merged.refunded_amount,
        }
        prisma.orders.findUnique.mockResolvedValue(order)
        mockTx.orders.findUnique.mockResolvedValue(order)
        mockTx.orders.update.mockImplementation(({ data }: any) =>
            Promise.resolve({
                ...order,
                ...data,
                refunded_amount: data.refunded_amount?.increment
                    ? (order.refunded_amount || 0) + data.refunded_amount.increment
                    : order.refunded_amount,
            }),
        )
        return order
    }

    beforeEach(async () => {
        mockTx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            orders: { findUnique: jest.fn(), update: jest.fn() },
            credit_statements: { create: jest.fn() },
        }

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OrderService,
                PrismaService,
                UserService,
                GiggleService,
                LinkService,
                RewardsPoolService,
                CreditService,
                Credit2cService,
                CreditLineService,
                { provide: HttpService, useValue: {} },
                { provide: JwtService, useValue: {} },
                { provide: stripeToken, useValue: {} },
            ],
        }).compile()

        service = module.get<OrderService>(OrderService)
        prisma = module.get(PrismaService) as any
        creditService = module.get(CreditService) as any
        creditLineService = module.get(CreditLineService) as any

        prisma.orders = { findUnique: jest.fn() }
        prisma.$transaction = jest.fn((cb: any) => cb(mockTx))
        creditLineService.refund = jest.fn().mockResolvedValue({})
        creditService.refundCredit = jest.fn().mockResolvedValue(undefined)
        // mapOrderDetail reaches for reward pools and token prices; the refund
        // behaviour is what is under test, not the response shaping.
        jest.spyOn(service, "mapOrderDetail").mockImplementation(async (o: any) => o)
    })

    it("puts the money back on the credit line, not into the credit balance", async () => {
        givenOrder()

        await service.refundOrder({ order_id: "order_1", refund_amount: 400 })

        expect(creditLineService.refund).toHaveBeenCalledWith(mockTx, "test_user_123", "test_widget", 400, "order_1")
        expect(creditService.refundCredit).not.toHaveBeenCalled()
        expect(mockTx.credit_statements.create).not.toHaveBeenCalled()
    })

    it("locks the order row first, as the credit refund does", async () => {
        givenOrder()

        await service.refundOrder({ order_id: "order_1", refund_amount: 400 })

        expect(mockTx.$queryRaw.mock.calls[0][0].join("?")).toContain("FOR UPDATE")
    })

    it("leaves a partial refund at PARTIAL_REFUNDED", async () => {
        givenOrder()

        const result: any = await service.refundOrder({ order_id: "order_1", refund_amount: 400 })

        expect(result.current_status).toBe(OrderStatus.PARTIAL_REFUNDED)
    })

    it("moves to REFUNDED once the last part is refunded", async () => {
        givenOrder({ refunded_amount: 600 })

        await service.refundOrder({ order_id: "order_1", refund_amount: 400 })

        const statuses = mockTx.orders.update.mock.calls.map((c: any[]) => c[0].data.current_status)
        expect(statuses).toContain(OrderStatus.REFUNDED)
    })

    it("refunds the whole remainder when no amount is given", async () => {
        givenOrder({ refunded_amount: 250 })

        await service.refundOrder({ order_id: "order_1" })

        expect(creditLineService.refund).toHaveBeenCalledWith(mockTx, "test_user_123", "test_widget", 750, "order_1")
    })

    it("refuses to refund more than is left", async () => {
        givenOrder({ refunded_amount: 900 })

        await expect(service.refundOrder({ order_id: "order_1", refund_amount: 200 })).rejects.toThrow(
            BadRequestException,
        )
        expect(creditLineService.refund).not.toHaveBeenCalled()
    })

    it("applies the same 10 day window as a credit order", async () => {
        givenOrder({ paid_time: new Date(Date.now() - 11 * 24 * 3600 * 1000) })

        await expect(service.refundOrder({ order_id: "order_1" })).rejects.toThrow("no longer refundable")
    })

    it("refuses an order that is not completed", async () => {
        givenOrder({ current_status: OrderStatus.PENDING })

        await expect(service.refundOrder({ order_id: "order_1" })).rejects.toThrow("can not be refunded")
    })

    it("refuses when the order carries no widget, since a credit line belongs to one", async () => {
        givenOrder({ widget_tag: null })

        await expect(service.refundOrder({ order_id: "order_1" })).rejects.toThrow("no widget tag")
        expect(creditLineService.refund).not.toHaveBeenCalled()
    })

    it("still sends a credit order down the credit path", async () => {
        givenOrder({ paid_method: PaymentMethod.CREDIT })

        await service.refundOrder({ order_id: "order_1", refund_amount: 400 })

        expect(creditService.refundCredit).toHaveBeenCalled()
        expect(creditLineService.refund).not.toHaveBeenCalled()
    })
})
