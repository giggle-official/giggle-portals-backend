import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsEmail, IsNotEmpty, IsOptional } from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { WalletDetailDto } from "src/web3/giggle/giggle.dto"

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
