import { ApiProperty, OmitType } from "@nestjs/swagger"
import { orders, user_rewards } from "@prisma/client"
import { Decimal, JsonValue } from "@prisma/client/runtime/library"
import {
    IsBoolean,
    IsEmail,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { LinkSummaryDto } from "src/open-app/link/link.dto"
import {
    DeveloperSpecifiedRewardSnapshotDto,
    LimitOffer,
    PoolResponseDto,
    RewardAllocateRoles,
    RewardSnapshotDto,
} from "../rewards-pool/rewards-pool.dto"
import { Type } from "class-transformer"
export enum OrderStatus {
    PENDING = "pending",
    REFUNDING = "refunding",
    PARTIAL_REFUNDED = "partial_refunded",
    REFUNDED = "refunded",
    COMPLETED = "completed",
    CANCELLED = "cancelled",
    REWARDS_RELEASED = "rewards_released",
}

export enum PaymentMethod {
    STRIPE = "stripe",
    WALLET = "wallet",
    WECHAT = "wechat",
    CREDIT = "credit",
    CREDIT2C = "2c-credit",
    CUSTOMIZED = "customized",
}

export class OrderRefundedDetailDto {
    @ApiProperty({
        description: "The amount of the refunded credit",
    })
    amount: number

    @ApiProperty({
        description: "The order amount after refund",
    })
    order_amount_after_refund: number

    @ApiProperty({
        description: "The refunded time",
    })
    refunded_time: Date
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
        description: "The item of the order",
    })
    item: string

    @ApiProperty({
        description: "The ip id of the order",
    })
    ip_id: number

    @ApiProperty({
        description: "The owner of the order",
    })
    owner: string

    @ApiProperty({
        description: "The sales agent of the order",
    })
    sales_agent: string

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
        description: "The is credit top up of the order",
    })
    is_credit_top_up: boolean

    @ApiProperty({
        description: "The current status of the order",
    })
    current_status: OrderStatus

    @ApiProperty({
        description: "The free credit paid of the order",
    })
    free_credit_paid: number

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
        description: "The ip holder revenue re-allocation of the order",
    })
    ip_holder_revenue_reallocation: JsonValue

    @ApiProperty({
        description: "The release rewards after paid of the order",
    })
    release_rewards_after_paid: boolean

    @ApiProperty({
        description: "The buyback after paid of the order",
    })
    buyback_after_paid: boolean

    @ApiProperty({
        description: "The buyback result of the order",
    })
    buyback_result: JsonValue

    @ApiProperty({
        description: "The buyback order id of the order",
    })
    buyback_order_id: string

    @ApiProperty({
        description: "The buyback fee transferred of the order",
    })
    buyback_fee_transferred: boolean

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
        description: "The allow free credit of the order",
    })
    allow_free_credit: boolean

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

    @ApiProperty({
        description: "The phone number of the order",
    })
    phone_number: string

    @ApiProperty({
        description: "The phone national code of the order",
    })
    phone_national: string

    @ApiProperty({
        description: "The customer ip of the order",
    })
    customer_ip: string

    @ApiProperty({
        description: "The payment asia callback of the order",
    })
    payment_asia_callback: JsonValue

    @ApiProperty({
        description: "The credit paid amount of the order",
    })
    credit_paid_amount: number

    @ApiProperty({
        description: "The refunded amount of the order",
    })
    refunded_amount: number

    @ApiProperty({
        description: "The refund time of the order",
    })
    refund_time: Date

    @ApiProperty({
        description: "The refund status of the order",
    })
    refund_status: string

    @ApiProperty({
        description: "The refund error of the order",
    })
    refund_error: JsonValue

    @ApiProperty({
        description: "The refund detail of the order",
    })
    refund_detail: JsonValue
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
        description:
            "Rewards amount after credit deducted of the order, this may different from base_rewards if user has free credit and payment method includes credit",
    })
    rewards_after_credit_deduct: number

    @ApiProperty({
        description: "The limit offer of the order",
        type: () => LimitOffer,
    })
    limit_offer: LimitOffer
}

export class OrderDetailDto extends OmitType(OrderDto, [
    "id",
    "stripe_invoice_detail",
    "stripe_invoice_id",
    "sales_agent",
    "wallet_paid_detail",
    "costs_allocation",
    "ip_holder_revenue_reallocation",
    "rewards_model_snapshot",
    "callback_url",
    "phone_number",
    "phone_national",
    "customer_ip",
    "payment_asia_callback",
    "buyback_result",
    "buyback_order_id",
    "buyback_fee_transferred",
    "refund_detail",
    "allow_free_credit",
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
        description: "The ip holder revenue re-allocation of the order",
        type: () => [IpHolderRevenueReallocationDto],
        required: false,
    })
    ip_holder_revenue_reallocation: IpHolderRevenueReallocationDto[]

    @ApiProperty({
        description: "The estimated rewards of the order",
        type: () => EstimatedRewardsDto,
    })
    estimated_rewards: EstimatedRewardsDto

    @ApiProperty({
        description: "The refund detail of the order",
        type: () => [OrderRefundedDetailDto],
    })
    refund_detail: OrderRefundedDetailDto[]
}

export class PreviewOrderDto extends OmitType(OrderDetailDto, ["order_id", "order_url", "current_status"]) {}

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

export enum IpHolderRevenueReallocationRole {
    CREATOR = "creator",
    UPLOADER = "uploader",
    REMIXER = "remixer",
    OTHER = "other",
}

export class IpHolderRevenueReallocationDto {
    @ApiProperty({
        description: "The user email of the ip holder, if not exists, this record will be ignored",
    })
    @IsNotEmpty()
    @IsEmail()
    email: string

