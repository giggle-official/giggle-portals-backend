import { Controller, Get, Post, Body, Req, UseGuards, Query } from "@nestjs/common"
import {
    AppendTokenDto,
    CreateRewardsPoolDto,
    PoolResponseDto,
    PoolsQueryDto,
    PoolsResponseListDto,
    UpdateRewardsPoolDto,
} from "./rewards-pool.dto"
import { RewardsPoolService } from "./rewards-pool.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request } from "express"
import { ApiOperation, ApiResponse } from "@nestjs/swagger"
import { ApiBody } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"

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
        return this.rewardsPoolService.createPool(body, req.user as UserJwtExtractDto)
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
        return this.rewardsPoolService.updatePool(body, req.user as UserJwtExtractDto)
    }

    @ApiOperation({
        summary: "Append a token to a rewards pool",
        tags: ["Rewards Pool Management"],
        description: "Append a token to a rewards pool",
    })
    @ApiBody({ type: AppendTokenDto })
    @ApiResponse({ type: PoolResponseDto })
    @Post("/append-token")
    @UseGuards(AuthGuard("jwt"))
    async appendToken(@Body() body: AppendTokenDto, @Req() req: Request) {
        return this.rewardsPoolService.appendToken(body, req.user as UserJwtExtractDto)
    }

    @Get("/")
    @ApiResponse({ type: PoolsResponseListDto })
    @ApiOperation({
        summary: "Get all rewards pools",
        tags: ["Rewards Pool Management"],
        description: "Get all rewards pools",
    })
    async getPools(@Query() query: PoolsQueryDto) {
        return this.rewardsPoolService.getPools(query)
    }
}
