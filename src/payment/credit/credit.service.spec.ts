/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from "@nestjs/testing"
import { BadRequestException, Logger } from "@nestjs/common"
import { credit_statement_type } from "@prisma/client"

// Mock all external modules before importing CreditService
jest.mock("../../common/prisma.service")
jest.mock("../../user/user.service")
jest.mock("../order/order.service")
jest.mock("../../notification/notification.service")

import { CreditService } from "./credit.service"
import { PrismaService } from "../../common/prisma.service"
import { UserService } from "../../user/user.service"
import { OrderService } from "../order/order.service"
import { NotificationService } from "../../notification/notification.service"

describe("CreditService - Subscription Credit", () => {
    let service: CreditService
    let prisma: jest.Mocked<PrismaService>

    // Mock data
    const mockUser = {
        id: 1,
        username_in_be: "test_user_123",
        email: "test@example.com",
        current_credit_balance: 1000,
    }

    const mockDeveloperInfo = {
        usernameShorted: "dev_123",
        developer_info: { tag: "test_widget" },
        app_id: "app_123",
        user_id: "dev_123",
    }

    const mockSubscriptionCredit = {
        id: 1,
        user_id: "test_user_123",
        widget_tag: "test_widget",
        subscription_id: "sub_123",
        issue_credits: 500,
        current_balance: 500,
        is_issue: true,
        issue_date: new Date("2024-01-01"),
        expire_date: new Date("2025-12-31"),
    }

    // Transaction mock
    let mockTx: any

    beforeEach(async () => {
        mockTx = {
            users: {
                update: jest.fn(),
                findUnique: jest.fn(),
            },
            widget_subscription_credit_issues: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
                createMany: jest.fn(),
                findUnique: jest.fn(),
                deleteMany: jest.fn(),
            },
            widget_subscriptions: {
                findFirst: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
            credit_statements: {
                create: jest.fn(),
                findMany: jest.fn(),
            },
            free_credit_issues: {
                findMany: jest.fn(),
                update: jest.fn(),
                findUnique: jest.fn(),
            },
        }

        const mockPrismaService = {
            users: {
                findFirst: jest.fn(),
                findUnique: jest.fn(),
                update: jest.fn(),
            },
            widget_subscription_credit_issues: {
                findMany: jest.fn(),
                update: jest.fn(),
                createMany: jest.fn(),
            },
            widget_subscriptions: {
                findFirst: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            credit_statements: {
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
                create: jest.fn(),
            },
            free_credit_issues: {
                findMany: jest.fn(),
            },
            $transaction: jest.fn((callback) => callback(mockTx)),
        }

        const mockUserService = {
            getProfile: jest.fn(),
            getUserInfoByEmail: jest.fn(),
            generateShortName: jest.fn(),
        }

        const mockOrderService = {
            createOrder: jest.fn(),
        }

        const mockNotificationService = {
            sendEmailTemplate: jest.fn(),
        }

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CreditService,
                { provide: PrismaService, useValue: mockPrismaService },
                { provide: UserService, useValue: mockUserService },
                { provide: OrderService, useValue: mockOrderService },
                { provide: NotificationService, useValue: mockNotificationService },
            ],
        }).compile()

        service = module.get<CreditService>(CreditService)
        prisma = module.get(PrismaService)
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    describe("updateWidgetSubscriptions", () => {
        it("should create new subscription and credits successfully (future issue_date)", async () => {
            const body = {
                user_id: "test_user_123",
                subscription_detail: {
                    product_name: "Premium Plan",
                    period_start: new Date("2025-01-01"),
                    period_end: new Date("2025-12-31"),
                    cancel_at_period_end: false,
                    subscription_metadata: { plan: "premium" },
                },
                subscription_credits: [
                    {
                        amount: 500,
                        issue_date: new Date("2030-01-01"), // Future date - no immediate issuance
                        expire_date: new Date("2030-12-31"),
                    },
                ],
            }

            ;(prisma.users.findUnique as jest.Mock).mockResolvedValue(mockUser)
            ;(prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(null)
            ;(prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([]) // No credits to issue (future date)
            mockTx.widget_subscriptions.create.mockResolvedValue({
                id: 1,
                subscription_id: "new_sub_id",
            })
            mockTx.widget_subscription_credit_issues.createMany.mockResolvedValue({ count: 1 })

            const result = await service.updateWidgetSubscriptions(body, mockDeveloperInfo as any)

            expect(result).toEqual({ success: true })
            expect(mockTx.widget_subscriptions.create).toHaveBeenCalled()
            expect(mockTx.widget_subscription_credit_issues.createMany).toHaveBeenCalled()
        })

        it("should throw error if user not found", async () => {
            const body = {
                user_id: "non_existent_user",
                subscription_detail: {
                    product_name: "Premium Plan",
                    period_start: new Date("2025-01-01"),
                    period_end: new Date("2025-12-31"),
                    cancel_at_period_end: false,
                    subscription_metadata: { plan: "premium" },
                },
                subscription_credits: [
                    {
                        amount: 500,
                        issue_date: new Date("2024-01-01"),
                        expire_date: new Date("2024-12-31"),
                    },
                ],
            }

            ;(prisma.users.findUnique as jest.Mock).mockResolvedValue(null)

            await expect(service.updateWidgetSubscriptions(body, mockDeveloperInfo as any)).rejects.toThrow(
                BadRequestException,
            )
        })

        it("should throw error if issue_date > expire_date", async () => {
            const body = {
                user_id: "test_user_123",
                subscription_detail: {
                    product_name: "Premium Plan",
                    period_start: new Date("2025-01-01"),
                    period_end: new Date("2025-12-31"),
                    cancel_at_period_end: false,
                    subscription_metadata: { plan: "premium" },
                },
                subscription_credits: [
                    {
                        amount: 500,
                        issue_date: new Date("2025-01-01"), // After expire_date
                        expire_date: new Date("2024-12-31"),
                    },
                ],
            }

            ;(prisma.users.findUnique as jest.Mock).mockResolvedValue(mockUser)
            ;(prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(null)
            mockTx.widget_subscriptions.create.mockResolvedValue({
                id: 1,
                subscription_id: "new_sub_id",
            })

            await expect(service.updateWidgetSubscriptions(body, mockDeveloperInfo as any)).rejects.toThrow(
                "Issue date cannot be greater than expire date",
            )
        })

        it("should update existing subscription", async () => {
            const body = {
                user_id: "test_user_123",
                subscription_detail: {
                    product_name: "Updated Plan",
                    period_start: new Date("2025-01-01"),
                    period_end: new Date("2025-12-31"),
                    cancel_at_period_end: false,
                    subscription_metadata: { plan: "updated" },
                },
                subscription_credits: [
                    {
                        amount: 1000,
                        issue_date: new Date("2030-01-01"), // Future date - should not issue immediately
                        expire_date: new Date("2030-12-31"),
                    },
                ],
            }

            const existingSubscription = {
                id: 1,
                subscription_id: "existing_sub_id",
                user_id: "test_user_123",
                widget_tag: "test_widget",
            }

            ;(prisma.users.findUnique as jest.Mock).mockResolvedValue(mockUser)
            ;(prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(existingSubscription)
            ;(prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([]) // No credits to issue (future date)
            mockTx.widget_subscriptions.update.mockResolvedValue(existingSubscription)
            mockTx.widget_subscription_credit_issues.createMany.mockResolvedValue({ count: 1 })

            const result = await service.updateWidgetSubscriptions(body, mockDeveloperInfo as any)

            expect(result).toEqual({ success: true })
            expect(mockTx.widget_subscriptions.update).toHaveBeenCalled()
        })

        it("should call issueWidgetSubscriptionCredit after creating credits", async () => {
            const body = {
                user_id: "test_user_123",
                subscription_detail: {
                    product_name: "Premium Plan",
                    period_start: new Date("2025-01-01"),
                    period_end: new Date("2025-12-31"),
                    cancel_at_period_end: false,
                    subscription_metadata: { plan: "premium" },
                },
                subscription_credits: [
                    {
                        amount: 500,
                        issue_date: new Date("2020-01-01"), // Past date
                        expire_date: new Date("2030-12-31"),
                    },
                ],
            }

            ;(prisma.users.findUnique as jest.Mock).mockResolvedValue(mockUser)
            ;(prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(null)
            mockTx.widget_subscriptions.create.mockResolvedValue({
                id: 1,
                subscription_id: "new_sub_id",
            })
            mockTx.widget_subscription_credit_issues.createMany.mockResolvedValue({ count: 1 })

            // Mock for issueWidgetSubscriptionCredit call
            ;(prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([
                {
                    id: 1,
                    user_id: "test_user_123",
                    current_balance: 500,
                    is_issue: false,
                    subscription_id: "new_sub_id",
                },
            ])
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 1500 })
            mockTx.credit_statements.create.mockResolvedValue({})
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})

            const result = await service.updateWidgetSubscriptions(body, mockDeveloperInfo as any)

            expect(result).toEqual({ success: true })
            // Should call findMany to get credits to issue
            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalled()
        })
    })

    describe("expireWidgetSubscriptionCredit", () => {
        it("should expire credits with optional subscription_id filter", async () => {
            const expiredCredit = {
                id: 1,
                user_id: "test_user_123",
                current_balance: 300,
                is_issue: true,
                expire_date: new Date("2023-01-01"),
                subscription_id: "sub_123",
            }

            ;(prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([expiredCredit])
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 700 })
            mockTx.credit_statements.create.mockResolvedValue({})

            await service.expireWidgetSubscriptionCredit("sub_123")

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    expire_date: { lt: expect.any(Date) },
                    is_issue: true,
                    current_balance: { gt: 0 },
                    subscription_id: "sub_123",
                },
            })
        })

        it("should expire all credits when no subscription_id provided", async () => {
            ;(prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([])

            await service.expireWidgetSubscriptionCredit()

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    expire_date: { lt: expect.any(Date) },
                    is_issue: true,
                    current_balance: { gt: 0 },
                },
            })
        })
    })

    describe("issueWidgetSubscriptionCredit", () => {
        it("should issue credits with optional subscription_id filter", async () => {
            const pendingCredit = {
                id: 1,
                user_id: "test_user_123",
                current_balance: 500,
                is_issue: false,
                issue_date: new Date("2024-01-01"),
                subscription_id: "sub_123",
            }

            ;(prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([pendingCredit])
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 1500 })
            mockTx.credit_statements.create.mockResolvedValue({})
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})

            await service.issueWidgetSubscriptionCredit("sub_123")

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    issue_date: { lte: expect.any(Date) },
                    current_balance: { gt: 0 },
                    is_issue: false,
                    subscription_id: "sub_123",
                },
            })
        })

        it("should issue all credits when no subscription_id provided", async () => {
            ;(prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([])

            await service.issueWidgetSubscriptionCredit()

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    issue_date: { lte: expect.any(Date) },
                    current_balance: { gt: 0 },
                    is_issue: false,
                },
            })
        })
    })

    describe("processWidgetSubscriptionCredits (cron job)", () => {
        it("should call expireWidgetSubscriptionCredit then issueWidgetSubscriptionCredit", async () => {
            ;(prisma.widget_subscription_credit_issues.findMany as jest.Mock)
                .mockResolvedValueOnce([]) // For expire
                .mockResolvedValueOnce([]) // For issue

            await service.processWidgetSubscriptionCredits()

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledTimes(2)
        })
    })

    describe("cancelWidgetSubscription", () => {
        it("should cancel subscription and delete unissued credits", async () => {
            const subscription = {
                id: 1,
                subscription_id: "sub_123",
                user_id: "test_user_123",
                widget_tag: "test_widget",
            }

            ;(prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(subscription)
            mockTx.widget_subscription_credit_issues.deleteMany.mockResolvedValue({ count: 2 })
            mockTx.widget_subscriptions.delete.mockResolvedValue(subscription)

            const result = await service.cancelWidgetSubscription("test_user_123", mockDeveloperInfo as any)

            expect(result).toEqual({ success: true })
            expect(mockTx.widget_subscription_credit_issues.deleteMany).toHaveBeenCalledWith({
                where: {
                    subscription_id: "sub_123",
                    is_issue: false,
                },
            })
            expect(mockTx.widget_subscriptions.delete).toHaveBeenCalledWith({
                where: { id: 1 },
            })
        })

        it("should throw error if subscription not found", async () => {
            ;(prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(null)

            await expect(
                service.cancelWidgetSubscription("non_existent_user", mockDeveloperInfo as any),
            ).rejects.toThrow("Subscription not found")
        })

        it("should only delete unissued credits (is_issue: false)", async () => {
            const subscription = {
                id: 1,
                subscription_id: "sub_123",
                user_id: "test_user_123",
                widget_tag: "test_widget",
            }

            ;(prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(subscription)
            mockTx.widget_subscription_credit_issues.deleteMany.mockResolvedValue({ count: 0 })
            mockTx.widget_subscriptions.delete.mockResolvedValue(subscription)

            await service.cancelWidgetSubscription("test_user_123", mockDeveloperInfo as any)

            // Should only delete where is_issue: false
            expect(mockTx.widget_subscription_credit_issues.deleteMany).toHaveBeenCalledWith({
                where: {
                    subscription_id: "sub_123",
                    is_issue: false,
                },
            })
        })
    })

    describe("consumeCredit - with subscription credits", () => {
        it("should consume subscription credits after free credits are exhausted", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            // Mock getUserCredits
            ;(prisma.users.findFirst as jest.Mock).mockResolvedValue({ current_credit_balance: 1000 })
            ;(prisma.free_credit_issues.findMany as jest.Mock).mockResolvedValue([])

            // No free credits
            mockTx.free_credit_issues.findMany.mockResolvedValue([])

            // Has subscription credits
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 500 },
            ])
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 700 })
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})
            mockTx.credit_statements.create.mockResolvedValue({})

            const result = await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            expect(result.total_credit_consumed).toBe(300)
            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { current_balance: 200 }, // 500 - 300
            })
        })

        it("should consume free credits first, then subscription credits", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            ;(prisma.users.findFirst as jest.Mock).mockResolvedValue({ current_credit_balance: 1000 })
            ;(prisma.free_credit_issues.findMany as jest.Mock).mockResolvedValue([
                { id: 1, balance: 100, expire_date: new Date("2025-12-31") },
            ])

            // Free credits (100)
            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, expire_date: new Date("2025-12-31") },
            ])

            // Subscription credits (500)
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 500 },
            ])

            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 700 })
            mockTx.free_credit_issues.update.mockResolvedValue({})
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})
            mockTx.credit_statements.create.mockResolvedValue({})

            // Consume 300 total: 100 from free + 200 from subscription
            const result = await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            expect(result.total_credit_consumed).toBe(300)
            expect(result.free_credit_consumed).toBe(100)
        })

        it("should only consume issued subscription credits (is_issue: true)", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            ;(prisma.users.findFirst as jest.Mock).mockResolvedValue({ current_credit_balance: 500 })
            ;(prisma.free_credit_issues.findMany as jest.Mock).mockResolvedValue([])
            mockTx.free_credit_issues.findMany.mockResolvedValue([])

            // Query should only return is_issue: true
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 200 })
            mockTx.credit_statements.create.mockResolvedValue({})

            const result = await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            expect(mockTx.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    user_id: "test_user_123",
                    current_balance: { gt: 0 },
                    is_issue: true,
                    expire_date: { gte: expect.any(Date) },
                },
                orderBy: { expire_date: "asc" },
            })
        })
    })

    describe("refundCredit - with subscription credits", () => {
        it("should refund subscription credits correctly", async () => {
            const consumeStatement = {
                id: 1,
                amount: -300,
                is_free_credit: false,
                is_subscription_credit: true,
                subscription_credit_issue_id: 1,
                free_credit_issue_id: null,
            }

            // Set up all mocks before calling the function
            mockTx.credit_statements.findMany = jest.fn().mockResolvedValue([consumeStatement])
            // Return a subscription credit with NO expire_date (or future expire_date with only expire_date being null)
            // The code checks: subscriptionCredit && subscriptionCredit.expire_date && expire_date < new Date()
            // If expire_date is null/undefined, the check fails and we proceed to update
            mockTx.widget_subscription_credit_issues.findUnique = jest.fn().mockResolvedValue({
                id: 1,
                user_id: "test_user_123",
                expire_date: null, // No expiry date set
                current_balance: 500,
            })
            mockTx.widget_subscription_credit_issues.update = jest.fn().mockResolvedValue({})
            mockTx.users.update = jest.fn().mockResolvedValue({ ...mockUser, current_credit_balance: 1300 })
            mockTx.credit_statements.create = jest.fn().mockResolvedValue({})

            await service.refundCredit(300, "order_123", "test_user_123", mockTx as any)

            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { current_balance: { increment: 300 } },
            })
            expect(mockTx.credit_statements.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    type: credit_statement_type.refund,
                    amount: 300,
                    is_subscription_credit: true,
                    subscription_credit_issue_id: 1,
                }),
            })
        })

        it("should skip refund for expired subscription credits", async () => {
            const consumeStatement = {
                id: 1,
                amount: -300,
                is_free_credit: false,
                is_subscription_credit: true,
                subscription_credit_issue_id: 1,
                free_credit_issue_id: null,
            }

            mockTx.credit_statements.findMany = jest.fn().mockResolvedValue([consumeStatement])
            mockTx.widget_subscription_credit_issues.findUnique = jest.fn().mockResolvedValue({
                id: 1,
                expire_date: new Date("2020-01-01"), // Expired (past date)
            })
            mockTx.widget_subscription_credit_issues.update = jest.fn().mockResolvedValue({})
            mockTx.users.update = jest.fn().mockResolvedValue({})

            await service.refundCredit(300, "order_123", "test_user_123", mockTx as any)

            // Should NOT update subscription credit or user balance
            expect(mockTx.widget_subscription_credit_issues.update).not.toHaveBeenCalled()
            expect(mockTx.users.update).not.toHaveBeenCalled()
        })

        it("should track amounts correctly when skipping expired credits", async () => {
            const statements = [
                {
                    id: 1,
                    amount: -200,
                    is_free_credit: false,
                    is_subscription_credit: true,
                    subscription_credit_issue_id: 1,
                    free_credit_issue_id: null,
                },
                {
                    id: 2,
                    amount: -100,
                    is_free_credit: false,
                    is_subscription_credit: true,
                    subscription_credit_issue_id: 2,
                    free_credit_issue_id: null,
                },
            ]

            mockTx.credit_statements.findMany = jest.fn().mockResolvedValue(statements)

            // First credit is expired (has expire_date in past), second has no expiry
            mockTx.widget_subscription_credit_issues.findUnique = jest
                .fn()
                .mockResolvedValueOnce({
                    id: 1,
                    expire_date: new Date("2020-01-01"), // Expired (past date)
                })
                .mockResolvedValueOnce({
                    id: 2,
                    expire_date: null, // No expiry - will proceed to refund
                })

            mockTx.widget_subscription_credit_issues.update = jest.fn().mockResolvedValue({})
            mockTx.users.update = jest.fn().mockResolvedValue({ ...mockUser, current_credit_balance: 1100 })
            mockTx.credit_statements.create = jest.fn().mockResolvedValue({})

            await service.refundCredit(150, "order_123", "test_user_123", mockTx as any)

            // Only second credit should be refunded (100 since statement amount is -100)
            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledTimes(1)
            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledWith({
                where: { id: 2 },
                data: { current_balance: { increment: 100 } },
            })
        })
    })
})
