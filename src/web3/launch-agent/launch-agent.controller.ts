import { Controller, Post, Body, UseGuards, Req, Get, Query, Param } from "@nestjs/common"
import { LaunchAgentService } from "./launch-agent.service"
import { ApiOperation, ApiBody, ApiTags, ApiResponse } from "@nestjs/swagger"
import {
    CheckAgentWalletsStatusRequestDto,
    CheckAgentWalletsStatusResponseDto,
    CreateLaunchAgentResponseDto,
    GenerateLaunchAgentWalletsRequestDto,
    GenerateLaunchAgentWalletsResponseDto,
    ParseLaunchLaunchPlanRequestDto,
    ParseLaunchLaunchPlanResponseDto,
    SuggestBondingSegmentsRequestDto,
    SuggestBondingSegmentsResponseDto,
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

    @Post("/generate-agent-wallets")
    @ApiOperation({ summary: "Generate a new launch agent wallets" })
    @ApiBody({ type: GenerateLaunchAgentWalletsRequestDto })
    @ApiResponse({ type: GenerateLaunchAgentWalletsResponseDto })
    @UseGuards(AuthGuard("jwt"))
    async generateAgentWallets(@Body() dto: GenerateLaunchAgentWalletsRequestDto, @Req() req: Request) {
        return await this.launchAgentService.generateAgentWallets(dto, req.user as UserJwtExtractDto)
    }

    @Post("/check-agent-wallets")
    @ApiOperation({ summary: "Check the status of a launch agent wallets" })
    @ApiBody({ type: CheckAgentWalletsStatusRequestDto })
    @ApiResponse({ type: CheckAgentWalletsStatusResponseDto })
    @UseGuards(AuthGuard("jwt"))
    async checkAgentWallets(@Body() dto: CheckAgentWalletsStatusRequestDto, @Req() req: Request) {
        return await this.launchAgentService.checkAgentWalletsStatus(dto, req.user as UserJwtExtractDto)
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

    @Post("/suggest-bonding-segments")
    @ApiOperation({ summary: "Suggest bonding segments" })
    @ApiBody({ type: SuggestBondingSegmentsRequestDto })
    @ApiResponse({ type: SuggestBondingSegmentsResponseDto })
    @UseGuards(AuthGuard("jwt"))
    async suggestBondingSegments(@Body() dto: SuggestBondingSegmentsRequestDto, @Req() req: Request) {
        return await this.launchAgentService.suggestBondingSegments(dto, req.user as UserJwtExtractDto)
    }
}
