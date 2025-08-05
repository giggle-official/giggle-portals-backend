import { Controller, Query, UseGuards, Get, Req } from "@nestjs/common"
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { SalesAgentIncomeQueryDto, SalesAgentIncomeResDto } from "./sales-agent.dto"
import { SalesAgentService } from "./sales-agent.service"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"

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
}
