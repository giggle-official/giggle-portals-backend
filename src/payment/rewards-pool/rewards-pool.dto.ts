import { ApiProperty, OmitType, PickType } from "@nestjs/swagger"
import { reward_pools } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import { Type } from "class-transformer"
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsPositive, IsString, Min, ValidateNested } from "class-validator"
import { PaginationDto } from "src/common/common.dto"
export enum RewardAllocateType {
    TOKEN = "token",
    USDC = "usdc",
}

export enum RewardAllocateRoles {
    BUYBACK = "buyback",
    INVITER = "inviter",
    DEVELOPER = "developer",
    CUSTOMIZED = "customized",
}

export class Pool implements reward_pools {
    @ApiProperty({ description: "ID of the pool" })
    id: number

    @ApiProperty({ description: "Token of the pool" })
    token: string

    @ApiProperty({ description: "Owner of the pool" })
    owner: string

    @ApiProperty({ description: "Unit price of the token" })
    unit_price: Decimal

    @ApiProperty({ description: "Revenue ratio of the pool" })
    revenue_ratio: any

    @ApiProperty({ description: "Address of the pool" })
    address: string

    @ApiProperty({ description: "Injected token amount of the pool" })
    injected_amount: number

    @ApiProperty({ description: "Released token amount of the pool" })
    released_amount: number

    @ApiProperty({ description: "Current token balance of the pool" })
    current_balance: number

    @ApiProperty({ description: "Created at" })
    created_at: Date

    @ApiProperty({ description: "Updated at" })
    updated_at: Date
}

export class PoolResponseDto extends OmitType(Pool, ["id", "unit_price"]) {
    @ApiProperty({ description: "Unit price of the token" })
    unit_price: string
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

export class CreateRewardsPoolDto {
    @ApiProperty({ description: "Token mint address" })
    @IsString()
    @IsNotEmpty()
    token: string

    @ApiProperty({ description: "Amount of tokens to be allocated to the pool" })
    @IsNumber()
    @IsPositive()
    amount: number

    @ApiProperty({
        description: "Unit price of the token, in usdc",
        example: 0.00001,
    })
    @IsNumber()
    @IsPositive()
    unit_price: number

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

export class UpdateRewardsPoolDto extends PickType(CreateRewardsPoolDto, ["unit_price", "revenue_ratio", "token"]) {}

export class AppendTokenDto {
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
