import { Controller, Post, Body, HttpCode, HttpStatus, Headers, UseGuards, Req, Get, Param } from "@nestjs/common"
import { CreateLinkRequestDto, CreateLinkResponseDto, LinkDetailDto } from "./link.dto"
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { LinkService } from "./link.service"
import { AuthGuard } from "@nestjs/passport"
import { UserInfoDTO } from "src/user/user.controller"
import { Request } from "express"

@ApiTags("Link")
@Controller("/api/v1/link")
export class LinkController {
    constructor(private readonly linkService: LinkService) {}

    @Post("create")
    @ApiOperation({
        summary: "Create a short link to share.",
        description: `Create a short link you can share to anywhere, default is to a portal page.
        The link redirect url is depends users token, if token is from a widget, the link will be to the widget in portal, you can specify the widget message when widget loaded.
        `,
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
        return this.linkService.create(body, req.user as UserInfoDTO, appId)
    }

    @Get(":uniqueStr")
    @ApiOperation({
        summary: "Get a link by unique string.",
    })
    @ApiResponse({ type: LinkDetailDto })
    getLink(@Param("uniqueStr") uniqueStr: string) {
        return this.linkService.getLink(uniqueStr)
    }
}
