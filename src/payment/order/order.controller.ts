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
} from "@nestjs/common"
import {
    CreateOrderDto,
    OrderDetailDto,
    OrderListDto,
    OrderListQueryDto,
    PayWithStripeRequestDto,
    PayWithStripeResponseDto,
    PayWithWalletRequestDto,
    ResendCallbackRequestDto,
} from "./order.dto"
import { ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { OrderService } from "./order.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request } from "express"
import Stripe from "stripe"

@Controller({ path: "api/v1/order" })
export class OrderController {
    constructor(private readonly orderService: OrderService) {}

    @Get("/list")
    @ApiOperation({ summary: "List of user's orders", tags: ["Order"] })
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: OrderListDto })
    async getOrderList(@Query() query: OrderListQueryDto, @Req() req: Request): Promise<OrderListDto> {
        return this.orderService.getOrderList(query, req.user as UserJwtExtractDto)
    }

    @Get("/detail")
    @ApiOperation({ summary: "Get an order by order id", tags: ["Order"] })
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: OrderDetailDto })
    async getOrder(@Query("order_id") orderId: string, @Req() req: Request): Promise<OrderDetailDto> {
        if (!orderId) {
            throw new BadRequestException("Order id is required")
        }
        return this.orderService.getOrderDetail(orderId, req.user as UserJwtExtractDto)
    }

    @Post("/create")
    @ApiOperation({ summary: "Create an order", tags: ["Order"] })
    @ApiBody({ type: CreateOrderDto })
    @ApiResponse({ type: OrderDetailDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async createOrder(@Body() order: CreateOrderDto, @Req() req: Request): Promise<OrderDetailDto> {
        return this.orderService.createOrder(order, req.user as UserJwtExtractDto)
    }

    @Post("/payWithWallet")
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: "Pay an order with wallet", tags: ["Order"] })
    @ApiBody({ type: PayWithWalletRequestDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async payWithWallet(@Body() order: PayWithWalletRequestDto, @Req() req: Request): Promise<OrderDetailDto> {
        return this.orderService.payWithWallet(order, req.user as UserJwtExtractDto)
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
        return this.orderService.payOrderWithStripe(order, req.user as UserJwtExtractDto)
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

    @Post("/resend-callback")
    @ApiOperation({ summary: "Resend callback for an order", tags: ["Admin"] })
    @ApiBody({ type: ResendCallbackRequestDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async resendCallback(@Body() order: ResendCallbackRequestDto, @Req() req: Request): Promise<OrderDetailDto> {
        return this.orderService.resendCallback(order, req.user as UserJwtExtractDto)
    }

    @Get("/get-stripe-pkey")
    async getStripePkey(): Promise<{ pkey: string }> {
        return { pkey: process.env.STRIPE_PUBLISHABLE_KEY }
    }

    @Get("/get-stripe-session-status")
    async getStripeSessionStatus(@Query("session_id") sessionId: string): Promise<{ status: string }> {
        return this.orderService.getStripeSessionStatus(sessionId)
    }
}
