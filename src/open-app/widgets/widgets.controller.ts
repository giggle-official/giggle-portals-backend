import { Controller, Body, Post, HttpCode, HttpStatus, UseGuards, Req } from "@nestjs/common"
import { WidgetsService } from "./widgets.service"
import { ApiResponse } from "@nestjs/swagger"
import { ApiBody } from "@nestjs/swagger"
import { LoginResponseDto } from "../auth/auto.dto"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import { CreateWidgetDto } from "./widget.dto"
import { AuthGuard } from "@nestjs/passport"
import { UserInfoDTO } from "src/user/user.controller"
import { Request } from "express"

@Controller("/api/v1/app/widgets")
@ApiTags("Widgets")
export class WidgetsController {
    constructor(private readonly widgetService: WidgetsService) {}

    @Post("/create")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "create a widget" })
    @ApiBody({ type: CreateWidgetDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: LoginResponseDto })
    async createWidget(@Body() body: CreateWidgetDto, @Req() req: Request) {
        return this.widgetService.createWidget(body, req.user as UserInfoDTO)
    }
}
