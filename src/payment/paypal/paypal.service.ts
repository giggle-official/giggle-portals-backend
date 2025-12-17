import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common"
import { HttpService } from "@nestjs/axios"
import { PrismaService } from "src/common/prisma.service"
import { lastValueFrom } from "rxjs"
import { OrderStatus, PaymentMethod } from "../order/order.dto"
import { orders } from "@prisma/client"
import { OrderService } from "../order/order.service"

interface PayPalAccessToken {
    access_token: string
    token_type: string
    expires_in: number
    expires_at?: number
}

interface PayPalOrderResponse {
    id: string
    status: string
    links: Array<{
        href: string
        rel: string
        method: string
    }>
}

@Injectable()
export class PaypalService {
    private readonly logger = new Logger(PaypalService.name)
    private accessToken: PayPalAccessToken | null = null

    private readonly baseUrl: string
    private readonly clientId: string
    private readonly clientSecret: string

    constructor(
        private readonly httpService: HttpService,
        private readonly prisma: PrismaService,

        @Inject(forwardRef(() => OrderService))
        private readonly orderService: OrderService,
    ) {
        // Use sandbox for non-production, live for production
        const isProduction = process.env.ENV === "product"
        this.baseUrl = isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
        this.clientId = process.env.PAYPAL_CLIENT_ID || ""
        this.clientSecret = process.env.PAYPAL_CLIENT_SECRET || ""
    }

