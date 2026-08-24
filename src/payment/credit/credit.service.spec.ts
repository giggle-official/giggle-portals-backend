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

import { CreditService } from "./credit.service"
import { PrismaService } from "../../common/prisma.service"
import { UserService } from "../../user/user.service"
import { OrderService } from "../order/order.service"
import { NotificationService } from "../../notification/notification.service"
import { SettleService } from "../settle/settle.service"

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
                aggregate: jest.fn().mockResolvedValue({ _sum: { current_balance: 0 } }),
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
                // Spendable free credit: what is left once expired-but-unswept rows
                // are taken out. Defaults to "nothing has expired".
                aggregate: jest.fn().mockResolvedValue({ _sum: { balance: null } }),
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

        const mockSettleService = {
            settleOrder: jest.fn(),
        }

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CreditService,
                { provide: PrismaService, useValue: mockPrismaService },
                { provide: UserService, useValue: mockUserService },
                { provide: OrderService, useValue: mockOrderService },
                { provide: NotificationService, useValue: mockNotificationService },
                { provide: SettleService, useValue: mockSettleService },
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
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 1500 })
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
            ; (prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([])

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
        it("only issues, because subscription credit does not expire", async () => {
            process.env.TASK_SLOT = "1"
            ; (prisma.widget_subscription_credit_issues.findMany as jest.Mock).mockResolvedValue([])

            await service.processWidgetSubscriptionCredits()

            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledTimes(1)
            expect(prisma.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    issue_date: { lte: expect.any(Date) },
                    current_balance: { gt: 0 },
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
                findFirst: jest.fn().mockResolvedValue({ current_credit_balance: 1000 }),
            }
            mockTx.free_credit_issues.findMany.mockResolvedValue([])
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 700 })
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
                findFirst: jest.fn().mockResolvedValue({ current_credit_balance: 1000 }),
            }
            mockTx.free_credit_issues.findMany.mockResolvedValue([])
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 700 })
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
                findFirst: jest.fn().mockResolvedValue({ current_credit_balance: 1000 }),
            }

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
                data: { current_balance: { decrement: 300 } },
            })
        })

        it("should consume subscription credits before free credits", async () => {
            const userInfo = { usernameShorted: "test_user_123" } as any

            // Add $queryRaw mock for FOR UPDATE lock
            mockTx.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }])

            // Mock getUserCredits via tx
            mockTx.users = {
                ...mockTx.users,
                findFirst: jest.fn().mockResolvedValue({ current_credit_balance: 1000 }),
            }

            // Free credits (100)
            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, expire_date: new Date("2025-12-31") },
            ])

            // Subscription credits (500)
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 500 },
            ])
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue({
                _sum: { current_balance: 500 },
            })

            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 700 })
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
                findFirst: jest.fn().mockResolvedValue({ current_credit_balance: 400 }),
            }

            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, expire_date: new Date("2099-12-31") },
            ])
            mockTx.free_credit_issues.aggregate.mockResolvedValue({ _sum: { balance: 100 } })
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 100 },
            ])
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue({
                _sum: { current_balance: 100 },
            })

            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 50 })
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
                findFirst: jest.fn().mockResolvedValue({ current_credit_balance: 500 }),
            }
            mockTx.free_credit_issues.findMany.mockResolvedValue([])

            // Query should only return is_issue: true
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 200 })
            mockTx.credit_statements.create.mockResolvedValue({})

            const result = await service.consumeCredit(300, "order_123", userInfo, mockTx as any, true)

            // No expire_date: subscription credit does not expire.
            expect(mockTx.widget_subscription_credit_issues.findMany).toHaveBeenCalledWith({
                where: {
                    user_id: "test_user_123",
                    current_balance: { gt: 0 },
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
            mockTx.users.findFirst = jest.fn().mockResolvedValue({ current_credit_balance: amount })
            // getUserCredits does not filter by expiry, so it sees the row...
            mockTx.free_credit_issues.findMany.mockImplementation(({ where }: any) =>
                where?.expire_date ? [] : [{ id: 1, balance: amount, expire_date: new Date("2020-01-01") }],
            )
            // ...but none of it is spendable.
            mockTx.free_credit_issues.aggregate.mockResolvedValue({ _sum: { balance: 0 } })
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([])
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue({ _sum: { current_balance: 0 } })
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
            mockTx.users.findFirst = jest.fn().mockResolvedValue({ current_credit_balance: 100 })
            mockTx.free_credit_issues.findMany.mockResolvedValue([])
            mockTx.free_credit_issues.aggregate.mockResolvedValue({ _sum: { balance: 0 } })
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue([
                { ...mockSubscriptionCredit, current_balance: 100, expire_date: new Date("2020-01-01") },
            ])
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue({ _sum: { current_balance: 100 } })
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 0 })
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
            mockTx.users.findFirst = jest.fn().mockResolvedValue({ current_credit_balance: opts.total })
            mockTx.free_credit_issues.findMany.mockResolvedValue(
                opts.free ? [{ id: 1, balance: opts.free, expire_date: new Date("2099-12-31") }] : [],
            )
            mockTx.free_credit_issues.aggregate.mockResolvedValue({ _sum: { balance: opts.free || null } })
            mockTx.widget_subscription_credit_issues.findMany.mockResolvedValue(
                opts.subscription
                    ? [
                          {
                              ...mockSubscriptionCredit,
                              current_balance: opts.subscription,
                              expire_date: opts.subExpired ? new Date("2020-01-01") : new Date("2099-12-31"),
                          },
                      ]
                    : [],
            )
            mockTx.widget_subscription_credit_issues.aggregate.mockResolvedValue({
                _sum: { current_balance: opts.subscription || null },
            })
            mockTx.users.update.mockResolvedValue({ ...mockUser, current_credit_balance: 0 })
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
                data: { current_balance: { decrement: 200 } },
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
                data: { current_balance: { decrement: 100 } },
            })
            expect(mockTx.users.update).toHaveBeenCalledWith({
                where: { username_in_be: "test_user_123" },
                data: { current_credit_balance: { decrement: 100 } },
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
            mockTx.users.findFirst = jest.fn().mockResolvedValue({ current_credit_balance: 500 })
            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, expire_date: new Date("2099-12-31") },
                { id: 2, balance: 50, expire_date: new Date("2020-01-01") },
            ])

            // Subscription credit does not expire, so what is left is exactly what
            // the buckets will spend: no gap for a repayment to fall through.
            expect(await service.getRepayableBalance("test_user_123", mockTx as any)).toBe(350)
        })

        it("never goes negative", async () => {
            mockTx.users.findFirst = jest.fn().mockResolvedValue({ current_credit_balance: 50 })
            mockTx.free_credit_issues.findMany.mockResolvedValue([
                { id: 1, balance: 100, expire_date: new Date("2099-12-31") },
            ])

            expect(await service.getRepayableBalance("test_user_123", mockTx as any)).toBe(0)
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

        it("refunds subscription credit even when its expire_date has passed", async () => {
            // Subscription credit does not expire, so a past expire_date is just a
            // recorded date and must not block the refund.
            const consumeStatement = {
                id: 1,
                amount: -300,
                is_free_credit: false,
                is_subscription_credit: true,
                subscription_credit_issue_id: 1,
                free_credit_issue_id: null,
            }

            mockTx.credit_statements.findMany = jest.fn().mockResolvedValue([consumeStatement])
            mockTx.widget_subscription_credit_issues.update = jest.fn().mockResolvedValue({})
            mockTx.users.update = jest.fn().mockResolvedValue({ ...mockUser, current_credit_balance: 1300 })
            mockTx.credit_statements.create = jest.fn().mockResolvedValue({})

            await service.refundCredit(300, "order_123", "test_user_123", mockTx as any)

            expect(mockTx.widget_subscription_credit_issues.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { current_balance: { increment: 300 } },
            })
            expect(mockTx.users.update).toHaveBeenCalledWith({
                where: { username_in_be: "test_user_123" },
                data: { current_credit_balance: { increment: 300 } },
            })
        })

        it("still skips free credit whose expiry has passed", async () => {
            // Free credit does expire, so this branch stays.
            mockTx.credit_statements.findMany = jest.fn().mockResolvedValue([
                {
                    id: 1,
                    amount: -300,
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
})
