import { Controller, Post, Body, HttpCode, HttpStatus, Headers, UseGuards, Req } from "@nestjs/common"
import { CreateLinkRequestDto, CreateLinkResponseDto } from "./share.dto"
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { ShareService } from "./share.service"
import { AuthGuard } from "@nestjs/passport"
import { UserInfoDTO } from "src/user/user.controller"
import { Request } from "express"

@ApiTags("Share")
@Controller("/api/v1/share")
export class ShareController {
    constructor(private readonly shareService: ShareService) {}

    @Post("create")
    @ApiOperation({ summary: "Create a link" })
    @ApiResponse({ type: CreateLinkResponseDto })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    createLink(@Body() body: CreateLinkRequestDto, @Headers("app-id") appId: string, @Req() req: Request) {
        return this.shareService.create(body, appId, req.user as UserInfoDTO)
    }
}
