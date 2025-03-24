import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Body, Req, UseGuards } from "@nestjs/common"
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { GenerateVideoService } from "./generate-video.service"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import {
    CancelGenerateVideoRequestDto,
    GenerateVideoDetailDto,
    GenerateVideoRequestDto,
    ReGenerateVideoRequestDto,
} from "./generate-video.dto"
import { UserInfoDTO } from "src/user/user.controller"

@ApiTags("AIGC Video Generator")
@Controller("api/v1/generate-video")
export class GenerateVideoController {
    constructor(private readonly generateVideoService: GenerateVideoService) {}

    @Get("/")
    @ApiOperation({
        summary: "Get generate-video job list",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getList(@Req() req: Request, @Query("take") take: string = "10") {
        return await this.generateVideoService.getList(req.user as UserInfoDTO, parseInt(take))
    }

    @Get("/:id")
    @ApiOperation({
        summary: "Get generate-video job detail",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        type: GenerateVideoDetailDto,
    })
    async getDetail(@Req() req: Request, @Param("id") id: string) {
        return await this.generateVideoService.detail(req.user as UserInfoDTO, parseInt(id))
    }

    @Post("/create")
    @ApiOperation({
        summary: "Create a generate-video job",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        type: GenerateVideoDetailDto,
    })
    async create(@Req() req: Request, @Body() body: GenerateVideoRequestDto) {
        return await this.generateVideoService.create(req.user as UserInfoDTO, body)
    }

    @ApiOperation({
        summary: "Cancel a generate-video job",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        type: GenerateVideoDetailDto,
    })
    async cancel(@Req() req: Request, @Body() body: CancelGenerateVideoRequestDto) {
        return await this.generateVideoService.cancel(req.user as UserInfoDTO, body)
    }

    @ApiOperation({
        summary: "Re-generate a generate-video job if it not as expected",
    })
    @UseGuards(AuthGuard("jwt"))
    @Post("/re-generate")
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        type: GenerateVideoDetailDto,
    })
    async reGenerate(@Req() req: Request, @Body() body: ReGenerateVideoRequestDto) {
        return await this.generateVideoService.reGenerate(req.user as UserInfoDTO, body)
    }
}
