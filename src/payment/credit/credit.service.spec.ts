/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from "@nestjs/testing"
import { BadRequestException, Logger } from "@nestjs/common"
import { credit_statement_type } from "@prisma/client"

// Mock all external modules before importing CreditService
jest.mock("../../common/prisma.service")
jest.mock("../../user/user.service")
jest.mock("../order/order.service")
jest.mock("../../notification/notification.service")
jest.mock("../settle/settle.service")
jest.mock("../../notification/payment-notify.service")

import { CreditService } from "./credit.service"
import { PrismaService } from "../../common/prisma.service"
import { UserService } from "../../user/user.service"
import { OrderService } from "../order/order.service"
import { NotificationService } from "../../notification/notification.service"
import { SettleService } from "../settle/settle.service"
import { PaymentNotifyService } from "../../notification/payment-notify.service"

describe("CreditService - Subscription Credit", () => {
    let service: CreditService
    let prisma: jest.Mocked<PrismaService>

    /**
     * Every money column has an integer and a precise twin, and production keeps
     * them equal while amounts are whole credits. These two builders exist so a
     * fixture cannot accidentally set one and not the other — the service reads the
     * precise column, and a half-set fixture reads as a zero balance rather than as
     * the obvious mistake it is.
     */
    const userRow = (balance: number | null) => ({
        current_credit_balance: balance,
        current_credit_balance_precise: balance,
    })

    const sumOf = (key: "balance" | "current_balance" | "amount", value: number | null) =>
        ({ _sum: { [key]: value, [`${key}_precise`]: value } }) as never

    // Mock data
    const mockUser = {
        id: 1,
        username_in_be: "test_user_123",
        email: "test@example.com",
        ...userRow(1000),
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
        issue_credits_precise: 500,
        current_balance: 500,
        current_balance_precise: 500,
        is_issue: true,
        issue_date: new Date("2024-01-01"),
        expire_date: new Date("2025-12-31"),
    }

    // Transaction mock
    let mockTx: any
    let mockPaymentNotify: {
        isLargeTopUp: jest.Mock
        notifyLargeTopUp: jest.Mock
        isLargeTransfer: jest.Mock
        notifyLargeTransfer: jest.Mock
    }

    beforeEach(async () => {
        mockTx = {
            users: {
                update: jest.fn(),
                findUnique: jest.fn(),
                findFirst: jest.fn(),
            },
            widget_subscription_credit_issues: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
                createMany: jest.fn(),
                findUnique: jest.fn(),
                deleteMany: jest.fn(),
                aggregate: jest.fn().mockResolvedValue(sumOf("current_balance", 0)),
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
            credit_transfers: {
                findFirst: jest.fn().mockResolvedValue(null),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn(),
            },
            free_credit_issues: {
                findMany: jest.fn(),
                update: jest.fn(),
                findUnique: jest.fn(),
                // Spendable free credit: what is left once expired-but-unswept rows
                // are taken out. Defaults to "nothing has expired".
                aggregate: jest.fn().mockResolvedValue(sumOf("balance", null)),
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
            credit_transfers: {
                findFirst: jest.fn().mockResolvedValue(null),
                count: jest.fn().mockResolvedValue(0),
            },
            admin_logs: {
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

        const mockSettleService = {
            settleOrder: jest.fn(),
        }

        mockPaymentNotify = {
            isLargeTopUp: jest.fn().mockReturnValue(false),
            notifyLargeTopUp: jest.fn().mockResolvedValue(undefined),
            isLargeTransfer: jest.fn().mockReturnValue(false),
            notifyLargeTransfer: jest.fn().mockResolvedValue(undefined),
        }

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CreditService,
                { provide: PrismaService, useValue: mockPrismaService },
                { provide: UserService, useValue: mockUserService },
                { provide: OrderService, useValue: mockOrderService },
                { provide: NotificationService, useValue: mockNotificationService },
                { provide: SettleService, useValue: mockSettleService },
                { provide: PaymentNotifyService, useValue: mockPaymentNotify },
            ],
        }).compile()

        service = module.get<CreditService>(CreditService)
        prisma = module.get(PrismaService)
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    describe("issueCredit", () => {
        const topUpOrder = {
            order_id: "order-big",
            owner: "test_user_123",
            is_credit_top_up: true,
            current_status: "completed",
            amount: 50000,
            amount_precise: 50000,
            widget_tag: "storyclaw_api_management",
            paid_method: "alipay_global",
        }

        beforeEach(() => {
            ; (prisma.credit_statements.findFirst as jest.Mock).mockResolvedValue(null)
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(51234) })
            mockTx.credit_statements.create.mockResolvedValue({})
            ; (prisma.users.findUnique as jest.Mock).mockResolvedValue({ email: "big@example.com" })
            // Rewards are a separate concern with their own tests.
            jest.spyOn(service, "processRewards").mockResolvedValue(undefined)
        })

        it("announces a top-up above the threshold with who, how much, and the balance after", async () => {
            mockPaymentNotify.isLargeTopUp.mockReturnValue(true)

            await service.issueCredit(topUpOrder as any)

            expect(mockPaymentNotify.isLargeTopUp).toHaveBeenCalledWith(50000)
            expect(mockPaymentNotify.notifyLargeTopUp).toHaveBeenCalledWith({
                order_id: "order-big",
                email: "big@example.com",
                user: "test_user_123",
                credits: 50000,
                balance_after: 51234,
                widget_tag: "storyclaw_api_management",
                paid_method: "alipay_global",
            })
        })

        it("stays quiet for an ordinary top-up", async () => {
            mockPaymentNotify.isLargeTopUp.mockReturnValue(false)

            await service.issueCredit({ ...topUpOrder, amount: 500, amount_precise: 500 } as any)

            expect(mockPaymentNotify.notifyLargeTopUp).not.toHaveBeenCalled()
            // The credit itself is unaffected either way.
            expect(mockTx.credit_statements.create).toHaveBeenCalledTimes(1)
        })

        /** The announcement is decided only after the credit has been committed. */
        it("issues the credit before it looks up who to announce", async () => {
            mockPaymentNotify.isLargeTopUp.mockReturnValue(true)
            const order: string[] = []
            mockTx.credit_statements.create.mockImplementation(async () => {
                order.push("credit")
                return {}
            })
            mockPaymentNotify.notifyLargeTopUp.mockImplementation(async () => {
                order.push("notify")
            })

            await service.issueCredit(topUpOrder as any)

            expect(order).toEqual(["credit", "notify"])
        })
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

                ; (prisma.users.findUnique as jest.Mock).mockResolvedValue(mockUser)
                ; (prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(null)
                ; (prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([]) // No credits to issue (future date)
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

                ; (prisma.users.findUnique as jest.Mock).mockResolvedValue(null)

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

                ; (prisma.users.findUnique as jest.Mock).mockResolvedValue(mockUser)
                ; (prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(null)
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

                ; (prisma.users.findUnique as jest.Mock).mockResolvedValue(mockUser)
                ; (prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(existingSubscription)
                ; (prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([]) // No credits to issue (future date)
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

                ; (prisma.users.findUnique as jest.Mock).mockResolvedValue(mockUser)
                ; (prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(null)
            mockTx.widget_subscriptions.create.mockResolvedValue({
                id: 1,
                subscription_id: "new_sub_id",
            })
            mockTx.widget_subscription_credit_issues.createMany.mockResolvedValue({ count: 1 })

                // Mock for issueWidgetSubscriptionCredit call
                ; (prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([
                    {
                        id: 1,
                        user_id: "test_user_123",
                        current_balance: 500,
                        is_issue: false,
                        subscription_id: "new_sub_id",
                    },
                ])
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(1500) })
            mockTx.credit_statements.create.mockResolvedValue({})
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})

            const result = await service.updateWidgetSubscriptions(body, mockDeveloperInfo as any)

            expect(result).toEqual({ success: true })
            // Should call findMany to get credits to issue
            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalled()
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

                ; (prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([pendingCredit])
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(1500) })
            mockTx.credit_statements.create.mockResolvedValue({})
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})

            await service.issueWidgetSubscriptionCredit("sub_123")

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    issue_date: { lte: expect.any(Date) },
                    current_balance_precise: { gt: 0 },
                    is_issue: false,
                    subscription_id: "sub_123",
                },
            })
        })

        it("should issue all credits when no subscription_id provided", async () => {
            ; (prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([])

            await service.issueWidgetSubscriptionCredit()

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    issue_date: { lte: expect.any(Date) },
                    current_balance_precise: { gt: 0 },
                    is_issue: false,
                },
            })
        })
    })

    describe("processWidgetSubscriptionCredits (cron job)", () => {
        it("only issues, because subscription credit does not expire", async () => {
            process.env.TASK_SLOT = "1"
            ; (prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([])

            await service.processWidgetSubscriptionCredits()

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledTimes(1)
            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    issue_date: { lte: expect.any(Date) },
                    current_balance_precise: { gt: 0 },
                    is_issue: false,
                },
            })
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

                ; (prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(subscription)
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
            ; (prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(null)

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

                ; (prisma.widget_subscriptions.findFirst as jest.Mock).mockResolvedValue(subscription)
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

    describe("consumeCredit - row locking for concurrent requests", () => {
        it("should execute FOR UPDATE lock before checking balance", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            // Add $queryRaw mock to transaction
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])

            // Mock getUserCredits via tx (after lock)
            mockTx.users = {
                ...mockTx.users,
                findFirst: jest.fn().mockResolvedValue(userRow(1000)),
            }
            mockTx.free_credit_issues.findMany.mockResolvedValue([])
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(700) })
            mockTx.credit_statements.create.mockResolvedValue({})

            await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            // Verify FOR UPDATE lock was called
            expect(mockTx.$queryRaw).toHaveBeenCalled()
            const queryCall = mockTx.$queryRaw.mock.calls[0]
            // Check that the query contains FOR UPDATE
            expect(queryCall[0].some((str: string) => str.includes("FOR UPDATE"))).toBe(true)
        })

        it("should use transaction client for getUserCredits after lock", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])
            mockTx.users = {
                ...mockTx.users,
                findFirst: jest.fn().mockResolvedValue(userRow(1000)),
            }
            mockTx.free_credit_issues.findMany.mockResolvedValue([])
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(700) })
            mockTx.credit_statements.create.mockResolvedValue({})

            await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            // Verify getUserCredits uses the transaction client (tx.users.findFirst)
            expect(mockTx.users.findFirst).toHaveBeenCalledWith({
                where: { username_in_be: "test_user_123" },
            })
        })
    })

    describe("consumeCredit - with subscription credits", () => {
        it("should consume subscription credits after free credits are exhausted", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            // Add $queryRaw mock for FOR UPDATE lock
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])

            // Mock getUserCredits via tx
            mockTx.users = {
                ...mockTx.users,
                findFirst: jest.fn().mockResolvedValue(userRow(1000)),
            }

            // No free credits
            mockTx.free_credit_issues.findMany.mockResolvedValue([])

            // Has subscription credits
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 500, current_balance_precise: 500 },
            ])
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(700) })
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({ current_balance_precise: 200 })
            mockTx.credit_statements.create.mockResolvedValue({})

            const result = await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            expect(result.total_credit_consumed).toBe(300)
            // The precise column takes the atomic decrement; the integer column is then
            // set to the floor of what that produced, never decremented itself.
            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenNthCalledWith(1, {
                where: { id: 1 },
                data: { current_balance_precise: { increment: -300 } },
            })
            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenNthCalledWith(2, {
                where: { id: 1 },
                data: { current_balance: 200 },
            })
        })

        it("should consume subscription credits before free credits", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            // Add $queryRaw mock for FOR UPDATE lock
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])

            // Mock getUserCredits via tx
            mockTx.users = {
                ...mockTx.users,
                findFirst: jest.fn().mockResolvedValue(userRow(1000)),
            }

            // Free credits (100)
            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, balance_precise: 100, expire_date: new Date("2025-12-31") },
            ])

            // Subscription credits (500)
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 500, current_balance_precise: 500 },
            ])
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue({
                _sum: { current_balance: 500, current_balance_precise: 500 },
            })

            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(700) })
            mockTx.free_credit_issues.update.mockResolvedValue({})
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})
            mockTx.credit_statements.create.mockResolvedValue({})

            // Consume 300: subscription covers all of it, free credit is untouched
            const result = await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            expect(result.total_credit_consumed).toBe(300)
            expect(result.free_credit_consumed).toBe(0)
            expect(mockTx.free_credit_issues.update).not.toHaveBeenCalled()
        })

        it("should consume in subscription -> paid -> free order", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])

            // Total 400 = 100 subscription + 200 paid + 100 free
            mockTx.users = {
                ...mockTx.users,
                findFirst: jest.fn().mockResolvedValue(userRow(400)),
            }

            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, balance_precise: 100, expire_date: new Date("2099-12-31") },
            ])
            mockTx.free_credit_issues.aggregate.mockResolvedValue(sumOf("balance", 100))
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 100, current_balance_precise: 100 },
            ])
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue({
                _sum: { current_balance: 100, current_balance_precise: 100 },
            })

            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(50) })
            mockTx.free_credit_issues.update.mockResolvedValue({})
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})
            mockTx.credit_statements.create.mockResolvedValue({})

            // Consume 350: 100 subscription + 200 paid + 50 free
            const result = await service.consumeCredit(350, "order_123", userInfo, mockTx as any, true)

            expect(result.total_credit_consumed).toBe(350)
            expect(result.free_credit_consumed).toBe(50)

            const statements = mockTx.credit_statements.create.mock.calls.map((call: any[]) => call[0].data)
            expect(statements).toHaveLength(3)
            expect(statements[0]).toMatchObject({ amount: -100, is_subscription_credit: true })
            expect(statements[1]).toMatchObject({ amount: -200 })
            expect(statements[1].is_free_credit).toBeUndefined()
            expect(statements[1].is_subscription_credit).toBeUndefined()
            expect(statements[2]).toMatchObject({ amount: -50, is_free_credit: true })
        })

        it("should only consume issued subscription credits (is_issue: true)", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            // Add $queryRaw mock for FOR UPDATE lock
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])

            // Mock getUserCredits via tx
            mockTx.users = {
                ...mockTx.users,
                findFirst: jest.fn().mockResolvedValue(userRow(500)),
            }
            mockTx.free_credit_issues.findMany.mockResolvedValue([])

            // Query should only return is_issue: true
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(200) })
            mockTx.credit_statements.create.mockResolvedValue({})

            const result = await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            // No expire_date: subscription credit does not expire.
            expect(mockTx.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    user_id: "test_user_123",
                    current_balance_precise: { gt: 0 },
                    is_issue: true,
                },
                orderBy: { expire_date: "asc" },
            })
        })
    })

    describe("expired credit is not spendable", () => {
        const userInfo = { usernameShorted: "test_user_123" } as any

        /**
         * A balance made entirely of free credit that expired but has not been
         * swept yet: it still counts towards current_credit_balance, and no bucket
         * will spend it.
         */
        const givenOnlyExpiredFreeCredit = (amount: number) => {
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])
            mockTx.users.findFirst = jest.fn().mockResolvedValue(userRow(amount))
            // getUserCredits does not filter by expiry, so it sees the row...
            mockTx.free_credit_issues.findMany.mockImplementation(({ where }: any) =>
                where?.expire_date ? [] : [{ id: 1, balance: amount, balance_precise: amount, expire_date: new Date("2020-01-01") }],
            )
            // ...but none of it is spendable.
            mockTx.free_credit_issues.aggregate.mockResolvedValue(sumOf("balance", 0))
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue(sumOf("current_balance", 0))
        }

        it("refuses to spend free credit that has expired but not been swept", async () => {
            givenOnlyExpiredFreeCredit(100)

            await expect(service.consumeCredit(100, "order_123", userInfo, mockTx as any, true)).rejects.toThrow(
                "Insufficient credit balance",
            )
        })

        it("does not touch the balance when it refuses", async () => {
            givenOnlyExpiredFreeCredit(100)

            await expect(service.consumeCredit(100, "order_123", userInfo, mockTx as any, true)).rejects.toThrow()

            // The bug this guards: the balance used to be decremented here with no
            // issue row behind it, and the sweep would then deduct the untouched row
            // as well, leaving the user negative.
            expect(mockTx.users.update).not.toHaveBeenCalled()
            expect(mockTx.credit_statements.create).not.toHaveBeenCalled()
        })

        it("reports expired free credit as unspendable while still counting it in the total", async () => {
            givenOnlyExpiredFreeCredit(100)

            const balances = await service.getSpendableBalance("test_user_123", mockTx as any)

            expect(balances).toMatchObject({ total: 100, free: 100, freeSpendable: 0, spendable: 0 })
        })

        it("spends subscription credit regardless of its expire_date", async () => {
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])
            mockTx.users.findFirst = jest.fn().mockResolvedValue(userRow(100))
            mockTx.free_credit_issues.findMany.mockResolvedValue([])
            mockTx.free_credit_issues.aggregate.mockResolvedValue(sumOf("balance", 0))
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 100, expire_date: new Date("2020-01-01") },
            ])
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue(sumOf("current_balance", 100))
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(0) })
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})
            mockTx.credit_statements.create.mockResolvedValue({})

            const result = await service.consumeCredit(100, "order_123", userInfo, mockTx as any, true)

            expect(result.total_credit_consumed).toBe(100)
            const where = mockTx.widget_subscription_credit_issues.findMany.mock.calls[0][0].where
            expect(where.expire_date).toBeUndefined()
        })
    })

    describe("spendForCreditLineRepayment", () => {
        /**
         * The credit-account leg of a repayment, exercised for real rather than
         * mocked out. The credit line service's own tests stub this method, so
         * without these the promise that free credit never services a debt is only
         * ever asserted as a clamp on the amount.
         */
        const givenBuckets = (opts: { total: number; free: number; subscription: number; subExpired?: boolean }) => {
            mockTx.users.findFirst = jest.fn().mockResolvedValue(userRow(opts.total))
            mockTx.free_credit_issues.findMany.mockResolvedValue(
                opts.free ? [{ id: 1, balance: opts.free, balance_precise: opts.free, expire_date: new Date("2099-12-31") }] : [],
            )
            mockTx.free_credit_issues.aggregate.mockResolvedValue(sumOf("balance", opts.free || null))
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue(
                opts.subscription
                    ? [
                          {
                              ...mockSubscriptionCredit,
                              current_balance: opts.subscription,
                              current_balance_precise: opts.subscription,
                              expire_date: opts.subExpired ? new Date("2020-01-01") : new Date("2099-12-31"),
                          },
                      ]
                    : [],
            )
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue({
                _sum: {
                    current_balance: opts.subscription || null,
                    current_balance_precise: opts.subscription || null,
                },
            })
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(0) })
            mockTx.widget_subscription_credit_issues.update.mockResolvedValue({})
            mockTx.free_credit_issues.update.mockResolvedValue({})
            mockTx.credit_statements.create.mockResolvedValue({})
        }

        it("leaves free credit alone even when it would cover the amount", async () => {
            // 100 free + 200 subscription, repaying 200: the whole thing must come
            // out of subscription.
            givenBuckets({ total: 300, free: 100, subscription: 200 })

            await service.spendForCreditLineRepayment(mockTx as any, "test_user_123", 200)

            expect(mockTx.free_credit_issues.update).not.toHaveBeenCalled()
            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledWith({
                where: { id: mockSubscriptionCredit.id },
                data: { current_balance_precise: { increment: -200 } },
            })
            const statements = mockTx.credit_statements.create.mock.calls.map((c: any[]) => c[0].data)
            expect(statements).toHaveLength(1)
            expect(statements[0]).toMatchObject({
                type: credit_statement_type.repay_credit_line,
                amount: -200,
                is_subscription_credit: true,
            })
            expect(statements[0].is_free_credit).toBeUndefined()
        })

        it("spends a subscription row whose expire_date has passed, and empties the row with it", async () => {
            // This is the shape that used to drive the balance negative: the row was
            // skipped, the balance was decremented anyway, and the sweep then took
            // the untouched row as well.
            givenBuckets({ total: 100, free: 0, subscription: 100, subExpired: true })

            await service.spendForCreditLineRepayment(mockTx as any, "test_user_123", 100)

            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledWith({
                where: { id: mockSubscriptionCredit.id },
                data: { current_balance_precise: { increment: -100 } },
            })
            expect(mockTx.users.update).toHaveBeenCalledWith({
                where: { username_in_be: "test_user_123" },
                data: { current_credit_balance_precise: { increment: -100 } },
            })
        })

        it("crosses subscription into paid, one statement per bucket", async () => {
            // 200 subscription + 300 paid, repaying 400.
            givenBuckets({ total: 500, free: 0, subscription: 200 })

            await service.spendForCreditLineRepayment(mockTx as any, "test_user_123", 400)

            const statements = mockTx.credit_statements.create.mock.calls.map((c: any[]) => c[0].data)
            expect(statements).toHaveLength(2)
            expect(statements[0]).toMatchObject({ amount: -200, is_subscription_credit: true })
            expect(statements[1]).toMatchObject({ amount: -200 })
            expect(statements[1].is_subscription_credit).toBeUndefined()
            expect(statements.every((s: any) => s.type === credit_statement_type.repay_credit_line)).toBe(true)
        })

        it("refuses rather than dipping into free credit when the rest cannot cover it", async () => {
            // 100 free + 100 subscription, asked for 200: free is off limits, so the
            // buckets come up short. The caller clamps to make this unreachable, and
            // it must fail loudly rather than quietly spend the gift.
            givenBuckets({ total: 200, free: 100, subscription: 100 })

            await expect(
                service.spendForCreditLineRepayment(mockTx as any, "test_user_123", 200),
            ).rejects.toThrow("Insufficient credit balance")
            expect(mockTx.free_credit_issues.update).not.toHaveBeenCalled()
        })
    })

    describe("getRepayableBalance", () => {
        it("is the balance minus all free credit, expired or not", async () => {
            mockTx.users.findFirst = jest.fn().mockResolvedValue(userRow(500))
            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, balance_precise: 100, expire_date: new Date("2099-12-31") },
                { id: 2, balance: 50, balance_precise: 50, expire_date: new Date("2020-01-01") },
            ])

            // Subscription credit does not expire, so what is left is exactly what
            // the buckets will spend: no gap for a repayment to fall through.
            expect(await service.getRepayableBalance("test_user_123", mockTx as any)).toBe(350)
        })

        it("never goes negative", async () => {
            mockTx.users.findFirst = jest.fn().mockResolvedValue(userRow(50))
            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, balance_precise: 100, expire_date: new Date("2099-12-31") },
            ])

            expect(await service.getRepayableBalance("test_user_123", mockTx as any)).toBe(0)
        })
    })

    describe("refundCredit - with subscription credits", () => {
        it("should refund subscription credits correctly", async () => {
            const consumeStatement = {
                id: 1,
                amount: -300,
                amount_precise: -300,
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
            mockTx.users.update = jest.fn().mockResolvedValue({ ...mockUser, ...userRow(1300) })
            mockTx.credit_statements.create = jest.fn().mockResolvedValue({})

            await service.refundCredit(300, "order_123", "test_user_123", mockTx as any)

            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { current_balance_precise: { increment: 300 } },
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

        it("refunds subscription credit even when its expire_date has passed", async () => {
            // Subscription credit does not expire, so a past expire_date is just a
            // recorded date and must not block the refund.
            const consumeStatement = {
                id: 1,
                amount: -300,
                amount_precise: -300,
                is_free_credit: false,
                is_subscription_credit: true,
                subscription_credit_issue_id: 1,
                free_credit_issue_id: null,
            }

            mockTx.credit_statements.findMany = jest.fn().mockResolvedValue([consumeStatement])
            mockTx.widget_subscription_credit_issues.update = jest.fn().mockResolvedValue({})
            mockTx.users.update = jest.fn().mockResolvedValue({ ...mockUser, ...userRow(1300) })
            mockTx.credit_statements.create = jest.fn().mockResolvedValue({})

            await service.refundCredit(300, "order_123", "test_user_123", mockTx as any)

            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { current_balance_precise: { increment: 300 } },
            })
            expect(mockTx.users.update).toHaveBeenCalledWith({
                where: { username_in_be: "test_user_123" },
                data: { current_credit_balance_precise: { increment: 300 } },
            })
        })

        it("still skips free credit whose expiry has passed", async () => {
            // Free credit does expire, so this branch stays.
            mockTx.credit_statements.findMany = jest.fn().mockResolvedValue([
                {
                    id: 1,
                    amount: -300,
                    amount_precise: -300,
                    is_free_credit: true,
                    is_subscription_credit: false,
                    free_credit_issue_id: 1,
                    subscription_credit_issue_id: null,
                },
            ])
            mockTx.free_credit_issues.findUnique = jest
                .fn()
                .mockResolvedValue({ id: 1, expire_date: new Date("2020-01-01") })
            mockTx.free_credit_issues.update = jest.fn().mockResolvedValue({})
            mockTx.users.update = jest.fn().mockResolvedValue({})

            await service.refundCredit(300, "order_123", "test_user_123", mockTx as any)

            expect(mockTx.free_credit_issues.update).not.toHaveBeenCalled()
            expect(mockTx.users.update).not.toHaveBeenCalled()
        })
    })
    describe("adminReverseStatement", () => {
        const admin = { usernameShorted: "admin_1" } as any
        const topUp = {
            id: 42,
            user: "test_user_123",
            type: credit_statement_type.top_up,
            amount: 5000,
            amount_precise: 5000,
            order_id: "fake-order",
            reversal_of: null,
            reversed_by: null,
        }

        beforeEach(() => {
            ;(prisma.credit_statements.findUnique as jest.Mock) = jest.fn().mockResolvedValue(topUp)
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])
            mockTx.credit_statements.findUniqueOrThrow = jest.fn().mockResolvedValue(topUp)
            mockTx.credit_statements.create.mockResolvedValue({ id: 99 })
            mockTx.credit_statements.update = jest.fn().mockResolvedValue({})
            mockTx.users.findUniqueOrThrow = jest.fn().mockResolvedValue(userRow(1200))
            mockTx.users.update.mockResolvedValue({ ...mockUser, ...userRow(-3800) })
            mockTx.orders = {
                findUnique: jest.fn().mockResolvedValue({ order_id: "fake-order", is_credit_top_up: true }),
                update: jest.fn().mockResolvedValue({}),
            }
            mockTx.admin_logs = { create: jest.fn().mockResolvedValue({}) }
        })

        it("appends a negated top_up linked both ways, takes the amount off the balance, cancels the order, logs it", async () => {
            const result = await service.adminReverseStatement(42, { reason: "replayed callback" }, admin)

            expect(result).toEqual({
                statement_id: 42,
                reversal_id: 99,
                user: "test_user_123",
                amount: 5000,
                balance_before: 1200,
                balance_after: -3800,
                order_id: "fake-order",
                order_cancelled: true,
            })
            // Balance: precise decrement, then the integer mirror.
            expect(mockTx.users.update).toHaveBeenNthCalledWith(1, {
                where: { username_in_be: "test_user_123" },
                data: { current_credit_balance_precise: { increment: -5000 } },
            })
            expect(mockTx.credit_statements.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    user: "test_user_123",
                    type: credit_statement_type.top_up,
                    amount: -5000,
                    amount_precise: -5000,
                    balance: -3800,
                    balance_precise: -3800,
                    order_id: "fake-order",
                    reversal_of: 42,
                }),
            })
            expect(mockTx.credit_statements.update).toHaveBeenCalledWith({
                where: { id: 42 },
                data: { reversed_by: 99 },
            })
            expect(mockTx.orders.update).toHaveBeenCalledWith({
                where: { order_id: "fake-order" },
                data: expect.objectContaining({ current_status: "cancelled" }),
            })
            expect(mockTx.admin_logs.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: "reverse_credit_statement",
                    user: "admin_1",
                    data: expect.objectContaining({ reason: "replayed callback", reversal_id: 99 }),
                }),
            })
        })

        it("locks the user row before touching anything", async () => {
            await service.adminReverseStatement(42, { reason: "x" }, admin)

            expect(mockTx.$queryRaw.mock.calls[0][0].join("?")).toContain("FOR UPDATE")
            expect(mockTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
                mockTx.users.update.mock.invocationCallOrder[0],
            )
        })

        it("leaves an order that is not a top-up order alone", async () => {
            mockTx.orders.findUnique.mockResolvedValue({ order_id: "fake-order", is_credit_top_up: false })

            const result = await service.adminReverseStatement(42, { reason: "x" }, admin)

            expect(result.order_cancelled).toBe(false)
            expect(mockTx.orders.update).not.toHaveBeenCalled()
        })

        /** Every other type also moved a bucket or an order's paid status; a reversal would not unwind those. */
        it("refuses anything but a top_up", async () => {
            for (const type of [
                credit_statement_type.consume,
                credit_statement_type.refund,
                credit_statement_type.issue_free_credit,
                credit_statement_type.issue_subscription_credit,
            ]) {
                ;(prisma.credit_statements.findUnique as jest.Mock).mockResolvedValue({ ...topUp, type })

                await expect(service.adminReverseStatement(42, { reason: "x" }, admin)).rejects.toThrow(
                    "Only top_up statements can be reversed",
                )
            }
            expect(mockTx.users.update).not.toHaveBeenCalled()
        })

        /** Checked under the lock, so two admins cannot reverse the same top-up twice. */
        it("refuses a top-up that is already reversed, and a reversal row itself", async () => {
            mockTx.credit_statements.findUniqueOrThrow.mockResolvedValue({ ...topUp, reversed_by: 77 })
            await expect(service.adminReverseStatement(42, { reason: "x" }, admin)).rejects.toThrow(
                "already reversed by 77",
            )

            mockTx.credit_statements.findUniqueOrThrow.mockResolvedValue({ ...topUp, reversal_of: 41, amount_precise: -5000 })
            await expect(service.adminReverseStatement(42, { reason: "x" }, admin)).rejects.toThrow(
                "A reversal cannot itself be reversed",
            )

            expect(mockTx.users.update).not.toHaveBeenCalled()
            expect(mockTx.credit_statements.create).not.toHaveBeenCalled()
        })

        it("requires a reason and an existing statement", async () => {
            await expect(service.adminReverseStatement(42, { reason: "  " }, admin)).rejects.toThrow(
                "A reason is required",
            )
            ;(prisma.credit_statements.findUnique as jest.Mock).mockResolvedValue(null)
            await expect(service.adminReverseStatement(42, { reason: "x" }, admin)).rejects.toThrow(
                "Statement not found",
            )
            expect(mockTx.users.update).not.toHaveBeenCalled()
        })
    })

    describe("transferCredit", () => {
        const sender = { ...mockUser, transfer_max_amount: null, transfer_max_daily_count: null }
        const recipient = {
            id: 2,
            username_in_be: "aaa_recipient",
            email: "friend@example.com",
            ...userRow(0),
            transfer_max_amount: null,
            transfer_max_daily_count: null,
        }
        const asSender = { usernameShorted: "test_user_123" } as any
        const body = { to_email: "friend@example.com", amount: 300, request_id: "req-1" }

        beforeEach(() => {
            ;(prisma.users.findUnique as jest.Mock).mockImplementation(({ where }: any) =>
                where.email === "friend@example.com" || where.username_in_be === "aaa_recipient"
                    ? recipient
                    : where.username_in_be === "test_user_123"
                      ? sender
                      : null,
            )
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])
            // The sender holds 1000, none of it free, so all of it may be transferred.
            mockTx.users.findFirst.mockResolvedValue({ ...sender, ...userRow(1000) })
            mockTx.free_credit_issues.findMany.mockResolvedValue([])
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.users.update.mockResolvedValue({ ...sender, ...userRow(700) })
            mockTx.credit_statements.create.mockResolvedValue({ id: 1 })
            mockTx.credit_transfers.create.mockResolvedValue({
                transfer_id: "t-1",
                from_user: "test_user_123",
                amount_precise: 300,
                created_at: new Date("2026-09-22T00:00:00Z"),
            })
            ;(prisma.users.findFirst as jest.Mock).mockResolvedValue({ ...sender, ...userRow(700) })
            ;(prisma.free_credit_issues.findMany as jest.Mock).mockResolvedValue([])
        })

        it("debits the sender through the buckets and credits the recipient as plain paid credit", async () => {
            const result = await service.transferCredit(body as any, asSender)

            const creates = mockTx.credit_statements.create.mock.calls.map((c: any[]) => c[0].data)
            const out = creates.find((d: any) => d.type === credit_statement_type.transfer_out)
            const incoming = creates.find((d: any) => d.type === credit_statement_type.transfer_in)

            expect(out).toMatchObject({
                user: "test_user_123",
                amount_precise: -300,
                transfer_peer: "aaa_recipient",
            })
            // The recipient never subscribed to anything, so nothing marks their row
            // as subscription or free credit: it is ordinary paid credit.
            expect(incoming).toMatchObject({
                user: "aaa_recipient",
                amount_precise: 300,
                transfer_peer: "test_user_123",
            })
            expect(incoming.is_free_credit).toBeUndefined()
            expect(incoming.is_subscription_credit).toBeUndefined()
            // Both legs carry the same transfer id, which is also the log's key.
            expect(out.order_id).toBe(incoming.order_id)
            expect(mockTx.credit_transfers.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    from_user: "test_user_123",
                    to_user: "aaa_recipient",
                    amount_precise: 300,
                    amount: 300,
                    request_id: "req-1",
                }),
            })
            expect(result.duplicate).toBe(false)
        })

        /** Two people transferring to each other at once deadlock unless the order is fixed. */
        it("locks both accounts, always in the same order", async () => {
            await service.transferCredit(body as any, asSender)

            const locked = mockTx.$queryRaw.mock.calls.map((call: any[]) => call[1])
            expect(locked).toEqual(["aaa_recipient", "test_user_123"])
        })

        it("refuses to send to yourself", async () => {
            await expect(
                service.transferCredit({ ...body, to_email: "test@example.com" } as any, asSender),
            ).rejects.toThrow(BadRequestException)
        })

        it("refuses an account that does not exist rather than creating one", async () => {
            ;(prisma.users.findUnique as jest.Mock).mockImplementation(({ where }: any) =>
                where.username_in_be === "test_user_123" ? sender : null,
            )
            await expect(
                service.transferCredit({ ...body, to_email: "nobody@example.com" } as any, asSender),
            ).rejects.toThrow("Recipient account not found")
            expect(mockTx.credit_transfers.create).not.toHaveBeenCalled()
        })

        it("refuses more than the per-transfer cap, and reads the cap off the account first", async () => {
            await expect(service.transferCredit({ ...body, amount: 100_001 } as any, asSender)).rejects.toThrow(
                /may not exceed 100000/,
            )

            ;(prisma.users.findUnique as jest.Mock).mockImplementation(({ where }: any) =>
                where.email === "friend@example.com"
                    ? recipient
                    : { ...sender, transfer_max_amount: 50 as never },
            )
            await expect(service.transferCredit({ ...body, amount: 60 } as any, asSender)).rejects.toThrow(
                /may not exceed 50/,
            )
        })

        it("refuses once the account has sent its allowance of transfers for the day", async () => {
            mockTx.credit_transfers.count.mockResolvedValue(20)
            await expect(service.transferCredit(body as any, asSender)).rejects.toThrow(/Daily transfer limit/)
            expect(mockTx.credit_transfers.create).not.toHaveBeenCalled()
        })

        /** Free credit is a gift; it stays with the account it was given to. */
        it("will not transfer free credit, even though it is inside the balance", async () => {
            mockTx.users.findFirst.mockResolvedValue({ ...sender, ...userRow(1000) })
            mockTx.free_credit_issues.findMany.mockResolvedValue([{ id: 7, balance_precise: 800 }])

            await expect(service.transferCredit({ ...body, amount: 300 } as any, asSender)).rejects.toThrow(
                /Free credit cannot be transferred/,
            )
        })

        it("replays a repeated request_id without moving credit again", async () => {
            ;(prisma.credit_transfers.findFirst as jest.Mock).mockResolvedValue({
                transfer_id: "t-original",
                from_user: "test_user_123",
                amount_precise: 300,
                created_at: new Date("2026-09-20T00:00:00Z"),
            })

            const result = await service.transferCredit(body as any, asSender)

            expect(result).toMatchObject({ transfer_id: "t-original", duplicate: true, amount_precise: 300 })
            expect(prisma.$transaction).not.toHaveBeenCalled()
            expect(mockTx.credit_statements.create).not.toHaveBeenCalled()
        })

        it("announces a large transfer with both parties", async () => {
            mockPaymentNotify.isLargeTransfer.mockReturnValue(true)

            await service.transferCredit(body as any, asSender)

            expect(mockPaymentNotify.notifyLargeTransfer).toHaveBeenCalledWith(
                expect.objectContaining({
                    from_email: "test@example.com",
                    from_user: "test_user_123",
                    to_email: "friend@example.com",
                    to_user: "aaa_recipient",
                    credits: 300,
                }),
            )
        })
    })

    describe("adminSetTransferLimit", () => {
        const admin = { usernameShorted: "admin_1" } as any

        beforeEach(() => {
            ;(prisma.users.findUnique as jest.Mock).mockResolvedValue({
                username_in_be: "test_user_123",
                transfer_max_amount: null,
                transfer_max_daily_count: null,
            })
            ;(prisma.users.update as jest.Mock).mockResolvedValue({})
            ;(prisma.users.findFirst as jest.Mock).mockResolvedValue(userRow(500))
            ;(prisma.free_credit_issues.findMany as jest.Mock).mockResolvedValue([])
        })

        it("writes the override and logs who changed it", async () => {
            await service.adminSetTransferLimit("test_user_123", { max_amount: 5000 }, admin)

            expect(prisma.users.update).toHaveBeenCalledWith({
                where: { username_in_be: "test_user_123" },
                data: { transfer_max_amount: 5000 },
            })
            expect(prisma.admin_logs.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ action: "set_transfer_limit", user: "admin_1" }),
            })
        })

        /** Null is the way back to the global default, so it must reach the column. */
        it("clears an override with null instead of ignoring it", async () => {
            await service.adminSetTransferLimit("test_user_123", { max_daily_count: null }, admin)

            expect(prisma.users.update).toHaveBeenCalledWith({
                where: { username_in_be: "test_user_123" },
                data: { transfer_max_daily_count: null },
            })
        })

        it("refuses a body that changes nothing", async () => {
            await expect(service.adminSetTransferLimit("test_user_123", {}, admin)).rejects.toThrow(BadRequestException)
        })
    })

})
