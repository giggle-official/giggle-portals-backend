import { HttpStatus } from "@nestjs/common"
import { ApiProperty } from "@nestjs/swagger"
export class SettleApiResponseDto<T> {
    code: HttpStatus
    data: T
    msg: string
}

export class CreateSettleOrderDto {
    @ApiProperty()
    order_id: string

    creator: string
    creator_invited_user: string
    revenue: number
    created_at: Date
}

export class SettleOrderResponseDto {
    success: boolean
}

export enum ORDER_SETTLE_STATUS {
    PENDING = "pending",
    COMPLETED = "completed",
    FAILED = "failed",
}

export class CreateSettleUserDto {
    @ApiProperty()
    user_email: string

    invite_code: string

    inviter_email: string | null
}

export class SettleUserResponseDto {
    success: boolean
}
