import { Controller, Query, UseGuards, Get, Req, Post, Body } from "@nestjs/common"
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import {
    CreateSalesAgentDto,
    SalesAgentIncomeQueryDto,
    SalesAgentIncomeResDto,
    SalesAgentDetailDto,
    AgentQueryDto,
} from "./sales-agent.dto"
import { SalesAgentService } from "./sales-agent.service"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"
import { IsAdminGuard } from "src/auth/is_admin.guard"

@Controller("/api/v1/sales-agent")
@ApiTags("Sales Agent")
export class SalesAgentController {
    constructor(private readonly salesAgentService: SalesAgentService) {}
    @Get("/incomes")
    @ApiOperation({ summary: "Get an order by order id", tags: ["Order"] })
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: SalesAgentIncomeResDto })
    async getSalesAgentIncomes(@Req() req: Request, @Query() query: SalesAgentIncomeQueryDto) {
        return await this.salesAgentService.getSalesAgentIncomes(req.user as UserJwtExtractDto, query)
    }

    @Post("/create")
    @ApiOperation({ summary: "Add a sales agent", tags: ["Sales Agent"] })
    @UseGuards(IsAdminGuard)
    @ApiResponse({ type: SalesAgentDetailDto })
    @ApiBody({ type: CreateSalesAgentDto })
    async addSalesAgent(@Body() body: CreateSalesAgentDto) {
        return await this.salesAgentService.addSalesAgent(body)
    }

    @Get("/")
    @ApiOperation({ summary: "Get a sales agent detail", tags: ["Sales Agent"] })
    @UseGuards(IsAdminGuard)
    @ApiResponse({ type: SalesAgentDetailDto })
    async getSalesAgentDetail(@Query() query: AgentQueryDto) {
        return await this.salesAgentService.getSalesAgentDetail(query)
    }
}
