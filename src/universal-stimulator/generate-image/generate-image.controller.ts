import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Body, Req, UseGuards } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import { GenerateImageService } from "./generate-image.service"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { GenerateImageRequestDto, ReGenerateImageRequestDto } from "./generate-image.dto"
import { UserInfoDTO } from "src/user/user.controller"

@ApiTags("AIGC Image Generator")
@Controller("api/v1/generate-image")
export class GenerateImageController {
    constructor(private readonly generateImageService: GenerateImageService) {}

    @Get("/")
    @ApiOperation({
        summary: "Get job list",
        description: "Get a list of generate-image jobs",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getList(@Req() req: Request, @Query("take") take: string = "10") {
        return await this.generateImageService.getList(req.user as UserInfoDTO, parseInt(take))
    }

    @Get("/ratios")
    @ApiOperation({
        summary: "Get supported ratios",
    })
    @HttpCode(HttpStatus.OK)
    async getSupportedRatios() {
        return this.generateImageService.getSupportedRatios()
    }

    @Get("/:id")
    @ApiOperation({
        summary: "Get job detail",
        description: "Get a generate-image job detail",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getDetail(@Req() req: Request, @Param("id") id: string) {
        return await this.generateImageService.detail(req.user as UserInfoDTO, parseInt(id))
    }

    @Post("/create")
    @ApiOperation({
        summary: "Create",
        description: "Create a generate-image job",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async create(@Req() req: Request, @Body() body: GenerateImageRequestDto) {
        return await this.generateImageService.create(req.user as UserInfoDTO, body)
    }

    @Post("/re-generate")
    @ApiOperation({
        summary: "Re-generate",
        description: "Re-generate a generate-image job if it not as expected",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async reGenerate(@Req() req: Request, @Body() body: ReGenerateImageRequestDto) {
        return await this.generateImageService.reGenerate(req.user as UserInfoDTO, body)
    }
}
