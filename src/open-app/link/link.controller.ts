import { Controller, Post, Body, HttpCode, HttpStatus, Headers, UseGuards, Req, Get, Param } from "@nestjs/common"
import {
    BindDeviceRequestDto,
    CreateLinkRequestDto,
    CreateLinkResponseDto,
    LinkDetailDto,
    UserLinkStatisticsDto,
} from "./link.dto"
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { LinkService } from "./link.service"
import { AuthGuard } from "@nestjs/passport"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request } from "express"

@Controller("/api/v1/link")
export class LinkController {
    constructor(private readonly linkService: LinkService) {}

    @Post("/create")
    @ApiOperation({
        summary: "Create a short link to share.",
        description: `Create a short link you can share to anywhere, default is to a portal page.
        The link redirect url is depends users token, if token is from a widget, the link will be to the widget in portal, you can specify the widget message when widget loaded.
        `,
        tags: ["Link"],
    })
    @ApiHeader({
        name: "app-id",
        description: "The app id of the user",
        required: false,
    })
    @ApiResponse({ type: CreateLinkResponseDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    createLink(@Body() body: CreateLinkRequestDto, @Req() req: Request, @Headers("app-id") appId: string) {
        return this.linkService.create(body, req.user as UserJwtExtractDto, appId)
    }

    @Post("/bind-device")
    @ApiOperation({
        summary: "Bind a device to a link.",
        tags: ["Admin"],
    })
    @ApiBody({ type: BindDeviceRequestDto })
    bindDevice(@Body() body: BindDeviceRequestDto) {
        return this.linkService.bindDevice(body)
    }

    @Get("/:uniqueStr")
    @ApiOperation({
        summary: "Get a link by unique string.",
        tags: ["Link"],
    })
    @ApiResponse({ type: LinkDetailDto })
    getLink(@Param("uniqueStr") uniqueStr: string) {
        return this.linkService.getLink(uniqueStr)
    }

    @Get("/my/statistics")
    @ApiOperation({
        summary: "Get my link statistics.",
        tags: ["Link"],
    })
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: UserLinkStatisticsDto })
    @ApiBearerAuth()
    getMyLinkStatistics(@Req() req: Request) {
        return this.linkService.getMyLinkStatistics(req.user as UserJwtExtractDto)
    }
}
