import {
    BadRequestException,
    Injectable,
    RawBodyRequest,
    Logger,
    NotFoundException,
    InternalServerErrorException,
    ForbiddenException,
    Inject,
    forwardRef,
} from "@nestjs/common"
import {
    BindRewardPoolDto,
    OrderCallbackDto,
    OrderDetailDto,
    OrderListDto,
    OrderListQueryDto,
    OrderRewardsDto,
    OrderStatus,
    PaymentMethod,
    PayWithStripeRequestDto,
    PayWithStripeResponseDto,
    PayWithWalletRequestDto,
    ReleaseRewardsDto,
    ResendCallbackRequestDto,
    UnbindRewardPoolDto,
} from "./order.dto"
import { PrismaService } from "src/common/prisma.service"
import { CreateOrderDto } from "./order.dto"
import { v4 as uuidv4 } from "uuid"
import { orders, Prisma, user_rewards, users } from "@prisma/client"
import { UserJwtExtractDto } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { Cron } from "@nestjs/schedule"
import { CronExpression } from "@nestjs/schedule"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { ConfirmStatus } from "src/web3/giggle/giggle.dto"
import Stripe from "stripe"
import { InjectStripe } from "nestjs-stripe"
import { Request } from "express"
import { HttpService } from "@nestjs/axios"
import { async, lastValueFrom } from "rxjs"
import { LinkService } from "src/open-app/link/link.service"
import { RewardsPoolService } from "../rewards-pool/rewards-pool.service"
import {
    RewardAllocateRatio,
    RewardAllocateRoles,
    RewardAllocateType,
    RewardSnapshotDto,
} from "../rewards-pool/rewards-pool.dto"
import { Decimal } from "@prisma/client/runtime/library"
import { JwtService } from "@nestjs/jwt"
@Injectable()
export class OrderService {
    public readonly logger = new Logger(OrderService.name)
    public static readonly paymentMethod = [PaymentMethod.STRIPE, PaymentMethod.WALLET]
    constructor(
        private readonly prisma: PrismaService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
        private readonly giggleService: GiggleService,
        private readonly httpService: HttpService,

        @Inject(forwardRef(() => LinkService))
        private readonly linkService: LinkService,

        @Inject(forwardRef(() => RewardsPoolService))
        private readonly rewardsPoolService: RewardsPoolService,

        private readonly jwtService: JwtService,
        @InjectStripe() private readonly stripe: Stripe,
    ) {}

    async createOrder(
        order: CreateOrderDto,
        userInfo: UserJwtExtractDto,
        app_id: string = "", // this value will replaced if app_id exists in the user's widget info
    ): Promise<OrderDetailDto> {
        const userProfile = await this.userService.getProfile(userInfo)
        let appId = app_id
        const orderId = uuidv4()
        let relatedRewardId = null
        let rewardsModelSnapshot = null

        if (userProfile?.widget_info?.app_id) {
            const app = await this.prisma.apps.findUnique({
                where: { app_id: userProfile.widget_info.app_id },
            })
            if (!app) {
                throw new BadRequestException("App not found")
            }
            appId = app.app_id
        }

        if (appId) {
            const appBindIp = await this.prisma.app_bind_ips.findFirst({
                where: {
                    app_id: appId,
                },
            })

            if (!appBindIp) {
                throw new BadRequestException("App bind ip not found")
            }

            if (order.reward_token) {
                const pool = await this.rewardsPoolService.getPools({
                    token: order.reward_token,
                    page: "1",
                    page_size: "1",
                })
                if (!pool || pool.pools.length === 0) {
                    throw new BadRequestException("Rewards token not found")
                }

                const tokenIp = await this.prisma.ip_library.findFirst({
                    where: {
                        token_mint: order.reward_token,
                    },
                })

                if (!tokenIp) {
                    throw new BadRequestException("Can not find ip info for this rewards token")
                }

                const IpRelations = await this.prisma.ip_library_child.findFirst({
                    where: {
                        ip_id: tokenIp.id,
                    },
                })

                if (tokenIp.id !== appBindIp.ip_id && IpRelations?.parent_ip !== appBindIp.ip_id) {
                    throw new BadRequestException("This ip is not allowed to be use in current app")
                }

                relatedRewardId = pool.pools[0].id
                rewardsModelSnapshot = await this.rewardsPoolService.getRewardSnapshot(pool.pools[0].token)
            } else {
                const rewardPool = await this.rewardsPoolService.getPools({
                    app_id: appId,
                    page: "1",
                    page_size: "1",
                })
                if (rewardPool && rewardPool.pools.length > 0) {
                    relatedRewardId = rewardPool?.pools?.[0]?.id
                    rewardsModelSnapshot = await this.rewardsPoolService.getRewardSnapshot(
                        rewardPool?.pools?.[0]?.token,
                    )
                }
            }
        }

        const sourceLink = await this.linkService.getLinkByDeviceId(userProfile.device_id)

        const record = await this.prisma.orders.create({
            data: {
                order_id: orderId,
                owner: userProfile.usernameShorted,
                widget_tag: userProfile.widget_info?.widget_tag || "",
                app_id: appId,
                amount: order.amount,
                description: order.description,
                related_reward_id: relatedRewardId,
                rewards_model_snapshot: rewardsModelSnapshot as any,
                release_rewards_after_paid: order?.release_rewards_after_paid,
                current_status: OrderStatus.PENDING,
                supported_payment_method: OrderService.paymentMethod,
                redirect_url: order.redirect_url,
                callback_url: order.callback_url,
                expire_time: new Date(Date.now() + 1000 * 60 * 15), //order will cancel after 15 minutes
                from_source_link: sourceLink,
            },
        })
        return await this.mapOrderDetail(record)
    }

