import { ApiProperty, OmitType } from "@nestjs/swagger"
import { orders, user_rewards } from "@prisma/client"
import { Decimal, JsonValue } from "@prisma/client/runtime/library"
import { IsInt, IsNotEmpty, Min } from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { LinkSummaryDto } from "src/open-app/link/link.dto"
import { RewardAllocateRoles, RewardSnapshotDto } from "../rewards-pool/rewards-pool.dto"
export enum OrderStatus {
    PENDING = "pending",
    REFUNDING = "refunding",
    REFUNDED = "refunded",
    COMPLETED = "completed",
    CANCELLED = "cancelled",
    REWARDS_RELEASED = "rewards_released",
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
    @ApiProperty({
        description: "The rewards model snapshot of the order",
    })
    rewards_model_snapshot: any
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
        description: "The url to pay with stripe",
    })
    url: string
}

export class ResendCallbackRequestDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}

export class BindRewardPoolDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}

export class UnbindRewardPoolDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}

export class ReleaseRewardsDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}

export class UserRewards implements user_rewards {
    @ApiProperty({
        description: "The id of the order rewards",
    })
    id: number

    @ApiProperty({
        description: "The order id",
    })
    order_id: string

    @ApiProperty({
        description: "The user of the order rewards",
    })
    user: string

    @ApiProperty({
        description: "The role of the order rewards",
    })
    role: RewardAllocateRoles

    @ApiProperty({
        description: "The wallet address of the order rewards",
    })
    wallet_address: string

    @ApiProperty({
        description: "The rewards of the order rewards",
    })
    rewards: Decimal

    @ApiProperty({
        description: "The token of the order rewards",
    })
    token: string

    @ApiProperty({
        description: "The ticker of the order rewards",
    })
    ticker: string

    @ApiProperty({
        description: "The start allocate of the order rewards",
    })
    start_allocate: Date

    @ApiProperty({
        description: "The end allocate of the order rewards",
    })
    end_allocate: Date

    @ApiProperty({
        description: "The released per day of the order rewards",
    })
    released_per_day: Decimal

    @ApiProperty({
        description: "The released rewards of the order rewards",
    })
    released_rewards: Decimal

    @ApiProperty({
        description: "The locked rewards of the order rewards",
    })
    locked_rewards: Decimal

    @ApiProperty({
        description: "The withdraw rewards of the order rewards",
    })
    withdraw_rewards: Decimal

    @ApiProperty({
        description: "The allocate snapshot of the order rewards",
    })
    allocate_snapshot: JsonValue

    @ApiProperty({
        description: "The created at of the order rewards",
    })
    created_at: Date

    @ApiProperty({
        description: "The updated at of the order rewards",
    })
    updated_at: Date
}

export class OrderRewardsDto extends OmitType(UserRewards, [
    "id",
    "rewards",
    "released_per_day",
    "released_rewards",
    "locked_rewards",
    "withdraw_rewards",
    "allocate_snapshot",
]) {
    @ApiProperty({
        description: "The rewards of the order rewards",
    })
    rewards: string

    @ApiProperty({
        description: "The released per day of the order rewards",
    })
    released_per_day: string

    @ApiProperty({
        description: "The released rewards of the order rewards",
    })
    released_rewards: string

    @ApiProperty({
        description: "The locked rewards of the order rewards",
    })
    locked_rewards: string

    @ApiProperty({
        description: "The withdraw rewards of the order rewards",
    })
    withdraw_rewards: string
}
