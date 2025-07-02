import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { TopUpDto } from "./credit.dto"
import { OrderDetailDto, OrderStatus, PaymentMethod } from "src/payment/order/order.dto"
import { OrderService } from "src/payment/order/order.service"
import { UserService } from "src/user/user.service"
import { v4 as uuidv4 } from "uuid"
import { credit_statement_type } from "@prisma/client"

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
        const orderId = uuidv4()
        //const callbackUrl = `${process.env.FRONTEND_URL}/api/v1/credit/top-up-callback`
        const callbackUrl = `http://localhost:8899/api/v1/credit/top-up-callback`

        const record = await this.prisma.orders.create({
            data: {
                order_id: orderId,
                owner: user.user_id,
                widget_tag: "",
                app_id: "",
                amount: body.amount,
                description: `Top up ${body.amount} credits`,
                related_reward_id: null,
                rewards_model_snapshot: null,
                costs_allocation: null,
                ip_holder_revenue_reallocation: null,
                release_rewards_after_paid: false,
                current_status: OrderStatus.PENDING,
                supported_payment_method: [PaymentMethod.WALLET, PaymentMethod.WECHAT, PaymentMethod.STRIPE],
                redirect_url: null,
                callback_url: callbackUrl,
                expire_time: new Date(Date.now() + 1000 * 60 * 15), //order will cancel after 15 minutes
                from_source_link: null,
            },
        })
        return await this.orderService.mapOrderDetail(record)
    }

    async topUpCallback(body: OrderDetailDto): Promise<void> {
        const order = await this.prisma.orders.findUnique({
            where: {
                order_id: body.order_id,
            },
        })
        if (!order) {
            this.logger.error(`Top-up credit order not found: ${body.order_id}`)
            return
        }
        if (order.current_status !== body.current_status || order.owner !== body.owner) {
            this.logger.error(`Top-up credit order data not match: ${body.order_id}`)
            return
        }

        if (order.current_status !== OrderStatus.COMPLETED) {
            // we no need do anything if the order is not completed
            this.logger.error(`Top-up credit order already completed: ${body.order_id}`)
            return
        }

        //check if credit is already issued
        const credit = await this.prisma.credit_statements.findFirst({
            where: {
                order_id: body.order_id,
            },
        })

        if (credit) {
            this.logger.error(`Top-up credit already issued: ${body.order_id}`)
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
                        increment: body.amount,
                    },
                },
            })
            await tx.credit_statements.create({
                data: {
                    order_id: body.order_id,
                    amount: body.amount,
                    balance: userBalanceUpdated.current_credit_balance,
                    user: order.owner,
                    type: credit_statement_type.top_up,
                },
            })
        })
    }
}
