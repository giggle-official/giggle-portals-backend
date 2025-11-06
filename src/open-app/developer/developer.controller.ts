import { Controller, Post, Req, UseGuards, Body, Get, Param, Query, Headers } from "@nestjs/common"
import { DeveloperService } from "./developer.service"
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import {
    DeveloperWidgetCreateDto,
    DeveloperWidgetDeleteDto,
    DeveloperWidgetDeleteResponseDto,
    DeveloperWidgetUpdateDto,
    GetUserInfoQueryDto,
    NationCodeDto,
    RequestWidgetAccessTokenDto,
    SendLoginCodeDto,
    WidgetAccessTokenDto,
    WidgetIdentityDto,
} from "./developer.dto"
import { UserInfoDTO, UserJwtExtractDto } from "src/user/user.controller"
import { WidgetDetailDto } from "../widgets/widget.dto"
import { IsDeveloperGuard } from "src/auth/is_developer.guard"
import { Request } from "express"
import { IsWidgetGuard } from "src/auth/is_widget.guard"
import { UsersService } from "./users.service"
import * as nationCodes from "./nation-codes.json"
import { LoginResponseDto } from "../auth/auto.dto"
import { GetUserTokenDto } from "./users.dto"
import { LoginCodeResponseDto } from "src/user/user.dto"
import { LoginResponseDTO, LoginWithCodeReqDto } from "src/auth/auth.dto"
import { AuthGuard } from "@nestjs/passport"

@Controller("/api/v1/developer")
@ApiTags("Widgets Management")
export class DeveloperController {
    constructor(
        private readonly developerService: DeveloperService,
        private readonly usersService: UsersService,
    ) {}

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

    @Post("/widgets/get-access-token")
    @ApiOperation({
        summary: "get access token for a widget",
        description: "get access token for a widget, default expire in 10 minites",
        tags: ["Developer Utility"],
    })
    @ApiBody({ type: RequestWidgetAccessTokenDto })
    @ApiResponse({ type: WidgetAccessTokenDto })
    async getAccessToken(@Body() body: RequestWidgetAccessTokenDto) {
        return this.developerService.getWidgetAccessToken(body)
    }

    @Get("/get-nation-codes")
    @ApiOperation({ summary: "get nation codes" })
    @ApiResponse({ type: NationCodeDto })
    @ApiTags("Developer Utility")
    async getNationCodes() {
        return nationCodes["countries"].sort((a, b) => a.code.localeCompare(b.code))
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

    //below is developer utility
    //get user info
    @Get("/user-info")
    @ApiBearerAuth("jwt")
    @ApiTags("Developer Utility")
    @ApiOperation({ summary: "get user info" })
    @ApiResponse({ type: UserInfoDTO })
    @UseGuards(IsWidgetGuard)
    async getUserInfo(@Req() req: Request, @Query() query: GetUserInfoQueryDto) {
        return this.usersService.getUserInfo(req.user as UserJwtExtractDto, query)
    }

    //get user info
    @Post("/get-user-token")
    @ApiBearerAuth("jwt")
    @ApiTags("Developer Utility")
    @ApiOperation({ summary: "get user token" })
    @ApiResponse({ type: LoginResponseDto })
    @ApiBody({ type: GetUserTokenDto })
    @UseGuards(IsWidgetGuard)
    async getUserToken(@Req() req: Request, @Body() body: GetUserTokenDto) {
        return this.usersService.getToken(req.user as UserJwtExtractDto, body)
    }

    //send login code
    @Post("/send-login-code")
    @ApiBearerAuth("jwt")
    @ApiTags("Developer Utility")
    @ApiOperation({
        summary: `send login code to an email`,
        description: `send login code to an email, if user not exists, a new user will be created, you must be a developer to use this api, after code sent, user can login with this code using [loginWithCode](https://app.giggle.pro/api/reference/api-v1-auth-loginWithCode) api`,
    })
    @ApiResponse({ type: LoginCodeResponseDto })
    @ApiBody({ type: SendLoginCodeDto })
    @UseGuards(IsWidgetGuard)
    async sendLoginCode(@Body() body: SendLoginCodeDto, @Headers("app-id") appId: string, @Req() req: Request) {
        return await this.developerService.sendLoginCode(body, appId, req.user as UserJwtExtractDto)
    }

    //login with code
    @Post("/login-with-code")
    @ApiTags("Developer Utility")
    @ApiOperation({ summary: "login with code" })
    @UseGuards(AuthGuard("code"))
    @ApiResponse({ type: LoginResponseDTO })
    @ApiBody({ type: LoginWithCodeReqDto })
    async loginWithCode(@Req() req: Request) {
        return await this.developerService.loginWithCode(req.user as UserJwtExtractDto)
    }
}
