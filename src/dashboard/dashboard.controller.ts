import { Controller, Get, Req, UseGuards } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
import { DashboardService } from "./dashboard.service"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"

@Controller("/api/v1/dashboard")
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService) {}

    @Get("/my-summary")
    @UseGuards(AuthGuard("jwt"))
    async getMySummary(@Req() req: Request) {
        return this.dashboardService.getMySummary(req.user as UserJwtExtractDto)
    }

    @Get("/market-ranks")
    @UseGuards(AuthGuard("jwt"))
    async getMarketRanks(@Req() req: Request) {
        return this.dashboardService.marketRanks(req.user as UserJwtExtractDto)
    }

    @Get("/ip-incomes")
    @UseGuards(AuthGuard("jwt"))
    async getIpIncomes(@Req() req: Request) {
        return this.dashboardService.ipIncomes(req.user as UserJwtExtractDto)
    }

    @Get("/statistic-by-day")
    @UseGuards(AuthGuard("jwt"))
    async getStatisticByDay(@Req() req: Request) {
        return this.dashboardService.getStatisticByDay(req.user as UserJwtExtractDto)
    }
}
