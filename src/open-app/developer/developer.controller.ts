import { Controller, Post, Req, UseGuards, Body, Get, Param, Query } from "@nestjs/common"
import { DeveloperService } from "./developer.service"
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import {
    DeveloperWidgetCreateDto,
    DeveloperWidgetDeleteDto,
    DeveloperWidgetDeleteResponseDto,
    DeveloperWidgetUpdateDto,
    WidgetIdentityDto,
} from "./developer.dto"
import { UserJwtExtractDto } from "src/user/user.controller"
import { WidgetDetailDto } from "../widgets/widget.dto"
import { IsDeveloperGuard } from "src/auth/is_developer.guard"
import { Request } from "express"

@Controller("/api/v1/developer")
@ApiTags("Widgets Management")
export class DeveloperController {
    constructor(private readonly developerService: DeveloperService) {}

    // widgets
    @Post("/widgets/create")
    @UseGuards(IsDeveloperGuard)
    @ApiOperation({ summary: "create a widget" })
    @ApiBody({ type: DeveloperWidgetCreateDto })
    @ApiResponse({ type: WidgetDetailDto })
    async createWidget(@Body() body: DeveloperWidgetCreateDto, @Req() req: Request) {
        return this.developerService.createWidget(body, req.user as UserJwtExtractDto)
    }

    @Post("/widgets/update")
    @UseGuards(IsDeveloperGuard)
    @ApiOperation({ summary: "update a widget" })
    @ApiBody({ type: DeveloperWidgetUpdateDto })
    @ApiResponse({ type: WidgetDetailDto })
    async updateWidget(@Body() body: DeveloperWidgetUpdateDto, @Req() req: Request) {
        return this.developerService.updateWidget(body, req.user as UserJwtExtractDto)
    }

    @Post("/widgets/delete")
    @UseGuards(IsDeveloperGuard)
    @ApiOperation({ summary: "delete a widget" })
    @ApiBody({ type: DeveloperWidgetDeleteDto })
    @ApiResponse({ type: DeveloperWidgetDeleteResponseDto })
    async deleteWidget(@Body() body: DeveloperWidgetDeleteDto, @Req() req: Request) {
        return this.developerService.deleteWidget(body.tag, req.user as UserJwtExtractDto)
    }

    @Get("/widgets/identity")
    @UseGuards(IsDeveloperGuard)
    @ApiOperation({ summary: "get identity for a widget" })
    @ApiResponse({ type: WidgetIdentityDto })
    async identifyWidget(@Req() req: Request, @Query("tag") tag: string) {
        return this.developerService.getWidgetIdentity(req.user as UserJwtExtractDto, tag)
    }

    @Get("/widgets")
    @UseGuards(IsDeveloperGuard)
    @ApiOperation({ summary: "get all widgets" })
    @ApiResponse({ type: WidgetDetailDto })
    async getWidgets(@Req() req: Request) {
        return this.developerService.getWidgets(req.user as UserJwtExtractDto)
    }

    @Get("/widgets/:tag")
    @UseGuards(IsDeveloperGuard)
    @ApiOperation({ summary: "get configs for a widget" })
    @ApiResponse({ type: WidgetDetailDto })
    async getConfigs(@Param("tag") tag: string, @Req() req: Request) {
        return this.developerService.getWidgetDetail(tag, req.user as UserJwtExtractDto)
    }
}
