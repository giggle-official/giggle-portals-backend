import { Controller, Get, Post, Body, Req, UseGuards, Query, Param } from "@nestjs/common"
import {
    CreateRewardsPoolDto,
    InjectTokensDto,
    PoolResponseDto,
    PoolsQueryDto,
    PoolsResponseListDto,
    RequestAirdropDto,
    StatementQueryDto,
    StatementResponseListDto,
    StatisticsIncomesDto,
    StatisticsQueryDto,
    StatisticsSummaryDto,
    UpdateRewardsPoolDto,
    AirdropResponseDto,
    AirdropQueryDto,
    AirdropResponseListDto,
} from "./rewards-pool.dto"
import { RewardsPoolService } from "./rewards-pool.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request } from "express"
import { ApiOperation, ApiResponse } from "@nestjs/swagger"
import { ApiBody } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { IsWidgetGuard } from "src/auth/is_widget.guard"

@Controller("/api/v1/rewards-pool")
export class RewardsPoolController {
    constructor(private readonly rewardsPoolService: RewardsPoolService) {}
    @ApiOperation({
        summary: "Create a rewards pool",
        tags: ["Rewards Pool Management"],
        description: "Create a rewards pool for a token",
    })
    @ApiBody({ type: CreateRewardsPoolDto })
    @ApiResponse({ type: PoolResponseDto })
    @Post("/create")
    @UseGuards(AuthGuard("jwt"))
    async createPool(@Body() body: CreateRewardsPoolDto, @Req() req: Request) {
        return await this.rewardsPoolService.createPool(body, req.user as UserJwtExtractDto)
    }

    @ApiOperation({
        summary: "Update a rewards pool",
        tags: ["Rewards Pool Management"],
        description: "Update a rewards pool",
    })
    @ApiBody({ type: UpdateRewardsPoolDto })
    @ApiResponse({ type: PoolResponseDto })
    @Post("/update")
    @UseGuards(AuthGuard("jwt"))
    async updatePool(@Body() body: UpdateRewardsPoolDto, @Req() req: Request) {
        return await this.rewardsPoolService.updatePool(body, req.user as UserJwtExtractDto)
    }

    @ApiOperation({
        summary: "Inject tokens to a rewards pool",
        tags: ["Rewards Pool Management"],
        description: "Inject tokens to a rewards pool",
    })
    @ApiBody({ type: InjectTokensDto })
    @ApiResponse({ type: PoolResponseDto })
    @Post("/inject-tokens")
    @UseGuards(AuthGuard("jwt"))
    async injectTokens(@Body() body: InjectTokensDto, @Req() req: Request) {
        return await this.rewardsPoolService.injectTokens(body, req.user as UserJwtExtractDto)
    }

    @ApiOperation({
        summary: "Airdrop tokens to an user",
        tags: ["Order"],
        description: "Airdrop tokens to an user",
    })
    @Post("/airdrop")
    @UseGuards(IsWidgetGuard)
    @ApiBody({ type: RequestAirdropDto })
    @ApiResponse({ type: AirdropResponseDto })
    async airdrop(@Body() body: RequestAirdropDto, @Req() req: Request) {
        return await this.rewardsPoolService.airdrop(body, req.user as UserJwtExtractDto)
    }

    @Get("/airdrops")
    @ApiResponse({ type: AirdropResponseListDto })
    @ApiOperation({
        summary: "Get airdrop statements",
        tags: ["Order"],
        description: "Get airdrop statements",
    })
    @UseGuards(AuthGuard("jwt"))
    async getAirdropStatements(@Query() query: AirdropQueryDto) {
        return await this.rewardsPoolService.getAirdrops(query)
    }

    @Get("/")
    @ApiResponse({ type: PoolsResponseListDto })
    @ApiOperation({
        summary: "Get all rewards pools",
        tags: ["Rewards Pool Management"],
        description: "Get all rewards pools",
    })
    async getPools(@Query() query: PoolsQueryDto) {
        return await this.rewardsPoolService.getPools(query)
    }

    @Get("/statistics/summary")
    @ApiResponse({ type: StatisticsSummaryDto })
    @ApiOperation({
        summary: "Get statistics summary",
        tags: ["Rewards Pool Management"],
        description: "Get statistics summary",
    })
    async getStatisticsSummary(@Query() query: StatisticsQueryDto): Promise<StatisticsSummaryDto> {
        return await this.rewardsPoolService.getStatisticsSummary(query)
    }

    @Get("/statistics/incomes")
    @ApiResponse({ type: StatisticsIncomesDto, isArray: true })
    @ApiOperation({
        summary: "Get statistics incomes",
        tags: ["Rewards Pool Management"],
        description: "Get statistics incomes",
    })
    async getStatisticsIncomes(@Query() query: StatisticsQueryDto): Promise<StatisticsIncomesDto[]> {
        return await this.rewardsPoolService.getStatisticsIncomes(query)
    }

    @Get("/statements")
    @ApiResponse({ type: StatementResponseListDto, isArray: true })
    @ApiOperation({
        summary: "Get statements",
        tags: ["Rewards Pool Management"],
        description: "Get statements",
    })
    async getStatement(@Query() query: StatementQueryDto): Promise<StatementResponseListDto> {
        return await this.rewardsPoolService.getStatement(query)
    }
}
