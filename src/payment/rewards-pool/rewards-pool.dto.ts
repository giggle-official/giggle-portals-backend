import { ApiProperty, OmitType, PickType } from "@nestjs/swagger"
import { reward_pool_on_chain_status, reward_pools } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import { Type } from "class-transformer"
import {
    ArrayMinSize,
    IsArray,
    IsDate,
    IsDateString,
    IsEmail,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Max,
    Min,
    ValidateNested,
} from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { OrderRewardsDto } from "../order/order.dto"
export enum RewardAllocateType {
    TOKEN = "token",
    USDC = "usdc",
}

export enum RewardAllocateRoles {
    BUYBACK = "buyback",
    //INVITER = "inviter",
    //DEVELOPER = "developer",
    CUSTOMIZED = "customized",
    PLATFORM = "platform",
    IPHOLDER = "ip-holder",
}

export class Pool implements reward_pools {
    @ApiProperty({ description: "ID of the pool" })
    id: number

    @ApiProperty({ description: "Token of the pool" })
    token: string

    @ApiProperty({ description: "Ticker of the pool" })
    ticker: string

    @ApiProperty({ description: "Owner of the pool" })
    owner: string

    @ApiProperty({ description: "Unit price of the token" })
    unit_price: Decimal

    @ApiProperty({ description: "Revenue ratio of the pool" })
    revenue_ratio: any

    @ApiProperty({ description: "Address of the pool" })
    address: string

    @ApiProperty({ description: "On chain status of the pool" })
    on_chain_status: reward_pool_on_chain_status

    @ApiProperty({ description: "On chain try count of the pool" })
    on_chain_try_count: number

    @ApiProperty({ description: "On chain detail of the pool" })
    on_chain_detail: any

    @ApiProperty({ description: "On chain error of the pool" })
    on_chain_error: any

    @ApiProperty({ description: "Buyback address of the pool" })
    buyback_address: string

    @ApiProperty({ description: "Injected token amount of the pool" })
    injected_amount: Decimal

    @ApiProperty({ description: "Rewarded token amount of the pool" })
    rewarded_amount: Decimal

    @ApiProperty({ description: "Current token balance of the pool" })
    current_balance: Decimal

    @ApiProperty({ description: "Created at" })
    created_at: Date

    @ApiProperty({ description: "Updated at" })
    updated_at: Date
}

export class PoolResponseDto extends OmitType(Pool, [
    "unit_price",
    "injected_amount",
    "rewarded_amount",
    "current_balance",
    "on_chain_error",
    "on_chain_status",
    "on_chain_detail",
    "on_chain_try_count",
]) {
    @ApiProperty({ description: "Unit price of the token" })
    unit_price: string

    @ApiProperty({ description: "Injected amount of the pool" })
    injected_amount: string

    @ApiProperty({ description: "Rewarded amount of the pool" })
    rewarded_amount: string

    @ApiProperty({ description: "Current balance of the pool" })
    current_balance: string

    @ApiProperty({ description: "Current balance of the pool in USDC" })
    current_balance_in_usdc: string

    @ApiProperty({ description: "Limit offer of the pool", isArray: true })
    @ValidateNested({ each: true })
    @Type(() => LimitOffer)
    limit_offers: LimitOffer[]

    @ApiProperty({ description: "Owed amount of the pool" })
    owed_amount: number

    @ApiProperty({ description: "Buyback burn ratio of the pool" })
    buyback_burn_ratio: number
}

export class RewardAllocateRatio {
    @ApiProperty({
        description: "Address of the account, if you setting customized role, you must set this",
        required: false,
    })
    @IsString()
    address: string

    @ApiProperty({ description: "Ratio of tokens to be allocated to the pool, sum of ratios must be 90" })
    @IsNumber()
    @IsPositive()
    ratio: number

    @ApiProperty({
        description: "Role of the account, platform always has 10% of the revenue",
        enum: RewardAllocateRoles,
    })
    @IsEnum(RewardAllocateRoles)
    @IsNotEmpty()
    role: RewardAllocateRoles

    @ApiProperty({
        description: "Type of the allocation, currently we only support usdc, so keep this as usdc",
        enum: RewardAllocateType,
    })
    @IsEnum(RewardAllocateType)
    @IsNotEmpty()
    allocate_type: RewardAllocateType
}

export class LimitOffer {
    @ApiProperty({ description: "External ratio of the limit offer" })
    @IsNumber()
    @IsPositive()
    @IsInt()
    @Min(101)
    @Max(200)
    external_ratio: number

    @ApiProperty({ description: "Start date of the limit offer" })
    @IsDateString()
    start_date: Date

    @ApiProperty({ description: "End date of the limit offer" })
    @IsDateString()
    end_date: Date
}

export class CreateRewardsPoolDto {
    @ApiProperty({ description: "Token mint address" })
    @IsString()
    @IsNotEmpty()
    token: string

    @ApiProperty({ description: "Amount of tokens to be allocated to the pool" })
    @IsNumber()
    @Min(0)
    amount: number

