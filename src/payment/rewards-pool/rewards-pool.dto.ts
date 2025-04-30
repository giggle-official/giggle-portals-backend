import { ApiProperty, PickType } from "@nestjs/swagger"

export enum RewardAllocateRoles {
    PLATFORM = "platform",
    BUYBACK = "buyback",
    INVITER = "inviter",
    DEVELOPER = "developer",
    CUSTOMIZED = "customized",
}

export class RewardAllocateRatio {
    @ApiProperty({ description: "Address of the account" })
    address: string
    @ApiProperty({ description: "Ratio of tokens to be allocated to the pool" })
    ratio: number
    @ApiProperty({ description: "Type of the account", enum: RewardAllocateRoles })
    type: RewardAllocateRoles
}

export class CreateRewardsPoolDto {
    @ApiProperty({ description: "Token mint address" })
    token: string
    @ApiProperty({ description: "Amount of tokens to be allocated to the pool" })
    amount: number
    @ApiProperty({
        description:
            "Unit price of the token, in usdc, currently we only support integer and precision decimal is 9, for example, if you want set 0.1 usdc per token, you should pass this param as 0.1 * 10^9 = 100000000",
    })
    unit_price: number
    @ApiProperty({ description: "Ratio of tokens to be allocated to the pool" })
    ratio_detail: RewardAllocateRatio[]
}

export class UpdateRewardsPoolDto extends PickType(CreateRewardsPoolDto, ["unit_price", "ratio_detail", "token"]) {}

export class AppendTokenDto {
    @ApiProperty({ description: "IP ID" })
    ip_id: number
    @ApiProperty({ description: "Amount of tokens to be appended to the pool" })
    append_amount: number
}

export class RewardModelDto {
    id: number
    token_address: string
    pool_address: string
    ratio_detail: RewardAllocateRatio[]
    created_at: Date
    updated_at: Date
}
