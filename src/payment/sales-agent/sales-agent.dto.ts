import { PaginationDto } from "src/common/common.dto"
import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export enum SalesAgentIncomeStatus {
    PAID = "paid",
    PENDING = "pending",
}
export class SalesAgentIncomeItemDto {
    @ApiProperty({ description: "user id" })
    user_id: string

    @ApiProperty({ description: "user avatar" })
    user_avatar: string

    @ApiProperty({ description: "username" })
    username: string

    @ApiProperty({ description: "user register time" })
    user_register_time: string

    @ApiProperty({ description: "agent user id" })
    agent_user_id: string

    @ApiProperty({ description: "order id" })
    order_id: string

    @ApiProperty({ description: "revenue" })
    revenue: number

    @ApiProperty({ description: "status" })
    status: SalesAgentIncomeStatus

    @ApiProperty({ description: "created at" })
    created_at: string
}

export class SalesAgentSummaryDto {
    @ApiProperty({ description: "total orders" })
    total_orders: number
    @ApiProperty({ description: "total referrends" })
    total_referrends: number
    @ApiProperty({ description: "total revenue" })
    total_revenue: number
}

export class SalesAgentIncomeResDto {
    @ApiProperty({ description: "summary", type: () => SalesAgentSummaryDto })
    summary: SalesAgentSummaryDto

    @ApiProperty({ description: "total records" })
    total: number

    @ApiProperty({ description: "is requester an agent" })
    is_agent: boolean

    @ApiProperty({ description: "list", type: [() => SalesAgentIncomeItemDto] })
    list: SalesAgentIncomeItemDto[]
}

export class SalesAgentIncomeQueryDto extends PaginationDto {
    @IsOptional()
    @IsString()
    @ApiProperty({ description: "filter by widget tag", required: false })
    widget_tag?: string

    @IsOptional()
    @IsString()
    @ApiProperty({ description: "start date", required: false })
    start_date?: string

    @IsOptional()
    @IsString()
    @ApiProperty({ description: "end date", required: false })
    end_date?: string
}

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
