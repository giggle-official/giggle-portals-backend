import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import { FaceSwapService } from "./face-swap.service"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import {
    FaceSwapCancelParamsDto,
    FaceSwapCreateDto,
    FaceSwapReExtractDto,
    FaceSwapRemoveFaceDto,
    FaceSwapRequestDto,
    FaceSwapReSwapDto,
    FaceSwapRetryDto,
} from "./face-swap.dto"

@ApiTags("AIGC Face Swap")
@Controller("api/v1/face-swap")
export class FaceSwapController {
    constructor(private readonly faceSwapService: FaceSwapService) {}

    @Get("/")
    @ApiOperation({
        summary: "Get face swap list",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getList(@Req() req: Request, @Query("take") take: string = "10") {
        return await this.faceSwapService.getList(req.user as any, parseInt(take))
    }

    @Get("/:id")
    @ApiOperation({
        summary: "Get face swap detail",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getDetail(@Req() req: Request, @Param("id") id: string) {
        return await this.faceSwapService.detail(req.user as any, parseInt(id))
    }

    @Post("/create")
    @ApiOperation({
        summary: "Create a face swap",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async create(@Req() req: Request, @Body() body: FaceSwapCreateDto) {
        return await this.faceSwapService.create(req.user as any, body)
    }

    @Post("/cancel")
    @ApiOperation({
        summary: "Cancel a face swap",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async cancelVideo(@Req() req: Request, @Body() body: FaceSwapCancelParamsDto) {
        return await this.faceSwapService.cancelVideo(req.user as any, body)
    }

    @Post("/re-extract")
    @ApiOperation({
        summary: "Re-extract faces from video",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async reExtractFace(@Req() req: Request, @Body() body: FaceSwapReExtractDto) {
        return await this.faceSwapService.reExtractFace(req.user as any, body)
    }

    @Post("/retry")
    @ApiOperation({
        summary: "Retry a face swap when it failed",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async retry(@Req() req: Request, @Body() body: FaceSwapRetryDto) {
        return await this.faceSwapService.retry(req.user as any, body)
    }

    @Post("/re-swap")
    @ApiOperation({
        summary: "Re-swap faces if it not as expected",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async reSwap(@Req() req: Request, @Body() body: FaceSwapReSwapDto) {
        return await this.faceSwapService.reSwap(req.user as any, body)
    }

    @Post("/swap")
    @ApiOperation({
        summary: "create a face swap job",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async swapFace(@Req() req: Request, @Body() body: FaceSwapRequestDto) {
        return await this.faceSwapService.swapFace(req.user as any, body)
    }

    @Post("/remove-face")
    @ApiOperation({
        summary: "remove a extracted face",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async removeFace(@Req() req: Request, @Body() body: FaceSwapRemoveFaceDto) {
        return await this.faceSwapService.removeFace(req.user as any, body)
    }
}