    async mapOrderDetail(data: orders): Promise<OrderDetailDto> {
        const orderUrl = `${process.env.FRONTEND_URL}/order?orderId=${data.order_id}`
        const snapshot = data.rewards_model_snapshot as unknown as RewardSnapshotDto
        let current_reward_pool_detail = null
        if (snapshot?.token) {
            const rewardPool = await this.rewardsPoolService.getPools({
                token: snapshot.token,
                page: "1",
                page_size: "1",
            })
            current_reward_pool_detail = rewardPool?.pools?.length > 0 ? rewardPool?.pools[0] : null
        }
        return {
            order_id: data.order_id,
            owner: data.owner,
            widget_tag: data.widget_tag,
            app_id: data.app_id,
            amount: data.amount,
            description: data.description,
            current_status: data.current_status as OrderStatus,
            created_at: data.created_at,
            updated_at: data.updated_at,
            paid_method: data.paid_method,
            related_reward_id: data.related_reward_id,
            supported_payment_method: data.supported_payment_method as string[],
            redirect_url: data.redirect_url,
            paid_time: data.paid_time,
            expire_time: data.expire_time,
            cancelled_time: data.cancelled_time,
            cancelled_detail: data.cancelled_detail,
            rewards_model_snapshot: data.rewards_model_snapshot as unknown as any,
            release_rewards_after_paid: data.release_rewards_after_paid,
            order_url: orderUrl,
            from_source_link: data.from_source_link,
            source_link_summary: await this.linkService.getLinkSummary(data.from_source_link),
            current_reward_pool_detail: current_reward_pool_detail,
        }
    }

    async getOrderDetail(orderId: string, userInfo: UserJwtExtractDto): Promise<OrderDetailDto> {
        if (!orderId) {
            throw new BadRequestException("Order id is required")
        }

        let where = { order_id: orderId }

        if (userInfo.developer_info) {
            where["widget_tag"] = userInfo.developer_info.tag
        } else {
            where["owner"] = userInfo.usernameShorted
        }

        //todo: permission check
        const record = await this.prisma.orders.findUnique({
            where,
        })
        if (!record) {
            throw new NotFoundException("Order not found")
        }
        return await this.mapOrderDetail(record)
    }

