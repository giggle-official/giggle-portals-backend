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
import { SettleService } from "src/payment/settle/settle.service"
import { PROJECTED, adjustProjected, projectedValues } from "src/payment/credit/credit-precision"

/**
 * Raw-query row shapes for the consolidated credit statistics report.
 * MariaDB hands SUM()/COUNT() back as string, number or bigint depending on the
 * column type, so every numeric field is normalised through `toNumber`.
 */
type SqlNumeric = string | number | bigint | null

const toNumber = (value: SqlNumeric | undefined): number => {
    if (value === null || value === undefined) return 0
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

interface FreeIssueStatRow {
    issue_type: free_credit_issue_type | null
    daily_amount: SqlNumeric
    monthly_amount: SqlNumeric
    total_amount: SqlNumeric
}

interface CreditAmountStatRow {
    daily_top_up: SqlNumeric
    monthly_top_up: SqlNumeric
    total_top_up: SqlNumeric
    daily_free_consume: SqlNumeric
    monthly_free_consume: SqlNumeric
    total_free_consume: SqlNumeric
    daily_paid_consume: SqlNumeric
    monthly_paid_consume: SqlNumeric
    total_paid_consume: SqlNumeric
}

interface CreditLineStatRow {
    daily_repay: SqlNumeric
    monthly_repay: SqlNumeric
    total_repay: SqlNumeric
    daily_consume: SqlNumeric
    monthly_consume: SqlNumeric
    total_consume: SqlNumeric
}

interface CreditLineOutstandingRow {
    outstanding: SqlNumeric
}

interface ConsumeUserCountRow {
    daily_free_users: SqlNumeric
    monthly_free_users: SqlNumeric
    total_free_users: SqlNumeric
    daily_paid_users: SqlNumeric
    monthly_paid_users: SqlNumeric
    total_paid_users: SqlNumeric
}

interface FirstTimeConsumeRow {
    daily_first_time: SqlNumeric
    monthly_first_time: SqlNumeric
    total_first_time: SqlNumeric
}

interface PerUserConsumeRow {
    user: string | null
    total_free_amount: SqlNumeric
    total_paid_amount: SqlNumeric
    daily_free_amount: SqlNumeric
    daily_paid_amount: SqlNumeric
    total_free_rows: SqlNumeric
    total_paid_rows: SqlNumeric
    daily_free_rows: SqlNumeric
    daily_paid_rows: SqlNumeric
}

interface WidgetAssetStatRow {
    daily_video_seconds: SqlNumeric
    monthly_video_seconds: SqlNumeric
    total_video_seconds: SqlNumeric
    daily_image_count: SqlNumeric
    monthly_image_count: SqlNumeric
    total_image_count: SqlNumeric
}

interface PerUserAssetStatRow {
    user: string | null
    total_video_seconds: SqlNumeric
    total_image_count: SqlNumeric
    daily_video_seconds: SqlNumeric
    daily_image_count: SqlNumeric
}

export interface CreditTop10User {
    user: string
    user_email: string
    _sum: { amount: number }
    free_amount: number
    paid_amount: number
    total_amount: number
    video_duration: number
    image_count: number
}

@Injectable()
export class CreditService {
    private readonly logger = new Logger(CreditService.name)
    private readonly freeCreditExpireDays = 730 //2 years

    constructor(
        private prisma: PrismaService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => OrderService))
        private readonly orderService: OrderService,

        private readonly notificationService: NotificationService,

        @Inject(forwardRef(() => SettleService))
        private readonly settleService: SettleService,
    ) {}

    async getUserCredits(userId: string, tx?: Prisma.TransactionClient): Promise<UserCreditBalanceDto> {
        const prisma = tx || this.prisma

        const user = await prisma.users.findFirst({
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
        const freeCredit = await prisma.free_credit_issues.findMany({
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

    /**
     * How much of `current_credit_balance` can actually be spent right now.
     *
     * The two differ because free credit expires: between the moment an issue row
     * expires and the moment `expireFreeCredit` sweeps it, its balance is still
     * inside `current_credit_balance` while no bucket will spend it. Spending
     * against the raw total therefore takes the same credit twice — once from the
     * balance, and again when the sweep deducts the untouched issue row — and
     * leaves the balance negative.
     *
     * Subscription credit does not expire, so it never contributes a gap.
     */
    async getSpendableBalance(
        userId: string,
        tx?: Prisma.TransactionClient,
    ): Promise<{ total: number; free: number; spendable: number; freeSpendable: number }> {
        const prisma = tx || this.prisma
        const { total_credit_balance, free_credit_balance } = await this.getUserCredits(userId, tx)

        const freeSpendable =
            (
                await prisma.free_credit_issues.aggregate({
                    _sum: { balance: true },
                    where: { user: userId, balance: { gt: 0 }, expire_date: { gte: new Date() } },
                })
            )._sum.balance || 0

        return {
            total: total_credit_balance,
            free: free_credit_balance,
            freeSpendable,
            spendable: total_credit_balance - (free_credit_balance - freeSpendable),
        }
    }

    /**
     * The part of the balance that may be used to repay a credit line: everything
     * except free credit, i.e. subscription + paid.
     *
     * Free credit is a gift and must not be spent servicing a debt. Subscription
     * credit may, because it is paid credit in our terms — the settlement report
     * already counts subscription consumption in the paid bucket.
     *
     * The free subtrahend is the on-the-books sum with no expiry filter, matching
     * `getUserCredits`: credit that has expired but has not been swept yet is
     * still inside `current_credit_balance`, so filtering it out here would
     * overstate what the user can actually repay with.
     */
    async getRepayableBalance(userId: string, tx?: Prisma.TransactionClient): Promise<number> {
        const { total_credit_balance, free_credit_balance } = await this.getUserCredits(userId, tx)
        return Math.max(0, total_credit_balance - free_credit_balance)
    }

    async getUserRechargedCredits(userId: string, tx?: Prisma.TransactionClient): Promise<number> {
        const prisma = tx || this.prisma

        const user = await prisma.credit_statements.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                user: userId,
                type: {
                    in: [credit_statement_type.top_up, credit_statement_type.issue_subscription_credit],
                },
            },
        })

        return user._sum?.amount || 0
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
            const balanceAfter = await adjustProjected(tx, PROJECTED.userBalance, order.owner, order.amount ?? 0)
            await tx.credit_statements.create({
                data: {
                    order_id: order.order_id,
                    ...projectedValues("amount", order.amount ?? 0),
                    balance: balanceAfter.whole,
                    balance_precise: balanceAfter.precise,
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
            // `query.type` accepts a single enum value or a comma-separated
            // list (e.g. "top_up,consume"). Parse, drop unknown tokens, and
            // map to a single equality or an `in` filter as appropriate.
            const validTypes = Object.values(credit_statement_type) as string[]
            const tokens = query.type
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t.length > 0 && validTypes.includes(t))
            const uniqueTypes = Array.from(new Set(tokens)) as credit_statement_type[]
            if (uniqueTypes.length === 1) {
                where.type = uniqueTypes[0]
            } else if (uniqueTypes.length > 1) {
                where.type = { in: uniqueTypes }
            }
        }

        if (query.widget_tag) {
            where.OR = [
                { order: { widget_tag: query.widget_tag } },
                { subscription_credit_issue: { widget_tag: query.widget_tag } },
            ]
        }

        if (query.start_time || query.end_time) {
            where.created_at = {
                ...(query.start_time && { gte: new Date(`${query.start_time}T00:00:00.000Z`) }),
                ...(query.end_time && { lte: new Date(`${query.end_time}T23:59:59.999Z`) }),
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
                order_item: statement.order?.item ?? null,
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
                // Expose the free-credit issuer's note so refund / bonus
                // statements can carry a human-readable reason to the user.
                description: statement.free_credit_issue?.description ?? null,
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
        // Lock user row to prevent concurrent credit consumption race condition
        await tx.$queryRaw`SELECT id FROM users WHERE username_in_be = ${userInfo.usernameShorted} FOR UPDATE`

        // Sized against what the buckets will actually spend, not against the raw
        // balance: expired-but-unswept free credit still sits in
        // current_credit_balance and no bucket will touch it.
        const { total, free, spendable } = await this.getSpendableBalance(userInfo.usernameShorted, tx)

        if (!allow_free_credit && total - free < amount) {
            throw new BadRequestException(
                "This consumption is not allowed to use free credit and the total credit balance is not enough",
            )
        }

        if (allow_free_credit && spendable < amount) {
            throw new BadRequestException("Insufficient credit balance")
        }

        const { free_credit_consumed } = await this.spendBalanceBuckets(tx, userInfo.usernameShorted, amount, {
            allowFreeCredit: allow_free_credit,
            statementType: credit_statement_type.consume,
            orderId: order_id,
        })

        return {
            free_credit_consumed,
            total_credit_consumed: amount,
        }
    }

    /**
     * Spends `amount` of real credit to pay off a credit line, the credit-account
     * leg of a repayment.
     *
     * Free credit is skipped: a gift must not be spent servicing a debt.
     * Subscription credit is not, because it is paid credit in our terms.
     *
     * It walks the same buckets as consumption rather than just decrementing the
     * total, because subscription credit is held per issue row — decrementing only
     * `current_credit_balance` would leave the two out of step and progressively
     * distort the derived paid balance.
     *
     * The caller owns the transaction, holds the user row lock, and has already
     * clamped `amount` to what is both owed and affordable.
     */
    async spendForCreditLineRepayment(tx: Prisma.TransactionClient, user: string, amount: number): Promise<void> {
        await this.spendBalanceBuckets(tx, user, amount, {
            allowFreeCredit: false,
            statementType: credit_statement_type.repay_credit_line,
            orderId: null,
        })
    }

    /**
     * Spends `amount` out of the user's real balance, walking the buckets in the
     * order subscription -> paid -> free.
     *
     * The supplier settlement report splits consumption into free
     * (is_free_credit = 1) and paid (is_free_credit = 0); free credit is the only
     * bucket that shrinks the paid figure, so it burns last. Subscription and paid
     * land in the same bucket, so their relative order does not move the settlement
     * number, and subscription goes first because it is the one that may expire.
     *
     * Callers are responsible for locking the user row and for checking that the
     * balance covers `amount` before calling.
     */
    private async spendBalanceBuckets(
        tx: Prisma.TransactionClient,
        user: string,
        amount: number,
        options: {
            allowFreeCredit: boolean
            statementType: credit_statement_type
            orderId: string | null
        },
    ): Promise<{ free_credit_consumed: number }> {
        const { allowFreeCredit, statementType, orderId } = options

        let needCreditConsumed = amount
        let freeCreditConsumed = 0

        const now = new Date()

        const { total_credit_balance, free_credit_balance } = await this.getUserCredits(user, tx)

        // The paid balance is not stored anywhere; it is whatever is left of
        // current_credit_balance once the free and subscription buckets are taken out.
        // The free subtrahend deliberately ignores expire_date: free credit that has
        // expired but has not been swept yet is still counted in
        // current_credit_balance, so filtering it here would overstate the paid
        // balance and let the paid bucket consume more than the user actually paid
        // for. Subscription credit does not expire, so the question does not arise
        // for it.
        const subscriptionOnBooks =
            (
                await tx.widget_subscription_credit_issues.aggregate({
                    _sum: { current_balance: true },
                    where: {
                        user_id: user,
                        current_balance: { gt: 0 },
                        is_issue: true,
                    },
                })
            )._sum.current_balance || 0

        const paidCreditBalance = Math.max(0, total_credit_balance - free_credit_balance - subscriptionOnBooks)

        // No expire_date filter: subscription credit does not expire. `expire_date`
        // is still recorded, and still orders the walk oldest-first, but it no
        // longer decides what may be spent.
        const widgetSubscriptionCredits = await tx.widget_subscription_credit_issues.findMany({
            where: {
                user_id: user,
                current_balance: { gt: 0 },
                is_issue: true,
            },
            orderBy: {
                expire_date: "asc",
            },
        })

        for (const subscriptionCredit of widgetSubscriptionCredits) {
            if (needCreditConsumed <= 0) {
                break
            }
            const consumeAmount = Math.min(subscriptionCredit.current_balance, needCreditConsumed)
            needCreditConsumed -= consumeAmount

            //update user table
            const balanceAfter = await adjustProjected(tx, PROJECTED.userBalance, user, -consumeAmount)
            //update subscription credit table
            await adjustProjected(tx, PROJECTED.subscriptionBalance, subscriptionCredit.id, -consumeAmount)

            //create statement
            await tx.credit_statements.create({
                data: {
                    user: user,
                    type: statementType,
                    ...projectedValues("amount", -consumeAmount),
                    balance: balanceAfter.whole,
                    balance_precise: balanceAfter.precise,
                    is_subscription_credit: true,
                    subscription_credit_issue_id: subscriptionCredit.id,
                    order_id: orderId,
                },
            })
        }

        //consume paid credit before free credit
        if (needCreditConsumed > 0 && paidCreditBalance > 0) {
            const consumeAmount = Math.min(paidCreditBalance, needCreditConsumed)
            needCreditConsumed -= consumeAmount

            const balanceAfter = await adjustProjected(tx, PROJECTED.userBalance, user, -consumeAmount)

            await tx.credit_statements.create({
                data: {
                    user: user,
                    type: statementType,
                    ...projectedValues("amount", -consumeAmount),
                    balance: balanceAfter.whole,
                    balance_precise: balanceAfter.precise,
                    order_id: orderId,
                },
            })
        }

        if (needCreditConsumed > 0 && allowFreeCredit) {
            const freeCredits = await tx.free_credit_issues.findMany({
                where: {
                    user: user,
                    balance: { gt: 0 },
                    expire_date: { gte: now },
                },
                orderBy: {
                    expire_date: "asc",
                },
            })

            //start consume free credit
            for (const freeCredit of freeCredits) {
                if (needCreditConsumed <= 0) {
                    break
                }
                const consumeAmount = Math.min(freeCredit.balance, needCreditConsumed)
                freeCreditConsumed += consumeAmount
                needCreditConsumed -= consumeAmount

                //update user table
                const balanceAfter = await adjustProjected(tx, PROJECTED.userBalance, user, -consumeAmount)
                // Update the free credit row by delta rather than by assigning
                // `freeCredit.balance - consumeAmount`. The absolute form reads the
                // integer column as its base, which silently drops any fraction the
                // row is carrying.
                await adjustProjected(tx, PROJECTED.freeCreditBalance, freeCredit.id, -consumeAmount)

                //create statement
                await tx.credit_statements.create({
                    data: {
                        user: user,
                        type: statementType,
                        ...projectedValues("amount", -consumeAmount),
                        balance: balanceAfter.whole,
                        balance_precise: balanceAfter.precise,
                        is_free_credit: true,
                        order_id: orderId,
                        free_credit_issue_id: freeCredit.id,
                    },
                })
            }
        }

        // Getting here means the buckets did not cover the amount even though the
        // caller checked the balance first, so the balance contains credit that no
        // bucket owns. Until now this branch took the shortfall off
        // current_credit_balance untagged, which is how expired-but-unswept credit
        // got spent twice: once here against the raw balance, and again when the
        // sweep deducted the full issue row it had left untouched, leaving the user
        // with a negative balance.
        //
        // Refusing is the safe answer. Callers must size the spend with
        // `getSpendableBalance`, which excludes exactly the credit the buckets will
        // not spend, so reaching this is a bug rather than an expected state.
        if (needCreditConsumed > 0) {
            this.logger.error(
                `Credit buckets came up ${needCreditConsumed} short for ${user}; ` +
                    `current_credit_balance disagrees with the issue rows behind it`,
            )
            throw new BadRequestException("Insufficient credit balance")
        }

        return { free_credit_consumed: freeCreditConsumed }
    }

    async updateWidgetSubscriptions(
        body: UpdateWidgetSubscriptionsDto,
        developerInfo: UserJwtExtractDto,
    ): Promise<{ success: boolean }> {
        const { user_id, subscription_detail, subscription_credits, paid_amount } = body
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
                        ...projectedValues("issue_credits", subscription_credit.amount),
                        ...projectedValues("current_balance", subscription_credit.amount),
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

        // If paid_amount is provided, create an order and settle it
        if (paid_amount && paid_amount > 0) {
            await this.createSubscriptionOrderAndSettle(user, paid_amount, subscriptionId, developerInfo)
        }

        return { success: true }
    }

    /**
     * Create a subscription order and settle it
     */
    private async createSubscriptionOrderAndSettle(
        user: { username_in_be: string; email: string },
        paidAmount: number,
        subscriptionId: string,
        developerInfo: UserJwtExtractDto,
    ): Promise<void> {
        const orderId = uuidv4()
        const widgetTag = developerInfo.developer_info.tag

        // Get app info for the widget through app_bind_widgets
        const appBindWidget = await this.prisma.app_bind_widgets.findFirst({
            where: {
                widget_tag: widgetTag,
                enabled: true,
            },
        })
        if (!appBindWidget) {
            this.logger.error(`[createSubscriptionOrderAndSettle] App bind widget not found for widget: ${widgetTag}`)
            return
        }

        const appBindIp = await this.prisma.app_bind_ips.findFirst({
            where: { app_id: appBindWidget.app_id },
        })
        if (!appBindIp) {
            this.logger.error(
                `[createSubscriptionOrderAndSettle] App bind ip not found for app: ${appBindWidget.app_id}`,
            )
            return
        }

        // Create the order directly in the database
        const order = await this.prisma.orders.create({
            data: {
                order_id: orderId,
                owner: user.username_in_be,
                ip_id: appBindIp.ip_id,
                widget_tag: widgetTag,
                app_id: appBindWidget.app_id,
                amount: paidAmount,
                item: `Subscription: ${subscriptionId}`,
                description: `Subscription payment for ${subscriptionId}`,
                current_status: OrderStatus.REWARDS_RELEASED,
                paid_method: PaymentMethod.STRIPE, //only stripe payment is supported for subscription order
                paid_time: new Date(),
                supported_payment_method: [PaymentMethod.STRIPE], //only stripe payment is supported for subscription order
                release_rewards_after_paid: false,
                is_credit_top_up: true,
                sales_agent: await this.orderService.getSalesAgent(user.username_in_be),
            },
        })

        this.logger.log(
            `[createSubscriptionOrderAndSettle] Created subscription order ${orderId} for user ${user.username_in_be}, amount: ${paidAmount}`,
        )

        // Post order to settle system
        try {
            await this.settleService.postSubscriptionOrderToSettle(order.order_id)
        } catch (error) {
            this.logger.error(`[createSubscriptionOrderAndSettle] Failed to settle order ${orderId}: ${error.message}`)
        }

        //process rewards
        this.processRewards(order)
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
                    const balanceAfter = await adjustProjected(
                        tx,
                        PROJECTED.userBalance,
                        issueCredit.user_id,
                        issueCredit.current_balance ?? 0,
                    )
                    await tx.credit_statements.create({
                        data: {
                            user: issueCredit.user_id,
                            type: credit_statement_type.issue_subscription_credit,
                            ...projectedValues("amount", issueCredit.current_balance ?? 0),
                            balance: balanceAfter.whole,
                            balance_precise: balanceAfter.precise,
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
     * Cron job: issue subscription credits that have come due.
     *
     * There is no expiry step: subscription credit does not expire.
     */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async processWidgetSubscriptionCredits(): Promise<void> {
        if (process.env.TASK_SLOT != "1") {
            return
        }
        this.logger.log(`[processWidgetSubscriptionCredits] Starting...`)

        await this.issueWidgetSubscriptionCredit()

        this.logger.log(`[processWidgetSubscriptionCredits] Completed`)
    }

    async refundCredit(amount: number, order_id: string, user: string, tx: Prisma.TransactionClient): Promise<void> {
        //find statement, newest first so the refund unwinds consumption in reverse order
        const statements = await tx.credit_statements.findMany({
            where: {
                order_id: order_id,
                type: credit_statement_type.consume,
            },
            orderBy: {
                id: "desc",
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
                await adjustProjected(tx, PROJECTED.freeCreditBalance, statement.free_credit_issue_id, _refundAmount)
            }

            //refund subscription credit
            if (statement.is_subscription_credit) {
                // No expiry check, unlike free credit above: subscription credit does
                // not expire, so there is no state in which it cannot be refunded.
                await adjustProjected(
                    tx,
                    PROJECTED.subscriptionBalance,
                    statement.subscription_credit_issue_id,
                    _refundAmount,
                )
            }

            needRefundAmount -= _refundAmount
            refundedAmount += _refundAmount

            //update user table
            const balanceAfter = await adjustProjected(tx, PROJECTED.userBalance, user, _refundAmount)

            //create statement
            await tx.credit_statements.create({
                data: {
                    user: user,
                    type: credit_statement_type.refund,
                    ...projectedValues("amount", _refundAmount),
                    balance: balanceAfter.whole,
                    balance_precise: balanceAfter.precise,
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
            const balanceAfter = await adjustProjected(
                tx,
                PROJECTED.userBalance,
                issuedFreeCredit.username_in_be,
                body.amount,
            )

            const issueRecord = await tx.free_credit_issues.create({
                data: {
                    user: issuedFreeCredit.username_in_be,
                    ...projectedValues("amount", body.amount),
                    description: body?.description,
                    expire_date: new Date(Date.now() + this.freeCreditExpireDays * 24 * 60 * 60 * 1000),
                    widget_tag: userInfo?.developer_info?.tag,
                    app_id: userInfo?.app_id,
                    ...projectedValues("balance", body.amount),
                    invited_user_id: options.invited_user_id || "",
                    issue_type: body.issue_type || free_credit_issue_type.widget_direct_issue,
                },
            })

            await tx.credit_statements.create({
                data: {
                    user: issuedFreeCredit.username_in_be,
                    ...projectedValues("amount", body.amount),
                    balance: balanceAfter.whole,
                    balance_precise: balanceAfter.precise,
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

        // This is the one place a caller gets to choose what `paid_method` an order
        // is stamped with, so it is also the one door through which "credit-line"
        // could be applied to an order that never went through the credit line.
        // Such an order would silently drop out of IP income and buyback, and a
        // credit line top-up is meaningless anyway: it would turn debt straight
        // into spendable balance.
        if (body.payment_method === PaymentMethod.CREDIT_LINE) {
            throw new BadRequestException("Top up orders cannot be paid with a credit line")
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
                metadata: body.metadata || {},
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
                paid_method: body.payment_method || PaymentMethod.CUSTOMIZED,
                paid_time: new Date(),
            },
        })

        await this.issueCredit(paidOrder)

        //settle order
        await this.settleService.postSubscriptionOrderToSettle(order.order_id)

        return { success: true }
    }

    async getCreditStatictics(widgetTag: string) {
        const now = new Date()
        const dailyStart = new Date(now)
        dailyStart.setDate(dailyStart.getDate() - 1)
        const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1)

        // Each block below folds the daily / monthly / total variants of one metric into a
        // single pass. `credit_statements` and `assets` are large enough that re-scanning
        // them once per period was what made this report slow.
        const [
            freeIssueRows,
            amountRows,
            consumeUserRows,
            firstTimeRows,
            perUserConsumeRows,
            widgetAssetRows,
            creditLineRows,
            creditLineOutstandingRows,
        ] = await Promise.all([
            this.prisma.$queryRaw<FreeIssueStatRow[]>`
                    SELECT issue_type,
                        COALESCE(SUM(CASE WHEN created_at >= ${dailyStart} AND created_at < ${now} THEN amount END), 0) AS daily_amount,
                        COALESCE(SUM(CASE WHEN created_at >= ${monthlyStart} AND created_at < ${now} THEN amount END), 0) AS monthly_amount,
                        COALESCE(SUM(amount), 0) AS total_amount
                    FROM free_credit_issues
                    WHERE widget_tag = ${widgetTag}
                    GROUP BY issue_type
                `,
            this.prisma.$queryRaw<CreditAmountStatRow[]>`
                    SELECT
                        COALESCE(SUM(CASE WHEN cs.type = 'top_up' AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN cs.amount END), 0) AS daily_top_up,
                        COALESCE(SUM(CASE WHEN cs.type = 'top_up' AND cs.created_at >= ${monthlyStart} AND cs.created_at < ${now} THEN cs.amount END), 0) AS monthly_top_up,
                        COALESCE(SUM(CASE WHEN cs.type = 'top_up' THEN cs.amount END), 0) AS total_top_up,
                        COALESCE(SUM(CASE WHEN cs.type IN ('consume', 'refund') AND cs.is_free_credit = 1 AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN cs.amount END), 0) AS daily_free_consume,
                        COALESCE(SUM(CASE WHEN cs.type IN ('consume', 'refund') AND cs.is_free_credit = 1 AND cs.created_at >= ${monthlyStart} AND cs.created_at < ${now} THEN cs.amount END), 0) AS monthly_free_consume,
                        COALESCE(SUM(CASE WHEN cs.type IN ('consume', 'refund') AND cs.is_free_credit = 1 THEN cs.amount END), 0) AS total_free_consume,
                        COALESCE(SUM(CASE WHEN cs.type IN ('consume', 'refund') AND cs.is_free_credit = 0 AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN cs.amount END), 0) AS daily_paid_consume,
                        COALESCE(SUM(CASE WHEN cs.type IN ('consume', 'refund') AND cs.is_free_credit = 0 AND cs.created_at >= ${monthlyStart} AND cs.created_at < ${now} THEN cs.amount END), 0) AS monthly_paid_consume,
                        COALESCE(SUM(CASE WHEN cs.type IN ('consume', 'refund') AND cs.is_free_credit = 0 THEN cs.amount END), 0) AS total_paid_consume
                    FROM credit_statements cs
                    INNER JOIN orders o ON cs.order_id = o.order_id
                    WHERE o.widget_tag = ${widgetTag}
                `,
            this.prisma.$queryRaw<ConsumeUserCountRow[]>`
                    SELECT
                        COUNT(DISTINCT CASE WHEN cs.is_free_credit = 1 AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN cs.user END) AS daily_free_users,
                        COUNT(DISTINCT CASE WHEN cs.is_free_credit = 1 AND cs.created_at >= ${monthlyStart} AND cs.created_at < ${now} THEN cs.user END) AS monthly_free_users,
                        COUNT(DISTINCT CASE WHEN cs.is_free_credit = 1 THEN cs.user END) AS total_free_users,
                        COUNT(DISTINCT CASE WHEN cs.is_free_credit = 0 AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN cs.user END) AS daily_paid_users,
                        COUNT(DISTINCT CASE WHEN cs.is_free_credit = 0 AND cs.created_at >= ${monthlyStart} AND cs.created_at < ${now} THEN cs.user END) AS monthly_paid_users,
                        COUNT(DISTINCT CASE WHEN cs.is_free_credit = 0 THEN cs.user END) AS total_paid_users
                    FROM credit_statements cs
                    INNER JOIN orders o ON cs.order_id = o.order_id
                    WHERE cs.type IN ('consume') AND o.widget_tag = ${widgetTag}
                `,
            this.prisma.$queryRaw<FirstTimeConsumeRow[]>`
                    SELECT
                        SUM(CASE WHEN first_at >= ${dailyStart} AND first_at < ${now} THEN 1 ELSE 0 END) AS daily_first_time,
                        SUM(CASE WHEN first_at >= ${monthlyStart} AND first_at < ${now} THEN 1 ELSE 0 END) AS monthly_first_time,
                        COUNT(*) AS total_first_time
                    FROM (
                        SELECT cs.user, MIN(cs.created_at) AS first_at
                        FROM credit_statements cs
                        INNER JOIN orders o ON cs.order_id = o.order_id
                        WHERE cs.type IN ('consume') AND o.widget_tag = ${widgetTag}
                        GROUP BY cs.user
                    ) sub
                `,
            // One pass over every consuming user; the four Top-10 rankings are derived
            // from this in memory rather than by four separate grouped scans.
            this.prisma.$queryRaw<PerUserConsumeRow[]>`
                    SELECT cs.user,
                        COALESCE(SUM(CASE WHEN cs.is_free_credit = 1 THEN cs.amount END), 0) AS total_free_amount,
                        COALESCE(SUM(CASE WHEN cs.is_free_credit = 0 THEN cs.amount END), 0) AS total_paid_amount,
                        COALESCE(SUM(CASE WHEN cs.is_free_credit = 1 AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN cs.amount END), 0) AS daily_free_amount,
                        COALESCE(SUM(CASE WHEN cs.is_free_credit = 0 AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN cs.amount END), 0) AS daily_paid_amount,
                        SUM(CASE WHEN cs.is_free_credit = 1 THEN 1 ELSE 0 END) AS total_free_rows,
                        SUM(CASE WHEN cs.is_free_credit = 0 THEN 1 ELSE 0 END) AS total_paid_rows,
                        SUM(CASE WHEN cs.is_free_credit = 1 AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN 1 ELSE 0 END) AS daily_free_rows,
                        SUM(CASE WHEN cs.is_free_credit = 0 AND cs.created_at >= ${dailyStart} AND cs.created_at < ${now} THEN 1 ELSE 0 END) AS daily_paid_rows
                    FROM credit_statements cs
                    INNER JOIN orders o ON cs.order_id = o.order_id
                    WHERE cs.type IN ('consume', 'refund') AND o.widget_tag = ${widgetTag}
                    GROUP BY cs.user
                `,
            this.prisma.$queryRaw<WidgetAssetStatRow[]>`
                    SELECT
                        COALESCE(SUM(CASE WHEN type = 'video' AND created_at >= ${dailyStart} AND created_at < ${now} THEN CAST(JSON_EXTRACT(asset_info, '$.videoInfo.duration') AS DECIMAL(10,2)) END), 0) AS daily_video_seconds,
                        COALESCE(SUM(CASE WHEN type = 'video' AND created_at >= ${monthlyStart} AND created_at < ${now} THEN CAST(JSON_EXTRACT(asset_info, '$.videoInfo.duration') AS DECIMAL(10,2)) END), 0) AS monthly_video_seconds,
                        COALESCE(SUM(CASE WHEN type = 'video' THEN CAST(JSON_EXTRACT(asset_info, '$.videoInfo.duration') AS DECIMAL(10,2)) END), 0) AS total_video_seconds,
                        COALESCE(SUM(CASE WHEN type = 'image' AND created_at >= ${dailyStart} AND created_at < ${now} THEN 1 END), 0) AS daily_image_count,
                        COALESCE(SUM(CASE WHEN type = 'image' AND created_at >= ${monthlyStart} AND created_at < ${now} THEN 1 END), 0) AS monthly_image_count,
                        COALESCE(SUM(CASE WHEN type = 'image' THEN 1 END), 0) AS total_image_count
                    FROM assets
                    WHERE widget_tag = ${widgetTag} AND name LIKE 'task\\_%' AND type IN ('video', 'image')
                `,
            // The credit line is a separate account, so none of the queries above can
            // see it: credit line spending never reaches `credit_statements`. That is
            // exactly what the report wants for spending — money borrowed is not
            // revenue — but repayments are cash actually arriving, and they belong in
            // the paid bucket on the day they land. Kept as its own query rather than
            // folded into the block above, whose `INNER JOIN orders` a repayment has
            // nothing to join to.
            this.prisma.$queryRaw<CreditLineStatRow[]>`
                    SELECT
                        COALESCE(SUM(CASE WHEN type = 'repay' AND created_at >= ${dailyStart} AND created_at < ${now} THEN amount END), 0) AS daily_repay,
                        COALESCE(SUM(CASE WHEN type = 'repay' AND created_at >= ${monthlyStart} AND created_at < ${now} THEN amount END), 0) AS monthly_repay,
                        COALESCE(SUM(CASE WHEN type = 'repay' THEN amount END), 0) AS total_repay,
                        COALESCE(SUM(CASE WHEN type IN ('consume', 'refund') AND created_at >= ${dailyStart} AND created_at < ${now} THEN amount END), 0) AS daily_consume,
                        COALESCE(SUM(CASE WHEN type IN ('consume', 'refund') AND created_at >= ${monthlyStart} AND created_at < ${now} THEN amount END), 0) AS monthly_consume,
                        COALESCE(SUM(CASE WHEN type IN ('consume', 'refund') THEN amount END), 0) AS total_consume
                    FROM credit_line_statements
                    WHERE widget_tag = ${widgetTag}
                `,
            // Point in time, not a period: what this widget is owed right now. Rows
            // with a negative `used` are overpayments, and netting them off would
            // understate the exposure, so only debts are summed.
            this.prisma.$queryRaw<CreditLineOutstandingRow[]>`
                    SELECT COALESCE(SUM(used), 0) AS outstanding
                    FROM user_credit_lines
                    WHERE widget_tag = ${widgetTag} AND used > 0
                `,
        ])

        const amounts = amountRows[0]
        const consumeUsers = consumeUserRows[0]
        const firstTime = firstTimeRows[0]
        const widgetAssets = widgetAssetRows[0]
        const creditLine = creditLineRows[0]
        const creditLineOutstanding = toNumber(creditLineOutstandingRows[0]?.outstanding)

        // Both ledgers store spending as a negative number — `credit_statements.amount`
        // for a consume, `credit_line_statements.amount` for a repay — so revenue
        // recognition is a plain addition with no sign to flip.
        //
        // The repayment's other leg does land in `credit_statements`, as a
        // `repay_credit_line` row, but that type is outside the `IN ('consume',
        // 'refund')` filter the paid bucket uses, so it is counted here once and only
        // once. Adding `repay_credit_line` to that filter would count it twice.
        const paidConsume = {
            daily: toNumber(amounts?.daily_paid_consume) + toNumber(creditLine?.daily_repay),
            monthly: toNumber(amounts?.monthly_paid_consume) + toNumber(creditLine?.monthly_repay),
            total: toNumber(amounts?.total_paid_consume) + toNumber(creditLine?.total_repay),
        }

        const freeIssueByPeriod = (period: "daily_amount" | "monthly_amount" | "total_amount") =>
            freeIssueRows.map((row) => ({ issue_type: row.issue_type, _sum: { amount: toNumber(row[period]) } }))

        // Consume amounts are negative, so ascending order puts the heaviest consumers first —
        // this reproduces the previous `orderBy: { _sum: { amount: "asc" } }, take: 10`.
        const rankTop10 = (
            amountKey: keyof PerUserConsumeRow,
            rowCountKey: keyof PerUserConsumeRow,
        ): PerUserConsumeRow[] =>
            perUserConsumeRows
                .filter((row) => row.user && toNumber(row[rowCountKey]) > 0)
                .sort((a, b) => toNumber(a[amountKey]) - toNumber(b[amountKey]))
                .slice(0, 10)

        const freeTop10 = rankTop10("total_free_amount", "total_free_rows")
        const paidTop10 = rankTop10("total_paid_amount", "total_paid_rows")
        const dailyFreeTop10 = rankTop10("daily_free_amount", "daily_free_rows")
        const dailyPaidTop10 = rankTop10("daily_paid_amount", "daily_paid_rows")

        const rankedUserIds = [
            ...new Set(
                [...freeTop10, ...paidTop10, ...dailyFreeTop10, ...dailyPaidTop10].map((row) => row.user as string),
            ),
        ]

        const [userEmails, perUserAssetRows] = await Promise.all([
            rankedUserIds.length > 0
                ? this.prisma.users.findMany({
                      where: { username_in_be: { in: rankedUserIds } },
                      select: { username_in_be: true, email: true },
                  })
                : Promise.resolve([]),
            rankedUserIds.length > 0
                ? this.prisma.$queryRaw<PerUserAssetStatRow[]>`
                    SELECT user,
                        COALESCE(SUM(CASE WHEN type = 'video' THEN CAST(JSON_EXTRACT(asset_info, '$.videoInfo.duration') AS DECIMAL(10,2)) END), 0) AS total_video_seconds,
                        COALESCE(SUM(CASE WHEN type = 'image' THEN 1 END), 0) AS total_image_count,
                        COALESCE(SUM(CASE WHEN type = 'video' AND created_at >= ${dailyStart} AND created_at < ${now} THEN CAST(JSON_EXTRACT(asset_info, '$.videoInfo.duration') AS DECIMAL(10,2)) END), 0) AS daily_video_seconds,
                        COALESCE(SUM(CASE WHEN type = 'image' AND created_at >= ${dailyStart} AND created_at < ${now} THEN 1 END), 0) AS daily_image_count
                    FROM assets
                    WHERE widget_tag = ${widgetTag} AND name LIKE 'task\\_%' AND type IN ('video', 'image')
                    AND user IN (${Prisma.join(rankedUserIds)})
                    GROUP BY user
                `
                : Promise.resolve([]),
        ])

        const emailByUser = new Map(userEmails.map((row) => [row.username_in_be, row.email]))
        const assetsByUser = new Map(perUserAssetRows.map((row) => [row.user, row]))

        const buildTop10 = (
            rows: PerUserConsumeRow[],
            period: "total" | "daily",
            rankedBy: keyof PerUserConsumeRow,
        ): CreditTop10User[] =>
            rows.map((row) => {
                const assets = assetsByUser.get(row.user)
                const freeAmount = toNumber(period === "daily" ? row.daily_free_amount : row.total_free_amount)
                const paidAmount = toNumber(period === "daily" ? row.daily_paid_amount : row.total_paid_amount)
                return {
                    user: row.user as string,
                    user_email: emailByUser.get(row.user as string) || "unknown",
                    _sum: { amount: toNumber(row[rankedBy]) },
                    free_amount: freeAmount,
                    paid_amount: paidAmount,
                    total_amount: freeAmount + paidAmount,
                    video_duration: toNumber(
                        period === "daily" ? assets?.daily_video_seconds : assets?.total_video_seconds,
                    ),
                    image_count: toNumber(period === "daily" ? assets?.daily_image_count : assets?.total_image_count),
                }
            })

        return {
            dailyFreeIssue: freeIssueByPeriod("daily_amount"),
            monthlyFreeIssue: freeIssueByPeriod("monthly_amount"),
            totalFreeIssue: freeIssueByPeriod("total_amount"),
            dailyTopUp: { _sum: { amount: toNumber(amounts?.daily_top_up) } },
            monthlyTopUp: { _sum: { amount: toNumber(amounts?.monthly_top_up) } },
            totalTopUp: { _sum: { amount: toNumber(amounts?.total_top_up) } },
            dailyFreeCreditConsume: { _sum: { amount: toNumber(amounts?.daily_free_consume) } },
            monthlyFreeCreditConsume: { _sum: { amount: toNumber(amounts?.monthly_free_consume) } },
            totalFreeCreditConsume: { _sum: { amount: toNumber(amounts?.total_free_consume) } },
            dailyNoFreeCreditConsume: { _sum: { amount: paidConsume.daily } },
            monthlyNoFreeCreditConsume: { _sum: { amount: paidConsume.monthly } },
            totalNoFreeCreditConsume: { _sum: { amount: paidConsume.total } },
            dailyCreditLineRepay: { _sum: { amount: toNumber(creditLine?.daily_repay) } },
            monthlyCreditLineRepay: { _sum: { amount: toNumber(creditLine?.monthly_repay) } },
            totalCreditLineRepay: { _sum: { amount: toNumber(creditLine?.total_repay) } },
            dailyCreditLineConsume: { _sum: { amount: toNumber(creditLine?.daily_consume) } },
            monthlyCreditLineConsume: { _sum: { amount: toNumber(creditLine?.monthly_consume) } },
            totalCreditLineConsume: { _sum: { amount: toNumber(creditLine?.total_consume) } },
            creditLineOutstanding,
            freeCreditConsumeTop10Users: buildTop10(freeTop10, "total", "total_free_amount"),
            noFreeCreditConsumeTop10Users: buildTop10(paidTop10, "total", "total_paid_amount"),
            dailyFreeCreditConsumeTop10Users: buildTop10(dailyFreeTop10, "daily", "daily_free_amount"),
            dailyNoFreeCreditConsumeTop10Users: buildTop10(dailyPaidTop10, "daily", "daily_paid_amount"),
            dailyFreeCreditConsumeUserCount: toNumber(consumeUsers?.daily_free_users),
            monthlyFreeCreditConsumeUserCount: toNumber(consumeUsers?.monthly_free_users),
            totalFreeCreditConsumeUserCount: toNumber(consumeUsers?.total_free_users),
            dailyNoFreeCreditConsumeUserCount: toNumber(consumeUsers?.daily_paid_users),
            monthlyNoFreeCreditConsumeUserCount: toNumber(consumeUsers?.monthly_paid_users),
            totalNoFreeCreditConsumeUserCount: toNumber(consumeUsers?.total_paid_users),
            dailyFirstTimeConsumeUserCount: toNumber(firstTime?.daily_first_time),
            monthlyFirstTimeConsumeUserCount: toNumber(firstTime?.monthly_first_time),
            totalFirstTimeConsumeUserCount: toNumber(firstTime?.total_first_time),
            dailyVideoDuration: toNumber(widgetAssets?.daily_video_seconds),
            monthlyVideoDuration: toNumber(widgetAssets?.monthly_video_seconds),
            totalVideoDuration: toNumber(widgetAssets?.total_video_seconds),
            dailyImageCount: toNumber(widgetAssets?.daily_image_count),
            monthlyImageCount: toNumber(widgetAssets?.monthly_image_count),
            totalImageCount: toNumber(widgetAssets?.total_image_count),
        }
    }

    //@Cron(CronExpression.EVERY_HOUR)
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

        // Format top 10 users data (with consumption breakdown, video duration, image count)
        // Consume amounts are stored as negative, multiply by -1 to display as positive
        const formatTop10Users = (users: any[]) =>
            users.map((user: any, index: number) => ({
                rank: index + 1,
                user_email: user.user_email || "unknown",
                total_amount: Number(user.total_amount ?? 0) * -1,
                free_amount: Number(user.free_amount ?? 0) * -1,
                paid_amount: Number(user.paid_amount ?? 0) * -1,
                video_duration_minutes: Math.round((Number(user.video_duration ?? 0) / 60) * 10) / 10,
                image_count: Number(user.image_count ?? 0),
            }))

        // Stored negative, displayed positive, same as every other consumption figure
        // in this report.
        const asPositive = (value: any) => Number(value?._sum?.amount || 0) * -1

        const creditLineOutstanding = Number(data.creditLineOutstanding || 0)
        const totalCreditLineConsume = asPositive(data.totalCreditLineConsume)
        const totalCreditLineRepay = asPositive(data.totalCreditLineRepay)
        // A widget that has never granted a credit line gets the report it got before
        // this section existed, rather than a block of zeroes.
        const hasCreditLine = creditLineOutstanding !== 0 || totalCreditLineConsume !== 0 || totalCreditLineRepay !== 0

        const freeCreditTop10Users = formatTop10Users(data.freeCreditConsumeTop10Users || [])
        const noFreeCreditTop10Users = formatTop10Users(data.noFreeCreditConsumeTop10Users || [])
        const dailyFreeCreditTop10Users = formatTop10Users(data.dailyFreeCreditConsumeTop10Users || [])
        const dailyNoFreeCreditTop10Users = formatTop10Users(data.dailyNoFreeCreditConsumeTop10Users || [])

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
            dailyFreeCreditConsume: Number(data.dailyFreeCreditConsume?._sum?.amount || 0) * -1,
            monthlyFreeCreditConsume: Number(data.monthlyFreeCreditConsume?._sum?.amount || 0) * -1,
            totalFreeCreditConsume: Number(data.totalFreeCreditConsume?._sum?.amount || 0) * -1,

            // Paid credit consumption (negative = consumed, positive = refunded more than consumed)
            dailyNoFreeCreditConsume: Number(data.dailyNoFreeCreditConsume?._sum?.amount || 0) * -1,
            monthlyNoFreeCreditConsume: Number(data.monthlyNoFreeCreditConsume?._sum?.amount || 0) * -1,
            totalNoFreeCreditConsume: Number(data.totalNoFreeCreditConsume?._sum?.amount || 0) * -1,

            // Credit line. The repay figures are already inside the paid consumption
            // numbers above; they are broken out here so the reader can see how much of
            // the paid bucket arrived as repayment rather than as spending.
            hasCreditLine,
            creditLineOutstanding,
            dailyCreditLineConsume: asPositive(data.dailyCreditLineConsume),
            monthlyCreditLineConsume: asPositive(data.monthlyCreditLineConsume),
            totalCreditLineConsume,
            dailyCreditLineRepay: asPositive(data.dailyCreditLineRepay),
            monthlyCreditLineRepay: asPositive(data.monthlyCreditLineRepay),
            totalCreditLineRepay,

            // Free issue data by type
            freeIssueData,

            // Top 10 users (all-time)
            freeCreditTop10Users: freeCreditTop10Users.length > 0 ? freeCreditTop10Users : null,
            noFreeCreditTop10Users: noFreeCreditTop10Users.length > 0 ? noFreeCreditTop10Users : null,

            // Top 10 users (daily)
            dailyFreeCreditTop10Users: dailyFreeCreditTop10Users.length > 0 ? dailyFreeCreditTop10Users : null,
            dailyNoFreeCreditTop10Users: dailyNoFreeCreditTop10Users.length > 0 ? dailyNoFreeCreditTop10Users : null,

            // 免费积分消耗人数
            dailyFreeCreditConsumeUserCount: data.dailyFreeCreditConsumeUserCount,
            monthlyFreeCreditConsumeUserCount: data.monthlyFreeCreditConsumeUserCount,
            totalFreeCreditConsumeUserCount: data.totalFreeCreditConsumeUserCount,

            // 付费积分消耗人数
            dailyNoFreeCreditConsumeUserCount: data.dailyNoFreeCreditConsumeUserCount,
            monthlyNoFreeCreditConsumeUserCount: data.monthlyNoFreeCreditConsumeUserCount,
            totalNoFreeCreditConsumeUserCount: data.totalNoFreeCreditConsumeUserCount,

            // 首次消耗人数
            dailyFirstTimeConsumeUserCount: data.dailyFirstTimeConsumeUserCount,
            monthlyFirstTimeConsumeUserCount: data.monthlyFirstTimeConsumeUserCount,
            totalFirstTimeConsumeUserCount: data.totalFirstTimeConsumeUserCount,

            // 生成视频分钟数 (convert seconds to minutes, round to 1 decimal)
            dailyVideoDurationMinutes: Math.round((data.dailyVideoDuration / 60) * 10) / 10,
            monthlyVideoDurationMinutes: Math.round((data.monthlyVideoDuration / 60) * 10) / 10,
            totalVideoDurationMinutes: Math.round((data.totalVideoDuration / 60) * 10) / 10,

            // 生成图片数
            dailyImageCount: data.dailyImageCount,
            monthlyImageCount: data.monthlyImageCount,
            totalImageCount: data.totalImageCount,
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
                    const creditbalance = freeCredit.balance ?? 0
                    //update user table
                    const balanceAfter = await adjustProjected(
                        tx,
                        PROJECTED.userBalance,
                        freeCredit.user,
                        -creditbalance,
                    )

                    //create statement
                    await tx.credit_statements.create({
                        data: {
                            user: freeCredit.user,
                            ...projectedValues("amount", -creditbalance),
                            balance: balanceAfter.whole,
                            balance_precise: balanceAfter.precise,
                            is_free_credit: true,
                            type: credit_statement_type.expire_free_credit,
                            free_credit_issue_id: freeCredit.id,
                        },
                    })

                    //update free credit table
                    await tx.free_credit_issues.update({
                        where: { id: freeCredit.id },
                        data: projectedValues("balance", 0),
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
