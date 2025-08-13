import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { HttpService } from "@nestjs/axios"
import {
    OrderStatus,
    PaymentMethod,
    PayWithPaymentAsiaRequestDto,
    PayWithPaymentAsiaResponseDto,
} from "../order/order.dto"
import { UserJwtExtractDto } from "src/user/user.controller"
import { OrderService } from "../order/order.service"
import { UserService } from "src/user/user.service"
import { PrismaService } from "src/common/prisma.service"
import {
    CreatePaymentOrderRequestDto,
    PaymentAsiaCallbackDto,
    PaymentAsiaNetwork,
    PaymentAsiaOrderStatus,
} from "./payment-asia.dto"
import * as crypto from "crypto"
import { UtilitiesService } from "src/common/utilities.service"
import { Request, Response } from "express"
import { URLSearchParams } from "url"
import { BillingInfoDto } from "src/user/user.dto"

@Injectable()
export class PaymentAsiaService {
    public readonly logger = new Logger(PaymentAsiaService.name)
    private readonly paymentAsiaUrl = process.env.PAYMENT_ASIA_PAGE_URL
    private readonly paymentAsiaApiKey = process.env.PAYMENT_ASIA_MERCHANT_TOKEN
    private readonly paymentAsiaSecretKey = process.env.PAYMENT_ASIA_MERCHANT_SECRET
    private readonly hkdToUsd = 8

    constructor(
        private readonly httpService: HttpService,
        private readonly orderService: OrderService,
        private readonly userService: UserService,
        private readonly prisma: PrismaService,
    ) {
        if (!this.paymentAsiaUrl || !this.paymentAsiaApiKey || !this.paymentAsiaSecretKey) {
            throw new Error("Payment Asia URL, API Key, and Secret Key are not set")
        }
    }

    signParams(params: any): string {
        const objectSorted = Object.keys(params)
            .filter((key) => key !== "sign" && params[key] !== undefined && params[key] !== null)
            .sort()
            .reduce((obj, key) => {
                obj[key] = params[key]
                return obj
            }, {})

        const searchParam = new URLSearchParams(objectSorted)
        this.paymentAsiaSecretKey
        const sign = crypto
            .createHash("sha512")
            .update(searchParam.toString() + this.paymentAsiaSecretKey)
            .digest("hex")
        return sign
    }

    async payWithPaymentAsia(
        orderDto: PayWithPaymentAsiaRequestDto,
        userInfo: UserJwtExtractDto,
        req: Request,
    ): Promise<PayWithPaymentAsiaResponseDto> {
        const userProfile = await this.userService.getProfile(userInfo)
        const orderId = orderDto.order_id
        const {
            allow,
            message,
            order: orderRecord,
        } = await this.orderService.allowPayOrder(orderId, userProfile, PaymentMethod.WECHAT)
        if (!allow) {
            throw new BadRequestException(message)
        }

        const ip = await UtilitiesService.getUsersIp(req)
        //update phone number
        await this.prisma.orders.update({
            where: {
                order_id: orderId,
            },
            data: {
                phone_number: orderDto.phone_number,
                phone_national: orderDto.phone_national,
                customer_ip: ip,
            },
        })
        await this.prisma.users.update({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
            data: {
                phone_number: orderDto.phone_number,
                phone_national: orderDto.phone_national,
            },
        })

        const returnUrl = `${process.env.FRONTEND_URL}/api/v1/order/payment-asia/redirect?method=${orderDto.method}`
        //const returnUrl = `https://specially-picked-quetzal.ngrok-free.app/api/v1/order/payment-asia/redirect?method=${orderDto.method}`
        const notifyUrl = `${process.env.FRONTEND_URL}/api/v1/order/payment-asia/callback?method=${orderDto.method}`
        //const notifyUrl = `https://specially-picked-quetzal.ngrok-free.app/api/v1/order/payment-asia/callback?method=${orderDto.method}`

        const createPaymentOrderRequest: CreatePaymentOrderRequestDto = {
            merchant_reference: orderId,
            currency: "HKD",
            amount: this.covertUsdToHkd(orderRecord.amount),
            return_url: returnUrl,
            customer_ip: ip,
            customer_first_name: userProfile.username,
            customer_last_name: userProfile.username,
            customer_phone: orderDto.phone_national + orderDto.phone_number,
            customer_email: userProfile.email,
            network: orderDto.method as PaymentAsiaNetwork,
            subject: `${orderRecord.description}`,
            notify_url: notifyUrl,
        }

        if (orderDto.method === "CreditCard") {
            createPaymentOrderRequest.customer_first_name = orderDto.first_name
            createPaymentOrderRequest.customer_last_name = orderDto.last_name
            createPaymentOrderRequest.customer_address = orderDto.customer_address
            createPaymentOrderRequest.customer_country = orderDto.customer_country
            createPaymentOrderRequest.customer_postal_code = orderDto.customer_postal_code
            createPaymentOrderRequest.customer_state = orderDto.customer_state || "NY"

            const billingInfo: BillingInfoDto = {
                first_name: orderDto.first_name,
                last_name: orderDto.last_name,
                phone_number: orderDto.phone_number,
                phone_national: orderDto.phone_national,
                billing_address: orderDto.customer_address,
                billing_country: orderDto.customer_country,
                billing_postal_code: orderDto.customer_postal_code,
                billing_state: orderDto.customer_state,
            }
            //save users billing info
            await this.prisma.users.update({
                where: {
                    username_in_be: userInfo.usernameShorted,
                },
                data: {
                    billing_info: billingInfo as any,
                },
            })
        }

        const sign = this.signParams(createPaymentOrderRequest)

        return {
            url: this.paymentAsiaUrl + "/" + this.paymentAsiaApiKey,
            params: {
                ...createPaymentOrderRequest,
                sign,
            },
        }
    }

