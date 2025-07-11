import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { GetStatementQueryDto, GetStatementsResponseDto, TopUpDto } from "./credit.dto"
import { OrderDetailDto, OrderStatus, PaymentMethod } from "src/payment/order/order.dto"
import { OrderService } from "src/payment/order/order.service"
import { UserService } from "src/user/user.service"
import { v4 as uuidv4 } from "uuid"
import { credit_statement_type, orders, Prisma } from "@prisma/client"

@Injectable()
export class CreditService {
    private readonly logger = new Logger(CreditService.name)

    constructor(
        private prisma: PrismaService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => OrderService))
        private readonly orderService: OrderService,
    ) {}

    async getUserCredits(userId: string): Promise<number> {
        const credit = await this.prisma.user_credit_consume.findFirst({
            where: {
                credit_info: {
                    user: userId,
                },
            },
            orderBy: {
                id: "desc",
            },
        })
        if (credit) {
            return credit.balance_after
        }
        return 0
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
    ): Promise<void> {
        const user = await tx.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!user || user.current_credit_balance < amount) {
            throw new BadRequestException("Insufficient credit balance")
        }

        const userBalanceUpdated = await tx.users.update({
            where: { username_in_be: userInfo.usernameShorted },
            data: {
                current_credit_balance: {
                    decrement: amount,
                },
            },
        })

        await tx.credit_statements.create({
            data: {
                user: userInfo.usernameShorted,
                type: credit_statement_type.consume,
                amount: amount * -1,
                balance: userBalanceUpdated.current_credit_balance,
                order_id: order_id,
            },
        })
    }

    async refundCredit(
        amount: number,
        order_id: string,
        userInfo: UserJwtExtractDto,
        tx: Prisma.TransactionClient,
    ): Promise<void> {
        const userBalanceUpdated = await tx.users.update({
            where: { username_in_be: userInfo.usernameShorted },
            data: {
                current_credit_balance: {
                    increment: amount,
                },
            },
        })
        await tx.credit_statements.create({
            data: {
                user: userInfo.usernameShorted,
                type: credit_statement_type.refund,
                amount: amount,
                balance: userBalanceUpdated.current_credit_balance,
                order_id: order_id,
            },
        })
    }
}
