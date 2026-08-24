/* eslint-disable @typescript-eslint/no-unused-vars */
import { readFileSync } from "fs"
import { join } from "path"
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
 * A credit line order is borrowed, not paid. COMPLETED is the end of it: no
 * rewards, no buyback, no IP income. The guards that enforce that are cheap to
 * delete by accident because, until the credit line payment channel ships,
 * nothing in production can trip them — they look like dead branches. These
 * tests are what makes deleting one loud.
 */
describe("OrderService - credit line orders release nothing downstream", () => {
    let service: OrderService
    let prisma: any

    const baseOrder = {
        order_id: "order_1",
        owner: "test_user_123",
        widget_tag: "test_widget",
        amount: 1000,
        refunded_amount: 0,
        free_credit_paid: 0,
        current_status: OrderStatus.COMPLETED,
        paid_method: PaymentMethod.CREDIT_LINE,
        // Everything below is what a releasable order looks like. The order is
        // deliberately perfect apart from how it was paid, so that a [] return
        // can only mean the credit line guard fired.
        related_reward_id: 7,
        rewards_model_snapshot: { token: "TEST_TOKEN", revenue_ratio: [] },
        buyback_after_paid: false,
        buyback_result: null,
        costs_allocation: [],
    }

    const givenOrder = (overrides: Partial<typeof baseOrder> = {}) => {
        const order = { ...baseOrder, ...overrides }
        prisma.orders.findUnique.mockResolvedValue(order)
        prisma.orders.findFirst.mockResolvedValue(order)
        return order
    }

    beforeEach(async () => {
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

        prisma.orders = { findUnique: jest.fn(), findFirst: jest.fn() }
        // The first thing `releaseRewards` reaches for once past the guard. If it
        // is ever called for a credit line order, the guard is gone.
        prisma.reward_pools = { findFirst: jest.fn().mockResolvedValue(null) }
    })

    describe("releaseRewards", () => {
        it("releases nothing for a credit line order", async () => {
            givenOrder()

            await expect(service.releaseRewards({ order_id: "order_1" })).resolves.toEqual([])
            expect(prisma.reward_pools.findFirst).not.toHaveBeenCalled()
        })

        it("refuses before the buyback and status checks, so no ordering change can slip it through", async () => {
            // Same order, but arranged so every other early return is inapplicable.
            givenOrder({ current_status: OrderStatus.PARTIAL_REFUNDED })

            await expect(service.releaseRewards({ order_id: "order_1" })).resolves.toEqual([])
            expect(prisma.reward_pools.findFirst).not.toHaveBeenCalled()
        })

        it("still lets a credit order through to the reward pool lookup", async () => {
            givenOrder({ paid_method: PaymentMethod.CREDIT })

            await service.releaseRewards({ order_id: "order_1" })

            expect(prisma.reward_pools.findFirst).toHaveBeenCalled()
        })

        it("still lets an order with no recorded payment method through", async () => {
            // Legacy rows carry a NULL paid_method. A guard written as a negated
            // comparison would have to be careful here; this one is an equality
            // check, and this test is what keeps it that way.
            givenOrder({ paid_method: null })

            await service.releaseRewards({ order_id: "order_1" })

            expect(prisma.reward_pools.findFirst).toHaveBeenCalled()
        })
    })

    describe("releaseRewardsRequest", () => {
        it("answers a widget with a reason rather than an empty list", async () => {
            givenOrder()

            await expect(service.releaseRewardsRequest({ order_id: "order_1" })).rejects.toThrow(BadRequestException)
            expect(prisma.reward_pools.findFirst).not.toHaveBeenCalled()
        })

        it("refuses before the status check, so a pending credit line order gets the credit line reason", async () => {
            givenOrder({ current_status: OrderStatus.PENDING })

            await expect(service.releaseRewardsRequest({ order_id: "order_1" })).rejects.toThrow("credit line")
        })
    })

    describe("releaseRewardsByDeveloper", () => {
        it("refuses too, since it is the same request one layer up", async () => {
            givenOrder()

            await expect(service.releaseRewardsByDeveloper({ order_id: "order_1" })).rejects.toThrow("credit line")
            expect(prisma.reward_pools.findFirst).not.toHaveBeenCalled()
        })
    })
})

/**
 * The view is applied to the database by hand, so no test can prove the live
 * one matches. What this can do is stop the checked-in definition losing the
 * exclusion silently — a dropped clause here means credit line orders start
 * counting as IP income on every dashboard that reads the view.
 */
describe("view_ip_incomes", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/views/uss_db/view_ip_incomes.sql"), "utf8")

    it("excludes credit line orders", () => {
        expect(sql).toContain("<> 'credit-line'")
    })

    it("does so with COALESCE, since paid_method is nullable and NULL <> x is NULL", () => {
        expect(sql).toMatch(/COALESCE\(`a`\.`paid_method`, ''\)\s*<>\s*'credit-line'/)
    })

    it("still counts completed orders, which is the whole point of the view", () => {
        expect(sql).toContain("'rewards_released', 'completed'")
    })
})
