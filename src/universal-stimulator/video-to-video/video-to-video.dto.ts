import { ApiProperty, PickType } from "@nestjs/swagger"
import {
    IsArray,
    IsBoolean,
    IsIn,
    IsNotEmpty,
    isNumber,
    IsNumber,
    IsOptional,
    IsString,
    Validate,
} from "class-validator"
import { AssetsListResDto } from "src/assets/assets.dto"
import { VideoSplitDto } from "src/task/task.dto"

export class VideoGenerateParamsDto {
    @IsString()
    @IsNotEmpty()
    preset: string

    @IsString()
    @IsOptional()
    prompt: string

    @IsString()
    seed: string

    @IsNumber()
    @IsNotEmpty()
    total_strength: number

    @IsNumber()
    @IsNotEmpty()
    video_id: number

    @IsArray()
    @IsNumber({}, { each: true })
    @IsOptional()
    sliced_video_ids: number[]

    @IsString()
    @IsNotEmpty()
    @IsIn(["all", "selected", "stopped"])
    method: "all" | "selected" | "stopped"

    @Validate(
        (o: VideoGenerateParamsDto) =>
            (Array.isArray(o.convert_seconds) && o.convert_seconds[1] - o.convert_seconds[0] >= 1) ||
            isNumber(o.convert_seconds),
        {
            message: "convert_seconds must be an array of 2 numbers or a single number",
        },
    )
    convert_seconds: number[] | number

    @IsOptional()
    split_params?: VideoSplitDto

    @IsOptional()
    @IsString()
    @IsIn(["1080", "720"])
    resolution?: "1080" | "720"

    @IsOptional()
    @IsBoolean()
    enhance_effect?: boolean
}

export class VideoMergeParamsDto extends PickType(VideoGenerateParamsDto, ["video_id"] as const) {}
export class VideoCompleteParamsDto extends VideoMergeParamsDto {}
export class VideoCancelParamsDto extends VideoMergeParamsDto {}
export class VideoStopGenerateParamsDto extends VideoMergeParamsDto {}
export class VideoReGenerateParamsDto extends VideoMergeParamsDto {}
export class VideoRetryParamsDto extends VideoMergeParamsDto {}

//video list
export class UniversalStimulatorVideo {
    id: number
    name: string
    thumbnail: string
    current_step: VideoProcessStep
    created_at: Date
    video_info: {
        width: number
        height: number
        duration: number
    }
    generate_params: {
        preset: string
        seed: number
        prompt: string
        total_strength: number
    }
    original_video_url: string
    generated_video_url: string
    generated_video_download_url: string
    queue_position: number
}

export class UniversalStimulatorVideoList {
    total: number
    data: UniversalStimulatorVideo[]
}

export enum VideoProcessStep {
    PENDING = "pending",
    UPLOADED = "uploaded",
    SLICING = "slicing",
    SLICED = "sliced",
    SLICED_FAILED = "sliced_failed",
    CONVERTING = "converting",
    CONVERTED = "converted",
    CONVERT_HANGING = "convert_hanging",
    CONVERT_STOPPED = "convert_stopped",
    COMBINING = "combining",
    COMBINED = "combined",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled",
}

export enum SlicedVideoStatus {
    READY = "ready",
    PENDING = "pending",
    CONVERTING = "converting",
    COMPLETED = "completed",
    STOPPED = "stopped",
    FAILED = "failed",
}

export class CreateFromAssetDto {
    @IsNumber()
    @IsNotEmpty()
    @ApiProperty({ description: "Asset ID" })
    asset_id: number
}

export class VideoDetailDto {
    id: number
    name: string
    signed_url: string
    thumbnail: string
    thumbnail_url: string
    current_status: VideoProcessStep
    generate_params: any
    created_at: Date
    convert_progress: number
    queue_position: number
    video_info: {
        width: number
        height: number
        duration: number
    }
    exported_assets: AssetsListResDto
}
