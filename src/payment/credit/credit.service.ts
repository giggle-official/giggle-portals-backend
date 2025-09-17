import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import {
    GetStatementQueryDto,
    GetStatementsResponseDto,
    IssueFreeCreditDto,
    TopUpDto,
    UserCreditBalanceDto,
} from "./credit.dto"
import { OrderDetailDto, OrderStatus, PaymentMethod } from "src/payment/order/order.dto"
import { OrderService } from "src/payment/order/order.service"
import { UserService } from "src/user/user.service"
import { credit_statement_type, orders, Prisma } from "@prisma/client"
import { Cron, CronExpression } from "@nestjs/schedule"

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
                allowed_payment_methods: [PaymentMethod.STRIPE, PaymentMethod.WECHAT, PaymentMethod.WALLET],
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
                order_id: statement.order_id,
                widget_tag: statement.order?.widget_tag,
                ip_id: statement.order?.ip_id,
                type: statement.type,
                is_free_credit: statement.is_free_credit,
                free_credit_issue_id: statement.free_credit_issue_id,
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
    ): Promise<{ free_credit_consumed: number; total_credit_consumed: number }> {
        const user = await tx.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!user || user.current_credit_balance < amount) {
            throw new BadRequestException("Insufficient credit balance")
        }

        let needCreditConsumed = amount
        let freeCreditConsumed = 0

        const freeCredits = await tx.free_credit_issues.findMany({
            where: {
                user: userInfo.usernameShorted,
                balance: {
                    gt: 0,
                },
            },
            orderBy: {
                expire_date: "asc",
            },
        })

        if (freeCredits.length > 0) {
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

        //we need consume credit if free credit is not enough
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

    async refundCredit(
        amount: number,
        order_id: string,
        userInfo: UserJwtExtractDto,
        tx: Prisma.TransactionClient,
    ): Promise<void> {
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
            needRefundAmount -= _refundAmount
            refundedAmount += _refundAmount

            if (statement.is_free_credit) {
                //if free credit is expired, we need not refund this statement
                const freeCredit = await tx.free_credit_issues.findUnique({
                    where: { id: statement.free_credit_issue_id },
                })
                if (freeCredit && freeCredit.expire_date && freeCredit.expire_date < new Date()) {
                    this.logger.warn(`Free credit is expired, we need not refund this statement: ${statement.id}`)
                    continue
                }
                //update free credit table
                await tx.free_credit_issues.update({
                    where: { id: statement.free_credit_issue_id },
                    data: { balance: { increment: _refundAmount } },
                })
            }

            //update user table
            const userBalanceUpdated = await tx.users.update({
                where: { username_in_be: userInfo.usernameShorted },
                data: { current_credit_balance: { increment: _refundAmount } },
            })

            //create statement
            await tx.credit_statements.create({
                data: {
                    user: userInfo.usernameShorted,
                    type: credit_statement_type.refund,
                    amount: _refundAmount,
                    balance: userBalanceUpdated.current_credit_balance,
                    order_id: order_id,
                    is_free_credit: statement.is_free_credit,
                    free_credit_issue_id: statement.free_credit_issue_id,
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

    async issueFreeCredit(body: IssueFreeCreditDto, userInfo: UserJwtExtractDto): Promise<UserCreditBalanceDto> {
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
                },
            })

            await tx.credit_statements.create({
                data: {
                    user: issuedFreeCredit.username_in_be,
                    amount: body.amount,
                    balance: userBalanceUpdated.current_credit_balance,
                    is_free_credit: true,
                    type: credit_statement_type.issue_free_credit,
                    free_credit_issue_id: issueRecord.id,
                },
            })
        })

        return await this.getUserCredits(issuedFreeCredit.username_in_be)
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
