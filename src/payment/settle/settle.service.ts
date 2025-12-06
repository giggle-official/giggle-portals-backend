import { HttpService } from "@nestjs/axios"
import { HttpStatus, Injectable, Logger } from "@nestjs/common"
import { CreateSettleOrderDto, ORDER_SETTLE_STATUS, SettleApiResponseDto, SettleOrderResponseDto } from "./settle.dto"
import { JwtService } from "@nestjs/jwt"
import { AxiosResponse, isAxiosError } from "axios"
import { PrismaService } from "src/common/prisma.service"
import { lastValueFrom } from "rxjs"
import { RewardAllocateRoles } from "../rewards-pool/rewards-pool.dto"
import { Decimal } from "@prisma/client/runtime/library"

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

    async postOrderToSettle(statement_id: number): Promise<void> {
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
}
