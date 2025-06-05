import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    RawBodyRequest,
} from "@nestjs/common"
import { CreateSubscriptionDto, SubscriptionResultDto, UpdateSubscriptionDto } from "./payment.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { PrismaService } from "src/common/prisma.service"
import Stripe from "stripe"
import { freePlan, SubscriptionPlanDto, SubscriptionPlanName, subscriptionPlans } from "./plans.config"
import { v4 as uuidv4 } from "uuid"
import { GetUserSubscriptionStatusDto } from "./payment.dto"
import { InjectStripe } from "nestjs-stripe"
import { CreditService } from "src/credit/credit.service"
import dayjs from "dayjs"
import { users } from "@prisma/client"
import { Request } from "express"
import { lastValueFrom } from "rxjs"
import { HttpService } from "@nestjs/axios"

@Injectable()
export class PaymentService {
    constructor(
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => CreditService))
        private readonly creditService: CreditService,
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
        const credit = await this.creditService.issueFreeCredits(userId)
        if (!credit) {
            throw new BadRequestException("Failed to issue free credits")
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

    async getSubscription(userInfo: UserInfoDTO): Promise<GetUserSubscriptionStatusDto> {
        let _freePlan: GetUserSubscriptionStatusDto = {
            name: freePlan.name,
            period: freePlan.period,
            price_per_credit: freePlan.price_per_credit,
            price_id: freePlan.price_id,
            next_billing_date: null,
            ended_date: null,
            invoices: [],
        }

        const user = await this.prismaService.users.findFirst({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (user.current_plan === "Custom") {
            return {
                ..._freePlan,
                name: SubscriptionPlanName.Custom,
            }
        }

        const userSubscription = await this.getUserSubscriptionFromStripe(userInfo)
        const isFreeCreditIssued = await this.creditService.isFreeCreditIssued(userInfo.usernameShorted)

        if (!userSubscription) {
            return {
                ..._freePlan,
                name: isFreeCreditIssued ? SubscriptionPlanName.Free : SubscriptionPlanName.None,
            }
        }

        if (userSubscription.status !== "active") {
            return {
                ..._freePlan,
                name: isFreeCreditIssued ? SubscriptionPlanName.Free : SubscriptionPlanName.None,
            }
        }

        const priceId = userSubscription.items.data[0].price.id
        if (!priceId) {
            throw new BadRequestException("Invalid price id")
        }
        const currentEnv = process.env.ENV === "product" ? "product" : "test"
        const plans = subscriptionPlans.find((plan) => plan.env === currentEnv).plans
        const plan = plans.find((plan) => plan.price_id === priceId)
        if (!plan) {
            throw new BadRequestException("Invalid plan")
        }

        let nextBillingDate = new Date(userSubscription.current_period_end * 1000)
        let endedDate = null
        if (userSubscription.cancel_at_period_end) {
            nextBillingDate = null
            endedDate = new Date(userSubscription.current_period_end * 1000)
        }

        return {
            name: plan.name as SubscriptionPlanName,
            period: plan.period,
            price_per_credit: plan.price_per_credit,
            price_id: plan.price_id,
            next_billing_date: nextBillingDate,
            ended_date: endedDate,
            invoices: await this.getInvoiceByCustomerId(userSubscription.customer as string),
        }
    }

    async getSubscriptionManage(userInfo: UserInfoDTO) {
        const subscription = await this.getSubscription(userInfo)
        if (subscription.name === "Free") {
            throw new BadRequestException("You don't have an active subscription")
        }
        const stripeCustomerId = await this.prismaService.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
            select: {
                stripe_customer_id: true,
            },
        })
        if (!stripeCustomerId) {
            throw new BadRequestException("Invalid stripe customer id")
        }
        const manageUrl = await this.stripe.billingPortal.sessions.create({
            customer: stripeCustomerId.stripe_customer_id,
            return_url: `${process.env.FRONTEND_URL}/universal-stimulator/profile`,
        })
        return {
            url: manageUrl.url,
        }
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

    async stripeInvoicePaid(localRecordId: number): Promise<void> {
        const record = await this.prismaService.stripe_webhook_log.findUnique({
            where: {
                id: localRecordId,
            },
        })
        if (!record || record.status === "processed") {
            this.logger.error(`Local record not found for invoice ${localRecordId}`)
            return
        }
        const invoice = (record.raw_data as any).data.object as Stripe.Invoice
        const user = await this.prismaService.users.findFirst({
            where: {
                stripe_customer_id: invoice.customer as string,
            },
        })
        if (!user) {
            this.logger.error(`User not found for invoice ${invoice.id}`)
            return
        }
        //return if this invoice processed
        const existingInvoice = await this.prismaService.user_credit_issues.findFirst({
            where: {
                invoice_id: invoice.id,
            },
        })
        if (existingInvoice) {
            this.logger.warn(`Invoice ${invoice.id} already processed`)
            return
        }

        //this indicate is an addtional credit purchase
        const isAdditionalCreditPurchase =
            invoice.lines.data.length === 1 && invoice.lines.data[0].description.includes("Add credit")
        //this indicate is a subscription invoice
        const isSubscription = invoice.subscription !== null

        if (isAdditionalCreditPurchase) {
            await this._processAdditionalCreditPurchase(invoice, user)
        } else if (isSubscription) {
            const isUpdate =
                (await this.prismaService.user_credit_issues.findFirst({
                    where: {
                        subscription_id: invoice.subscription as string,
                    },
                })) && invoice.lines.data.length > 1

            if (isUpdate) {
                //process update subscription
                await this._processUpdateSubscription(invoice, user)
            } else {
                //process new subscription
                await this._processNewSubscription(invoice, user)
            }
        } else {
            this.logger.error(`Invoice ${invoice.id} is not an additional credit purchase or subscription`)
            return
        }

        //notify payment success
        const notifyChannel = process.env.PAYMENT_NOTIFY_URL
        if (notifyChannel) {
            const res = await lastValueFrom(
                this.httpService.post(
                    notifyChannel,
                    {
                        text: `New invoice paid: ${invoice.id} by ${user.email}, amount: $${(invoice.total / 100).toFixed(2)}, type:${isAdditionalCreditPurchase ? "Add Credit" : "Subscription"}`,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                        },
                    },
                ),
            )
            if (res.status !== 200) {
                this.logger.warn(`notify payment success failed: ${res.data}`)
            }
        }

        await this.prismaService.stripe_webhook_log.update({
            where: {
                id: localRecordId,
            },
            data: { status: "processed" },
        })
    }

    private async _processNewSubscription(invoice: Stripe.Invoice, user: users) {
        const subscriptionFromStripe = await this.stripe.subscriptions.retrieve(invoice.subscription as string)
        const subscriptionStartDate = dayjs(subscriptionFromStripe.current_period_start * 1000).toDate()
        const subscriptionEndDate = dayjs(subscriptionFromStripe.current_period_end * 1000).toDate()
        const priceId = invoice.lines.data[0].price.id
        if (!priceId) {
            this.logger.error(`Invalid price id for invoice ${invoice.id}`)
            return
        }

        const plan = await this.getPlanByPriceId(priceId)
        if (!plan) {
            this.logger.error(`Invalid plan for invoice ${invoice.id}`)
            return
        }

        const subscriptionId = invoice.subscription as string
        //allocate credit to user
        if (plan.period === "monthly") {
            await this.creditService.issueCredits({
                user: user.username_in_be,
                credit: plan.credit_per_month,
                invoice_id: invoice.id,
                subscription_id: subscriptionId,
                type: "subscription",
                effective_date: subscriptionStartDate,
                expire_date: subscriptionEndDate,
            })
        }

        if (plan.period === "yearly") {
            let effectiveDate = subscriptionStartDate
            for (let i = 0; i < 12; i++) {
                const expireDate = dayjs(effectiveDate).add(1, "month").subtract(1, "day").toDate()
                await this.creditService.issueCredits({
                    user: user.username_in_be,
                    credit: plan.credit_per_month,
                    invoice_id: invoice.id,
                    type: "subscription",
                    subscription_id: subscriptionId,
                    effective_date: effectiveDate,
                    expire_date: expireDate > subscriptionEndDate ? subscriptionEndDate : expireDate,
                })
                effectiveDate = dayjs(expireDate).add(1, "day").toDate()
            }
        }

        //update user's current plan and pay period
        await this.prismaService.users.update({
            where: { username_in_be: user.username_in_be },
            data: { current_plan: plan.name, current_pay_period: plan.period },
        })
    }

    private async _processUpdateSubscription(invoice: Stripe.Invoice, user: users) {
        if (invoice.lines.data.length < 2) {
            this.logger.error(`this invoice ${invoice.id} is not an update subscription invoice`)
            return
        }

        const subscriptionFromStripe = await this.stripe.subscriptions.retrieve(invoice.subscription as string)
        const subscriptionStartDate = dayjs(subscriptionFromStripe.current_period_start * 1000).toDate()
        const invoicePaidDate = dayjs(invoice.effective_at * 1000).toDate()
        const subscriptionEndDate = dayjs(subscriptionFromStripe.current_period_end * 1000).toDate()

        const newPriceId = invoice.lines.data[1].price.id
        if (!newPriceId) {
            this.logger.error(`Invalid price id for invoice ${invoice.id}`)
            return
        }

        const newPlan = await this.getPlanByPriceId(newPriceId)
        if (!newPlan) {
            this.logger.error(`Invalid plan for invoice ${invoice.id}`)
            return
        }

        const perviousPriceId = invoice.lines.data[0].price.id
        if (!perviousPriceId) {
            this.logger.error(`Invalid price id for invoice ${invoice.id}`)
            return
        }

        const perviousPlan = await this.getPlanByPriceId(perviousPriceId)
        if (!perviousPlan) {
            this.logger.error(`Invalid plan for invoice ${invoice.id}`)
            return
        }

        //new monthly, previous monthly
        if (newPlan.period === "monthly" && perviousPlan.period === "monthly") {
            let shouldIssueCredits = newPlan.credit_per_month
            const allDays = dayjs(subscriptionEndDate).diff(subscriptionStartDate, "day") + 1
            const dayBetweenEnd = dayjs(subscriptionEndDate).diff(invoicePaidDate, "day") + 1

            if (dayBetweenEnd > 0 && dayBetweenEnd < allDays) {
                shouldIssueCredits = (newPlan.credit_per_month / allDays) * dayBetweenEnd
            }
            shouldIssueCredits = Math.ceil(shouldIssueCredits - perviousPlan.credit_per_month)

            await this.creditService.issueCredits({
                user: user.username_in_be,
                credit: shouldIssueCredits,
                invoice_id: invoice.id,
                subscription_id: subscriptionFromStripe.id,
                type: "subscription",
                effective_date: subscriptionStartDate,
                expire_date: subscriptionEndDate,
            })
        }
        //new yearly, previous yearly
        if (newPlan.period === "yearly" && perviousPlan.period === "yearly") {
            await this.creditService.removeAllPendingCredit(user.username_in_be)
            const paidDate = dayjs(invoice.effective_at * 1000).toDate()
            let effectiveDate = subscriptionStartDate
            for (let i = 0; i < 12; i++) {
                const expireDate = dayjs(effectiveDate).add(1, "month").subtract(1, "day").toDate()
                if (paidDate > expireDate) {
                    effectiveDate = dayjs(expireDate).add(1, "day").toDate()
                    continue
                }
                const subscriptionId = invoice.subscription as string
                const existingSubscriptions = await this.prismaService.user_credit_issues.findMany({
                    where: {
                        subscription_id: subscriptionId,
                        effective_date: effectiveDate,
                        expire_date: expireDate,
                    },
                })

                let shouldIssueCredits = newPlan.credit_per_month
                if (existingSubscriptions.length > 0) {
                    const allDays = dayjs(expireDate).diff(effectiveDate, "day") + 1
                    const dayBetweenEnd = dayjs(expireDate).diff(paidDate, "day") + 1

                    if (dayBetweenEnd > 0 && dayBetweenEnd < allDays) {
                        shouldIssueCredits = (newPlan.credit_per_month / allDays) * dayBetweenEnd
                    }
                    shouldIssueCredits = Math.ceil(
                        shouldIssueCredits - existingSubscriptions.reduce((acc, curr) => acc + curr.credit, 0),
                    )
                }
                if (shouldIssueCredits > 0) {
                    await this.creditService.issueCredits({
                        user: user.username_in_be,
                        credit: shouldIssueCredits,
                        invoice_id: invoice.id,
                        type: "subscription",
                        subscription_id: subscriptionId,
                        effective_date: effectiveDate,
                        expire_date: expireDate > subscriptionEndDate ? subscriptionEndDate : expireDate,
                    })
                }
                effectiveDate = dayjs(expireDate).add(1, "day").toDate()
            }
        }
        //new yearly, previous monthly
        if (newPlan.period === "yearly" && perviousPlan.period === "monthly") {
            await this.creditService.removeAllPendingCredit(user.username_in_be)
            const previousSubscriptionRecord = await this.prismaService.user_credit_issues.findFirst({
                where: {
                    subscription_id: invoice.subscription as string,
                },
                select: {
                    effective_date: true,
                    expire_date: true,
                },
            })
            const paidDate = dayjs(invoice.effective_at * 1000).toDate()
            const unUsedDays = dayjs(previousSubscriptionRecord.expire_date).diff(paidDate, "day") + 1

            const perviousSubscriptionDays =
                dayjs(previousSubscriptionRecord.expire_date).diff(previousSubscriptionRecord.effective_date, "day") + 1
            const shouldSubstractCredits = Math.ceil(
                (perviousPlan.credit_per_month / perviousSubscriptionDays) * unUsedDays,
            )
            let effectiveDate = subscriptionStartDate
            for (let i = 0; i < 12; i++) {
                let shouldIssueCredits =
                    i === 0 ? newPlan.credit_per_month - shouldSubstractCredits : newPlan.credit_per_month
                const expireDate = dayjs(effectiveDate).add(1, "month").subtract(1, "day").toDate()
                if (shouldIssueCredits > 0) {
                    await this.creditService.issueCredits({
                        user: user.username_in_be,
                        credit: shouldIssueCredits,
                        invoice_id: invoice.id,
                        type: "subscription",
                        subscription_id: invoice.subscription as string,
                        effective_date: effectiveDate,
                        expire_date: expireDate > subscriptionEndDate ? subscriptionEndDate : expireDate,
                    })
                }
                effectiveDate = dayjs(expireDate).add(1, "day").toDate()
            }
        }
        //new monthly, previous yearly
        if (newPlan.period === "monthly" && perviousPlan.period === "yearly") {
            await this.creditService.removeAllPendingCredit(user.username_in_be)
            const paidDate = dayjs(invoice.effective_at * 1000).toDate()
            const previousSubscriptionRecord = await this.prismaService.user_credit_issues.findFirst({
                where: {
                    subscription_id: invoice.subscription as string,
                    effective_date: {
                        lte: paidDate,
                    },
                    expire_date: {
                        gt: paidDate,
                    },
                },
                select: {
                    effective_date: true,
                    expire_date: true,
                },
                orderBy: {
                    effective_date: "desc",
                },
            })
            let shouldSubstractCredits = 0
            if (previousSubscriptionRecord) {
                const unUsedDays = dayjs(previousSubscriptionRecord.expire_date).diff(paidDate, "day") + 1

                const perviousSubscriptionDays =
                    dayjs(previousSubscriptionRecord.expire_date).diff(
                        previousSubscriptionRecord.effective_date,
                        "day",
                    ) + 1
                shouldSubstractCredits = Math.ceil(
                    (perviousPlan.credit_per_month / perviousSubscriptionDays) * unUsedDays,
                )
            }
            let effectiveDate = subscriptionStartDate
            const expireDate = dayjs(effectiveDate).add(1, "month").subtract(1, "day").toDate()
            await this.creditService.issueCredits({
                user: user.username_in_be,
                credit: Math.max(newPlan.credit_per_month - shouldSubstractCredits, 0),
                invoice_id: invoice.id,
                type: "subscription",
                subscription_id: invoice.subscription as string,
                effective_date: effectiveDate,
                expire_date: expireDate > subscriptionEndDate ? subscriptionEndDate : expireDate,
            })
        }

        //update user's current plan and pay period
        await this.prismaService.users.update({
            where: { username_in_be: user.username_in_be },
            data: { current_plan: newPlan.name, current_pay_period: newPlan.period },
        })
    }

    async _processAdditionalCreditPurchase(invoice: Stripe.Invoice, user: users) {
        const metadata = invoice.metadata
        const credits = parseInt(metadata.credits)
        if (!credits) {
            this.logger.error(`no credit on this invoice`)
            return
        }
        await this.creditService.issueCredits({
            user: user.username_in_be,
            credit: credits,
            invoice_id: invoice.id,
            type: "additional",
            subscription_id: invoice.subscription as string,
            effective_date: new Date(),
            expire_date: new Date("9999-12-31"),
        })
    }

    async reprocessInvoice(logid: string) {
        return await this.stripeInvoicePaid(parseInt(logid))
    }
}