    @ApiProperty({
        description: "The allocate role of the ip holder revenue",
        enum: IpHolderRevenueReallocationRole,
    })
    @IsEnum(IpHolderRevenueReallocationRole)
    @IsNotEmpty()
    allocate_role: string

    @ApiProperty({
        description: "The percent of the ip holder revenue, must be integer, 1 means 100%, min is 1(1%)",
    })
    @IsInt()
    @IsNotEmpty()
    @Min(1)
    @Max(100)
    percent: number
}

export class OrderCostsAllocationDto {
    @ApiProperty({
        description: "Cost amount of the order, must be integer, 100 means $1.00, min is 1($0.01)",
    })
    @IsInt()
    @IsNotEmpty()
    @Min(1)
    amount: number

    @ApiProperty({
        description: "The type of the cost",
        enum: OrderCostType,
    })
    @IsEnum(OrderCostType)
    @IsNotEmpty()
    type: OrderCostType

    @ApiProperty({
        description:
            "The user of the cost, when order paid, the cost will be distributed to this user, default is developer",
        required: false,
    })
    @IsOptional()
    @IsString()
    email?: string
}

export class CreateOrderDto {
    @ApiProperty({
        description:
            "The order id, if provided, this parameter is use for avoid duplicate order,if not provided, a new order id will be generated.",
    })
    @IsUUID()
    @IsOptional()
    order_id?: string

    @ApiProperty({
        description: "The amount of the order, only accept integer, 100 means $1.00, min is 1($0.01)",
    })
    @IsInt()
    @IsNotEmpty()
    @Min(0)
    amount: number

    @ApiProperty({
        description: "The item of the order",
        required: false,
    })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    item?: string

    @ApiProperty({
        description:
            "Release rewards after paid of the order, default is `false`, **NOTE:** order will be **NOT** refundable if rewards are released",
        required: false,
        default: false,
    })
    release_rewards_after_paid?: boolean

    @ApiProperty({
        description:
            "Buyback after paid of the order, default is `false`,if release_rewards_after_paid set to `true`, the rewards will be released after buyback",
        required: false,
        default: false,
    })
    buyback_after_paid?: boolean

    @ApiProperty({
        description:
            "Allow free credit of the order, default is `true`, if set to `false`, the order will not be allowed to use free credit",
        required: false,
        default: true,
    })
    @IsOptional()
    @IsBoolean()
    allow_free_credit?: boolean

    @ApiProperty({
        description: "The rewards model of the order, this only allow requester is developer",
        type: () => DeveloperSpecifiedRewardSnapshotDto,
        required: false,
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => DeveloperSpecifiedRewardSnapshotDto)
    rewards_model?: DeveloperSpecifiedRewardSnapshotDto

    @ApiProperty({
        description:
            "The token of the order rewards, if not provided, the default token will be used, this token must be app bind ip or child ip of app bind ip",
        required: false,
    })
    reward_token?: string

    @ApiProperty({
        description:
            "The allowed payment methods of the order, if not provided, the default payment method will be used",
        required: false,
        enum: PaymentMethod,
        isArray: true,
    })
    allowed_payment_methods?: PaymentMethod[]

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
        description: "The user jwt, this parameter is required if requester is from developer",
        required: false,
    })
    user_jwt?: string

    @ApiProperty({
        description: `The costs of the order.
    This parameter is only allowed when requester is developer.
    Can be multiple costs and the total amount of the costs must be less than the 90% of the amount of the order.
    The costs will be distributed to the distribute_wallet provided.`,
        type: () => [OrderCostsAllocationDto],
        required: false,
    })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => OrderCostsAllocationDto)
    costs_allocation?: OrderCostsAllocationDto[]

    @ApiProperty({
        description: `The ip holder revenue re-allocation of the order,
    This parameter is only allowed when requester is developer.
    For example, if the order amount is $100, the ip holder revenue re-allocation is:

\`\`\`json
[
    {
        user_id: "123",
        percent: 50
    },
    {
        user_id: "456",
        percent: 50
    }
]
\`\`\`

The order revenue will be distributed to the user 123 and 456, all of them will get 50%($50.00) of the order revenue. ip holder will get **$0** of the this order but also need to release token if order paid.`,
        type: () => [IpHolderRevenueReallocationDto],
        required: false,
    })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => IpHolderRevenueReallocationDto)
    ip_holder_revenue_reallocation?: IpHolderRevenueReallocationDto[]
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

export class PayWithCreditRequestDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}

export class RefundOrderDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string

    @ApiProperty({
        description: `
The amount of the order to refund, if not specified, the order amount will be refunded, only accept integer, 100 means $1.00, min is 1($0.01).
For wallet paid orders, currently we only support refund with the full amount of the order.
            `,
        required: false,
    })
    @IsInt()
    @IsOptional()
    @Min(1)
    refund_amount?: number
}

export class PayWithPaymentAsiaRequestDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string

    @ApiProperty({
        description: "The phone national code of the user",
    })
    phone_national: string

    @ApiProperty({
        description: "The phone number of the user",
    })
    @IsNotEmpty()
    @Matches(/^\d{1,15}$/, { message: "Phone number must be 1-15 digits" })
    phone_number: string

    @ApiProperty({
        description: "The method of the payment",
        enum: ["Wechat", "Alipay"],
    })
    method: "Wechat" | "Alipay"
}

export class PayWithPaymentAsiaResponseDto {
    url: string
    params: Record<string, string>
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
        description: "The lock days of the order rewards",
    })
    lock_days: number

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
        description: "The remark of the order rewards, this value is specified by developer",
    })
    remark: string

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

export class PayWithCredit2cRequestDto {
    @ApiProperty({
        description: "The order id",
    })
    order_id: string
}
