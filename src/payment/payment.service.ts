import { BadRequestException, Injectable, InternalServerErrorException, Logger, RawBodyRequest } from "@nestjs/common"
import { CreateSubscriptionDto, SubscriptionResultDto, UpdateSubscriptionDto } from "./payment.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { PrismaService } from "src/common/prisma.service"
import Stripe from "stripe"
import { SubscriptionPlanDto, subscriptionPlans } from "./plans.config"
import { v4 as uuidv4 } from "uuid"
import { GetUserSubscriptionStatusDto } from "./payment.dto"
import { InjectStripe } from "nestjs-stripe"
import { Request } from "express"
import { HttpService } from "@nestjs/axios"

@Injectable()
export class PaymentService {
    constructor(
        private readonly prismaService: PrismaService,
        @InjectStripe() private readonly stripe: Stripe,

        private readonly httpService: HttpService,
    ) {}

    private readonly logger = new Logger(PaymentService.name)

    async getPlan(
        subscriptionInfo: CreateSubscriptionDto | UpdateSubscriptionDto | GetUserSubscriptionStatusDto,
    ): Promise<SubscriptionPlanDto> {
        const currentEnv = process.env.ENV === "product" ? "product" : "test"
        const plans = subscriptionPlans.find((plan) => plan.env === currentEnv).plans
        const plan = plans.find(
            (plan) => plan.name === subscriptionInfo.name && plan.period === subscriptionInfo.period,
        )
        return plan
    }

    async getCreditPrice(credits: number) {
        let unitPrice = 0.01
        if (credits < 0) {
            throw new BadRequestException("Invalid credits")
        }
        /*
        if (credits > 10000) {
            unitPrice = 0.009
        }
        if (credits > 5000 && credits <= 10000) {
            unitPrice = 0.0096
        }
        */
        return { usd: (credits * unitPrice).toFixed(2) }
    }

    async processFreeSubscription(userId: string): Promise<SubscriptionResultDto> {
        const existsSubscription = await this.getUserSubscriptionFromStripe({
            usernameShorted: userId,
            user_id: userId,
        })
        if (existsSubscription) {
            throw new BadRequestException("User already has an active subscription, cancel it first")
        }

        //update user's current plan and pay period
        await this.prismaService.users.update({
            where: { username_in_be: userId },
            data: { current_plan: "Free" },
        })
        return {
            url: "",
            redirect: false,
        }
    }

