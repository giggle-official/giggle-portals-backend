import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    Req,
    Query,
    BadRequestException,
    RawBodyRequest,
    HttpCode,
    HttpStatus,
    Res,
} from "@nestjs/common"
import {
    BindRewardPoolDto,
    CreateOrderDto,
    GetRewardsDetailQueryDto,
    OrderCallbackDto,
    OrderDetailDto,
    OrderListDto,
    OrderListQueryDto,
    OrderRewardsDto,
    PayWithCredit2cRequestDto,
    PayWithPaymentAsiaRequestDto,
    PayWithPaymentAsiaResponseDto,
    PayWithStripeRequestDto,
    PayWithStripeResponseDto,
    PayWithWalletRequestDto,
    PreviewOrderDto,
    RefundOrderDto,
    ReleaseRewardsDto,
    ResendCallbackRequestDto,
    UnbindRewardPoolDto,
    PaymentMethod,
    UpdateRewardsDto,
} from "./order.dto"
import {
    PayWithPayPalRequestDto,
    PayWithPayPalResponseDto,
    CapturePayPalOrderDto,
    PayPalOrderStatusResponseDto,
} from "../paypal/paypal.dto"
import { PaypalService } from "../paypal/paypal.service"
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { OrderService } from "./order.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request, Response } from "express"
import Stripe from "stripe"
import { IsAdminGuard } from "src/auth/is_admin.guard"
import { PaymentAsiaService } from "src/payment/payment-asia/payment-asia.service"
import { PaymentAsiaCallbackDto } from "../payment-asia/payment-asia.dto"
import { IsWidgetGuard } from "src/auth/is_widget.guard"

@Controller({ path: "/api/v1/order" })
export class OrderController {
    constructor(
        private readonly orderService: OrderService,
        private readonly paymentAsiaService: PaymentAsiaService,
        private readonly paypalService: PaypalService,
    ) { }

