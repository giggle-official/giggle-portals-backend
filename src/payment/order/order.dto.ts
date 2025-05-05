import { ApiProperty, OmitType } from "@nestjs/swagger"
import { orders } from "@prisma/client"
import { JsonValue } from "@prisma/client/runtime/library"
import { isArray, IsInt, IsNotEmpty, IsOptional, Min } from "class-validator"
import { RewardModelDto } from "../rewards-pool/rewards-pool.dto"
import { PaginationDto } from "src/common/common.dto"
import { LinkDetailDto, LinkSummaryDto } from "src/open-app/link/link.dto"
export enum OrderStatus {
    PENDING = "pending",
    REFUNDED = "refunded",
    COMPLETED = "completed",
    CANCELLED = "cancelled",
}

export enum PaymentMethod {
    STRIPE = "stripe",
    WALLET = "wallet",
}

export class OrderDto implements orders {
    id: number
    @ApiProperty({
        description: "The order id",
    })
    order_id: string

    @ApiProperty({
        description: "The description of the order",
        required: false,
    })
    description: string
    @ApiProperty({
        description: "The amount of the order",
    })
    amount: number

    @ApiProperty({
        description: "The owner of the order",
    })
    owner: string
    @ApiProperty({
        description: "The widget tag of the order created by",
        required: false,
    })
    widget_tag: string

    @ApiProperty({
        description: "The app id of the order created by",
        required: false,
    })
    app_id: string

    @ApiProperty({
        description: "The current status of the order",
    })
    current_status: OrderStatus

    @ApiProperty({
        description: "The paid method of the order",
    })
    paid_method: string

    @ApiProperty({
        description: "The stripe invoice id of the order",
    })
    stripe_invoice_id: string

    @ApiProperty({
        description: "The stripe invoice detail of the order",
    })
    stripe_invoice_detail: JsonValue

    @ApiProperty({
        description: "The wallet paid detail if order is paid with wallet",
    })
    wallet_paid_detail: JsonValue

    @ApiProperty({
        description:
            "The related reward pool id of the order, note: this field may be require if we finish our economic model",
        required: false,
    })
    related_reward_id: number

    @ApiProperty({
        description: "The rewards model snapshot of the order",
    })
    rewards_model_snapshot: any

    @ApiProperty({
        description: "The supported payment method of the order",
    })
    supported_payment_method: string[]
    @ApiProperty({
        description: "The callback url of the order",
    })
    callback_url: string

    @ApiProperty({
        description: "The redirect url after order is paid",
    })
    redirect_url: string

    @ApiProperty({
        description: "The paid time of the order",
    })
    paid_time: Date

    @ApiProperty({
        description: "The expire time of the order, default is 15 minutes",
    })
    expire_time: Date

    @ApiProperty({
        description: "The cancelled time of the order",
    })
    cancelled_time: Date

    @ApiProperty({
        description: "The cancelled detail of the order",
    })
    cancelled_detail: JsonValue

    @ApiProperty({
        description: "The created time of the order",
    })
    created_at: Date

    @ApiProperty({
        description: "The updated time of the order",
    })
    updated_at: Date

    @ApiProperty({
        description: "The source link of the order",
    })
    from_source_link: string
}

export class OrderDetailDto extends OmitType(OrderDto, [
    "id",
    "stripe_invoice_detail",
    "stripe_invoice_id",
    "wallet_paid_detail",
    "callback_url",
]) {
    rewards_model_snapshot: RewardModelDto
    @ApiProperty({
        description: "The url of order to pay or check the order status",
    })
    order_url: string

    @ApiProperty({
        description: "The source link summary of the order",
        type: () => LinkSummaryDto,
        required: false,
    })
    source_link_summary: LinkSummaryDto
}

export class ItemDto {
    @ApiProperty({
        description: "The name of the item",
    })
    name: string

    @ApiProperty({
        description: "The unit price of the item",
    })
    unit_price: number

    @ApiProperty({
        description: "The quantity of the item",
    })
    quantity: number
}

export class CreateOrderDto {
    @ApiProperty({
        description: "The amount of the order, only accept integer, 100 means $1.00, min is 1($0.01)",
    })
    @IsInt()
    @IsNotEmpty()
    @Min(1)
    amount: number

    @ApiProperty({ description: "The description of the order", required: false })
    description?: string

    @ApiProperty({
        description:
            "The related reward pool id of the order, note: this field may be require if we finish our economic model",
        required: false,
    })
    related_reward_id?: number

    @ApiProperty({
        description: "The redirect url after order is paid",
        required: false,
    })
    redirect_url?: string

    @ApiProperty({
        description:
            "The callback url of the order, this url will be called when the order is paid or refunded or cancelled",
        required: false,
    })
    callback_url?: string
}

export class OrderListDto {
    @ApiProperty({
        description: "The list of orders",
    })
    orders: OrderDetailDto[]

    @ApiProperty({
        description: "The total number of orders",
    })
    total: number
}

export class OrderListQueryDto extends PaginationDto {
    @ApiProperty({
        description: "The status of the order",
        required: false,
    })
    status?: OrderStatus
}

export class PayWithWalletRequestDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}

export class PayWithStripeRequestDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}

export class PayWithStripeResponseDto {
    @ApiProperty({
        description: "The client secret of the stripe",
    })
    clientSecret: string
}

export class ResendCallbackRequestDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}
