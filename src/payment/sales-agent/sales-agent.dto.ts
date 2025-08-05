import { PaginationDto } from "src/common/common.dto"

export enum SalesAgentIncomeStatus {
    PAID = "paid",
    PENDING = "pending",
}
export class SalesAgentIncomeItemDto {
    order_id: string
    revenue: number
    status: SalesAgentIncomeStatus
    created_at: string
}

export class SalesAgentIncomeResDto {
    total_records: number
    total_revenue: number
    list: SalesAgentIncomeItemDto[]
}

export class SalesAgentIncomeQueryDto extends PaginationDto {}
