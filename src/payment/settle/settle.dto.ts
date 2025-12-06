import { HttpStatus } from "@nestjs/common"
export class SettleApiResponseDto<T> {
    code: HttpStatus
    data: T
    msg: string
}

export class CreateSettleOrderDto {
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