    /**
     * Get PayPal access token (with caching)
     */
    private async getAccessToken(): Promise<string> {
        // Check if we have a valid cached token
        if (this.accessToken && this.accessToken.expires_at && Date.now() < this.accessToken.expires_at) {
            return this.accessToken.access_token
        }

        try {
            const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")

            const response = await lastValueFrom(
                this.httpService.post(`${this.baseUrl}/v1/oauth2/token`, "grant_type=client_credentials", {
                    headers: {
                        Authorization: `Basic ${auth}`,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }),
            )

            this.accessToken = {
                ...response.data,
                expires_at: Date.now() + (response.data.expires_in - 60) * 1000, // Refresh 1 minute before expiry
            }

            return this.accessToken.access_token
        } catch (error) {
            this.logger.error("Failed to get PayPal access token:", error?.response?.data || error.message)
            throw new BadRequestException("Failed to authenticate with PayPal")
        }
    }

    /**
     * Create a PayPal order for checkout
     */
    async createPayPalOrder(order: orders): Promise<{ orderId: string; approvalUrl: string }> {
        const accessToken = await this.getAccessToken()

        const returnUrl = `${process.env.FRONTEND_URL}/order?orderId=${order.order_id}&paypal=success`
        const cancelUrl = `${process.env.FRONTEND_URL}/order?orderId=${order.order_id}&paypal=cancel`

        const payload = {
            intent: "CAPTURE",
            purchase_units: [
                {
                    reference_id: order.order_id,
                    description: order.description || `Payment for order ${order.order_id}`,
                    amount: {
                        currency_code: "USD",
                        value: (order.amount / 100).toFixed(2), // Convert cents to dollars
                    },
                    custom_id: order.order_id,
                },
            ],
            payment_source: {
                paypal: {
                    experience_context: {
                        payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
                        brand_name: "Giggle.Pro",
                        locale: "en-US",
                        landing_page: "LOGIN",
                        user_action: "PAY_NOW",
                        return_url: returnUrl,
                        cancel_url: cancelUrl,
                    },
                },
            },
        }

        try {
            const response = await lastValueFrom(
                this.httpService.post<PayPalOrderResponse>(`${this.baseUrl}/v2/checkout/orders`, payload, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                        "PayPal-Request-Id": order.order_id, // Idempotency key
                    },
                }),
            )

            const paypalOrder = response.data
            const approvalLink = paypalOrder.links.find((link) => link.rel === "payer-action")

            if (!approvalLink) {
                throw new BadRequestException("PayPal approval URL not found")
            }

            // Store PayPal order ID in database
            await this.prisma.orders.update({
                where: { order_id: order.order_id },
                data: {
                    paypal_order_id: paypalOrder.id,
                    paypal_order_detail: paypalOrder as any,
                },
            })

            return {
                orderId: paypalOrder.id,
                approvalUrl: approvalLink.href,
            }
        } catch (error) {
            this.logger.error("Failed to create PayPal order:", error?.response?.data || error.message)
            throw new BadRequestException("Failed to create PayPal order")
        }
    }

    /**
     * Capture PayPal payment after user approval
     */
    async capturePayPalOrder(paypalOrderId: string): Promise<orders> {
        const accessToken = await this.getAccessToken()

        try {
            const response = await lastValueFrom(
                this.httpService.post(
                    `${this.baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`,
                    {},
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json",
                        },
                    },
                ),
            )

            const captureData = response.data

            if (captureData.status !== "COMPLETED") {
                this.logger.warn(`PayPal order ${paypalOrderId} capture status: ${captureData.status}`)
                throw new BadRequestException(`Payment not completed. Status: ${captureData.status}`)
            }

            // Get our order from the PayPal order ID
            const order = await this.prisma.orders.findFirst({
                where: { paypal_order_id: paypalOrderId },
            })

            if (!order) {
                throw new BadRequestException("Order not found for PayPal order ID")
            }

            // Update order status
            const updatedOrder = await this.prisma.orders.update({
                where: { id: order.id },
                data: {
                    current_status: OrderStatus.COMPLETED,
                    paid_method: PaymentMethod.PAYPAL,
                    paid_time: new Date(),
                    paypal_capture_detail: captureData as any,
                },
            })

            return updatedOrder
        } catch (error) {
            this.logger.error("Failed to capture PayPal order:", error?.response?.data || error.message)
            throw new BadRequestException("Failed to capture PayPal payment")
        }
    }

    /**
     * Verify PayPal webhook signature
     */
    async verifyWebhookSignature(headers: Record<string, string>, body: any, webhookId: string): Promise<boolean> {
        const accessToken = await this.getAccessToken()

        const verificationPayload = {
            auth_algo: headers["paypal-auth-algo"],
            cert_url: headers["paypal-cert-url"],
            transmission_id: headers["paypal-transmission-id"],
            transmission_sig: headers["paypal-transmission-sig"],
            transmission_time: headers["paypal-transmission-time"],
            webhook_id: webhookId,
            webhook_event: body,
        }

        try {
            const response = await lastValueFrom(
                this.httpService.post(
                    `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
                    verificationPayload,
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json",
                        },
                    },
                ),
            )

            return response.data.verification_status === "SUCCESS"
        } catch (error) {
            this.logger.error("Failed to verify webhook signature:", error?.response?.data || error.message)
            return false
        }
    }

    /**
     * Process PayPal webhook event
     */
    async processWebhookEvent(event: any, headers: Record<string, string>): Promise<void> {
        const webhookId = process.env.PAYPAL_WEBHOOK_ID

        // Log the webhook event
        await this.prisma.paypal_webhook_log.create({
            data: {
                event_type: event.event_type,
                raw_data: event,
                status: "pending",
            },
        })

        // Verify signature in production
        if (process.env.ENV === "product" && webhookId) {
            const isValid = await this.verifyWebhookSignature(headers, event, webhookId)
            if (!isValid) {
                this.logger.warn("Invalid PayPal webhook signature")
                return
            }
        }

        // Handle different event types
        switch (event.event_type) {
            case "CHECKOUT.ORDER.APPROVED":
                await this.handleOrderApproved(event)
                break
            case "PAYMENT.CAPTURE.COMPLETED":
                await this.handleCaptureCompleted(event)
                break
            case "PAYMENT.CAPTURE.DENIED":
                await this.handleCaptureDenied(event)
                break
            case "PAYMENT.CAPTURE.REFUNDED":
                await this.handleCaptureRefunded(event)
                break
            default:
                this.logger.log(`Unhandled PayPal webhook event: ${event.event_type}`)
        }
    }

    /**
     * Handle CHECKOUT.ORDER.APPROVED event
     */
    private async handleOrderApproved(event: any): Promise<void> {
        const paypalOrderId = event.resource?.id
        if (!paypalOrderId) return

        this.logger.log(`PayPal order approved: ${paypalOrderId}`)

        // Auto-capture the payment
        try {
            await this.capturePayPalOrder(paypalOrderId)
        } catch (error) {
            this.logger.error(`Failed to auto-capture PayPal order ${paypalOrderId}:`, error.message)
        }
    }

    /**
     * Handle PAYMENT.CAPTURE.COMPLETED event
     */
    private async handleCaptureCompleted(event: any): Promise<void> {
        const customId = event.resource?.custom_id
        if (!customId) return

        this.logger.log(`PayPal capture completed for order: ${customId}`)

        const order = await this.prisma.orders.findFirst({
            where: { order_id: customId },
        })

        if (!order) {
            this.logger.warn(`Order not found for PayPal custom_id: ${customId}`)
            return
        }

        // Update order if not already completed
        if (order.current_status === OrderStatus.PENDING) {
            await this.prisma.orders.update({
                where: { id: order.id },
                data: {
                    current_status: OrderStatus.COMPLETED,
                    paid_method: PaymentMethod.PAYPAL,
                    paid_time: new Date(),
                    paypal_capture_detail: event.resource as any,
                },
            })
        }

        //update bind rewards price
        await this.orderService.updateBindRewards(order)

        if (order.release_rewards_after_paid) {
            await this.orderService.releaseRewards(order)
        }
        await this.orderService.processCallback(order.order_id, order.callback_url)
    }

    /**
     * Handle PAYMENT.CAPTURE.DENIED event
     */
    private async handleCaptureDenied(event: any): Promise<void> {
        const customId = event.resource?.custom_id
        if (!customId) return

        this.logger.warn(`PayPal capture denied for order: ${customId}`)

        // Could update order status or notify user
    }

    /**
     * Handle PAYMENT.CAPTURE.REFUNDED event
     */
    private async handleCaptureRefunded(event: any): Promise<void> {
        const customId = event.resource?.custom_id
        if (!customId) return

        this.logger.log(`PayPal capture refunded for order: ${customId}`)

        // Handle refund logic if needed
    }

    /**
     * Get PayPal order details
     */
    async getPayPalOrderDetails(paypalOrderId: string): Promise<any> {
        const accessToken = await this.getAccessToken()

        try {
            const response = await lastValueFrom(
                this.httpService.get(`${this.baseUrl}/v2/checkout/orders/${paypalOrderId}`, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                }),
            )

            return response.data
        } catch (error) {
            this.logger.error("Failed to get PayPal order details:", error?.response?.data || error.message)
            throw new BadRequestException("Failed to get PayPal order details")
        }
    }
}
