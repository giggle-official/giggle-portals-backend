import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { CreateUserDto, UserJwtExtractDto } from "src/user/user.controller"
import {
    GetStatementQueryDto,
    GetStatementsResponseDto,
    IssueFreeCreditDto,
    PayTopUpOrderDto,
    TopUpDto,
    UpdateWidgetSubscriptionsDto,
    UserCreditBalanceDto,
} from "./credit.dto"
import { OrderDetailDto, OrderStatus, PaymentMethod } from "src/payment/order/order.dto"
import { OrderService } from "src/payment/order/order.service"
import { UserService } from "src/user/user.service"
import { credit_statement_type, free_credit_issue_type, orders, Prisma } from "@prisma/client"
import { Cron, CronExpression } from "@nestjs/schedule"
import * as crypto from "crypto"
import { v4 as uuidv4 } from "uuid"
import { NotificationService } from "src/notification/notification.service"

@Injectable()
export class CreditService {
    private readonly logger = new Logger(CreditService.name)
    private readonly freeCreditExpireDays = 180

    constructor(
        private prisma: PrismaService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => OrderService))
        private readonly orderService: OrderService,

        private readonly notificationService: NotificationService,
    ) {}

    async getUserCredits(userId: string): Promise<UserCreditBalanceDto> {
        const user = await this.prisma.users.findFirst({
            where: {
                username_in_be: userId,
            },
        })

        if (!user) {
            return {
                total_credit_balance: 0,
                free_credit_balance: 0,
            }
        }

        //calculate free credit
        const freeCredit = await this.prisma.free_credit_issues.findMany({
            where: {
                user: userId,
                balance: {
                    gt: 0,
                },
            },
        })

        return {
            total_credit_balance: user.current_credit_balance,
            free_credit_balance: freeCredit.reduce((acc, curr) => acc + (curr.balance || 0), 0),
        }
    }

    async topUp(body: TopUpDto, userInfo: UserJwtExtractDto): Promise<OrderDetailDto> {
        const user = await this.userService.getProfile(userInfo)
        if (!user) {
            throw new BadRequestException("User not found")
        }

        return await this.orderService.createOrder(
            {
                amount: body.amount,
                description: `Top up ${body.amount} credits`,
                callback_url: body.callback_url,
                release_rewards_after_paid: false,
                allowed_payment_methods: [PaymentMethod.CREDIT2C, PaymentMethod.WALLET],
            },
            userInfo,
            {
                related_to_reward_pool: false,
                is_credit_top_up: true,
            },
        )
    }

    async issueCredit(order: orders): Promise<void> {
        if (!order.is_credit_top_up) {
            this.logger.error(`Top-up credit order not found: ${order.order_id}`)
            return
        }

        if (order.current_status !== OrderStatus.COMPLETED) {
            // we no need do anything if the order is not completed
            this.logger.error(
                `Top-up credit order(${order.order_id}) not completed, currents status: ${order.current_status}`,
            )
            return
        }

        //check if credit is already issued
        const credit = await this.prisma.credit_statements.findFirst({
            where: {
                order_id: order.order_id,
            },
        })

        if (credit) {
            this.logger.error(`Top-up credit order(${order.order_id}) already issued`)
            return
        }

        //issue credit
        await this.prisma.$transaction(async (tx) => {
            const userBalanceUpdated = await tx.users.update({
                where: {
                    username_in_be: order.owner,
                },
                data: {
                    current_credit_balance: {
                        increment: order.amount,
                    },
                },
            })
            await tx.credit_statements.create({
                data: {
                    order_id: order.order_id,
                    amount: order.amount,
                    balance: userBalanceUpdated.current_credit_balance,
                    user: order.owner,
                    type: credit_statement_type.top_up,
                },
            })
        })

        //process rewards
        this.processRewards(order)
    }

    async processRewards(order: orders): Promise<void> {
        //if first order issue free credit to invited user
        const userFirstOrder = await this.prisma.orders.findFirst({
            where: {
                owner: order.owner,
                is_credit_top_up: true,
                current_status: { in: [OrderStatus.COMPLETED, OrderStatus.REWARDS_RELEASED] },
            },
            orderBy: {
                id: "asc",
            },
        })
        if (userFirstOrder.order_id !== order.order_id) {
            this.logger.warn(
                `[PROCESS TOPUP CREDIT REWARDS] order ${order.order_id} is not the first order of user ${order.owner}, skip process rewards`,
            )
            return
        }

        const userInfo = await this.prisma.users.findUnique({
            where: {
                username_in_be: order.owner,
            },
        })
        if (!userInfo || !userInfo.invited_by) {
            this.logger.error(
                `[PROCESS TOPUP CREDIT REWARDS] user ${order.owner} not found or not invited by anyone, skip process rewards`,
            )
            return
        }

        const invitedUser = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.invited_by,
            },
        })
        if (!invitedUser) {
            this.logger.error(
                `[PROCESS TOPUP CREDIT REWARDS] invited user ${userInfo.invited_by} not found, skip process rewards`,
            )
            return
        }

        await this.issueFreeCredit(
            { email: invitedUser.email, amount: 500, issue_type: free_credit_issue_type.invite_rewards },
            {
                user_id: order.owner,
                usernameShorted: order.owner,
                app_id: order.app_id,
                developer_info: { tag: order.widget_tag, usernameShorted: "" },
            },
            {
                invited_user_id: order.owner,
            },
        )
    }

    async getStatements(query: GetStatementQueryDto, userInfo: UserJwtExtractDto): Promise<GetStatementsResponseDto> {
        const where: Prisma.credit_statementsWhereInput = {
            user: userInfo.usernameShorted,
        }

        if (query.type) {
            where.type = query.type
        }

        if (query.widget_tag) {
            where.order = {
                widget_tag: query.widget_tag,
            }
        }

        const statements = await this.prisma.credit_statements.findMany({
            where,
            skip: Math.max(0, parseInt(query.page.toString()) - 1) * Math.max(0, parseInt(query.page_size.toString())),
            take: Math.max(0, parseInt(query.page_size.toString()) || 10),
            include: {
                order: true,
                free_credit_issue: {
                    include: {
                        invited_user_info: {
                            select: {
                                username_in_be: true,
                                email: true,
                                avatar: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                id: "desc",
            },
        })

        const total = await this.prisma.credit_statements.count({
            where,
        })

        return {
            statements: statements.map((statement) => ({
                id: statement.id,
                order_id: statement.order_id,
                widget_tag: statement.order?.widget_tag,
                ip_id: statement.order?.ip_id,
                type: statement.type,
                is_free_credit: statement.is_free_credit,
                free_credit_invited_user_info: {
                    invited_user_id: statement.free_credit_issue?.invited_user_info?.username_in_be || "",
                    username: statement.free_credit_issue?.invited_user_info?.email || "",
                    avatar: statement.free_credit_issue?.invited_user_info?.avatar || "",
                },
                free_credit_issue_id: statement.free_credit_issue_id,
                is_subscription_credit: statement.is_subscription_credit,
                subscription_credit_issue_id: statement.subscription_credit_issue_id,
                amount: statement.amount,
                balance: statement.balance,
                created_at: statement.created_at,
                updated_at: statement.updated_at,
            })),
            count: total,
        }
    }

    async consumeCredit(
        amount: number,
        order_id: string,
        userInfo: UserJwtExtractDto,
        tx: Prisma.TransactionClient,
        allow_free_credit: boolean = true,
    ): Promise<{ free_credit_consumed: number; total_credit_consumed: number }> {
        const { total_credit_balance, free_credit_balance } = await this.getUserCredits(userInfo.usernameShorted)

        if (!allow_free_credit && total_credit_balance - free_credit_balance < amount) {
            throw new BadRequestException(
                "This consumption is not allowed to use free credit and the total credit balance is not enough",
            )
        }

        if (allow_free_credit && total_credit_balance < amount) {
            throw new BadRequestException("Insufficient credit balance")
        }

        let needCreditConsumed = amount
        let freeCreditConsumed = 0

        const now = new Date()
        const freeCredits = await tx.free_credit_issues.findMany({
            where: {
                user: userInfo.usernameShorted,
                balance: { gt: 0 },
                expire_date: { gte: now },
            },
            orderBy: {
                expire_date: "asc",
            },
        })

        if (freeCredits.length > 0 && allow_free_credit) {
            //start consume free credit
            for (const freeCredit of freeCredits) {
                const consumeAmount = Math.min(freeCredit.balance, needCreditConsumed)
                freeCreditConsumed += consumeAmount
                needCreditConsumed -= consumeAmount

                //update user table
                const userBalanceUpdated = await tx.users.update({
                    where: { username_in_be: userInfo.usernameShorted },
                    data: { current_credit_balance: { decrement: consumeAmount } },
                })
                //update free credit table
                await tx.free_credit_issues.update({
                    where: { id: freeCredit.id },
                    data: { balance: freeCredit.balance - consumeAmount },
                })

                //create statement
                await tx.credit_statements.create({
                    data: {
                        user: userInfo.usernameShorted,
                        type: credit_statement_type.consume,
                        amount: consumeAmount * -1,
                        balance: userBalanceUpdated.current_credit_balance,
                        is_free_credit: true,
                        order_id: order_id,
                        free_credit_issue_id: freeCredit.id,
                    },
                })

                if (needCreditConsumed === 0) {
                    break
                }
                if (needCreditConsumed < 0) {
                    //error and this should not happen
                    throw new BadRequestException("balance calculated error")
                }
            }
        }

        const widgetSubscriptionCredits = await tx.widget_subscription_credit_issues.findMany({
            where: {
                user_id: userInfo.usernameShorted,
                current_balance: { gt: 0 },
                is_issue: true,
                expire_date: { gte: now },
            },
            orderBy: {
                expire_date: "asc",
            },
        })

        if (widgetSubscriptionCredits.length > 0) {
            //start consume subscription credit
            for (const subscriptionCredit of widgetSubscriptionCredits) {
                const consumeAmount = Math.min(subscriptionCredit.current_balance, needCreditConsumed)

                needCreditConsumed -= consumeAmount

                //update user table
                const userBalanceUpdated = await tx.users.update({
                    where: { username_in_be: userInfo.usernameShorted },
                    data: { current_credit_balance: { decrement: consumeAmount } },
                })
                //update subscription credit table
                await tx.widget_subscription_credit_issues.update({
                    where: { id: subscriptionCredit.id },
                    data: { current_balance: subscriptionCredit.current_balance - consumeAmount },
                })

                //create statement
                await tx.credit_statements.create({
                    data: {
                        user: userInfo.usernameShorted,
                        type: credit_statement_type.consume,
                        amount: consumeAmount * -1,
                        balance: userBalanceUpdated.current_credit_balance,
                        is_subscription_credit: true,
                        subscription_credit_issue_id: subscriptionCredit.id,
                        order_id: order_id,
                    },
                })

                if (needCreditConsumed === 0) {
                    break
                }
                if (needCreditConsumed < 0) {
                    //error and this should not happen
                    throw new BadRequestException("balance calculated error")
                }
            }
        }

        //we need consume credit if free credit and subscription credit is not enough
        if (needCreditConsumed > 0) {
            const userBalanceUpdated = await tx.users.update({
                where: { username_in_be: userInfo.usernameShorted },
                data: {
                    current_credit_balance: {
                        decrement: needCreditConsumed,
                    },
                },
            })

            await tx.credit_statements.create({
                data: {
                    user: userInfo.usernameShorted,
                    type: credit_statement_type.consume,
                    amount: needCreditConsumed * -1,
                    balance: userBalanceUpdated.current_credit_balance,
                    order_id: order_id,
                },
            })
        }

        return {
            free_credit_consumed: freeCreditConsumed,
            total_credit_consumed: amount,
        }
    }

    async updateWidgetSubscriptions(
        body: UpdateWidgetSubscriptionsDto,
        developerInfo: UserJwtExtractDto,
    ): Promise<{ success: boolean }> {
        const { user_id, subscription_detail, subscription_credits } = body
        const user = await this.prisma.users.findUnique({
            where: { username_in_be: user_id },
        })
        if (!user) {
            throw new BadRequestException("User not found")
        }

        let type = "create"
        let subscriptionId = uuidv4() as string

        const isExists = await this.prisma.widget_subscriptions.findFirst({
            where: {
                user_id: user_id,
                widget_tag: developerInfo.developer_info.tag,
            },
        })

        if (isExists) {
            type = "update"
            subscriptionId = isExists.subscription_id
        }

        await this.prisma.$transaction(async (tx) => {
            if (type === "update") {
                await tx.widget_subscriptions.update({
                    where: { id: isExists.id },
                    data: {
                        product_name: subscription_detail.product_name,

                        period_start: subscription_detail.period_start,
                        period_end: subscription_detail.period_end,
                        cancel_at_period_end: subscription_detail.cancel_at_period_end,
                        subscription_metadata: subscription_detail.subscription_metadata,
                    },
                })
            } else {
                const createdSubscription = await tx.widget_subscriptions.create({
                    data: {
                        product_name: subscription_detail.product_name,
                        user_id: user_id,
                        widget_tag: developerInfo.developer_info.tag,
                        subscription_id: subscriptionId,

                        period_start: subscription_detail.period_start,
                        period_end: subscription_detail.period_end,
                        cancel_at_period_end: subscription_detail.cancel_at_period_end,
                        subscription_metadata: subscription_detail.subscription_metadata,
                    },
                })
                subscriptionId = createdSubscription.subscription_id
            }
            if (subscription_credits.length > 0) {
                const createData = subscription_credits.map((subscription_credit) => {
                    if (subscription_credit.issue_date > subscription_credit.expire_date) {
                        throw new BadRequestException("Issue date cannot be greater than expire date")
                    }
                    return {
                        user_id: user_id,
                        is_issue: false,
                        widget_tag: developerInfo.developer_info.tag,
                        subscription_id: subscriptionId,
                        issue_credits: subscription_credit.amount,
                        current_balance: subscription_credit.amount,
                        issue_date: subscription_credit.issue_date,
                        expire_date: subscription_credit.expire_date,
                    }
                })
                await tx.widget_subscription_credit_issues.createMany({
                    data: createData,
                })
            }
        })

        // Issue credits immediately for this subscription (if issue_date <= now)
        await this.issueWidgetSubscriptionCredit(subscriptionId)

        return { success: true }
    }

    /**
     * Cancel a user's widget subscription
     * - Deletes the subscription record
     * - Removes all unissued credits (is_issue: false)
     * - Leaves issued credits as-is (they'll expire naturally)
     */
    async cancelWidgetSubscription(user_id: string, developerInfo: UserJwtExtractDto): Promise<{ success: boolean }> {
        const widgetTag = developerInfo.developer_info.tag

        const subscription = await this.prisma.widget_subscriptions.findFirst({
            where: {
                user_id: user_id,
                widget_tag: widgetTag,
            },
        })

        if (!subscription) {
            throw new BadRequestException("Subscription not found")
        }

        await this.prisma.$transaction(async (tx) => {
            // Delete all unissued credits for this subscription
            await tx.widget_subscription_credit_issues.deleteMany({
                where: {
                    subscription_id: subscription.subscription_id,
                    is_issue: false,
                },
            })

            // Delete the subscription record
            await tx.widget_subscriptions.delete({
                where: { id: subscription.id },
            })
        })

        this.logger.log(
            `[cancelWidgetSubscription] Cancelled subscription ${subscription.subscription_id} for user ${user_id}`,
        )

        return { success: true }
    }

    /**
     * Expire subscription credits
     * @param subscriptionId - Optional: only expire credits for this subscription
     */
    async expireWidgetSubscriptionCredit(subscriptionId?: string): Promise<void> {
        const now = new Date()
        const where: any = {
            expire_date: { lt: now },
            is_issue: true,
            current_balance: { gt: 0 },
        }
        if (subscriptionId) {
            where.subscription_id = subscriptionId
        }

        const creditsToExpire = await this.prisma.widget_subscription_credit_issues.findMany({ where })

        if (creditsToExpire.length === 0) {
            this.logger.log(`[expireWidgetSubscriptionCredit] No subscription credit to expire`)
            return
        }

        for (const expiredCredit of creditsToExpire) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    await tx.widget_subscription_credit_issues.update({
                        where: { id: expiredCredit.id },
                        data: { current_balance: 0 },
                    })
                    const userBalanceUpdated = await tx.users.update({
                        where: { username_in_be: expiredCredit.user_id },
                        data: { current_credit_balance: { decrement: expiredCredit.current_balance } },
                    })
                    await tx.credit_statements.create({
                        data: {
                            user: expiredCredit.user_id,
                            type: credit_statement_type.expire_subscription_credit,
                            amount: expiredCredit.current_balance * -1,
                            balance: userBalanceUpdated.current_credit_balance,
                            subscription_credit_issue_id: expiredCredit.id,
                            order_id: expiredCredit.subscription_id,
                            is_subscription_credit: true,
                        },
                    })
                })
                this.logger.log(`[expireWidgetSubscriptionCredit] Expired credit ${expiredCredit.id}`)
            } catch (error) {
                this.logger.error(
                    `[expireWidgetSubscriptionCredit] Failed to expire credit ${expiredCredit.id}: ${error.message}`,
                )
            }
        }
    }

    /**
     * Issue subscription credits
     * @param subscriptionId - Optional: only issue credits for this subscription
     */
    async issueWidgetSubscriptionCredit(subscriptionId?: string): Promise<void> {
        const now = new Date()
        const where: any = {
            issue_date: { lte: now },
            current_balance: { gt: 0 },
            is_issue: false,
        }
        if (subscriptionId) {
            where.subscription_id = subscriptionId
        }

        const creditsToIssue = await this.prisma.widget_subscription_credit_issues.findMany({ where })

        if (creditsToIssue.length === 0) {
            this.logger.log(`[issueWidgetSubscriptionCredit] No subscription credit to issue`)
            return
        }

        for (const issueCredit of creditsToIssue) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    const userBalanceUpdated = await tx.users.update({
                        where: { username_in_be: issueCredit.user_id },
                        data: { current_credit_balance: { increment: issueCredit.current_balance } },
                    })
                    await tx.credit_statements.create({
                        data: {
                            user: issueCredit.user_id,
                            type: credit_statement_type.issue_subscription_credit,
                            amount: issueCredit.current_balance,
                            balance: userBalanceUpdated.current_credit_balance,
                            subscription_credit_issue_id: issueCredit.id,
                            is_subscription_credit: true,
                            order_id: issueCredit.subscription_id,
                        },
                    })
                    await tx.widget_subscription_credit_issues.update({
                        where: { id: issueCredit.id },
                        data: { is_issue: true },
                    })
                })
                this.logger.log(`[issueWidgetSubscriptionCredit] Issued credit ${issueCredit.id}`)
            } catch (error) {
                this.logger.error(
                    `[issueWidgetSubscriptionCredit] Failed to issue credit ${issueCredit.id}: ${error.message}`,
                )
            }
        }
    }

    /**
     * Cron job: process all subscription credits (expire first, then issue)
     */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async processWidgetSubscriptionCredits(): Promise<void> {
        if (process.env.TASK_SLOT != "1") {
            return
        }
        this.logger.log(`[processWidgetSubscriptionCredits] Starting...`)

        // Step 1: Expire old credits first
        await this.expireWidgetSubscriptionCredit()

        // Step 2: Issue new credits
        await this.issueWidgetSubscriptionCredit()

        this.logger.log(`[processWidgetSubscriptionCredits] Completed`)
    }

    async refundCredit(amount: number, order_id: string, user: string, tx: Prisma.TransactionClient): Promise<void> {
        //find statement
        const statements = await tx.credit_statements.findMany({
            where: {
                order_id: order_id,
                type: credit_statement_type.consume,
            },
        })

        let needRefundAmount = amount
        let refundedAmount = 0

        //we need refund free credit first
        for (const statement of statements) {
            const _refundAmount = Math.min(statement.amount * -1, needRefundAmount)

            if (statement.is_free_credit) {
                //if free credit is expired, we need not refund this statement
                const freeCredit = await tx.free_credit_issues.findUnique({
                    where: { id: statement.free_credit_issue_id },
                })
                if (freeCredit && freeCredit.expire_date && freeCredit.expire_date < new Date()) {
                    this.logger.warn(`Free credit is expired, we cannot refund this statement: ${statement.id}`)
                    continue
                }
                //update free credit table
                await tx.free_credit_issues.update({
                    where: { id: statement.free_credit_issue_id },
                    data: { balance: { increment: _refundAmount } },
                })
            }

            //refund subscription credit
            if (statement.is_subscription_credit) {
                const subscriptionCredit = await tx.widget_subscription_credit_issues.findUnique({
                    where: { id: statement.subscription_credit_issue_id },
                })
                if (
                    subscriptionCredit &&
                    subscriptionCredit.expire_date &&
                    subscriptionCredit.expire_date < new Date()
                ) {
                    this.logger.warn(`Subscription credit is expired, we cannot refund this statement: ${statement.id}`)
                    continue
                }
                //update subscription credit table
                await tx.widget_subscription_credit_issues.update({
                    where: { id: statement.subscription_credit_issue_id },
                    data: { current_balance: { increment: _refundAmount } },
                })
            }

            needRefundAmount -= _refundAmount
            refundedAmount += _refundAmount

            //update user table
            const userBalanceUpdated = await tx.users.update({
                where: { username_in_be: user },
                data: { current_credit_balance: { increment: _refundAmount } },
            })

            //create statement
            await tx.credit_statements.create({
                data: {
                    user: user,
                    type: credit_statement_type.refund,
                    amount: _refundAmount,
                    balance: userBalanceUpdated.current_credit_balance,
                    order_id: order_id,
                    is_free_credit: statement.is_free_credit,
                    free_credit_issue_id: statement.free_credit_issue_id,
                    is_subscription_credit: statement.is_subscription_credit,
                    subscription_credit_issue_id: statement.subscription_credit_issue_id,
                },
            })

            if (needRefundAmount === 0) {
                break
            }
            if (needRefundAmount < 0) {
                //error and this should not happen
                throw new BadRequestException("balance calculated error")
            }
        }
    }

    async issueFreeCredit(
        body: IssueFreeCreditDto,
        userInfo: UserJwtExtractDto,
        options: { invited_user_id?: string } = {},
    ): Promise<UserCreditBalanceDto> {
        const issuedFreeCredit = await this.prisma.users.findUnique({
            where: {
                email: body.email,
            },
        })
        if (!issuedFreeCredit) {
            throw new BadRequestException("User not found")
        }

        await this.prisma.$transaction(async (tx) => {
            const userBalanceUpdated = await tx.users.update({
                where: { username_in_be: issuedFreeCredit.username_in_be },
                data: {
                    current_credit_balance: { increment: body.amount },
                },
            })

            const issueRecord = await tx.free_credit_issues.create({
                data: {
                    user: issuedFreeCredit.username_in_be,
                    amount: body.amount,
                    description: body?.description,
                    expire_date: new Date(Date.now() + this.freeCreditExpireDays * 24 * 60 * 60 * 1000),
                    widget_tag: userInfo?.developer_info?.tag,
                    app_id: userInfo?.app_id,
                    balance: body.amount,
                    invited_user_id: options.invited_user_id || "",
                    issue_type: body.issue_type || free_credit_issue_type.widget_direct_issue,
                },
            })

            await tx.credit_statements.create({
                data: {
                    user: issuedFreeCredit.username_in_be,
                    amount: body.amount,
                    balance: userBalanceUpdated.current_credit_balance,
                    is_free_credit: true,
                    order_id: uuidv4() as string,
                    type: credit_statement_type.issue_free_credit,
                    free_credit_issue_id: issueRecord.id,
                },
            })
        })

        return await this.getUserCredits(issuedFreeCredit.username_in_be)
    }

    async payTopUpOrder(body: PayTopUpOrderDto, developer: UserJwtExtractDto): Promise<{ success: boolean }> {
        const widgetTag = developer.developer_info.tag
        const widget = await this.prisma.widgets.findUnique({
            where: { tag: widgetTag },
        })
        if (!widget) throw new BadRequestException("Widget not found")
        const permissions: any = widget.request_permissions
        if (!permissions?.can_issue_token) {
            throw new BadRequestException("Widget does not have permission to issue token")
        }

        const userEmail = body.email
        let userProfile: UserJwtExtractDto = await this.userService.getUserInfoByEmail(userEmail)
        //we need create user if user not exists
        if (!userProfile) {
            const userNameShorted = this.userService.generateShortName()
            const username = userEmail.split("@")[0]
            const newUserInfo: CreateUserDto = {
                user_id: userNameShorted,
                username: username,
                password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                email: userEmail,
                usernameShorted: userNameShorted,
                app_id: "",
                from_source_link: "",
                from_device_id: "",
                can_create_ip: false,
                invited_by: "",
            }
            userProfile = await this.userService.createUser(newUserInfo)
        }

        const order = await this.orderService.createOrder(
            {
                order_id: body.order_id,
                amount: body.amount,
                description: `Top up ${body.amount} credits`,
                callback_url: body.callback_url,
                release_rewards_after_paid: false,
                user_jwt: body.user_jwt,
                allowed_payment_methods: [PaymentMethod.CUSTOMIZED],
            },
            developer,
            {
                related_to_reward_pool: false,
                is_credit_top_up: true,
            },
        )

        const paidOrder = await this.prisma.orders.update({
            where: { order_id: order.order_id },
            data: {
                current_status: OrderStatus.COMPLETED,
                paid_method: PaymentMethod.CUSTOMIZED,
                paid_time: new Date(),
            },
        })

        await this.issueCredit(paidOrder)

        return { success: true }
    }

    async getCreditStatictics(widgetTag: string) {
        //daily free issue with type
        const dailyFreeIssue = await this.prisma.free_credit_issues.groupBy({
            by: ["issue_type"],
            where: {
                widget_tag: widgetTag,
                created_at: {
                    gte: new Date(new Date().setDate(new Date().getDate() - 1)),
                    lt: new Date(),
                },
            },
            _sum: {
                amount: true,
            },
        })
        // monthly issue with type
        const monthlyFreeIssue = await this.prisma.free_credit_issues.groupBy({
            by: ["issue_type"],
            where: {
                widget_tag: widgetTag,
                created_at: {
                    gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
                    lt: new Date(),
                },
            },
            _sum: {
                amount: true,
            },
        })
        // total issue with type
        const totalFreeIssue = await this.prisma.free_credit_issues.groupBy({
            by: ["issue_type"],
            where: {
                widget_tag: widgetTag,
            },
            _sum: {
                amount: true,
            },
        })

        //daily top up
        const dailyTopUp = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                type: credit_statement_type.top_up,
                created_at: {
                    gte: new Date(new Date().setDate(new Date().getDate() - 1)),
                    lt: new Date(),
                },
                order: {
                    widget_tag: widgetTag,
                },
            },
        })

        //monthly top up
        const monthlyTopUp = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                type: credit_statement_type.top_up,
                order: {
                    widget_tag: widgetTag,
                },
                created_at: {
                    gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
                    lt: new Date(),
                },
            },
        })

        //total top up
        const totalTopUp = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                type: credit_statement_type.top_up,
                order: {
                    widget_tag: widgetTag,
                },
            },
        })

        //daily free credit consume
        const dailyFreeCreditConsume = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                is_free_credit: true,
                created_at: {
                    gte: new Date(new Date().setDate(new Date().getDate() - 1)),
                    lt: new Date(),
                },
                order: {
                    widget_tag: widgetTag,
                },
                type: { in: [credit_statement_type.consume, credit_statement_type.refund] },
            },
        })

        //monthly free credit consume
        const monthlyFreeCreditConsume = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                is_free_credit: true,
                created_at: {
                    gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
                    lt: new Date(),
                },
                order: {
                    widget_tag: widgetTag,
                },
                type: { in: [credit_statement_type.consume, credit_statement_type.refund] },
            },
        })

        //total free credit consume
        const totalFreeCreditConsume = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                is_free_credit: true,
                type: { in: [credit_statement_type.consume, credit_statement_type.refund] },
                order: {
                    widget_tag: widgetTag,
                },
            },
        })

        //daily no-free credit consume
        const dailyNoFreeCreditConsume = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                is_free_credit: false,
                created_at: {
                    gte: new Date(new Date().setDate(new Date().getDate() - 1)),
                    lt: new Date(),
                },
                type: { in: [credit_statement_type.consume, credit_statement_type.refund] },
                order: {
                    widget_tag: widgetTag,
                },
            },
        })

        //monthly no-free credit consume
        const monthlyNoFreeCreditConsume = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                is_free_credit: false,
                created_at: {
                    gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
                    lt: new Date(),
                },
                type: { in: [credit_statement_type.consume, credit_statement_type.refund] },
                order: {
                    widget_tag: widgetTag,
                },
            },
        })
        //total no-free credit consume
        const totalNoFreeCreditConsume = await this.prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                is_free_credit: false,
                type: { in: [credit_statement_type.consume, credit_statement_type.refund] },
                order: {
                    widget_tag: widgetTag,
                },
            },
        })

        //free credit consume top 10 users
        const freeCreditConsumeTop10Users: any = await this.prisma.credit_statements.groupBy({
            by: ["user"],
            _sum: {
                amount: true,
            },
            where: {
                is_free_credit: true,
                type: { in: [credit_statement_type.consume, credit_statement_type.refund] },
                order: {
                    widget_tag: widgetTag,
                },
            },
            orderBy: {
                _sum: {
                    amount: "asc",
                },
            },
            take: 10,
        })
        //append user email info
        const freeCreditConsumeTop10UsersEmails = await this.prisma.users.findMany({
            where: {
                username_in_be: { in: freeCreditConsumeTop10Users.map((user) => user.user) },
            },
            select: {
                username_in_be: true,
                email: true,
            },
        })

        for (let i = 0; i < freeCreditConsumeTop10Users.length; i++) {
            const user = freeCreditConsumeTop10Users[i]
            const userEmail = freeCreditConsumeTop10UsersEmails.find((email) => email.username_in_be === user.user)
            freeCreditConsumeTop10Users[i].user_email = userEmail.email || "unknown"
        }

        //no-free credit consume top 10 users
        const noFreeCreditConsumeTop10Users: any = await this.prisma.credit_statements.groupBy({
            by: ["user"],
            _sum: {
                amount: true,
            },
            where: {
                is_free_credit: false,
                type: { in: [credit_statement_type.consume, credit_statement_type.refund] },
                order: {
                    widget_tag: widgetTag,
                },
            },
            orderBy: {
                _sum: {
                    amount: "asc",
                },
            },
            take: 10,
        })

        //append user email info
        const noFreeCreditConsumeTop10UsersEmails = await this.prisma.users.findMany({
            where: {
                username_in_be: { in: noFreeCreditConsumeTop10Users.map((user) => user.user) },
            },
            select: {
                username_in_be: true,
                email: true,
            },
        })
        for (let i = 0; i < noFreeCreditConsumeTop10Users.length; i++) {
            const user = noFreeCreditConsumeTop10Users[i]
            const userEmail = noFreeCreditConsumeTop10UsersEmails.find((email) => email.username_in_be === user.user)
            noFreeCreditConsumeTop10Users[i].user_email = userEmail.email || "unknown"
        }

        return {
            dailyFreeIssue,
            monthlyFreeIssue,
            totalFreeIssue,
            dailyTopUp,
            monthlyTopUp,
            totalTopUp,
            dailyFreeCreditConsume,
            monthlyFreeCreditConsume,
            totalFreeCreditConsume,
            dailyNoFreeCreditConsume,
            monthlyNoFreeCreditConsume,
            totalNoFreeCreditConsume,
            freeCreditConsumeTop10Users,
            noFreeCreditConsumeTop10Users,
        }
    }

    //@Cron(CronExpression.EVERY_DAY_AT_5PM)
    @Cron(CronExpression.EVERY_DAY_AT_1AM)
    async generateCreditStatictics() {
        this.logger.log("start generateCreditStatictics")
        if (process.env.TASK_SLOT != "1") return
        if (process.env.ENV !== "product") {
            this.logger.log("Skipping credit statistics email generation in non-production environment")
            return
        }

        const widgetTagsEnv = process.env.CREDIT_REPORT_WIDGETS
        const sendEmailListEnv = process.env.CREDIT_REPORT_SENDTO

        if (!widgetTagsEnv || widgetTagsEnv.trim() === "") {
            this.logger.log("No widget tags to generate credit statistics")
            return
        }

        if (!sendEmailListEnv || sendEmailListEnv.trim() === "") {
            this.logger.log("No email list to send credit statistics")
            return
        }

        const widgetTags = widgetTagsEnv
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0)
        const sendEmailList = sendEmailListEnv
            .split(",")
            .map((email) => email.trim())
            .filter((email) => email.length > 0)

        if (widgetTags.length === 0) {
            this.logger.log("No widget tags to generate credit statistics")
            return
        }

        if (sendEmailList.length === 0) {
            this.logger.log("No email list to send credit statistics")
            return
        }

        for (const widgetTag of widgetTags) {
            try {
                const result = await this.getCreditStatictics(widgetTag)
                const templateContext = this.formatCreditStatsForTemplate(widgetTag, result)

                // Send emails to all recipients
                const emailPromises = sendEmailList.map(async (email) => {
                    try {
                        await this.notificationService.sendNotification(
                            `💳 Daily Credit Statistics Report - ${widgetTag} - ${templateContext.reportDate}`,
                            email,
                            "credit_report",
                            templateContext,
                            "mail.giggle.pro",
                            "Giggle.Pro <app-noreply@giggle.pro>",
                        )
                        this.logger.log(`Credit report for ${widgetTag} sent successfully to ${email}`)
                    } catch (error) {
                        this.logger.error(`Failed to send credit report for ${widgetTag} to ${email}:`, error)
                    }
                })

                await Promise.allSettled(emailPromises)
                this.logger.log(
                    `Credit statistics email for ${widgetTag} process completed. Sent to ${sendEmailList.length} recipients.`,
                )
            } catch (error) {
                this.logger.error(`Failed to generate/send credit statistics for ${widgetTag}:`, error)
            }
        }
    }

    /**
     * Formats credit statistics data for email template
     */
    private formatCreditStatsForTemplate(widgetTag: string, data: any) {
        const currentDate = new Date()

        // Consolidate issue types into 3 categories: Direct Issue, Invite Rewards, Others
        const consolidatedIssues = {
            direct_issue: { daily: 0, monthly: 0, total: 0 },
            invite_rewards: { daily: 0, monthly: 0, total: 0 },
            others: { daily: 0, monthly: 0, total: 0 },
        }

        // Helper function to categorize issue type
        const categorizeIssueType = (type: string): "direct_issue" | "invite_rewards" | "others" => {
            if (type === "widget_direct_issue") return "direct_issue"
            if (type === "invite_rewards") return "invite_rewards"
            return "others"
        }

        // Process daily free issues
        for (const item of data.dailyFreeIssue || []) {
            const category = categorizeIssueType(item.issue_type || "unknown")
            consolidatedIssues[category].daily += Number(item._sum?.amount || 0)
        }

        // Process monthly free issues
        for (const item of data.monthlyFreeIssue || []) {
            const category = categorizeIssueType(item.issue_type || "unknown")
            consolidatedIssues[category].monthly += Number(item._sum?.amount || 0)
        }

        // Process total free issues
        for (const item of data.totalFreeIssue || []) {
            const category = categorizeIssueType(item.issue_type || "unknown")
            consolidatedIssues[category].total += Number(item._sum?.amount || 0)
        }

        // Convert to array for template (only include categories with data)
        const freeIssueData = [
            {
                issue_type: "直接发放",
                daily_amount: consolidatedIssues.direct_issue.daily,
                monthly_amount: consolidatedIssues.direct_issue.monthly,
                total_amount: consolidatedIssues.direct_issue.total,
            },
            {
                issue_type: "邀请奖励",
                daily_amount: consolidatedIssues.invite_rewards.daily,
                monthly_amount: consolidatedIssues.invite_rewards.monthly,
                total_amount: consolidatedIssues.invite_rewards.total,
            },
            {
                issue_type: "其他",
                daily_amount: consolidatedIssues.others.daily,
                monthly_amount: consolidatedIssues.others.monthly,
                total_amount: consolidatedIssues.others.total,
            },
        ].filter((item) => item.daily_amount > 0 || item.monthly_amount > 0 || item.total_amount > 0)

        // Format top 10 users data
        const freeCreditTop10Users = (data.freeCreditConsumeTop10Users || []).map((user: any, index: number) => ({
            rank: index + 1,
            user_email: user.user_email || "unknown",
            amount: Number(user._sum?.amount || 0),
        }))

        const noFreeCreditTop10Users = (data.noFreeCreditConsumeTop10Users || []).map((user: any, index: number) => ({
            rank: index + 1,
            user_email: user.user_email || "unknown",
            amount: Number(user._sum?.amount || 0),
        }))

        return {
            widgetTag,
            reportDate: currentDate.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
            }),
            period: `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`,

            // Top-up data
            dailyTopUp: Number(data.dailyTopUp?._sum?.amount || 0),
            monthlyTopUp: Number(data.monthlyTopUp?._sum?.amount || 0),
            totalTopUp: Number(data.totalTopUp?._sum?.amount || 0),

            // Free credit consumption (negative = consumed, positive = refunded more than consumed)
            dailyFreeCreditConsume: Number(data.dailyFreeCreditConsume?._sum?.amount || 0),
            monthlyFreeCreditConsume: Number(data.monthlyFreeCreditConsume?._sum?.amount || 0),
            totalFreeCreditConsume: Number(data.totalFreeCreditConsume?._sum?.amount || 0),

            // Paid credit consumption (negative = consumed, positive = refunded more than consumed)
            dailyNoFreeCreditConsume: Number(data.dailyNoFreeCreditConsume?._sum?.amount || 0),
            monthlyNoFreeCreditConsume: Number(data.monthlyNoFreeCreditConsume?._sum?.amount || 0),
            totalNoFreeCreditConsume: Number(data.totalNoFreeCreditConsume?._sum?.amount || 0),

            // Free issue data by type
            freeIssueData,

            // Top 10 users
            freeCreditTop10Users: freeCreditTop10Users.length > 0 ? freeCreditTop10Users : null,
            noFreeCreditTop10Users: noFreeCreditTop10Users.length > 0 ? noFreeCreditTop10Users : null,
        }
    }

    //expire free credit everyday
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    //@Cron(CronExpression.EVERY_MINUTE) //test
    async expireFreeCredit() {
        if (process.env.TASK_SLOT != "1") {
            return
        }
        this.logger.log("start expireFreeCredit")
        const freeCredits = await this.prisma.free_credit_issues.findMany({
            where: {
                expire_date: { lt: new Date() },
                balance: { gt: 0 },
            },
        })
        if (freeCredits.length === 0) {
            this.logger.log("No free credits to expire")
            return
        }
        this.logger.log(`Found ${freeCredits.length} free credits to expire`)
        for (const freeCredit of freeCredits) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    const creditbalance = freeCredit.balance
                    //update user table
                    const userBalanceUpdated = await tx.users.update({
                        where: { username_in_be: freeCredit.user },
                        data: {
                            current_credit_balance: { decrement: creditbalance },
                        },
                    })

                    //create statement
                    await tx.credit_statements.create({
                        data: {
                            user: freeCredit.user,
                            amount: creditbalance * -1,
                            balance: userBalanceUpdated.current_credit_balance,
                            is_free_credit: true,
                            type: credit_statement_type.expire_free_credit,
                            free_credit_issue_id: freeCredit.id,
                        },
                    })

                    //update free credit table
                    await tx.free_credit_issues.update({
                        where: { id: freeCredit.id },
                        data: { balance: 0 },
                    })
                })
            } catch (error) {
                this.logger.error(`Error expire free credit: ${error}`)
                continue
            }
        }
        this.logger.log(`Expired ${freeCredits.length} free credits`)
    }
}
