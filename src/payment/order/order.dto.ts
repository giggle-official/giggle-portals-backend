import { ApiProperty, OmitType } from "@nestjs/swagger"
import { orders, user_rewards } from "@prisma/client"
import { Decimal, JsonValue } from "@prisma/client/runtime/library"
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { LinkSummaryDto } from "src/open-app/link/link.dto"
import { LimitOffer, PoolResponseDto, RewardAllocateRoles, RewardSnapshotDto } from "../rewards-pool/rewards-pool.dto"
import { Type } from "class-transformer"
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
        description: "The costs allocation of the order",
    })
    costs_allocation: JsonValue

    @ApiProperty({
        description: "The release rewards after paid of the order",
    })
    release_rewards_after_paid: boolean

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

export class EstimatedRewardsDto {
    @ApiProperty({
        description: "The base rewards of the order",
    })
    base_rewards: number

    @ApiProperty({
        description: "The bonus rewards of the order",
    })
    bonus_rewards: number

    @ApiProperty({
        description: "The total rewards of the order",
    })
    total_rewards: number

    @ApiProperty({
        description: "The limit offer of the order",
    })
    limit_offer: LimitOffer
}

export class OrderDetailDto extends OmitType(OrderDto, [
    "id",
    "stripe_invoice_detail",
    "stripe_invoice_id",
    "wallet_paid_detail",
    "costs_allocation",
    "rewards_model_snapshot",
    "callback_url",
]) {
    @ApiProperty({
        description: "The rewards model snapshot of the order",
        type: () => RewardSnapshotDto,
    })
    rewards_model_snapshot: RewardSnapshotDto

    @ApiProperty({
        description: "The current reward pool detail of the order",
        type: () => PoolResponseDto,
    })
    current_reward_pool_detail: PoolResponseDto

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

    @ApiProperty({
        description: "The costs allocation of the order",
        type: () => [OrderCostsAllocationDto],
        required: false,
    })
    costs_allocation: OrderCostsAllocationDto[]

    @ApiProperty({
        description: "The estimated rewards of the order",
        type: () => EstimatedRewardsDto,
    })
    estimated_rewards: EstimatedRewardsDto
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

export enum OrderCostType {
    DEVELOPER_COST = "developer_cost",
    GOODS_COST = "goods_cost",
    CREATOR_COST = "creator_cost",
    PLATFORM = "platform",
}

export class OrderCostsAllocationDto {
    @ApiProperty({
        description: "Cost amount of the order, must be integer, 100 means $1.00, min is 10($0.10)",
    })
    @IsInt()
    @IsNotEmpty()
    @Min(10)
    amount: number

    @ApiProperty({
        description: "The type of the cost",
        enum: OrderCostType,
    })
    @IsEnum(OrderCostType)
    @IsNotEmpty()
    type: OrderCostType

    //@ApiProperty({
    //    description: "The wallet address of the cost, when order paid, the cost will be distributed to this wallet",
    //})
    //@IsNotEmpty()
    //@IsString()
    //distribute_wallet: string
}

export class CreateOrderDto {
    @ApiProperty({
        description: "The amount of the order, only accept integer, 100 means $1.00, min is 1($0.01)",
    })
    @IsInt()
    @IsNotEmpty()
    @Min(1)
    amount: number

    @ApiProperty({
        description: "Release rewards after paid of the order, default is false",
        required: false,
        default: false,
    })
    release_rewards_after_paid?: boolean

    @ApiProperty({
        description:
            "The token of the order rewards, if not provided, the default token will be used, this token must be app bind ip or child ip of app bind ip",
        required: false,
    })
    reward_token?: string

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

    @ApiProperty({
        description: `The costs of the order.
    Can be multiple costs and the total amount of the costs must be less than the 90% of the amount of the order.
    The costs will be distributed to the distribute_wallet provided.`,
        type: () => [OrderCostsAllocationDto],
        required: false,
    })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => OrderCostsAllocationDto)
    costs_allocation?: OrderCostsAllocationDto[]
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

    @ApiProperty({
        description: "The new callback url, if not provided, the old callback url will be used",
        required: false,
    })
    new_callback_url?: string
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

export enum RewardType {
    ORDER = "order",
    AIRDROP = "airdrop",
}

export class UserRewards implements user_rewards {
    @ApiProperty({
        description: "The id of the order rewards",
    })
    id: number

    @ApiProperty()
    statement_id: number

    @ApiProperty({
        description: "Whether the rewards is cost",
    })
    is_cost: boolean

    @ApiProperty({
        description: "The type of the cost",
    })
    cost_type: OrderCostType

    @ApiProperty({
        description: "The amount of the cost",
    })
    cost_amount: Decimal

    @ApiProperty()
    rewards_type: string

    @ApiProperty({
        description: "The order id",
    })
    order_id: string

    @ApiProperty({
        description: "The user of the order rewards",
    })
    user: string

    @ApiProperty({
        description: "The actual allocated role of the order rewards",
    })
    role: RewardAllocateRoles

    @ApiProperty({
        description: "The expected role of the order rewards",
    })
    expected_role: RewardAllocateRoles

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
        description: "The note of the order rewards",
    })
    note: string

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
    "user",
    "released_per_day",
    "released_rewards",
    "locked_rewards",
    "withdraw_rewards",
    "allocate_snapshot",
    "cost_amount",
    "cost_type",
    "is_cost",
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

    @ApiProperty({
        description: "The cost amount of the order rewards",
    })
    cost_amount: string

    @ApiProperty({
        description: "The cost type of the order rewards",
        enum: OrderCostType,
    })
    cost_type: OrderCostType

    @ApiProperty({
        description: "The user info of the order rewards",
    })
    user_info: {
        username: string
        avatar: string
        email: string
    }
}

export class OrderCallbackDto extends OrderDetailDto {
    @ApiProperty({
        description: "The jwt verify of the order",
    })
    jwt_verify: string
}

export class GetRewardsDetailQueryDto {
    @ApiProperty({
        description: "The order id",
        required: false,
    })
    order_id?: string

    @ApiProperty({
        description: "The statement id",
        required: false,
    })
    statement_id?: string
}
