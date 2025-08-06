import { PaginationDto } from "src/common/common.dto"
import { IsEmail, IsNotEmpty, IsOptional } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

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

export class CreateSalesAgentDto {
    @IsNotEmpty()
    @IsEmail()
    @ApiProperty({ description: "User email" })
    email: string

    @IsOptional()
    @IsEmail()
    @ApiProperty({ description: "Parent agent email", required: false })
    parent_agent?: string
}

export class SalesAgentDetailDto {
    id: number
    user: string
    email: string
    sales_level: number
    parent_agent: SalesAgentDetailDto | null
    children_agents: SalesAgentDetailDto[]
    created_at: Date
    updated_at: Date
}

export class AgentQueryDto extends PaginationDto {
    user?: string
}

export class SalesAgentListDto {
    total: number
    agents: SalesAgentDetailDto[]
}