    async processPaymentAsiaCallback(body: PaymentAsiaCallbackDto, method: PaymentAsiaNetwork) {
        this.logger.log(`Received payment asia callback: ${JSON.stringify(body)}`)
        //check sign
        const expecetdSign = this.signParams(body)
        if (expecetdSign !== body.sign) {
            this.logger.warn(`sign incorrect, ignore this callback: ${JSON.stringify(body)}`)
            return
        }

        if (body.status !== PaymentAsiaOrderStatus.SUCCESS) {
            this.logger.warn(`payment status is not success, ignore this callback: ${JSON.stringify(body)}`)
            return
        }

        const order = await this.prisma.orders.findUnique({
            where: {
                order_id: body.merchant_reference,
            },
        })
        if (!order) {
            throw new BadRequestException("Order not found")
        }

        //check amount
        const amount = this.covertUsdToHkd(order.amount)
        if (amount !== body.amount) {
            this.logger.error(
                `amount incorrect, ignore this callback: ${JSON.stringify(body)} ${amount} ${body.amount}`,
            )
            return
        }

        //check currency
        if (body.currency !== "HKD") {
            this.logger.error(`currency incorrect, ignore this callback: ${JSON.stringify(body)}`)
            return
        }

        if (order.current_status !== OrderStatus.PENDING) {
            this.logger.error(`order status incorrect, ignore this callback: ${JSON.stringify(body)}`)
            return
        }

        await this.prisma.orders.update({
            where: {
                order_id: body.merchant_reference,
            },
            data: {
                payment_asia_callback: body as any,
            },
        })

        await this.prisma.orders.update({
            where: {
                order_id: body.merchant_reference,
            },
            data: {
                current_status: OrderStatus.COMPLETED,
                paid_method: this.convertPaymentAsiaNetworkToPaymentMethod(method),
                paid_time: new Date(),
                payment_asia_callback: body as any,
            },
        })
        //update bind rewards price
        await this.orderService.updateBindRewards(order)

        if (order.release_rewards_after_paid) {
            await this.orderService.releaseRewards(order)
        }
        await this.orderService.processCallback(order.order_id, order.callback_url)
    }

    async processPaymentAsiaRedirect(body: PaymentAsiaCallbackDto, res: Response) {
        this.logger.log(`Received payment asia redirect: ${JSON.stringify(body)}`)
        const order = await this.prisma.orders.findUnique({
            where: {
                order_id: body.merchant_reference,
            },
        })
        if (!order) {
            throw new BadRequestException("Order not found")
        }
        const url = `${process.env.FRONTEND_URL}/order?orderId=${order.order_id}&payment_asia_status=${body.status}`
        res.redirect(301, url)
    }

    convertPaymentAsiaNetworkToPaymentMethod(network: PaymentAsiaNetwork): PaymentMethod {
        switch (network) {
            case PaymentAsiaNetwork.WECHAT:
                return PaymentMethod.WECHAT
            case PaymentAsiaNetwork.CREDIT_CARD:
                return PaymentMethod.CREDIT_CARD
            default:
                return PaymentMethod.WECHAT
        }
    }

    covertUsdToHkd(amount: number) {
        return ((amount * this.hkdToUsd) / 100).toFixed(2)
    }
}
