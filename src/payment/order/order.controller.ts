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
} from "./order.dto"
import { ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { OrderService } from "./order.service"
import { UserInfoDTO } from "src/user/user.controller"
import { Request } from "express"
import Stripe from "stripe"

@ApiTags("Order")
@Controller({ path: "api/v1/order" })
export class OrderController {
    constructor(private readonly orderService: OrderService) {}

    @Get("/list")
    @ApiOperation({ summary: "List of user's orders" })
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: OrderListDto })
    async getOrderList(@Query() query: OrderListQueryDto, @Req() req: Request): Promise<OrderListDto> {
        return this.orderService.getOrderList(query, req.user as UserInfoDTO)
    }

    @Get("/detail")
    @ApiOperation({ summary: "Get an order by order id" })
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: OrderDetailDto })
    async getOrder(@Query("order_id") orderId: string, @Req() req: Request): Promise<OrderDetailDto> {
        if (!orderId) {
            throw new BadRequestException("Order id is required")
        }
        return this.orderService.getOrderDetail(orderId, req.user as UserInfoDTO)
    }

    @Post("/create")
    @ApiOperation({ summary: "Create an order" })
    @ApiBody({ type: CreateOrderDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async createOrder(@Body() order: CreateOrderDto, @Req() req: Request): Promise<OrderDetailDto> {
        return this.orderService.createOrder(order, req.user as UserInfoDTO)
    }

    @Post("/payWithWallet")
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: "Pay an order with wallet" })
    @ApiBody({ type: PayWithWalletRequestDto })
    @ApiResponse({ type: OrderDetailDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async payWithWallet(@Body() order: PayWithWalletRequestDto, @Req() req: Request): Promise<OrderDetailDto> {
        return this.orderService.payWithWallet(order, req.user as UserInfoDTO)
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
        return this.orderService.payOrderWithStripe(order, req.user as UserInfoDTO)
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
}
