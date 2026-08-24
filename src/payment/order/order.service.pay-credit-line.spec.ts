/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException, ForbiddenException } from "@nestjs/common"
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
 * Paying with a credit line is borrowing. The two things that must hold no
 * matter how the request arrives: the debt lands on the account the ORDER
 * points at, and no real credit moves. Everything downstream of payment stays
 * shut, because the money has not arrived yet.
 */
describe("OrderService - paying an order with a credit line", () => {
    let service: OrderService
    let prisma: any
    let creditService: any
    let creditLineService: any
    let userService: any
    let mockTx: any

    const baseOrder = {
        id: 42,
        order_id: "order_1",
        owner: "order_owner_user",
        widget_tag: "test_widget",
        amount: 700,
        current_status: OrderStatus.PENDING,
        supported_payment_method: [PaymentMethod.CREDIT, PaymentMethod.CREDIT_LINE],
        callback_url: "https://widget.example/callback",
        related_reward_id: null,
        rewards_model_snapshot: null,
        buyback_after_paid: false,
        is_credit_top_up: false,
        paid_method: null,
        paid_time: null,
    }

    const givenOrder = (overrides: Partial<typeof baseOrder> = {}) => {
        const order = { ...baseOrder, ...overrides }
        prisma.orders.findUnique.mockResolvedValue(order)
        mockTx.orders.findUnique.mockResolvedValue(order)
        return order
    }

    beforeEach(async () => {
        mockTx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            orders: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
            credit_statements: { create: jest.fn() },
            users: { update: jest.fn() },
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
        userService = module.get(UserService) as any

        prisma.orders = { findUnique: jest.fn() }
        prisma.$transaction = jest.fn((cb: any) => cb(mockTx))

        // By the time payment runs the caller has already been resolved to the end
        // user: `createAndPayCreditLineOrder` swaps a widget's own profile for the
        // one in `user_jwt`, and `allowPayOrder` then refuses anyone who is not the
        // owner. So the profile always matches the order here.
        userService.getProfile = jest.fn().mockResolvedValue({ usernameShorted: "order_owner_user" })
        creditLineService.charge = jest.fn().mockResolvedValue({ used: 700 })
        creditLineService.assertWidgetMayLend = jest.fn().mockResolvedValue(undefined)
        creditService.consumeCredit = jest.fn()
        jest.spyOn(service, "processCallback").mockResolvedValue(undefined as never)
        jest.spyOn(service, "updateBindRewards").mockResolvedValue(undefined as never)
        jest.spyOn(service, "releaseRewards").mockResolvedValue([])
        jest.spyOn(service, "mapOrderDetail").mockImplementation(async (o: any) => o)
    })

    describe("the charge", () => {
        it("borrows the order amount against the order's own account", async () => {
            givenOrder()

            await service.payCreditLineOrder({ order_id: "order_1" }, {} as any)

            // Both the user and the widget come off the order row. Neither is
            // taken from the request, so there is no shape of request that can
            // aim the debt at a different account.
            expect(creditLineService.charge).toHaveBeenCalledWith(
                mockTx,
                "order_owner_user",
                "test_widget",
                700,
                "order_1",
            )
        })

        it("refuses a caller who does not own the order", async () => {
            givenOrder()
            userService.getProfile.mockResolvedValue({ usernameShorted: "someone_else" })

            await expect(service.payCreditLineOrder({ order_id: "order_1" }, {} as any)).rejects.toThrow(
                "not the owner",
            )
            expect(creditLineService.charge).not.toHaveBeenCalled()
        })

        it("leaves the credit balance and the credit statement untouched", async () => {
            givenOrder()

            await service.payCreditLineOrder({ order_id: "order_1" }, {} as any)

            expect(creditService.consumeCredit).not.toHaveBeenCalled()
            expect(mockTx.credit_statements.create).not.toHaveBeenCalled()
            expect(mockTx.users.update).not.toHaveBeenCalled()
        })

        it("completes the order and records how it was paid", async () => {
            givenOrder()

            await service.payCreditLineOrder({ order_id: "order_1" }, {} as any)

            const data = mockTx.orders.update.mock.calls[0][0].data
            expect(data.current_status).toBe(OrderStatus.COMPLETED)
            expect(data.paid_method).toBe(PaymentMethod.CREDIT_LINE)
            expect(data.paid_time).toBeInstanceOf(Date)
        })

        it("records no credit paid, since none was", async () => {
            givenOrder()

            await service.payCreditLineOrder({ order_id: "order_1" }, {} as any)

            const data = mockTx.orders.update.mock.calls[0][0].data
            expect(data.credit_paid_amount).toBeUndefined()
            expect(data.free_credit_paid).toBeUndefined()
        })

        it("asks to pay as a credit line, not as something else", async () => {
            // `payCreditOrder` checks `allowPayOrder` with WALLET while writing
            // `paid_method = credit`. Repeating that here would mean orders whose
            // column says one thing and whose ledger says another, and every
            // exclusion built on `paid_method` reads that column.
            const allowSpy = jest.spyOn(service, "allowPayOrder")
            givenOrder()

            await service.payCreditLineOrder({ order_id: "order_1" }, {} as any)

            expect(allowSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), PaymentMethod.CREDIT_LINE)
        })
    })

    describe("what it refuses", () => {
        const expectRefused = async (overrides: Partial<typeof baseOrder>, match: string | RegExp) => {
            givenOrder(overrides)

            await expect(service.payCreditLineOrder({ order_id: "order_1" }, {} as any)).rejects.toThrow(match)
            expect(creditLineService.charge).not.toHaveBeenCalled()
            expect(mockTx.orders.update).not.toHaveBeenCalled()
        }

        it("an order with no widget, since a credit line belongs to one", async () => {
            await expectRefused({ widget_tag: null }, "no widget tag")
        })

        it("an order bound to a reward pool", async () => {
            await expectRefused({ related_reward_id: 7 }, "reward pool")
        })

        it("an order carrying a reward snapshot", async () => {
            await expectRefused({ rewards_model_snapshot: { token: "T" } as any }, "rewards")
        })

        it("an order with buyback, which spends real money on chain", async () => {
            await expectRefused({ buyback_after_paid: true }, "buyback")
        })

        it("a top up order, which would turn the debt straight back into balance", async () => {
            await expectRefused({ is_credit_top_up: true }, "top up")
        })

        it("an order whose widget no longer holds the permission", async () => {
            givenOrder()
            creditLineService.assertWidgetMayLend.mockRejectedValue(new ForbiddenException("not allowed"))

            await expect(service.payCreditLineOrder({ order_id: "order_1" }, {} as any)).rejects.toThrow(
                ForbiddenException,
            )
            expect(creditLineService.charge).not.toHaveBeenCalled()
        })

        it("an order the payment guard already rejected", async () => {
            givenOrder({ supported_payment_method: [PaymentMethod.CREDIT] })

            await expect(service.payCreditLineOrder({ order_id: "order_1" }, {} as any)).rejects.toThrow(
                BadRequestException,
            )
            expect(creditLineService.charge).not.toHaveBeenCalled()
        })

        it("an order that stopped being pending while the payment was in flight", async () => {
            const order = givenOrder()
            // Passes `allowPayOrder`, then another payment lands first.
            mockTx.orders.findUnique.mockResolvedValue({ ...order, current_status: OrderStatus.COMPLETED })

            await expect(service.payCreditLineOrder({ order_id: "order_1" }, {} as any)).rejects.toThrow(
                "Order is not pending",
            )
            expect(creditLineService.charge).not.toHaveBeenCalled()
        })

        it("does not complete an order whose charge was rejected", async () => {
            givenOrder()
            creditLineService.charge.mockRejectedValue(new BadRequestException("Insufficient credit line"))

            await expect(service.payCreditLineOrder({ order_id: "order_1" }, {} as any)).rejects.toThrow(
                "Insufficient credit line",
            )
            expect(mockTx.orders.update).not.toHaveBeenCalled()
        })
    })

    describe("concurrency", () => {
        it("locks the order row before charging, so one order cannot be paid twice", async () => {
            givenOrder()

            await service.payCreditLineOrder({ order_id: "order_1" }, {} as any)

            expect(mockTx.$queryRaw.mock.calls[0][0].join("?")).toContain("FOR UPDATE")
            const lockedAt = mockTx.$queryRaw.mock.invocationCallOrder[0]
            const chargedAt = creditLineService.charge.mock.invocationCallOrder[0]
            expect(lockedAt).toBeLessThan(chargedAt)
        })
    })

    describe("what happens after payment", () => {
        it("notifies the widget so it can deliver", async () => {
            givenOrder()

            await service.payCreditLineOrder({ order_id: "order_1" }, {} as any)

            expect(service.processCallback).toHaveBeenCalledWith("order_1", "https://widget.example/callback")
        })

        it("releases nothing and re-prices nothing", async () => {
            givenOrder()

            await service.payCreditLineOrder({ order_id: "order_1" }, {} as any)

            expect(service.releaseRewards).not.toHaveBeenCalled()
            expect(service.updateBindRewards).not.toHaveBeenCalled()
        })
    })

    describe("the payment method whitelist", () => {
        it("includes the credit line, or a widget asking for it would be silently dropped", () => {
            expect(OrderService.defaultPaymentMethod).toContain(PaymentMethod.CREDIT_LINE)
        })
    })
})