    async getOrderList(query: OrderListQueryDto, userInfo: UserJwtExtractDto): Promise<OrderListDto> {
        const userProfile = await this.userService.getProfile(userInfo)
        let where = {}
        if (userInfo.developer_info) {
            //if user is developer, it will return all orders of specific widget tag
            where = { widget_tag: userInfo.developer_info.tag }
        } else {
            where = { owner: userProfile.usernameShorted }
            if (userProfile.widget_info?.app_id) {
                where["app_id"] = userProfile.widget_info.app_id
            }

            if (userProfile.widget_info?.widget_tag) {
                where["widget_tag"] = userProfile.widget_info.widget_tag
            }

            if (query.status) {
                where["current_status"] = query.status
            } else {
                where["current_status"] = { not: OrderStatus.CANCELLED }
            }
        }

        const orders = await this.prisma.orders.findMany({
            where,
            skip: Math.max(0, parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
            orderBy: {
                created_at: "desc",
            },
        })

        const total = await this.prisma.orders.count({
            where,
        })
        return {
            orders: await Promise.all(orders.map(async (order) => await this.mapOrderDetail(order))),
            total,
        }
    }

    async payWithWallet(order: PayWithWalletRequestDto, userInfo: UserJwtExtractDto): Promise<OrderDetailDto> {
        const userProfile = await this.userService.getProfile(userInfo)
        const orderId = order.order_id
        const {
            allow,
            message,
            order: orderRecord,
        } = await this.allowPayOrder(orderId, userProfile, PaymentMethod.WALLET)
        if (!allow) {
            throw new BadRequestException(message)
        }

        const userBalance = await this.giggleService.getUsdcBalance(userProfile)
        if (userBalance.balance * 100 < orderRecord.amount) {
            throw new BadRequestException("Insufficient balance")
        }

        const walletPaidDetail = await this.giggleService.payment({
            amount: orderRecord.amount / 100,
            user: userProfile.usernameShorted,
        })

        const walletPaidCallback = await this.giggleService.paymentCallback({
            sn: walletPaidDetail.sn,
            status: ConfirmStatus.CONFIRMED,
        })

        await this.prisma.orders.update({
            where: { id: orderRecord.id },
            data: {
                current_status: OrderStatus.COMPLETED,
                paid_method: PaymentMethod.WALLET,
                paid_time: new Date(),
                wallet_paid_detail: {
                    paid_detail: walletPaidDetail as any,
                    callback_detail: walletPaidCallback as any,
                },
            },
        })

        await this.updateBindRewards(orderRecord) // we need update bind rewards price after paid

        if (orderRecord.release_rewards_after_paid) {
            await this.releaseRewards(orderRecord)
        }

        await this.processCallback(orderRecord.order_id, orderRecord.callback_url)
        return await this.mapOrderDetail(orderRecord)
    }

    async payOrderWithStripe(
        order: PayWithStripeRequestDto,
        userInfo: UserJwtExtractDto,
    ): Promise<PayWithStripeResponseDto> {
        const userProfile = await this.userService.getProfile(userInfo)
        const orderId = order.order_id
        const {
            allow,
            message,
            order: orderRecord,
        } = await this.allowPayOrder(orderId, userProfile, PaymentMethod.STRIPE)
        if (!allow) {
            throw new BadRequestException(message)
        }

        const customer = await this.prisma.users.findFirst({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
            select: {
                stripe_customer_id: true,
            },
        })
        if (!customer.stripe_customer_id) {
            const customerCreated = await this.stripe.customers.create({
                email: userInfo.email,
            })
            await this.prisma.users.update({
                where: {
                    username_in_be: userInfo.usernameShorted,
                },
                data: { stripe_customer_id: customerCreated.id },
            })
            customer.stripe_customer_id = customerCreated.id
        }

        const returnUrl = `${process.env.FRONTEND_URL}/order?orderId=${orderRecord.order_id}&session_id={CHECKOUT_SESSION_ID}`
        const successUrl = returnUrl

        const metadata = {
            id: orderId,
            username: userInfo.usernameShorted,
            order_id: orderRecord.order_id,
        }

        const stripeSessionParams: Stripe.Checkout.SessionCreateParams = {
            client_reference_id: orderId,
            customer: customer.stripe_customer_id,
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: "Pay for order",
                            description: `Pay for order ${orderRecord.order_id}`,
                        },
                        unit_amount: orderRecord.amount,
                    },
                    quantity: 1,
                },
            ],
            mode: "payment",
            ui_mode: "embedded",
            invoice_creation: {
                enabled: true,
                invoice_data: {
                    metadata: metadata,
                },
            },
            metadata: metadata,
            //cancel_url: cancelUrl,
            //success_url: successUrl,
            return_url: returnUrl,
            expires_at: Math.floor(orderRecord.expire_time.getTime() / 1000 + 30 * 60),
        }

        const stripeSession = await this.stripe.checkout.sessions.create(stripeSessionParams)
        return {
            clientSecret: stripeSession.client_secret,
        }
    }

    //stripe session status
    async getStripeSessionStatus(sessionId: string) {
        const session = await this.stripe.checkout.sessions.retrieve(sessionId)
        const orderId = session.client_reference_id
        const order = await this.prisma.orders.findUnique({
            where: { order_id: orderId },
        })
        if (order && order.current_status === OrderStatus.PENDING && session.status === "complete") {
            await this.prisma.orders.update({
                where: { id: order.id },
                data: {
                    current_status: OrderStatus.COMPLETED,
                    paid_method: PaymentMethod.STRIPE,
                    paid_time: new Date(),
                },
            })
        }
        return {
            status: session.status,
        }
    }

    async getRewardsDetail(orderId: string, statementId: string): Promise<OrderRewardsDto[]> {
        let where = {}
        if (orderId) {
            const order = await this.prisma.orders.findUnique({
                where: { order_id: orderId },
            })
            if (!order) {
                throw new NotFoundException("Order not found")
            }
            where["order_id"] = orderId
        }

        const statementIdInt = parseInt(statementId)
        if (statementIdInt) {
            const statement = await this.prisma.reward_pool_statement.findUnique({
                where: { id: statementIdInt },
            })
            if (!statement) {
                throw new NotFoundException("Statement not found")
            }
            where["statement_id"] = statementIdInt
        }

        return this.mapRewardsDetail(
            await this.prisma.user_rewards.findMany({
                where: where,
                include: {
                    user_info: true,
                },
            }),
        )
    }

    mapRewardsDetail(rewards: (user_rewards & { user_info: users })[]): OrderRewardsDto[] {
        return rewards.map((reward) => ({
            id: reward.id,
            order_id: reward.order_id,
            statement_id: reward.statement_id,
            rewards_type: reward.rewards_type,
            user_info: {
                username: reward?.user_info?.username,
                avatar: reward?.user_info?.avatar,
                email: reward?.user_info?.email,
            },
            wallet_address: reward.wallet_address,
            rewards: reward.rewards.toString(),
            token: reward.token,
            ticker: reward.ticker,
            role: reward.role as RewardAllocateRoles,
            expected_role: reward.expected_role as RewardAllocateRoles,
            note: reward.note,
            created_at: reward.created_at,
            updated_at: reward.updated_at,
            start_allocate: reward.start_allocate,
            end_allocate: reward.end_allocate,
            released_per_day: reward.released_per_day.toString(),
            released_rewards: reward.released_rewards.toString(),
            locked_rewards: reward.locked_rewards.toString(),
            withdraw_rewards: reward.withdraw_rewards.toString(),
        }))
    }

    //stripe webhook
    async recordStripeEvent(req: RawBodyRequest<Request>) {
        try {
            const sig = req.headers["stripe-signature"]
            if (!sig) {
                throw new BadRequestException("Invalid stripe signature")
            }
            const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
            const event = this.stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret)
            return await this.prisma.stripe_webhook_log.create({
                data: {
                    type: event.type,
                    raw_data: JSON.parse(JSON.stringify(event)),
                    status: "pending",
                },
            })
        } catch (error) {
            this.logger.error("Error in recordStripeEvent:", error)
            throw new InternalServerErrorException("Failed to record stripe event")
        }
    }

    @Cron(CronExpression.EVERY_SECOND)
    //check if the order is expired
    async cancelExpiredOrders() {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        const orders = await this.prisma.orders.findMany({
            where: {
                expire_time: { lt: new Date() },
                current_status: OrderStatus.PENDING,
            },
        })
        if (orders.length === 0) {
            return
        }
        this.logger.log(`Found ${orders.length} expired orders`)
        for (const order of orders) {
            await this.prisma.orders.update({
                where: { id: order.id },
                data: {
                    current_status: OrderStatus.CANCELLED,
                    cancelled_time: new Date(),
                    cancelled_detail: {
                        reason: "Order expired",
                    },
                },
            })
            await this.processCallback(order.order_id, order.callback_url)
        }
        this.logger.log(`Cancelled ${orders.length} expired orders`)
    }

    async allowPayOrder(
        orderId: string,
        profile: UserJwtExtractDto,
        method: PaymentMethod,
    ): Promise<{ allow: boolean; message: string; order: orders }> {
        const order = await this.prisma.orders.findUnique({
            where: { order_id: orderId, owner: profile.usernameShorted },
        })
        if (!order) {
            return { allow: false, message: "Order not found", order: null }
        }
        if (order.owner !== profile.usernameShorted) {
            return { allow: false, message: "You are not the owner of this order", order: null }
        }
        if (order.current_status !== OrderStatus.PENDING) {
            return { allow: false, message: "Order is not pending", order: null }
        }
        if (!(order.supported_payment_method as string[]).includes(method)) {
            return { allow: false, message: `This order is not supported to pay with ${method}`, order: null }
        }
        return { allow: true, message: "You can pay this order", order: order }
    }

    async stripeInvoicePaid(localRecordId: number) {
        const localRecord = await this.prisma.stripe_webhook_log.findUnique({
            where: { id: localRecordId },
        })
        const invoice = (localRecord.raw_data as any).data.object as Stripe.Invoice
        const orderId = invoice.metadata.order_id
        const order = await this.prisma.orders.findUnique({
            where: { order_id: orderId },
        })
        if (!order) {
            this.logger.error(`Order not found for invoice ${invoice.id}`)
            return
        }
        await this.prisma.orders.update({
            where: { id: order.id },
            data: {
                current_status: OrderStatus.COMPLETED,
                paid_method: PaymentMethod.STRIPE,
                paid_time: new Date(),
                stripe_invoice_id: invoice.id,
                stripe_invoice_detail: invoice as any,
            },
        })

        //update bind rewards price
        await this.updateBindRewards(order)

        if (order.release_rewards_after_paid) {
            await this.releaseRewards(order)
        }
        await this.processCallback(order.order_id, order.callback_url)
    }

    async updateBindRewards(order: orders) {
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order.order_id },
        })
        if (!orderRecord || !orderRecord.rewards_model_snapshot) {
            return
        }
        const snapshot = orderRecord.rewards_model_snapshot as unknown as RewardSnapshotDto
        const token = snapshot?.token
        if (!token) {
            return
        }
        const tokenInfo = await this.giggleService.getIpTokenList({
            mint: token,
            page: "1",
            page_size: "1",
            site: "3body",
        })

        if (!tokenInfo || !tokenInfo.data || !tokenInfo.data.length) {
            return
        }

        const resData = tokenInfo.data
        const unitPrice = resData?.[0]?.price
        if (new Decimal(unitPrice).eq(snapshot.unit_price)) {
            return
        }
        await this.prisma.orders.update({
            where: { id: order.id },
            data: {
                rewards_model_snapshot: {
                    ...snapshot,
                    unit_price: unitPrice.toString(),
                } as any,
            },
        })
    }

    async stripeSessionCompleted(localRecordId: number) {
        const localRecord = await this.prisma.stripe_webhook_log.findUnique({
            where: { id: localRecordId },
        })
        const session = (localRecord.raw_data as any).data.object as Stripe.Checkout.Session
        const orderId = session.client_reference_id
        const order = await this.prisma.orders.findUnique({
            where: { order_id: orderId },
        })
        if (!order) {
            this.logger.error(`Order not found for session ${session.id}`)
            return
        }
        await this.prisma.orders.update({
            where: { id: order.id },
            data: {
                current_status: OrderStatus.COMPLETED,
                paid_method: PaymentMethod.STRIPE,
                paid_time: new Date(),
            },
        })
        //await this.processCallback(order.order_id)
    }

    async processCallback(orderId: string, callbackUrl: string): Promise<OrderCallbackDto> {
        const order = await this.prisma.orders.findUnique({
            where: { order_id: orderId },
        })
        if (!order || !callbackUrl) {
            return
        }
        const orderDetail: OrderCallbackDto = {
            ...(await this.mapOrderDetail(order)),
            jwt_verify: "",
        }

        //if order is from widget, we need add a jwt verify field to the order detail
        if (order.widget_tag) {
            const widgetInfo = await this.prisma.widgets.findUnique({
                where: { tag: order.widget_tag },
            })
            if (widgetInfo) {
                const signInfo = {
                    iss: widgetInfo.access_key,
                    exp: Math.floor(Date.now() / 1000) + 60 * 5, //5 minutes
                    nbf: Math.floor(Date.now() / 1000) - 5, // 5 seconds before now
                }
                orderDetail.jwt_verify = await this.jwtService.signAsync(signInfo, {
                    secret: widgetInfo.secret_key,
                })
            }
        }

        try {
            const request = await lastValueFrom(this.httpService.post(callbackUrl, orderDetail))
            await this.prisma.order_callback_record.create({
                data: {
                    order_id: orderId,
                    callback_url: callbackUrl,
                    request: orderDetail as any,
                    response: request.data,
                },
            })
        } catch (error) {
            await this.prisma.order_callback_record.create({
                data: {
                    order_id: orderId,
                    callback_url: callbackUrl,
                    request: orderDetail as any,
                    response: error,
                },
            })
        }

        return orderDetail
    }

    async resendCallback(order: ResendCallbackRequestDto, userInfo: UserJwtExtractDto): Promise<OrderCallbackDto> {
        const { order_id, new_callback_url } = order
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order_id },
        })

        if (!orderRecord) {
            throw new NotFoundException("Order not found")
        }

        if (!new_callback_url && !orderRecord.callback_url) {
            throw new BadRequestException("Order has no callback url")
        }

        let callbackUrl = new_callback_url || orderRecord.callback_url

        //check permission
        let allow = false
        if (orderRecord.owner === userInfo.usernameShorted || userInfo.is_admin) {
            allow = true
        }

        if (userInfo.developer_info && userInfo.developer_info.tag === orderRecord.widget_tag) {
            allow = true
        }

        if (!allow) {
            throw new ForbiddenException("You are not allowed to resend callback")
        }

        return await this.processCallback(orderRecord.order_id, callbackUrl)
    }

    async bindRewardPoolByUser(order: BindRewardPoolDto, userInfo: UserJwtExtractDto): Promise<OrderDetailDto> {
        const { order_id } = order
        let orderRecord = null
        if (userInfo.developer_info) {
            orderRecord = await this.prisma.orders.findUnique({
                where: { widget_tag: userInfo.developer_info.tag, order_id: order_id },
            })
        } else {
            orderRecord = await this.prisma.orders.findUnique({
                where: { order_id: order_id, owner: userInfo.usernameShorted },
            })
        }
        if (!orderRecord) {
            throw new NotFoundException("Order not found")
        }
        return await this.bindRewardPool(order)
    }

    async bindRewardPool(order: BindRewardPoolDto): Promise<OrderDetailDto> {
        const { order_id } = order
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order_id },
        })
        if (!orderRecord || !orderRecord.app_id) {
            throw new NotFoundException("Order not found")
        }
        if (![OrderStatus.COMPLETED, OrderStatus.PENDING].includes(orderRecord.current_status as OrderStatus)) {
            throw new BadRequestException("Order is not completed or pending")
        }

        if (orderRecord.related_reward_id) {
            throw new BadRequestException("Order already has a reward pool, unbind it first")
        }

        const rewardPool = await this.rewardsPoolService.getPools({
            app_id: orderRecord.app_id,
            page: "1",
            page_size: "1",
        })
        if (!rewardPool.pools.length) {
            throw new BadRequestException("No reward pool found")
        }
        const rewardPoolId = rewardPool.pools[0].id
        const snapshot = await this.rewardsPoolService.getRewardSnapshot(rewardPool.pools[0].token)

        return await this.mapOrderDetail(
            await this.prisma.orders.update({
                where: { id: orderRecord.id },
                data: {
                    related_reward_id: rewardPoolId,
                    rewards_model_snapshot: snapshot as any,
                },
            }),
        )
    }

    async unbindRewardPool(order: UnbindRewardPoolDto): Promise<OrderDetailDto> {
        const { order_id } = order
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order_id },
        })
        if (!orderRecord) {
            throw new NotFoundException("Order not found")
        }
        if (orderRecord.current_status === OrderStatus.REWARDS_RELEASED) {
            throw new BadRequestException("Order rewards is already released")
        }
        return await this.mapOrderDetail(
            await this.prisma.orders.update({
                where: { id: orderRecord.id },
                data: {
                    related_reward_id: null,
                    rewards_model_snapshot: null,
                },
            }),
        )
    }

    async releaseRewardsByUser(order: ReleaseRewardsDto, userInfo: UserJwtExtractDto): Promise<OrderRewardsDto[]> {
        let orderRecord = null
        if (userInfo.developer_info) {
            orderRecord = await this.prisma.orders.findFirst({
                where: { widget_tag: userInfo.developer_info.tag, order_id: order.order_id },
            })
        } else {
            orderRecord = await this.prisma.orders.findFirst({
                where: { owner: userInfo.usernameShorted, order_id: order.order_id },
            })
        }
        if (!orderRecord) {
            throw new NotFoundException("Order not found")
        }
        return await this.releaseRewardsRequest(orderRecord)
    }

    async releaseRewardsRequest(order: ReleaseRewardsDto): Promise<OrderRewardsDto[]> {
        const { order_id } = order
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order_id },
        })
        if (!orderRecord) {
            this.logger.error(`Order ${order_id} not found`)
            throw new NotFoundException("Order not found")
        }
        if (orderRecord.current_status !== OrderStatus.COMPLETED) {
            this.logger.error(`Order ${order_id} is not completed`)
            throw new BadRequestException("Order is not completed")
        }
        if (!orderRecord.related_reward_id || !orderRecord.rewards_model_snapshot) {
            this.logger.error(`Order ${order_id} has no reward pool`)
            throw new BadRequestException("Order has no reward pool")
        }

        const modelSnapshot = orderRecord.rewards_model_snapshot as unknown as RewardSnapshotDto

        const rewardPool = await this.prisma.reward_pools.findFirst({
            where: {
                token: modelSnapshot.token,
            },
        })
        if (!rewardPool) {
            this.logger.error(`Reward pool not found for order ${order_id}`)
            throw new BadRequestException("Reward pool not found")
        }

        //get newest unit price
        const unitPriceResponse = await this.giggleService.getIpTokenList({
            mint: modelSnapshot.token,
            page: "1",
            page_size: "1",
            site: "3body",
        })

        if (
            !unitPriceResponse ||
            !unitPriceResponse.data ||
            !unitPriceResponse.data.length ||
            !unitPriceResponse.data?.[0]?.price
        ) {
            this.logger.error(`Unit price not found for order ${order_id}`)
            throw new BadRequestException("Unit price not found")
        }

        return await this.releaseRewards(order, new Decimal(unitPriceResponse.data[0].price))
    }

    async releaseRewards(order: ReleaseRewardsDto, unitPrice: Decimal = null): Promise<OrderRewardsDto[]> {
        const { order_id } = order
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order_id },
        })
        if (!orderRecord) {
            this.logger.error(`Order ${order_id} not found`)
            return []
        }
        if (orderRecord.current_status !== OrderStatus.COMPLETED) {
            this.logger.error(`Order ${order_id} is not completed`)
            return []
        }
        if (!orderRecord.related_reward_id || !orderRecord.rewards_model_snapshot) {
            this.logger.error(`Order ${order_id} has no reward pool`)
            return []
        }

        const modelSnapshot = orderRecord.rewards_model_snapshot as unknown as RewardSnapshotDto

        const rewardPool = await this.prisma.reward_pools.findFirst({
            where: {
                token: modelSnapshot.token,
            },
        })
        if (!rewardPool) {
            this.logger.error(`Reward pool not found for order ${order_id}`)
            return []
        }

        let rewards: Prisma.user_rewardsCreateManyInput[] = []
        const currentDate = new Date(Date.now())
        const releaseEndTime = new Date(currentDate.getTime() + 180 * 24 * 60 * 60 * 1000) //180 days

        if (!unitPrice) {
            //get newest unit price
            const unitPriceResponse = await this.giggleService.getIpTokenList({
                mint: modelSnapshot.token,
                page: "1",
                page_size: "1",
                site: "3body",
            })

            if (
                !unitPriceResponse ||
                !unitPriceResponse.data ||
                !unitPriceResponse.data.length ||
                !unitPriceResponse.data?.[0]?.price
            ) {
                this.logger.error(`Unit price not found for order ${order_id}`)
                return []
            }
            unitPrice = new Decimal(unitPriceResponse.data[0].price)
        }

        //allocate order creator's rewards
        const orderAmount = new Decimal(orderRecord.amount).div(100)
        let creatorNote = ""
        let orderCreatorRewards = orderAmount.div(unitPrice)
        //external rewards
        if (modelSnapshot?.limit_offer?.external_ratio) {
            orderCreatorRewards = orderAmount
                .mul(new Decimal(modelSnapshot.limit_offer.external_ratio))
                .div(unitPrice)
                .div(100)
            creatorNote = `External ratio: ${modelSnapshot.limit_offer.external_ratio}%`
        }
        let currentRewardPoolBalance = new Decimal(rewardPool.current_balance)

        if (orderCreatorRewards.gt(currentRewardPoolBalance)) {
            orderCreatorRewards = Decimal.min(orderCreatorRewards, currentRewardPoolBalance)
            creatorNote = "Reward pool balance is not enough, only allocate part of the rewards"
        }
        currentRewardPoolBalance = Decimal.max(currentRewardPoolBalance.minus(orderCreatorRewards), new Decimal(0))

        rewards.push({
            order_id: orderRecord.order_id,
            user: orderRecord.owner,
            role: "order_creator",
            token: modelSnapshot.token,
            ticker: modelSnapshot.ticker,
            wallet_address: "",
            rewards: orderCreatorRewards,
            start_allocate: currentDate,
            end_allocate: releaseEndTime,
            released_per_day: orderCreatorRewards.div(180), //token rewards is released in 180 days
            released_rewards: 0,
            locked_rewards: orderCreatorRewards,
            allocate_snapshot: modelSnapshot as any,
            withdraw_rewards: 0,
            note: creatorNote,
        })

        let allocatedUSDCAmount = new Decimal(0)
        let allocatedTokenAmount = orderCreatorRewards

        for (const reward of modelSnapshot.revenue_ratio) {
            //to ensure usdc not overflow, we need process platform rewards at final
            if (reward.role === RewardAllocateRoles.PLATFORM) {
                continue
            }
            const rewardUSDAmount = this._calculateUSDCRewards(reward, orderRecord)
            const rewardType = reward.allocate_type as unknown as RewardAllocateType

            const { user, address, expectedAllocateRole, actualAllocateRole, note } = await this.getUser(
                orderRecord,
                reward,
                rewardPool.owner,
            )
            if (rewardType === RewardAllocateType.USDC) {
                const currentDate = new Date()
                rewards.push({
                    order_id: orderRecord.order_id,
                    user: user,
                    role: actualAllocateRole,
                    expected_role: expectedAllocateRole,
                    token: process.env.GIGGLE_LEGAL_USDC,
                    ticker: "usdc",
                    wallet_address: address,
                    rewards: rewardUSDAmount,
                    start_allocate: currentDate,
                    end_allocate: currentDate, //usdc is released immediately
                    released_per_day: rewardUSDAmount,
                    released_rewards: rewardUSDAmount,
                    locked_rewards: 0,
                    allocate_snapshot: modelSnapshot as any,
                    withdraw_rewards: 0,
                    note: note,
                })
            } else {
                let buybackNote = note
                //we only allocate token to user not buyback
                if (actualAllocateRole !== RewardAllocateRoles.BUYBACK) {
                    //check balance
                    let rewardTokenAmount = rewardUSDAmount.div(unitPrice)
                    let tokenNote = note
                    //check balance
                    if (rewardTokenAmount.gt(currentRewardPoolBalance)) {
                        rewardTokenAmount = currentRewardPoolBalance
                        tokenNote = tokenNote + "Reward pool balance is not enough, only allocate part of the rewards"
                    }

                    currentRewardPoolBalance = Decimal.max(
                        currentRewardPoolBalance.minus(rewardTokenAmount),
                        new Decimal(0),
                    )

                    rewards.push({
                        order_id: orderRecord.order_id,
                        user: user,
                        role: actualAllocateRole,
                        expected_role: expectedAllocateRole,
                        token: modelSnapshot.token,
                        ticker: modelSnapshot.ticker,
                        wallet_address: address,
                        rewards: rewardTokenAmount,
                        start_allocate: currentDate,
                        end_allocate: releaseEndTime,
                        released_per_day: rewardTokenAmount.div(180), //token rewards is released in 180 days
                        released_rewards: 0,
                        locked_rewards: rewardTokenAmount,
                        allocate_snapshot: modelSnapshot as any,
                        withdraw_rewards: 0,
                        note: tokenNote,
                    })
                    buybackNote = `We need to allocate ${rewardTokenAmount} ${modelSnapshot.ticker} to the ${expectedAllocateRole} in order to give the ${actualAllocateRole} the corresponding token rewards.`
                    allocatedTokenAmount = allocatedTokenAmount.plus(rewardTokenAmount)
                }

                //whatever the role is, we need to allocate usdc to buyback account
                rewards.push({
                    order_id: orderRecord.order_id,
                    user: "",
                    role: RewardAllocateRoles.BUYBACK,
                    expected_role: expectedAllocateRole,
                    token: process.env.GIGGLE_LEGAL_USDC,
                    ticker: "usdc",
                    wallet_address: process.env.BUYBACK_WALLET,
                    rewards: rewardUSDAmount,
                    start_allocate: currentDate,
                    end_allocate: currentDate,
                    released_per_day: rewardUSDAmount,
                    released_rewards: rewardUSDAmount,
                    locked_rewards: 0,
                    allocate_snapshot: modelSnapshot as any,
                    withdraw_rewards: 0,
                    note: buybackNote,
                })
            }
            allocatedUSDCAmount = allocatedUSDCAmount.plus(rewardUSDAmount)
        }

        //add platform rewards
        const platformRewards = orderAmount.minus(allocatedUSDCAmount)
        rewards.push({
            order_id: orderRecord.order_id,
            user: "",
            role: RewardAllocateRoles.PLATFORM,
            expected_role: RewardAllocateRoles.PLATFORM,
            token: process.env.GIGGLE_LEGAL_USDC,
            ticker: "usdc",
            wallet_address: process.env.PLATFORM_WALLET,
            rewards: platformRewards,
            start_allocate: currentDate,
            end_allocate: currentDate, //usdc is released immediately
            released_per_day: platformRewards,
            released_rewards: platformRewards,
            locked_rewards: 0,
            allocate_snapshot: modelSnapshot as any,
            withdraw_rewards: 0,
            note: "",
        })

        // check pool balance
        // todo: maybe this will be removed, rewards pool allow negative balance
        if (rewardPool.current_balance.lt(allocatedTokenAmount)) {
            throw new BadRequestException("Reward pool balance is not enough")
        }
        const newPoolBalance = rewardPool.current_balance.minus(allocatedTokenAmount)
        const newRewardedAmount = rewardPool.rewarded_amount.plus(allocatedTokenAmount)

        //create rewards for the order
        await this.prisma.$transaction(async (tx) => {
            await tx.orders.update({
                where: { id: orderRecord.id },
                data: {
                    current_status: OrderStatus.REWARDS_RELEASED,
                },
            })
            await tx.reward_pools.update({
                data: {
                    current_balance: newPoolBalance,
                    rewarded_amount: newRewardedAmount,
                },
                where: {
                    id: rewardPool.id,
                },
            })
            const statement = await tx.reward_pool_statement.create({
                data: {
                    token: modelSnapshot.token,
                    widget_tag: orderRecord.widget_tag,
                    amount: allocatedTokenAmount.mul(new Decimal(-1)),
                    usd_revenue: orderAmount,
                    unit_price: modelSnapshot.unit_price,
                    related_order_id: orderRecord.order_id,
                    type: "released",
                    current_balance: newPoolBalance,
                },
            })
            await tx.user_rewards.createMany({
                data: rewards.map((reward) => ({
                    ...reward,
                    statement_id: statement.id,
                })),
            })
        })

        //todo: settle rewards
        return this.mapRewardsDetail(
            await this.prisma.user_rewards.findMany({
                where: {
                    order_id: orderRecord.order_id,
                },
                include: {
                    user_info: true,
                },
            }),
        )
    }

    _calculateUSDCRewards(reward: RewardAllocateRatio, orderRecord: orders): Decimal {
        return new Decimal(orderRecord.amount).mul(new Decimal(reward.ratio)).div(100).div(100)
    }

    async getUser(
        orderRecord: orders,
        allocateRatio: RewardAllocateRatio,
        ipHolder: string,
    ): Promise<{
        user: string
        address: string
        actualAllocateRole: RewardAllocateRoles
        expectedAllocateRole: RewardAllocateRoles
        note: string
    }> {
        switch (allocateRatio.role) {
            case RewardAllocateRoles.BUYBACK:
                return {
                    user: "",
                    address: process.env.BUYBACK_WALLET,
                    expectedAllocateRole: RewardAllocateRoles.BUYBACK,
                    actualAllocateRole: RewardAllocateRoles.BUYBACK,
                    note: "",
                }
            case RewardAllocateRoles.IPHOLDER:
                return {
                    user: ipHolder,
                    address: "",
                    expectedAllocateRole: RewardAllocateRoles.IPHOLDER,
                    actualAllocateRole: RewardAllocateRoles.IPHOLDER,
                    note: "",
                }
            /*
            case RewardAllocateRoles.INVITER:
                if (!orderRecord.from_source_link) {
                    return {
                        user: "",
                        address: process.env.BUYBACK_WALLET,
                        expectedAllocateRole: RewardAllocateRoles.INVITER,
                        actualAllocateRole: RewardAllocateRoles.BUYBACK,
                        note: "Inviter not found, reward to buyback wallet",
                    }
                }

                //new user and first order
                const link = await this.prisma.app_links.findFirst({
                    where: {
                        unique_str: orderRecord.from_source_link,
                    },
                })

                if (!link) {
                    return {
                        user: "",
                        address: process.env.BUYBACK_WALLET,
                        expectedAllocateRole: RewardAllocateRoles.INVITER,
                        actualAllocateRole: RewardAllocateRoles.BUYBACK,
                        note: "Inviter not found, reward to buyback wallet",
                    }
                }

                if (link && link.creator === orderRecord.owner) {
                    return {
                        user: "",
                        address: "",
                        expectedAllocateRole: RewardAllocateRoles.INVITER,
                        actualAllocateRole: RewardAllocateRoles.INVITER,
                        note: "Can not invite yourself",
                    }
                }

                const user = await this.prisma.users.findFirst({
                    where: {
                        username_in_be: orderRecord.owner,
                    },
                })

                //check if user is invited by link.
                if (!user.from_source_link) {
                    return {
                        user: "",
                        address: process.env.BUYBACK_WALLET,
                        expectedAllocateRole: RewardAllocateRoles.INVITER,
                        actualAllocateRole: RewardAllocateRoles.BUYBACK,
                        note: "Inviter not found, reward to buyback wallet",
                    }
                }

                let isFirstOrder = false
                const orders = await this.prisma.orders.findMany({
                    where: {
                        owner: user.username_in_be,
                        current_status: {
                            in: [OrderStatus.COMPLETED, OrderStatus.REWARDS_RELEASED],
                        },
                    },
                    orderBy: {
                        id: "asc",
                    },
                    take: 1,
                })

                if (orders && orders.length > 0 && orders[0].id === orderRecord.id) {
                    isFirstOrder = true
                }

                const inviteUsersLink = await this.prisma.app_links.findFirst({
                    where: {
                        unique_str: user.from_source_link,
                    },
                })

                if (inviteUsersLink && isFirstOrder && inviteUsersLink.creator === link.creator) {
                    return {
                        user: link.creator,
                        address: "",
                        expectedAllocateRole: RewardAllocateRoles.INVITER,
                        actualAllocateRole: RewardAllocateRoles.INVITER,
                        note: "",
                    }
                } else {
                    return {
                        user: "",
                        address: process.env.BUYBACK_WALLET,
                        expectedAllocateRole: RewardAllocateRoles.INVITER,
                        actualAllocateRole: RewardAllocateRoles.BUYBACK,
                        note: "Inviter not found, reward to buyback wallet",
                    }
                }

            case RewardAllocateRoles.DEVELOPER:
                if (!orderRecord.widget_tag) {
                    return {
                        user: "",
                        address: process.env.BUYBACK_WALLET,
                        expectedAllocateRole: RewardAllocateRoles.DEVELOPER,
                        actualAllocateRole: RewardAllocateRoles.BUYBACK,
                        note: "Widget tag not found, reward to buyback wallet",
                    }
                }
                const widget = await this.prisma.widgets.findFirst({
                    where: {
                        tag: orderRecord.widget_tag,
                    },
                })
                if (!widget) {
                    return {
                        user: "",
                        address: process.env.BUYBACK_WALLET,
                        expectedAllocateRole: RewardAllocateRoles.DEVELOPER,
                        actualAllocateRole: RewardAllocateRoles.BUYBACK,
                        note: "Widget not found, reward to buyback wallet",
                    }
                }
                return {
                    user: widget.author,
                    address: "",
                    expectedAllocateRole: RewardAllocateRoles.DEVELOPER,
                    actualAllocateRole: RewardAllocateRoles.DEVELOPER,
                    note: "",
                }
            */
            case RewardAllocateRoles.CUSTOMIZED:
                return {
                    user: "",
                    address: allocateRatio.address,
                    expectedAllocateRole: RewardAllocateRoles.CUSTOMIZED,
                    actualAllocateRole: RewardAllocateRoles.CUSTOMIZED,
                    note: "",
                }
            default:
                return {
                    user: "",
                    address: "",
                    expectedAllocateRole: RewardAllocateRoles.BUYBACK,
                    actualAllocateRole: RewardAllocateRoles.BUYBACK,
                    note: "unknown role, reward to buyback wallet",
                }
        }
    }

    //@Cron(CronExpression.EVERY_MINUTE)
    async bindAllOrdersToRewardPool() {
        const orders = await this.prisma.orders.findMany({
            where: {
                current_status: OrderStatus.COMPLETED,
                related_reward_id: null,
            },
        })
        for (const order of orders) {
            try {
                await this.bindRewardPool({ order_id: order.order_id })
            } catch (error) {
                this.logger.error(`Error binding order ${order.order_id} to reward pool: ${error}`)
                continue
            }
        }
    }

    //@Cron(CronExpression.EVERY_MINUTE)
    async releaseAllOrders() {
        const orders = await this.prisma.orders.findMany({
            where: {
                current_status: OrderStatus.COMPLETED,
                related_reward_id: { not: null },
            },
        })
        for (const order of orders) {
            try {
                await this.releaseRewards({ order_id: order.order_id })
            } catch (error) {
                this.logger.error(`Error releasing rewards for order ${order.order_id}: ${error}`)
                continue
            }
        }
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async settleUserRewards() {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        try {
            this.logger.log("Settling user rewards")
            const result = await this.prisma.$queryRaw`
update user_rewards r join (select id,
                                   least(datediff(current_date, start_allocate) *
                                         (rewards / greatest(1, datediff(end_allocate, start_allocate))), rewards) as r_amount
                            from user_rewards) u
    on r.id = u.id
set r.released_rewards=u.r_amount,
    r.locked_rewards=r.rewards - u.r_amount
where r.ticker != 'usdc'
  and r.end_allocate > r.start_allocate
  and r.end_allocate >= current_date;
            `
            this.logger.log(`Settled result: ${result}`)
        } catch (error) {
            this.logger.error(`Error settling user rewards: ${error}`)
        }
    }

    //update user_rewards_withdraw
    async updateUserRewardsWithdraw() {}
}
