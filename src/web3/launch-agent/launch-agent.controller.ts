import { Controller, Post, Body, UseGuards, Req, Get, Query, Param } from "@nestjs/common"
import { LaunchAgentService } from "./launch-agent.service"
import { ApiOperation, ApiBody, ApiTags, ApiResponse } from "@nestjs/swagger"
import {
    CreateLaunchAgentResponseDto,
    ParseLaunchLaunchPlanRequestDto,
    ParseLaunchLaunchPlanResponseDto,
} from "./launch-agent.dto"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"

@Controller("/api/v1/launch-agent")
@ApiTags("Launch Agent")
export class LaunchAgentController {
    constructor(private readonly launchAgentService: LaunchAgentService) {}

    @Post("/create")
    @ApiOperation({ summary: "Create a new launch agent" })
    @ApiBody({})
    @ApiResponse({ type: CreateLaunchAgentResponseDto })
    @UseGuards(AuthGuard("jwt"))
    async createAgent(@Req() req: Request) {
        return await this.launchAgentService.createAgent(req.user as UserJwtExtractDto)
    }

    @Post("/generate-strategy")
    @ApiOperation({ summary: "Generate a new launch agent strategy" })
    @ApiBody({ type: ParseLaunchLaunchPlanRequestDto })
    @ApiResponse({ type: ParseLaunchLaunchPlanResponseDto })
    @UseGuards(AuthGuard("jwt"))
    async generateStrategy(@Body() dto: ParseLaunchLaunchPlanRequestDto, @Req() req: Request) {
        return await this.launchAgentService.generateStrategy(dto, req.user as UserJwtExtractDto)
    }

    @Get("/get-strategy-price")
    @ApiOperation({ summary: "Get the estimated usdc of a launch agent strategy" })
    @ApiResponse({ type: Number })
    @UseGuards(AuthGuard("jwt"))
    async getStrategyPrice(@Query("sols") sol: string) {
        return await this.launchAgentService.getStrategyEstimatedUsdc(Number(sol))
    }

    @Get("/check-agent-status/:ip_id")
    @ApiOperation({ summary: "Check the status of a launch agent" })
    @UseGuards(AuthGuard("jwt"))
    async checkAgentStatus(@Param("ip_id") ip_id: string, @Req() req: Request) {
        return await this.launchAgentService.checkAgentStatusByIpId(req.user as UserJwtExtractDto, Number(ip_id))
    }

    @Get("/get-permission")
    @ApiOperation({ summary: "Get the permission of a user to use launch agent" })
    @ApiResponse({ schema: { type: "object", properties: { allowed: { type: "boolean" } } } })
    @UseGuards(AuthGuard("jwt"))
    async getPermission(@Req() req: Request) {
        return await this.launchAgentService.getPermission(req.user as UserJwtExtractDto)
    }
}
