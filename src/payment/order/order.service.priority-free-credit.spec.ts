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
import { CreateOrderDto, OrderStatus, PaymentMethod } from "./order.dto"

/**
 * `priority_free_credit_issue_ids` is checked when the order is created and
 * carried to `consumeCredit` when it is paid. Which issue actually pays is the
 * credit service's business and is covered there.
 */
describe("OrderService - priority free credit issues", () => {
    let service: OrderService
    let prisma: any
    let creditService: any
    let userService: any
    let mockTx: any

    beforeEach(async () => {
        mockTx = {
            orders: { update: jest.fn().mockResolvedValue({}) },
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
        userService = module.get(UserService) as any

        prisma.free_credit_issues = { count: jest.fn() }
        prisma.orders = { findUnique: jest.fn() }
        prisma.$transaction = jest.fn((cb: any) => cb(mockTx))
    })

    describe("at order creation", () => {
        const validate = (order: Partial<CreateOrderDto>): Promise<number[]> =>
            (service as any).validatePriorityFreeCreditIssueIds(order, "order_owner_user")

        it("keeps the first occurrence of each id, in order", async () => {
            prisma.free_credit_issues.count.mockResolvedValue(3)

            await expect(validate({ priority_free_credit_issue_ids: [8, 7, 8, 9, 7] })).resolves.toEqual([8, 7, 9])
            expect(prisma.free_credit_issues.count).toHaveBeenCalledWith({
                where: { id: { in: [8, 7, 9] }, user: "order_owner_user" },
            })
        })

        it("refuses an id that is not one of the owner's issues", async () => {
            prisma.free_credit_issues.count.mockResolvedValue(1)

            await expect(validate({ priority_free_credit_issue_ids: [7, 8] })).rejects.toThrow("not this user's")
        })

        it("refuses the ids together with allow_free_credit: false", async () => {
            await expect(validate({ allow_free_credit: false, priority_free_credit_issue_ids: [7] })).rejects.toThrow(
                BadRequestException,
            )
            expect(prisma.free_credit_issues.count).not.toHaveBeenCalled()
        })

        it("accepts the ids when allow_free_credit is left at its default", async () => {
            prisma.free_credit_issues.count.mockResolvedValue(1)

            await expect(validate({ priority_free_credit_issue_ids: [7] })).resolves.toEqual([7])
        })

        it.each([
            ["absent", {}],
            ["empty", { priority_free_credit_issue_ids: [] }],
            ["empty with allow_free_credit: false", { allow_free_credit: false, priority_free_credit_issue_ids: [] }],
        ])("treats %s ids as none", async (_label, order) => {
            await expect(validate(order)).resolves.toEqual([])
            expect(prisma.free_credit_issues.count).not.toHaveBeenCalled()
        })
    })

    describe("at payment", () => {
        const givenOrder = (overrides: Record<string, unknown>) => {
            const order = {
                id: 42,
                order_id: "order_1",
                owner: "order_owner_user",
                widget_tag: "test_widget",
                amount: 300,
                amount_precise: 300,
                current_status: OrderStatus.PENDING,
                supported_payment_method: [PaymentMethod.CREDIT],
                allow_free_credit: true,
                priority_free_credit_issue_ids: null,
                release_rewards_after_paid: false,
                ...overrides,
            }
            jest.spyOn(service, "allowPayOrder").mockResolvedValue({ allow: true, message: "", order } as never)
            return order
        }

        beforeEach(() => {
            userService.getProfile = jest.fn().mockResolvedValue({ usernameShorted: "order_owner_user" })
            creditService.consumeCredit = jest.fn().mockResolvedValue({ free_credit_consumed: 0 })
            jest.spyOn(service, "processCallback").mockResolvedValue(undefined as never)
            jest.spyOn(service, "updateBindRewards").mockResolvedValue(undefined as never)
            jest.spyOn(service, "mapOrderDetail").mockImplementation(async (o: any) => o)
        })

        it("hands the stored ids to consumeCredit in their stored order", async () => {
            givenOrder({ priority_free_credit_issue_ids: [8, 7] })

            await service.payCreditOrder({ order_id: "order_1" }, {} as any)

            expect(creditService.consumeCredit).toHaveBeenCalledWith(300, "order_1", {}, mockTx, true, [8, 7])
        })

        it("hands an empty list for an order without ids", async () => {
            givenOrder({})

            await service.payCreditOrder({ order_id: "order_1" }, {} as any)

            expect(creditService.consumeCredit).toHaveBeenCalledWith(300, "order_1", {}, mockTx, true, [])
        })

        it("passes both fields through so consumeCredit can refuse the pair", async () => {
            givenOrder({ allow_free_credit: false, priority_free_credit_issue_ids: [7] })

            await service.payCreditOrder({ order_id: "order_1" }, {} as any)

            expect(creditService.consumeCredit).toHaveBeenCalledWith(300, "order_1", {}, mockTx, false, [7])
        })
    })
})
