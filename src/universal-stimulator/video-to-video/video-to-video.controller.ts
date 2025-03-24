import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards, Get, Param, Query } from "@nestjs/common"
import { VideoToVideoService } from "./video-to-video.service"
import {
    CreateFromAssetDto,
    VideoCancelParamsDto,
    VideoDetailDto,
    VideoGenerateParamsDto,
    VideoReGenerateParamsDto,
    VideoRetryParamsDto,
    VideoStopGenerateParamsDto,
} from "./video-to-video.dto"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { ApiOperation, ApiTags, ApiExcludeEndpoint } from "@nestjs/swagger"
import { UploadedDto } from "src/assets/assets.dto"

@ApiTags("AIGC Video Animation")
@Controller("api/v1/video-to-video")
export class VideoToVideoController {
    constructor(private readonly videoToVideoService: VideoToVideoService) {}

    @Post("uploaded")
    @UseGuards(AuthGuard("jwt"))
    @ApiExcludeEndpoint()
    @HttpCode(HttpStatus.OK)
    async videoUploaded(@Req() req: Request, @Body() body: UploadedDto) {
        return await this.videoToVideoService.newVideoUploaded(req.user as any, body)
    }

    @Post("re-generate")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Re-generate a video if it not as expected",
    })
    @HttpCode(HttpStatus.OK)
    async reGeneratevideo(@Req() req: Request, @Body() body: VideoGenerateParamsDto) {
        return await this.videoToVideoService.reGeneratevideo(req.user as any, body)
    }

    @Post("retry")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Retry a video if it failed",
    })
    @HttpCode(HttpStatus.OK)
    async retryVideo(@Req() req: Request, @Body() body: VideoRetryParamsDto) {
        return await this.videoToVideoService.retryVideo(req.user as any, body)
    }

    @Get("list")
    @ApiOperation({
        summary: "Get video-to-video job list",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getVideoList(@Req() req: Request, @Query("take") take: string = "10") {
        return await this.videoToVideoService.getVideoList(req.user as any, parseInt(take))
    }

    @Get("/:videoId")
    @ApiOperation({
        summary: "Get video-to-video job detail",
    })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getCurrentVideo(@Req() req: Request, @Param("videoId") videoId: string): Promise<VideoDetailDto> {
        return await this.videoToVideoService.getVideoDetail(req.user as any, parseInt(videoId))
    }

    @Post("generate")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "create a video-to-video job",
    })
    @HttpCode(HttpStatus.OK)
    async generateVideo(@Req() req: Request, @Body() body: VideoGenerateParamsDto) {
        return await this.videoToVideoService.generateVideo(req.user as any, body)
    }

    @ApiExcludeEndpoint()
    @Get("slicedVideos/:videoId")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getSlicedVideos(@Req() req: Request, @Param("videoId") videoId: string, @Query("take") take: string = "10") {
        return await this.videoToVideoService.getSlicedVideos(req.user as any, parseInt(videoId), parseInt(take))
    }

    @Post("cancel")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Cancel a video-to-video job",
    })
    @HttpCode(HttpStatus.OK)
    async cancelVideo(@Req() req: Request, @Body() body: VideoCancelParamsDto) {
        return await this.videoToVideoService.cancelVideo(req.user as any, body)
    }

    @Post("create-from-asset")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Create video convert job from asset",
    })
    @HttpCode(HttpStatus.OK)
    async createFromAsset(@Req() req: Request, @Body() body: CreateFromAssetDto) {
        return await this.videoToVideoService.createFromAsset(req.user as any, body.asset_id)
    }

    @Post("stopGenerate")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Stop a video-to-video job",
    })
    @HttpCode(HttpStatus.OK)
    async stopGenerateVideo(@Req() req: Request, @Body() body: VideoStopGenerateParamsDto) {
        return await this.videoToVideoService.stopGenerateVideo(req.user as any, body)
    }
}
