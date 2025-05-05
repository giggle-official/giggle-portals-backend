import {
    BadRequestException,
    Injectable,
    RawBodyRequest,
    Logger,
    NotFoundException,
    InternalServerErrorException,
    ForbiddenException,
} from "@nestjs/common"
import {
    BindRewardPoolDto,
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
import { orders, Prisma, user_rewards } from "@prisma/client"
import { UserInfoDTO } from "src/user/user.controller"
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
@Injectable()
export class OrderService {
    public readonly logger = new Logger(OrderService.name)
    public static readonly paymentMethod = [PaymentMethod.STRIPE, PaymentMethod.WALLET]
    constructor(
        private readonly prisma: PrismaService,
        private readonly userService: UserService,
        private readonly giggleService: GiggleService,
        private readonly httpService: HttpService,
        private readonly linkService: LinkService,
        private readonly rewardsPoolService: RewardsPoolService,
        @InjectStripe() private readonly stripe: Stripe,
    ) {}

    async createOrder(
        order: CreateOrderDto,
        userInfo: UserInfoDTO,
        app_id: string = "", // this value will replaced if app_id exists in the user's widget info
    ): Promise<OrderDetailDto> {
        const userProfile = await this.userService.getProfile(userInfo)
        let appId = app_id
        const orderId = uuidv4()
        let relatedRewardId = null
        let rewardsModelSnapshot = null

        if (app_id) {
            const rewardPool = await this.rewardsPoolService.getPools({
                app_id: app_id,
                page: "1",
                page_size: "1",
            })
            if (!rewardPool.pools.length) {
                throw new BadRequestException("No reward pool found")
            }
            relatedRewardId = rewardPool.pools[0].id
            rewardsModelSnapshot = await this.rewardsPoolService.getRewardSnapshot(rewardPool.pools[0].token)
        }

        if (userProfile?.widget_info?.app_id) {
            const app = await this.prisma.apps.findUnique({
                where: { app_id: userProfile.widget_info.app_id },
            })
            if (!app) {
                throw new BadRequestException("App not found")
            }
            appId = app.app_id
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
            order_url: orderUrl,
            from_source_link: data.from_source_link,
            source_link_summary: await this.linkService.getLinkSummary(data.from_source_link),
        }
    }

    async getOrderDetail(orderId: string, userInfo: UserInfoDTO): Promise<OrderDetailDto> {
        if (!orderId) {
            throw new BadRequestException("Order id is required")
        }
        const userProfile = await this.userService.getProfile(userInfo)
        const where = { order_id: orderId, owner: userProfile.usernameShorted }

        if (userProfile.widget_info?.app_id) {
            where["app_id"] = userProfile.widget_info.app_id
        }

        if (userProfile.widget_info?.widget_tag) {
            where["widget_tag"] = userProfile.widget_info.widget_tag
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

    async getOrderList(query: OrderListQueryDto, userInfo: UserInfoDTO): Promise<OrderListDto> {
        const userProfile = await this.userService.getProfile(userInfo)
        const where = { owner: userProfile.usernameShorted }
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

    async payWithWallet(order: PayWithWalletRequestDto, userInfo: UserInfoDTO): Promise<OrderDetailDto> {
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
        await this.processCallback(orderRecord.order_id)
        return await this.mapOrderDetail(orderRecord)
    }

    async payOrderWithStripe(order: PayWithStripeRequestDto, userInfo: UserInfoDTO): Promise<PayWithStripeResponseDto> {
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

    async getRewardsDetail(orderId: string, userInfo: UserInfoDTO): Promise<OrderRewardsDto[]> {
        const order = await this.prisma.orders.findUnique({
            where: { order_id: orderId, owner: userInfo.usernameShorted },
        })
        if (!order) {
            throw new NotFoundException("Order not found")
        }
        return this.mapRewardsDetail(
            await this.prisma.user_rewards.findMany({
                where: { order_id: orderId },
            }),
        )
    }

    mapRewardsDetail(rewards: user_rewards[]): OrderRewardsDto[] {
        return rewards.map((reward) => ({
            id: reward.id,
            order_id: reward.order_id,
            user: reward.user,
            wallet_address: reward.wallet_address,
            rewards: reward.rewards.toString(),
            token: reward.token,
            ticker: reward.ticker,
            role: reward.role as RewardAllocateRoles,
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
            await this.processCallback(order.order_id)
        }
        this.logger.log(`Cancelled ${orders.length} expired orders`)
    }

    async allowPayOrder(
        orderId: string,
        profile: UserInfoDTO,
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
        await this.processCallback(order.order_id)
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

    async processCallback(orderId: string) {
        const order = await this.prisma.orders.findUnique({
            where: { order_id: orderId },
        })
        if (!order || !order.callback_url) {
            return
        }
        const orderDetail = await this.mapOrderDetail(order)
        try {
            const request = await lastValueFrom(this.httpService.post(order.callback_url, orderDetail))
            await this.prisma.order_callback_record.create({
                data: {
                    order_id: orderId,
                    callback_url: order.callback_url,
                    request: orderDetail as any,
                    response: request.data,
                },
            })
        } catch (error) {
            await this.prisma.order_callback_record.create({
                data: {
                    order_id: orderId,
                    callback_url: order.callback_url,
                    request: orderDetail as any,
                    response: error,
                },
            })
        }
    }

    async resendCallback(order: ResendCallbackRequestDto, userInfo: UserInfoDTO): Promise<OrderDetailDto> {
        const { order_id } = order
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order_id },
        })
        const user = await this.prisma.users.findUnique({
            where: { username_in_be: userInfo.usernameShorted },
        })
        if (!orderRecord || !orderRecord.callback_url) {
            throw new NotFoundException("Order or callback url not found")
        }
        if (!user || !user.is_admin) {
            throw new ForbiddenException("You are not allowed to resend callback")
        }
        await this.processCallback(orderRecord.order_id)
        return await this.mapOrderDetail(orderRecord)
    }

    async bindRewardPool(order: BindRewardPoolDto): Promise<OrderDetailDto> {
        const { order_id } = order
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order_id },
        })
        if (!orderRecord || !orderRecord.app_id) {
            throw new NotFoundException("Order not found")
        }
        if (![OrderStatus.COMPLETED, OrderStatus.COMPLETED].includes(orderRecord.current_status as OrderStatus)) {
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

    async releaseRewards(order: ReleaseRewardsDto): Promise<OrderRewardsDto[]> {
        const { order_id } = order
        const orderRecord = await this.prisma.orders.findUnique({
            where: { order_id: order_id },
        })
        if (!orderRecord) {
            throw new NotFoundException("Order not found")
        }
        if (orderRecord.current_status !== OrderStatus.COMPLETED) {
            throw new BadRequestException("Order is not completed")
        }
        if (!orderRecord.related_reward_id || !orderRecord.rewards_model_snapshot) {
            throw new BadRequestException("Order has no reward pool")
        }

        const modelSnapshot = orderRecord.rewards_model_snapshot as unknown as RewardSnapshotDto

        const rewardPool = await this.prisma.reward_pools.findFirst({
            where: {
                token: modelSnapshot.token,
            },
        })
        if (!rewardPool) {
            throw new BadRequestException("Reward pool not found")
        }

        let rewards: Prisma.user_rewardsCreateManyInput[] = []
        const currentDate = new Date(Date.now())
        const releaseEndTime = new Date(currentDate.getTime() + 180 * 24 * 60 * 60 * 1000) //180 days

        //allocate order creator's rewards
        const orderCreatorRewards = new Decimal(orderRecord.amount).div(100).div(new Decimal(modelSnapshot.unit_price))

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
        })

        let allocatedUSDCAmount = new Decimal(0)
        let allocatedTokenAmount = orderCreatorRewards
        for (const reward of modelSnapshot.revenue_ratio) {
            //to ensure usdc not overflow, we need process platform rewards at final
            if (reward.role === RewardAllocateRoles.PLATFORM) {
                continue
            }
            const rewardUSDAmount = this._calculateUSDCRewards(reward, orderRecord)
            const rewardTokenAmount = rewardUSDAmount.div(new Decimal(modelSnapshot.unit_price))
            const rewwardType = reward.allocate_type as unknown as RewardAllocateType
            const { user, address } = await this.getUser(orderRecord, reward)
            if (rewwardType === RewardAllocateType.USDC) {
                const currentDate = new Date()
                rewards.push({
                    order_id: orderRecord.order_id,
                    user: user,
                    role: reward.role,
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
                })
            } else {
                rewards.push({
                    order_id: orderRecord.order_id,
                    user: user,
                    role: reward.role,
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
                })

                //usdc rewards to buy back account
                rewards.push({
                    order_id: orderRecord.order_id,
                    user: "",
                    role: RewardAllocateRoles.BUYBACK,
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
                })
                allocatedTokenAmount = allocatedTokenAmount.plus(rewardTokenAmount)
            }
            allocatedUSDCAmount = allocatedUSDCAmount.plus(rewardUSDAmount)
        }

        //add platform rewards
        const platformRewards = new Decimal(orderRecord.amount).div(100).minus(allocatedUSDCAmount)
        rewards.push({
            order_id: orderRecord.order_id,
            user: "",
            role: "platform",
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
        })

        //check pool balance
        if (rewardPool.current_balance.lt(allocatedTokenAmount)) {
            throw new BadRequestException("Reward pool balance is not enough")
        }
        const newPoolBalance = rewardPool.current_balance.minus(allocatedTokenAmount)
        const newRewardedAmount = rewardPool.rewarded_amount.plus(allocatedTokenAmount)

        //create rewards for the order
        await this.prisma.$transaction(async (tx) => {
            await tx.user_rewards.createMany({
                data: rewards,
            })
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
            await tx.reward_pool_statement.create({
                data: {
                    token: modelSnapshot.token,
                    amount: allocatedTokenAmount.mul(new Decimal(-1)),
                    usd_revenue: new Decimal(orderRecord.amount).div(100),
                    unit_price: modelSnapshot.unit_price,
                    related_order_id: orderRecord.order_id,
                    type: "released",
                    current_balance: newPoolBalance,
                },
            })
        })

        //todo: settle rewards
        return this.mapRewardsDetail(
            await this.prisma.user_rewards.findMany({
                where: {
                    order_id: orderRecord.order_id,
                },
            }),
        )
    }

    _calculateUSDCRewards(reward: RewardAllocateRatio, orderRecord: orders): Decimal {
        return new Decimal(orderRecord.amount).mul(new Decimal(reward.ratio)).div(100).div(100)
    }

    async getUser(orderRecord: orders, allocateRatio: RewardAllocateRatio): Promise<{ user: string; address: string }> {
        const defaultAddress = { user: "", address: process.env.BUYBACK_WALLET }
        switch (allocateRatio.role) {
            case RewardAllocateRoles.BUYBACK:
                return defaultAddress
            case RewardAllocateRoles.INVITER:
                if (!orderRecord.from_source_link) {
                    return defaultAddress
                }
                const link = await this.prisma.app_links.findFirst({
                    where: {
                        unique_str: orderRecord.from_source_link,
                    },
                })
                if (!link) {
                    return defaultAddress
                }
                return { user: link.creator, address: "" }
            case RewardAllocateRoles.DEVELOPER:
                if (!orderRecord.widget_tag) {
                    return defaultAddress
                }
                const widget = await this.prisma.widgets.findFirst({
                    where: {
                        tag: orderRecord.widget_tag,
                    },
                })
                if (!widget) {
                    return defaultAddress
                }
                return { user: widget.author, address: "" }
            case RewardAllocateRoles.CUSTOMIZED:
                return { user: "", address: allocateRatio.address }
            default:
                return defaultAddress
        }
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async settleUserRewards() {
        try {
            this.logger.log("Settling user rewards")
            const result = await this.prisma.$queryRaw`
update user_rewards r join (select id,
                                   least(datediff(current_date, start_allocate) *
                                         (rewards / datediff(end_allocate, start_allocate)), rewards) as r_amount
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
}