    @Get("/list")
    @ApiOperation({
        summary: "List of orders",
        description:
            "List of orders, if requester is developer, it will return all orders depends your permission, if requester is user, it will return all orders of specific user",
        tags: ["Order"],
    })
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: OrderListDto })
    @ApiBearerAuth("jwt")
    async getOrderList(@Query() query: OrderListQueryDto, @Req() req: Request): Promise<OrderListDto> {
        return await this.orderService.getOrderList(query, req.user as UserJwtExtractDto)
    }

    @Get("/detail")
    @ApiOperation({ summary: "Get an order by order id", tags: ["Order"] })
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: OrderDetailDto })
    async getOrder(@Query("order_id") orderId: string, @Req() req: Request): Promise<OrderDetailDto> {
        if (!orderId) {
            throw new BadRequestException("Order id is required")
        }
        return await this.orderService.getOrderDetail(orderId, req.user as UserJwtExtractDto)
    }

    @Post("/create")
    @ApiOperation({ summary: "Create an order", tags: ["Order"] })
    @ApiBody({ type: CreateOrderDto })
    @ApiResponse({ type: OrderDetailDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async createOrder(@Body() order: CreateOrderDto, @Req() req: Request): Promise<OrderDetailDto> {
        return await this.orderService.createOrder(order, req.user as UserJwtExtractDto)
    }

    @Post("/preview")
    @ApiOperation({
        summary: "Preview an order",
        description:
            "Preview an order, you can use this api to preview the order detail before you create an order, such as the estimated rewards, the order detail, etc.",
        tags: ["Order"],
    })
    @ApiBody({ type: CreateOrderDto })
    @ApiResponse({ type: PreviewOrderDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async previewOrder(@Body() order: CreateOrderDto, @Req() req: Request): Promise<PreviewOrderDto> {
        return await this.orderService.previewOrder(order, req.user as UserJwtExtractDto)
    }

    @Post("/release-rewards")
    @ApiOperation({
        summary: "Release rewards for an order",
        description: "Release rewards for an order, after the released, order can not be refunded",
    })
    @ApiBody({ type: ReleaseRewardsDto })
    @ApiResponse({ type: OrderRewardsDto, isArray: true })
    @UseGuards(IsWidgetGuard)
    @HttpCode(HttpStatus.OK)
    async releaseRewardsByDeveloper(@Body() body: ReleaseRewardsDto) {
        return await this.orderService.releaseRewardsByDeveloper(body)
    }

    @Post("/bind-reward-pool")
    @ApiOperation({ summary: "Bind a reward pool to an order", tags: ["Order"] })
    @ApiBody({ type: BindRewardPoolDto })
    @ApiResponse({ type: OrderDetailDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async bindRewardPoolByUser(@Body() body: BindRewardPoolDto, @Req() req: Request) {
        return await this.orderService.bindRewardPoolByUser(body, req.user as UserJwtExtractDto)
    }

    @Post("/payWithWallet")
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: "Pay an order with wallet", tags: ["Order"] })
    @ApiBody({ type: PayWithWalletRequestDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async payWithWallet(@Body() order: PayWithWalletRequestDto, @Req() req: Request): Promise<OrderDetailDto> {
        return await this.orderService.payWithWallet(order, req.user as UserJwtExtractDto)
    }

    @Post("/resend-callback")
    @ApiOperation({ summary: "Resend callback for an order", tags: ["Order"] })
    @ApiBody({ type: ResendCallbackRequestDto })
    @ApiResponse({ type: OrderCallbackDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async resendCallbackByUser(
        @Body() order: ResendCallbackRequestDto,
        @Req() req: Request,
    ): Promise<OrderCallbackDto> {
        return await this.orderService.resendCallback(order, req.user as UserJwtExtractDto)
    }

    @Post("/payWithStripe")
    @ApiOperation({ summary: "Pay an order with stripe" })
    @ApiExcludeEndpoint()
    @ApiBody({ type: PayWithStripeRequestDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: PayWithStripeResponseDto })
    async payOrderWithStripe(
        @Body() order: PayWithStripeRequestDto,
        @Req() req: Request,
    ): Promise<PayWithStripeResponseDto> {
        return await this.orderService.payOrderWithStripe(order, req.user as UserJwtExtractDto)
    }

    @Post("/pay-with-credit")
    @ApiOperation({ summary: "Create an order and pay with credit", tags: ["Order"] })
    @ApiBody({ type: CreateOrderDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async payOrderWithCredit(@Body() body: CreateOrderDto, @Req() req: Request): Promise<OrderDetailDto> {
        return await this.orderService.createAndPayCreditOrder(body, req.user as UserJwtExtractDto)
    }

    @Post("/wallet-quick-pay")
    @ApiOperation({ summary: "Create an order and pay with wallet", tags: ["Order"] })
    @ApiBody({ type: CreateOrderDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async payOrderWithWallet(@Body() body: CreateOrderDto, @Req() req: Request): Promise<OrderDetailDto> {
        return await this.orderService.createOrderAndPayWithWallet(body, req.user as UserJwtExtractDto)
    }

    @Post("/refund")
    @ApiOperation({
        summary: "Refund an order",
        description:
            "Refund an order, only support completed order(not rewards released) and paid time is not more than 10 days, currently we only support refund with credit and wallet",
        tags: ["Order"],
    })
    @ApiBearerAuth("widget")
    @ApiBody({ type: RefundOrderDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(IsWidgetGuard)
    async refundOrder(@Body() body: RefundOrderDto): Promise<OrderDetailDto> {
        return await this.orderService.refundOrder(body)
    }

    @Post("update-rewards")
    @ApiOperation({ summary: "Update rewards for an order", tags: ["Order"] })
    @ApiBody({ type: UpdateRewardsDto })
    @ApiResponse({ type: OrderRewardsDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(IsWidgetGuard)
    async updateRewards(@Body() body: UpdateRewardsDto): Promise<OrderDetailDto> {
        return await this.orderService.updateRewards(body)
    }

    //payment asia
    @Post("/payWithPaymentAsia")
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: "Pay an order with payment asia", tags: ["Order"] })
    @ApiBody({ type: PayWithPaymentAsiaRequestDto })
    @ApiResponse({ type: PayWithPaymentAsiaResponseDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async payWithPaymentAsia(
        @Body() order: PayWithPaymentAsiaRequestDto,
        @Req() req: Request,
    ): Promise<PayWithPaymentAsiaResponseDto> {
        return await this.paymentAsiaService.payWithPaymentAsia(order, req.user as UserJwtExtractDto, req)
    }

    //pay with credit2c
    @Post("/payWithCredit2c")
    @ApiOperation({ summary: "Pay an order with credit2c", tags: ["Order"] })
    @ApiBody({ type: PayWithCredit2cRequestDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async payWithCredit2c(@Body() order: PayWithCredit2cRequestDto, @Req() req: Request): Promise<OrderDetailDto> {
        return await this.orderService.payWithCredit2c(order, req.user as UserJwtExtractDto)
    }

    @Post("/payment-asia/callback")
    @ApiExcludeEndpoint()
    @HttpCode(HttpStatus.OK)
    async paymentAsiaCallback(@Body() body: PaymentAsiaCallbackDto) {
        return await this.paymentAsiaService.processPaymentAsiaCallback(body)
    }

    @Post("/payment-asia/redirect")
    @ApiExcludeEndpoint()
    @HttpCode(HttpStatus.OK)
    async paymentAsiaRedirect(@Body() body: PaymentAsiaCallbackDto, @Res() res: Response) {
        await this.paymentAsiaService.processPaymentAsiaRedirect(body, res)
    }

    @Get("/rewards-detail")
    @ApiOperation({ summary: "Get rewards detail for an order", tags: ["Order"] })
    @ApiResponse({ type: OrderRewardsDto, isArray: true })
    async getRewardsDetail(@Query() query: GetRewardsDetailQueryDto): Promise<OrderRewardsDto[]> {
        if (!query.order_id && !query.statement_id) {
            throw new BadRequestException("Order id or statement id is required")
        }
        return await this.orderService.getRewardsDetail(query.order_id, query.statement_id)
    }

    // PayPal Payment Endpoints
    @Post("/payWithPayPal")
    @ApiOperation({ summary: "Pay an order with PayPal", tags: ["Order"] })
    @ApiBody({ type: PayWithPayPalRequestDto })
    @ApiResponse({ type: PayWithPayPalResponseDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async payWithPayPal(@Body() body: PayWithPayPalRequestDto, @Req() req: Request): Promise<PayWithPayPalResponseDto> {
        const userInfo = req.user as UserJwtExtractDto
        const userProfile = await this.orderService["userService"].getProfile(userInfo)

        const { allow, message, order } = await this.orderService.allowPayOrder(
            body.order_id,
            userProfile,
            PaymentMethod.PAYPAL,
        )
        if (!allow) {
            throw new BadRequestException(message)
        }

        const result = await this.paypalService.createPayPalOrder(order)
        return {
            paypal_order_id: result.orderId,
            approval_url: result.approvalUrl,
        }
    }

    @Get("/paypal/order-status")
    @ApiOperation({ summary: "Get PayPal order status", tags: ["Order"] })
    @ApiResponse({ type: PayPalOrderStatusResponseDto })
    async getPayPalOrderStatus(@Query("paypal_order_id") paypalOrderId: string): Promise<PayPalOrderStatusResponseDto> {
        if (!paypalOrderId) {
            throw new BadRequestException("PayPal order ID is required")
        }
        const details = await this.paypalService.getPayPalOrderDetails(paypalOrderId)
        return {
            status: details.status,
            order_id: details.purchase_units?.[0]?.custom_id || "",
            paypal_order_id: paypalOrderId,
        }
    }

    @Post("/paypal/webhook")
    @ApiExcludeEndpoint()
    @HttpCode(HttpStatus.OK)
    async processPayPalWebhook(@Req() req: Request, @Body() body: any) {
        const headers = {
            "paypal-auth-algo": req.headers["paypal-auth-algo"] as string,
            "paypal-cert-url": req.headers["paypal-cert-url"] as string,
            "paypal-transmission-id": req.headers["paypal-transmission-id"] as string,
            "paypal-transmission-sig": req.headers["paypal-transmission-sig"] as string,
            "paypal-transmission-time": req.headers["paypal-transmission-time"] as string,
        }
        await this.paypalService.processWebhookEvent(body, headers)
        return { received: true }
    }

    @ApiExcludeEndpoint()
    @Post("/stripe/webhook")
    @HttpCode(HttpStatus.OK)
    async processStripeWebhook(@Req() req: RawBodyRequest<Request>) {
        const localRecord = await this.orderService.recordStripeEvent(req)
        const eventType = (localRecord.raw_data as unknown as Stripe.Event).type
        switch (eventType) {
            case "invoice.paid":
                return this.orderService.stripeInvoicePaid(localRecord.id)
            default:
                return {}
        }
    }

    @Post("/admin-resend-callback")
    @ApiOperation({ summary: "Resend callback for an order", tags: ["Order Management"] })
    @ApiBody({ type: ResendCallbackRequestDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(IsAdminGuard)
    async resendCallback(@Body() order: ResendCallbackRequestDto, @Req() req: Request): Promise<OrderDetailDto> {
        return await this.orderService.resendCallback(order, req.user as UserJwtExtractDto)
    }

    @UseGuards(IsAdminGuard)
    @Post("/admin-bind-reward-pool")
    @ApiOperation({ summary: "Bind a reward pool to an order", tags: ["Order Management"] })
    @ApiBody({ type: BindRewardPoolDto })
    @ApiResponse({ type: OrderDetailDto })
    async bindRewardPool(@Body() body: BindRewardPoolDto) {
        return await this.orderService.bindRewardPool(body)
    }

    @Post("/admin-unbind-reward-pool")
    @UseGuards(IsAdminGuard)
    @ApiOperation({ summary: "Unbind a reward pool from an order", tags: ["Order Management"] })
    @ApiBody({ type: UnbindRewardPoolDto })
    @ApiResponse({ type: OrderDetailDto })
    async unbindRewardPool(@Body() body: UnbindRewardPoolDto) {
        return await this.orderService.unbindRewardPool(body)
    }

    @Post("/admin-release-rewards")
    @UseGuards(IsAdminGuard)
    @ApiOperation({ summary: "Release rewards for an order", tags: ["Order Management"] })
    @ApiBody({ type: ReleaseRewardsDto })
    @ApiResponse({ type: OrderDetailDto })
    async releaseRewards(@Body() body: ReleaseRewardsDto) {
        return await this.orderService.releaseRewardsRequest(body)
    }

    @Get("/get-stripe-pkey")
    @ApiExcludeEndpoint()
    async getStripePkey(): Promise<{ pkey: string }> {
        return { pkey: process.env.STRIPE_PUBLISHABLE_KEY }
    }

    @Get("/get-stripe-session-status")
    @ApiExcludeEndpoint()
    async getStripeSessionStatus(@Query("session_id") sessionId: string): Promise<{ status: string }> {
        return this.orderService.getStripeSessionStatus(sessionId)
    }
}
