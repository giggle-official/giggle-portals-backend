import { HttpService } from "@nestjs/axios"
import { BadRequestException, forwardRef, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common"
import { CreateSettleUserDto, SettleApiResponseDto, SettleOrderResponseDto, SettleUserResponseDto } from "./settle.dto"
import { JwtService } from "@nestjs/jwt"
import { AxiosResponse, isAxiosError } from "axios"
import { PrismaService } from "src/common/prisma.service"
import { lastValueFrom } from "rxjs"
import { RewardAllocateRoles } from "../rewards-pool/rewards-pool.dto"
import { Decimal } from "@prisma/client/runtime/library"
import { UserService } from "src/user/user.service"
import { OrderStatus } from "../order/order.dto"

@Injectable()
export class SettleService {
    private readonly settleApiEndpoint = process.env.SETTLE_API_ENDPOINT
    private readonly settleApiKey = process.env.PRODUCT_ACCESS_KEY
    private readonly settleApiSecret = process.env.PRODUCT_ACCESS_SECRET
    private readonly logger = new Logger(SettleService.name)
    private readonly needSettleWidget = process.env.SETTLE_WIDGET_TAG

    constructor(
        private readonly httpService: HttpService,
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
    ) {
        if (!this.settleApiEndpoint || !this.settleApiKey || !this.settleApiSecret) {
            throw new Error("SETTLE_API_ENDPOINT, PRODUCT_ACCESS_KEY, PRODUCT_ACCESS_SECRET must be set")
        }
    }

    async generateAuthHeader(): Promise<string> {
        return `Bearer ${this.jwtService.sign(
            {
                iss: this.settleApiKey,
            },
            {
                secret: this.settleApiSecret,
                expiresIn: "10m",
            },
        )}`
    }

    async PostOrderToSettleByOrderId(order_id: string): Promise<any> {
        const statement = await this.prisma.reward_pool_statement.findFirst({
            where: {
                related_order_id: order_id,
            },
        })
        if (!statement) {
            throw new BadRequestException(`Statement not found for order ${order_id}`)
        }
        return await this.postSubscriptionOrderToSettle(order_id)
    }

    async postOrderToSettle(statement_id: number): Promise<void> {
        //we only need push order on production environment
        if (process.env.ENV !== "product") {
            this.logger.warn(`[Settle] Not in product environment, skip post order to settle`)
            return
        }

        //find order needs posts
        const statement = await this.prisma.reward_pool_statement.findUnique({
            where: {
                id: statement_id,
                chain_transaction: { not: null },
            },
        })
        if (!statement || !statement.related_order_id) {
            this.logger.warn(`[Settle] Statement ${statement_id} not found or not settled`)
            return
        }

        const order = await this.prisma.orders.findUnique({
            where: {
                order_id: statement.related_order_id,
            },
            include: {
                user_info: true,
            },
        })

        if (order.settled) {
            this.logger.warn(`[Settle] Order ${statement.related_order_id} already settled`)
            return
        }

        if (order.widget_tag !== this.needSettleWidget) {
            this.logger.warn(
                `[Settle] Order ${statement.related_order_id} not supported widget: ${this.needSettleWidget}`,
            )
            return
        }

        const platformRewards = await this.prisma.user_rewards.aggregate({
            where: {
                statement_id: statement_id,
                role: RewardAllocateRoles.PLATFORM,
                token: process.env.GIGGLE_LEGAL_USDC,
            },
            _sum: {
                rewards: true,
            },
        })

        if (platformRewards._sum.rewards.equals(new Decimal(0))) {
            this.logger.warn(`[Settle] No platform rewards for statement ${statement_id}`)
            return
        }

        //find creator invited user
        const creatorInvitedUser = await this.prisma.users.findUnique({
            where: {
                username_in_be: order.owner,
            },
            select: {
                invited_by: true,
            },
        })

        //find invited_by email
        let creatorInvitedUserEmail = ""
        if (creatorInvitedUser?.invited_by) {
            const invitedByEmail = await this.prisma.users.findUnique({
                where: {
                    username_in_be: creatorInvitedUser?.invited_by,
                },
                select: {
                    email: true,
                },
            })
            creatorInvitedUserEmail = invitedByEmail?.email
        }

        //push order to settle system

        try {
            const authHeader = await this.generateAuthHeader()
            const requestParams = {
                order_id: order.order_id,
                creator: order.user_info.email,
                creator_invited_user: creatorInvitedUserEmail,
                revenue: platformRewards._sum.rewards.toNumber(),
                created_at: order.paid_time,
            }
            const response = await lastValueFrom<AxiosResponse<SettleApiResponseDto<SettleOrderResponseDto>>>(
                this.httpService.post(this.settleApiEndpoint + "/api/v1/product-orders/create", requestParams, {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: authHeader,
                    },
                }),
            )
            this.logger.log(`Settle order response: ${JSON.stringify(response?.data)}`)

            if (
                response.status !== HttpStatus.OK ||
                response?.data?.code !== HttpStatus.OK ||
                !response?.data?.data?.success
            ) {
                throw new Error(`Failed to post order ${statement.related_order_id} to settle: ${response?.statusText}`)
            }

            await this.prisma.orders.update({
                where: {
                    order_id: statement.related_order_id,
                },
                data: {
                    settled: true,
                    settled_time: new Date(),
                },
            })
        } catch (error) {
            if (isAxiosError(error)) {
                this.logger.error(
                    `Failed to post order ${statement.related_order_id} to settle: ${JSON.stringify(error.response.data)}`,
                )
            } else {
                this.logger.error(`Failed to post order ${statement.related_order_id} to settle: ${error.message}`)
            }
        }
    }

    /**
     * Post subscription order to settle system
     * This is used for subscription payments that don't go through the normal rewards release flow
     */
    async postSubscriptionOrderToSettle(order_id: string): Promise<void> {
        //we only need push order on production environment
        // if (process.env.ENV !== "product") {
        //     this.logger.warn(`[Settle] Not in product environment, skip post subscription order to settle`)
        //     return
        // }

        if (!order_id) {
            throw new BadRequestException(`Order id is required`)
        }

        const order = await this.prisma.orders.findUnique({
            where: {
                order_id: order_id,
            },
            include: {
                user_info: true,
            },
        })

        if (!order) {
            this.logger.warn(`[Settle] Invalid order provided`)
            return
        }


        if (order.widget_tag !== this.needSettleWidget) {
            this.logger.warn(`[Settle] Order ${order.order_id} not supported widget: ${this.needSettleWidget}`)
            return
        }

        //for credit-top up order, we needd check current status is completed or rewards released
        if (order.is_credit_top_up) {
            if (order.current_status !== OrderStatus.COMPLETED && order.current_status !== OrderStatus.REWARDS_RELEASED) {
                this.logger.warn(`[Settle] Credit top up order ${order.order_id} not completed or released rewards`)
                return
            }
        } else {
            if (order.current_status !== OrderStatus.REWARDS_RELEASED) {
                this.logger.warn(`[Settle] Order ${order.order_id} not released rewards`)
                return
            }
        }

        // Calculate platform revenue (10% of the order amount)
        const platformRevenue = order.amount / 100 // amount is in cents, convert to dollars

        //find invited_by email
        let creatorInvitedUserEmail = ""
        if (order.user_info?.invited_by) {
            const invitedByEmail = await this.prisma.users.findUnique({
                where: {
                    username_in_be: order.user_info.invited_by,
                },
                select: {
                    email: true,
                },
            })
            creatorInvitedUserEmail = invitedByEmail?.email
        }

        try {
            const authHeader = await this.generateAuthHeader()
            const requestParams = {
                order_id: order.order_id,
                creator: order.user_info.email,
                creator_invited_user: creatorInvitedUserEmail,
                revenue: platformRevenue,
                created_at: order.paid_time || new Date(),
            }
            const response = await lastValueFrom<AxiosResponse<SettleApiResponseDto<SettleOrderResponseDto>>>(
                this.httpService.post(this.settleApiEndpoint + "/api/v1/product-orders/create", requestParams, {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: authHeader,
                    },
                }),
            )
            this.logger.log(`Settle subscription order response: ${JSON.stringify(response?.data)}`)

            if (
                response.status !== HttpStatus.OK ||
                response?.data?.code !== HttpStatus.OK
            ) {
                throw new Error(`Failed to post subscription order ${order.order_id} to settle: ${response?.statusText}`)
            }

            await this.prisma.orders.update({
                where: {
                    order_id: order.order_id,
                },
                data: {
                    settled: true,
                    settled_time: new Date(),
                },
            })

            this.logger.log(`[Settle] Subscription order ${order.order_id} settled successfully`)
        } catch (error) {
            if (isAxiosError(error)) {
                this.logger.error(
                    `Failed to post subscription order ${order.order_id} to settle: ${JSON.stringify(error.response?.data)}`,
                )
            } else {
                this.logger.error(`Failed to post subscription order ${order.order_id} to settle: ${error.message}`)
            }
            throw error
        }
    }

    //post user to settle system
    async postUserToSettle(email: string): Promise<any> {
        //we only need push order on production environment
        if (process.env.ENV !== "product") {
            this.logger.warn(`[Settle] Not in product environment, skip post order to settle`)
            return
        }

        const userProfile = await this.userService.getUserInfoByEmail(email)
        if (!userProfile) {
            throw new BadRequestException(`User ${email} not found`)
        }

        const profile = await this.userService.getProfile({
            email: email,
            usernameShorted: userProfile.usernameShorted,
            user_id: userProfile.usernameShorted,
        })

        //push user to settle system
        try {
            const authHeader = await this.generateAuthHeader()

            const requestParams: CreateSettleUserDto = {
                user_email: email,
                invite_code: profile.invite_code,
                inviter_email: profile?.register_info?.invited_by?.email || null,
            }
            const response = await lastValueFrom<AxiosResponse<SettleApiResponseDto<SettleUserResponseDto>>>(
                this.httpService.post(this.settleApiEndpoint + "/api/v1/user-invitations/create", requestParams, {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: authHeader,
                    },
                }),
            )
            this.logger.log(`Settle user response: ${JSON.stringify(response?.data)}`)

            if (
                response.status !== HttpStatus.OK ||
                response?.data?.code !== HttpStatus.OK ||
                !response?.data?.data?.success
            ) {
                throw new Error(`Failed to post user ${email} to settle: ${response?.statusText}`)
            }
            return response.data.data
        } catch (error) {
            if (isAxiosError(error)) {
                this.logger.error(`Failed to post user ${email} to settle: ${JSON.stringify(error.response.data)}`)
            } else {
                this.logger.error(`Failed to post user ${email} to settle: ${error.message}`)
            }
            throw new BadRequestException(`Failed to post user ${email} to settle: ${error.message}`)
        }
    }
}
