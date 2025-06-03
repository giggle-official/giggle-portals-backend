import { ApiProperty, OmitType, PickType } from "@nestjs/swagger"
import { reward_pool_on_chain_status, reward_pools } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import { Type } from "class-transformer"
import {
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
import { OrderRewardsDto, UserRewards } from "../order/order.dto"
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

    @ApiProperty({ description: "Limit offer of the pool", isArray: true })
    @ValidateNested({ each: true })
    @Type(() => LimitOffer)
    limit_offers: LimitOffer[]
}

export class RewardAllocateRatio {
    @ApiProperty({ description: "Address of the account" })
    @IsString()
    address: string

    @ApiProperty({ description: "Ratio of tokens to be allocated to the pool" })
    @IsNumber()
    @IsPositive()
    ratio: number

    @ApiProperty({ description: "Role of the account", enum: RewardAllocateRoles })
    @IsEnum(RewardAllocateRoles)
    @IsNotEmpty()
    role: RewardAllocateRoles

    @ApiProperty({ description: "Type of the allocation", enum: RewardAllocateType })
    @IsEnum(RewardAllocateType)
    @IsNotEmpty()
    allocate_type: RewardAllocateRoles
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

    @ApiProperty({
        description: "Revenue ratio of the pool, all revenue will be allocated depends on this ratio",
        isArray: true,
        properties: {
            address: { type: "string", example: "" },
            ratio: { type: "number", example: 40 },
            role: { type: "string", enum: RewardAllocateRoles, example: RewardAllocateRoles.BUYBACK },
        },
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

export class UpdateRewardsPoolDto extends PickType(CreateRewardsPoolDto, ["revenue_ratio", "token", "limit_offers"]) {}

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

    @ApiProperty({ description: "Limit offer of the pool", required: false })
    limit_offer: LimitOffer
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

    @ApiProperty({ description: "rewarded amount" })
    rewarded_amount: number

    @ApiProperty({ description: "roles income", isArray: true, type: StatisticsRolesDto })
    roles_income: StatisticsRolesDto[]
}

export class StatementQueryDto extends PaginationDto {
    @ApiProperty({ description: "token address", required: false })
    @IsString()
    @IsNotEmpty()
    token: string
}

export enum StatementType {
    RELEASED = "released",
    INJECTED = "injected",
    AIRDROP = "airdrop",
}

export enum AirdropType {
    INVITE = "invite",
    INTERACT = "interact",
    OTHER = "other",
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

    @ApiProperty({ description: "usd amount of tokens to be airdropped, if set, token_amount will be ignored" })
    @IsNumber()
    @IsPositive()
    usd_amount: number

    @ApiProperty({ description: "type of airdrop", enum: AirdropType })
    @IsEnum(AirdropType)
    type: AirdropType
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
