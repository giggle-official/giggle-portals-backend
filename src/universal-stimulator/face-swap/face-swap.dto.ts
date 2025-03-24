import { OmitType, PickType } from "@nestjs/swagger"
import { face_swap_videos } from "@prisma/client"
import { JsonValue } from "@prisma/client/runtime/library"
import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString, Max, Min } from "class-validator"
import { IsNumber } from "class-validator"
import { AssetsListResDto } from "src/assets/assets.dto"

export class FaceSwapDto implements face_swap_videos {
    id: number
    user: string
    name: string
    object_key: string
    status: FaceSwapStatus
    video_info: JsonValue
    extract_task_id: string
    extracting_params: JsonValue
    swapped_result_key: string
    swapping_task_id: string
    from_asset_id: number
    result_asset_id: number
    thumbnail: string
    created_at: Date
    updated_at: Date
}

export class TaskFaceExtractDto {
    bucket: string
    file_name: string
    user_args: {
        root: string
        name: string
        value: number
    }[]
}

export class TaskFaceSwapDto {
    bucket: string
    file_name: string
    image_list: {
        reference_img: string
        source_img: string
    }[]
}

export enum FaceSwapStatus {
    UPLOADED = "uploaded",
    EXTRACTING = "extracting",
    EXTRACTED = "extracted",
    SWAPPING = "swapping",
    SWAPPED = "swapped",
    CANCELLED = "cancelled",
    FAILED = "failed",
}

export type FaceExtractTaskResponseDto = string[]
export type FaceSwapTaskResponseDto = string

export class FaceSwapCreateDto extends PickType(FaceSwapDto, ["from_asset_id"]) {
    @ApiProperty({ description: "from asset id" })
    @IsNumber()
    @IsNotEmpty()
    from_asset_id: number
}

export class FaceSwapSummaryDto extends PickType(FaceSwapDto, ["id", "name", "status", "thumbnail"]) {}
export class FaceSwapListDto {
    data: FaceSwapSummaryDto[]
    total: number
}

export class FaceSwapDetailDto extends PickType(FaceSwapDto, [
    "id",
    "name",
    "status",
    "object_key",
    "thumbnail",
    "created_at",
    "updated_at",
    "video_info",
]) {
    @ApiProperty({ description: "thumbnail url" })
    thumbnail_url: string

    @ApiProperty({ description: "object video url" })
    object_video_url: string

    @ApiProperty({ description: "queue position" })
    queue_position: number

    @ApiProperty({ description: "face extracted" })
    face_extracted: FaceExtractedDto[]

    @ApiProperty({ description: "exported assets" })
    exported_assets: AssetsListResDto
}

export class FaceExtractedDto {
    id: number
    recognition_face_key: string
    recognition_face_url: string
    target_face_key: string
    target_face_url: string
}

export class FaceSwapCancelParamsDto {
    @ApiProperty({ description: "face swap id" })
    @IsNumber()
    @IsNotEmpty()
    id: number
}

export class FaceSwapExtractingParamsDto {
    @ApiProperty({ description: "face score" })
    @IsNumber()
    @IsNotEmpty()
    @Min(0.1)
    @Max(1)
    face_score: number

    @ApiProperty({ description: "face distance" })
    @IsNumber()
    @IsNotEmpty()
    @Min(0.1)
    @Max(1)
    face_distance: number
}

export class FaceSwapReExtractDto {
    @ApiProperty({ description: "face swap id" })
    @IsNumber()
    @IsNotEmpty()
    id: number

    @ApiProperty({ description: "extracting params" })
    extracting_params: FaceSwapExtractingParamsDto
}

export class FaceSwapRetryDto {
    @ApiProperty({ description: "face swap id" })
    @IsNumber()
    @IsNotEmpty()
    id: number
}

export class FaceSwapParamsDto {
    @ApiProperty({ description: "face swap id" })
    @IsNumber()
    @IsNotEmpty()
    face_id: number

    @ApiProperty({ description: "target face s3 key" })
    @IsString()
    target_face_key: string
}

export class FaceSwapRequestDto {
    @ApiProperty({ description: "video id to swap" })
    @IsNumber()
    @IsNotEmpty()
    video_id: number

    @ApiProperty({ description: "params to swap" })
    swap_params: FaceSwapParamsDto[]
}

export class FaceSwapReSwapDto {
    @ApiProperty({ description: "face swap id" })
    @IsNumber()
    @IsNotEmpty()
    id: number
}

export class FaceSwapRemoveFaceDto {
    @ApiProperty({ description: "face id" })
    @IsNumber()
    @IsNotEmpty()
    id: number
}
