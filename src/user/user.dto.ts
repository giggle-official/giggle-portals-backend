import { ApiProperty, OmitType } from "@nestjs/swagger"
import { user_rewards_withdraw } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import { IsString, IsEmail, IsNotEmpty, IsOptional, IsNumber, Min, IsPositive } from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { CreateIpTokenGiggleResponseDto, WalletDetailDto } from "src/web3/giggle/giggle.dto"

export class ContactDTO {
    @ApiProperty()
    @IsString()
    first_name: string
    @ApiProperty()
    @IsString()
    last_name: string
    @ApiProperty()
    @IsEmail()
    email: string
    @ApiProperty()
    phone_number?: string
    @ApiProperty()
    message?: string
}

export class UserPlanSettingsDto {
    id: number
    plan_settings: {
        video_convert_max_seconds: number
        credit_consume_every_second: number
    }
    current_plan: "Standard" | "Premium" | "Free" | "none" | "Custom"
}

export class UserWalletDetailDto extends WalletDetailDto {
    @ApiProperty({
        description: "ip income",
    })
    ip_license_incomes: number

    @ApiProperty({
        description: "total balance change 24h",
    })
    total_balance_change_24h: number
}

export class UserFollowDto {
    @ApiProperty({
        description: "user of the user to follow",
    })
    user: string
}

export class UserUnFollowDto extends UserFollowDto {}

export class LoginCodeReqDto {
    @ApiProperty()
    @IsEmail()
    @IsNotEmpty()
    email: string
}

export class LoginCodeResponseDto {
    @ApiProperty()
    success: boolean
}

export class UserWalletDetailQueryDto extends PaginationDto {
    @ApiProperty({
        description: "mint address of token to query",
        required: false,
    })
    @IsString()
    @IsOptional()
    mint?: string
}

export class UserTokenRewardsQueryDto extends PaginationDto {
    @ApiProperty({
        description: "The token to query",
        required: false,
    })
    @IsString()
    @IsOptional()
    token?: string
}

export class UserTokenRewardsDto {
    @ApiProperty({
        description: "Token address",
    })
    token: string

    @ApiProperty({
        description: "Token info",
        type: () => CreateIpTokenGiggleResponseDto,
    })
    token_info: CreateIpTokenGiggleResponseDto

    @ApiProperty({
        description: "Token ticker",
    })
    ticker: string

    @ApiProperty({
        description: "Token rewards",
    })
    rewards: number

    @ApiProperty({
        description: "Token locked",
    })
    locked: number

    @ApiProperty({
        description: "Token released",
    })
    released: number

    @ApiProperty({
        description: "The available tokens can be claimed",
    })
    availables: number
}

export class UserTokenRewardsListDto {
    @ApiProperty({
        description: "Token rewards",
        isArray: true,
        type: () => UserTokenRewardsDto,
    })
    rewards: UserTokenRewardsDto[]

    @ApiProperty({
        description: "Total token rewards of user",
    })
    total: number
}

export enum ClaimStatus {
    PENDING = "pending",
    COMPLETED = "completed",
    FAILED = "failed",
    REJECTED = "rejected",
}

export class ClaimRewardsDto {
    @ApiProperty({
        description: "Token address",
    })
    @IsString()
    @IsNotEmpty()
    token: string

    @ApiProperty({
        description: "Amount to claim",
    })
    @IsNumber()
    @IsPositive()
    @Min(1)
    amount: number
}

export class ClaimRewardsQueryDto extends PaginationDto {
    @ApiProperty({
        description: "Token address",
        required: false,
    })
    @IsString()
    @IsOptional()
    token?: string
}

export class UserRewardsClaimDto {
    @ApiProperty({
        description: "Claim id",
    })
    id: number

    @ApiProperty({
        description: "Token address",
    })
    token: string

    @ApiProperty({
        description: "Claim status",
        enum: ClaimStatus,
    })
    status: ClaimStatus

    @ApiProperty({
        description: "created at",
    })
    created_at: Date

    @ApiProperty({
        description: "updated at",
    })
    updated_at: Date

    @ApiProperty({
        description: "user id",
    })
    user: string

    @ApiProperty({
        description: "Withdrawn amount",
    })
    withdrawn: number
}

export class ClaimRewardsHistoryListDto {
    @ApiProperty({
        description: "The claims",
        isArray: true,
        type: () => UserRewardsClaimDto,
    })
    claims: UserRewardsClaimDto[]

    @ApiProperty({
        description: "The total claims",
    })
    total: number
}