    async addCredit(userInfo: UserInfoDTO, amount: number) {
        try {
            const customer = await this.prismaService.users.findFirst({
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
                await this.prismaService.users.update({
                    where: {
                        username_in_be: userInfo.usernameShorted,
                    },
                    data: { stripe_customer_id: customerCreated.id },
                })
                customer.stripe_customer_id = customerCreated.id
            }
            const credits = amount
            const needUsd = await this.getCreditPrice(credits)
            const orderId = uuidv4()
            const metadata = {
                id: orderId,
                username: userInfo.usernameShorted,
                credits: credits,
            }
            const stripeSession = await this.stripe.checkout.sessions.create({
                client_reference_id: orderId,
                customer: customer.stripe_customer_id,
                line_items: [
                    {
                        price_data: {
                            currency: "usd",
                            product_data: {
                                name: "Add credit",
                                description: `Purchase additional ${credits} credits`,
                            },
                            unit_amount: parseFloat(needUsd.usd) * 100,
                        },
                        quantity: 1,
                    },
                ],
                mode: "payment",
                invoice_creation: {
                    enabled: true,
                    invoice_data: {
                        metadata: metadata,
                    },
                },
                metadata: metadata,
                success_url: `${process.env.FRONTEND_URL}/universal-stimulator/profile/subscription`,
                cancel_url: `${process.env.FRONTEND_URL}/universal-stimulator/profile/subscription?status=cancelled`,
            })
            return {
                url: stripeSession.url,
            }
        } catch (error) {
            this.logger.error(error)
            throw new BadRequestException(error.message)
        }
    }

    async subscription(userInfo: UserInfoDTO, subscriptionInfo: CreateSubscriptionDto): Promise<SubscriptionResultDto> {
        try {
            if (subscriptionInfo.name === "Free") {
                return await this.processFreeSubscription(userInfo.usernameShorted)
            }

            const existingSubscription = await this.getUserSubscriptionFromStripe(userInfo)
            //update subscription
            if (existingSubscription) {
                return await this._updateSubscription(userInfo, subscriptionInfo)
            }

            const plan = await this.getPlan(subscriptionInfo)
            if (!plan) {
                throw new Error("Invalid plan")
            }

            let stripeCustomerId = null
            const customer = await this.prismaService.users.findUnique({
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
                await this.prismaService.users.update({
                    where: {
                        username_in_be: userInfo.usernameShorted,
                    },
                    data: { stripe_customer_id: customerCreated.id },
                })
                stripeCustomerId = customerCreated.id
            } else {
                stripeCustomerId = customer.stripe_customer_id
            }

            const orderId = uuidv4()
            const session = await this.stripe.checkout.sessions.create({
                client_reference_id: orderId,
                line_items: [{ price: plan.price_id, quantity: 1 }],
                mode: "subscription",
                metadata: {
                    id: orderId,
                    username: userInfo.usernameShorted,
                    plan: subscriptionInfo.name,
                    payment_method: subscriptionInfo.period,
                },
                customer: stripeCustomerId,
                success_url: `${process.env.FRONTEND_URL}/universal-stimulator/profile/subscription`,
                cancel_url: `${process.env.FRONTEND_URL}/universal-stimulator/profile/subscription?status=cancelled`,
            })
            if (!session.url) {
                throw new Error("Failed to create checkout session")
            }
            return { url: session.url, redirect: true }
        } catch (error) {
            this.logger.error(error)
            throw new BadRequestException(error.message)
        }
    }

    async getPlanByPriceId(priceId: string): Promise<SubscriptionPlanDto | null> {
        const currentEnv = process.env.ENV === "product" ? "product" : "test"
        const plans = subscriptionPlans.find((plan) => plan.env === currentEnv).plans
        const plan = plans.find((plan) => plan.price_id === priceId)
        return plan
    }

    async getUserSubscriptionFromStripe(userInfo: UserInfoDTO): Promise<Stripe.Subscription | null> {
        const user = await this.prismaService.users.findFirst({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
            select: {
                stripe_customer_id: true,
            },
        })

        if (!user.stripe_customer_id) {
            return null
        }

        const subscriptions = await this.stripe.subscriptions.list({
            customer: user.stripe_customer_id,
        })

        if (subscriptions.data.length === 0) {
            return null
        }
        return subscriptions.data[0]
    }

    private async _updateSubscription(
        userInfo: UserInfoDTO,
        subscriptionInfo: UpdateSubscriptionDto,
    ): Promise<SubscriptionResultDto> {
        const subscription = await this.getUserSubscriptionFromStripe(userInfo)
        if (!subscription) {
            throw new BadRequestException("You don't have an active subscription")
        }

        if (subscription.status !== "active") {
            throw new BadRequestException("Your subscription is not active")
        }

        const plan = await this.getPlan(subscriptionInfo)
        if (!plan) {
            throw new BadRequestException("Invalid plan")
        }

        if (subscription.items.data[0].price.id === plan.price_id) {
            throw new BadRequestException("You already have this subscription")
        }

        const customer = await this.prismaService.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
            select: {
                stripe_customer_id: true,
            },
        })

        const session = await this.stripe.billingPortal.sessions.create({
            customer: customer.stripe_customer_id,
            flow_data: {
                type: "subscription_update_confirm",
                subscription_update_confirm: {
                    items: [
                        {
                            id: subscription.items.data[0].id,
                            price: plan.price_id,
                            quantity: 1,
                        },
                    ],
                    subscription: subscription.id,
                },
            },
            return_url: `${process.env.FRONTEND_URL}/universal-stimulator/profile`,
        })
        return { url: session.url, redirect: true }
    }

    async getInvoiceByCustomerId(customerId: string) {
        const invoices = await this.stripe.invoices.list({
            customer: customerId,
            status: "paid",
        })
        return invoices.data.map((invoice) => ({
            id: invoice.id,
            status: invoice.status,
            downloadUrl: invoice.invoice_pdf,
            previewUrl: invoice.hosted_invoice_url,
            amount: invoice.total / 100,
            created_at: new Date(invoice.created * 1000),
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
            return await this.prismaService.stripe_webhook_log.create({
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
}