    @ApiProperty({ description: "Limit offer of the pool", required: false, isArray: true })
    @ValidateNested({ each: true })
    @Type(() => LimitOffer)
    limit_offers?: LimitOffer[]

    @ApiProperty({ description: "Buyback burn ratio of the pool", required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(20)
    buyback_burn_ratio?: number

    @ApiProperty({
        description: "Revenue ratio of the pool, all revenue will be allocated depends on this ratio",
        isArray: true,
        type: () => RewardAllocateRatio,
        example: [
            {
                address: "",
                ratio: 40,
                role: RewardAllocateRoles.BUYBACK,
                allocate_type: "usdc",
            },
            {
                address: "",
                ratio: 40,
                role: RewardAllocateRoles.IPHOLDER,
                allocate_type: "usdc",
            },
            /*
            {
                address: "",
                ratio: 30,
                role: RewardAllocateRoles.DEVELOPER,
                allocate_type: "usdc",
            },
            {
                address: "",
                ratio: 10,
                role: RewardAllocateRoles.INVITER,
                allocate_type: "token",
            },
            */
            {
                address: "some customized address",
                ratio: 10,
                role: RewardAllocateRoles.CUSTOMIZED,
                allocate_type: "usdc",
            },
        ],
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RewardAllocateRatio)
    revenue_ratio: RewardAllocateRatio[]
}

export class UpdateRewardsPoolDto extends PickType(CreateRewardsPoolDto, [
    "revenue_ratio",
    "token",
    "limit_offers",
    "buyback_burn_ratio",
]) {}

export class InjectTokensDto {
    @ApiProperty({ description: "Token address" })
    @IsString()
    @IsNotEmpty()
    token: string

    @ApiProperty({ description: "Amount of tokens to be appended to the pool" })
    @IsNumber()
    @IsPositive()
    @Min(0)
    append_amount: number
}

export class PoolsQueryDto extends PaginationDto {
    @ApiProperty({ description: "Filter by owner", required: false })
    owner?: string

    @ApiProperty({ description: "Filter by token address", required: false })
    token?: string

    @ApiProperty({ description: "Available pools for specific app", required: false })
    app_id?: string
}

export class PoolsResponseListDto {
    @ApiProperty({ description: "List of rewards pools" })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PoolResponseDto)
    pools: PoolResponseDto[]

    @ApiProperty({ description: "Total amount of tokens in the pools" })
    @IsNumber()
    @IsPositive()
    total: number
}

export class RewardSnapshotDto {
    @ApiProperty({ description: "Token of the pool" })
    token: string

    @ApiProperty({ description: "Ticker of the pool" })
    ticker: string

    @ApiProperty({ description: "Unit price of the token" })
    unit_price: string

    @ApiProperty({ description: "Revenue ratio of the pool", isArray: true, type: RewardAllocateRatio })
    revenue_ratio: RewardAllocateRatio[]

    @ApiProperty({ description: "Updated at" })
    updated_at: Date

    @ApiProperty({ description: "Created at" })
    created_at: Date

    @ApiProperty({ description: "Snapshot date" })
    snapshot_date: Date

    @ApiProperty({ description: "Limit offer of the pool", required: false, type: () => LimitOffer })
    limit_offer: LimitOffer
}

export class DeveloperSpecifiedRewardSnapshotDto {
    @ApiProperty({
        description:
            "Revenue ratio of the pool, the sum of ratio must be 90(90%), since platform will take 10% of the revenue",
        isArray: true,
        type: RewardAllocateRatio,
    })
    @ValidateNested({ each: true })
    @Type(() => RewardAllocateRatio)
    @ArrayMinSize(1)
    revenue_ratio: RewardAllocateRatio[]

    @ApiProperty({
        description:
            "Released token ratio for order paid, 0 means no token released, 1 means 1%, this must be 0-200(0%-200%)",
    })
    @IsNumber()
    @IsInt()
    @Min(0)
    @Max(200)
    released_token_ratio: number
}

export class StatisticsQueryDto {
    @ApiProperty({ description: "token address", required: false })
    @IsString()
    @IsNotEmpty()
    token: string
}

export class StatisticsRolesDto {
    @ApiProperty({ description: "roles income", enum: RewardAllocateRoles })
    @IsEnum(RewardAllocateRoles)
    role: RewardAllocateRoles

    @ApiProperty({ description: "income" })
    @IsNumber()
    income: number
}

export class StatisticsIncomesDto {
    @ApiProperty({ description: "date" })
    @IsDate()
    date: Date

    @ApiProperty({ description: "orders" })
    orders: number

    @ApiProperty({ description: "amount" })
    order_amount: number

    @ApiProperty({ description: "role summary" })
    role_detail: StatisticsRolesDto[]
}

export class StatisticsSummaryDto {
    @ApiProperty({ description: "total income without platform" })
    incomes: number

    @ApiProperty({ description: "total income with platform" })
    incomes_total: number

    @ApiProperty({ description: "total orders" })
    orders: number

    @ApiProperty({ description: "unit price" })
    unit_price: number

    @ApiProperty({ description: "price change 24h" })
    price_change_24h: number

    @ApiProperty({ description: "market cap" })
    market_cap: number

    @ApiProperty({ description: "trade volume" })
    trade_volume: number

    @ApiProperty({ description: "current balance" })
    current_balance: number

    @ApiProperty({ description: "injected amount" })
    injected_amount: number

    @ApiProperty({ description: "buyback amount" })
    buyback_amount: number

    @ApiProperty({ description: "rewarded amount" })
    rewarded_amount: number

    @ApiProperty({ description: "roles income", isArray: true, type: StatisticsRolesDto })
    roles_income: StatisticsRolesDto[]
}

export enum StatementType {
    RELEASED = "released",
    INJECTED = "injected",
    AIRDROP = "airdrop",
    BUYBACK = "buyback",
}

export enum AirdropType {
    INVITE = "invite",
    INTERACT = "interact",
    OTHER = "other",
}

export class StatementQueryDto extends PaginationDto {
    @ApiProperty({ description: "token address", required: false })
    @IsString()
    @IsNotEmpty()
    token: string

    @ApiProperty({ description: "start date", required: false })
    @IsOptional()
    start_date?: string

    @ApiProperty({ description: "end date", required: false })
    @IsOptional()
    end_date?: string

    @ApiProperty({ description: "widget tag", required: false })
    @IsString()
    @IsOptional()
    widget_tag?: string

    @ApiProperty({ description: "type", required: false })
    @IsOptional()
    type?: StatementType

    @ApiProperty({ description: "only return settled statements(on chain tx confirmed) ", required: false })
    @IsOptional()
    only_settled?: string
}

export enum SupportedLockDays {
    IMMEDIATELY = 0,
    SIX_MONTHS = 180,
}

export class RequestAirdropDto {
    @ApiProperty({ description: "token address" })
    @IsString()
    @IsNotEmpty()
    token: string

    @ApiProperty({ description: "email of the user to be airdropped" })
    @IsEmail()
    @IsNotEmpty()
    email: string

    @ApiProperty({
        description:
            "USDC valued amount of tokens, if you want airdrop specific amount of tokens, set this to 0 and provide token_amount.",
    })
    @IsNumber()
    @Min(0)
    usd_amount: number

    @ApiProperty({
        description:
            "Amount of tokens to be airdropped, if you want airdrop USDC valued amount, set this to 0 and provide usd_amount.",
    })
    @IsNumber()
    @Min(0)
    token_amount: number

    @ApiProperty({
        description:
            "Amount lock days, currently we only support 0 and 180, 0 means release rewards immediately, 180 means 180 days",
        default: SupportedLockDays.SIX_MONTHS,
        enum: SupportedLockDays,
        required: false,
    })
    @IsEnum(SupportedLockDays)
    @IsOptional()
    lock_days?: SupportedLockDays

    @ApiProperty({ description: "type of airdrop", enum: AirdropType })
    @IsEnum(AirdropType)
    type: AirdropType
}

export enum StatementStatus {
    CREATED = "created",
    SETTLED = "settled",
}

export class StatementResponseDto {
    @ApiProperty({ description: "id" })
    id: number

    @ApiProperty({ description: "date" })
    date: Date

    @ApiProperty({ description: "usd revenue", type: "string" })
    usd_revenue: Decimal

    @ApiProperty({ description: "order id" })
    order_id: string

    @ApiProperty({ description: "widget id" })
    widget_tag: string

    @ApiProperty({ description: "rewarded amount", type: "string" })
    rewarded_amount: Decimal

    @ApiProperty({ description: "balance", type: "string" })
    balance: Decimal

    @ApiProperty({ description: "type", enum: StatementType })
    @IsEnum(StatementType)
    type: StatementType

    @ApiProperty({ description: "airdrop type", enum: AirdropType })
    @IsEnum(AirdropType)
    airdrop_type: AirdropType

    @ApiProperty({ description: "status", enum: StatementStatus })
    @IsEnum(StatementStatus)
    status: StatementStatus

    @ApiProperty({ description: "chain tx link" })
    chain_tx_link?: string
}

export class AirdropResponseDto extends StatementResponseDto {
    @ApiProperty({ description: "rewards detail", type: () => OrderRewardsDto })
    rewards_detail: OrderRewardsDto
}

export class StatementResponseListDto {
    @ApiProperty({ description: "list of statement" })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StatementResponseDto)
    statements: StatementResponseDto[]

    @ApiProperty({ description: "total" })
    @IsNumber()
    @IsPositive()
    total: number
}

export class AirdropQueryDto extends PaginationDto {
    @ApiProperty({ description: "token address", required: false })
    @IsString()
    @IsOptional()
    token?: string

    @ApiProperty({ description: "email of the user to be airdropped", required: false })
    @IsEmail()
    @IsOptional()
    email?: string

    @ApiProperty({ description: "type of airdrop", enum: AirdropType, required: false })
    @IsEnum(AirdropType)
    @IsOptional()
    type?: AirdropType
}

export class AirdropResponseListDto {
    @ApiProperty({ description: "list of airdrop", isArray: true, type: () => AirdropResponseDto })
    airdrops: AirdropResponseDto[]

    @ApiProperty({ description: "total" })
    total: number
}
