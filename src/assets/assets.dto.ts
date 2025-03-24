import { ApiProperty, OmitType, PickType } from "@nestjs/swagger"
import { assets } from "@prisma/client"
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Matches } from "class-validator"
import { IpLibraryDetailDto } from "src/ip-library/ip-library.dto"
import { NewVideoProcessResult } from "src/task/task.dto"

export const ASSETS_MAX_TAKE = 100

export class AssetsDto implements assets {
    @ApiProperty({
        description: "id of the asset",
    })
    id: number

    @ApiProperty({
        description: "name of the asset, not unique",
    })
    name: string

    @IsEnum(["all", "video", "image"])
    @ApiProperty({
        description: "type of the asset, all, video, image",
    })
    type: string

    @IsEnum(["uploads", "exports", "ip-clips"])
    @ApiProperty({
        description: "category of the asset, uploads, exports, ip-clips",
    })
    category: string

    @ApiProperty({
        description: "path of the asset in s3",
    })
    path: string

    @ApiProperty({
        description: "optimized path of the asset in s3",
        required: false,
    })
    path_optimized: any

    @ApiProperty({
        description: "belong to which user",
    })
    user: string

    @ApiProperty({
        description: "created time of the asset",
    })
    created_at: Date

    @ApiProperty({
        description: "thumbnail of the asset",
    })
    thumbnail: string

    @ApiProperty({
        description: "which product exported this asset, video-2-video or face-swap, etc...",
    })
    exported_by: string

    @ApiProperty({
        description:
            "Source video id, only available for category exports and type video, this indicates the id of the video that was exported to create this asset",
    })
    source_video: number

    @ApiProperty({
        description: "info of the asset, normaly video or image metadata",
    })
    asset_info: any | NewVideoProcessResult | null

    @ApiProperty({
        description:
            "task id of the asset, only available for internal use, this indicates the id of the task that was exported to create this asset",
    })
    exported_by_task_id: string

    @ApiProperty({
        description: "ipfs key of the asset",
    })
    ipfs_key: string
}

export class AssetDetailDto extends AssetsDto {
    @ApiProperty({
        description: "signed url of the asset, for browser to access",
    })
    signed_url: string

    @ApiProperty({
        description: "optimized urls of the asset",
    })
    optimized_urls: {
        [key: string]: string
    }

    @ApiProperty({
        description: "signed url of the asset, for download",
    })
    download_url: string

    @ApiProperty({
        description: "thumbnail url of the asset",
    })
    thumbnail_url: string

    @ApiProperty({
        description: "related ip libraries of the asset",
        type: [IpLibraryDetailDto],
    })
    related_ip_libraries: IpLibraryDetailDto[]
}

export class AssetCreateDto extends OmitType(AssetsDto, ["id", "created_at", "exported_by_task_id"] as const) {}

export class AssetsDtoWithUrl extends OmitType(AssetsDto, ["user", "exported_by_task_id", "ipfs_key"] as const) {
    @ApiProperty({
        description: "signed url of the asset, for browser to access",
    })
    signed_url: string

    @ApiProperty({
        description: "signed url of the asset, for download",
    })
    download_url: string
}

export class AssetsListResDto {
    @ApiProperty({ type: [AssetsDtoWithUrl] })
    data: AssetsDtoWithUrl[]

    @ApiProperty({
        description: "total number of assets",
    })
    total: number
}

export class AssetListReqDto {
    @ApiProperty({
        description: "type of the asset, all, video, image",
    })
    type: string

    @ApiProperty({
        description: "category of the asset, uploads, exports, ip-clips",
    })
    category: string

    @ApiProperty({
        description: "which product exported this asset, video-2-video or face-swap, etc...",
        required: false,
    })
    exported_by?: string

    @ApiProperty({
        description: "source video id",
        required: false,
    })
    source_video?: number

    @ApiProperty({
        description: "skip number",
        required: false,
    })
    skip?: number

    @ApiProperty({
        description: "take number",
    })
    take: number
}

export class AssetRenameReqDto extends PickType(AssetsDto, ["id"] as const) {
    @ApiProperty({
        description: "new name of the asset",
    })
    name: string
}

export class UploadTokenDto {
    @ApiProperty({
        description: "name of the file, currently only support mp4",
    })
    @IsString()
    @Matches(/\.mp4|mov|mkv|jpeg|jpg|png$/i, {
        message: "File name must end with .mp4, .mov, .mkv, .jpeg, .jpg, .png",
    })
    file_name: string

    @ApiProperty({
        description: "type of the file",
    })
    @IsString()
    file_type: string
}

export class UploadTokenResDto {
    @ApiProperty({
        description: "object key of the asset in s3",
    })
    object_key: string

    @ApiProperty({
        description: "signed url of the asset, for upload",
    })
    signed_url: string
}

export class UploadedDto extends PickType(UploadTokenResDto, ["object_key"] as const) {
    @ApiProperty({
        description: "name of the asset",
    })
    @IsString()
    @IsNotEmpty()
    name: string

    @ApiProperty({
        description: "source video id",
        required: false,
    })
    @IsOptional()
    source_video?: number

    @ApiProperty({
        description: "category of the asset",
        required: false,
    })
    @IsEnum(["exports", "uploads"])
    @IsOptional()
    category?: "exports" | "uploads"

    @ApiProperty({
        description: "optimize video to 360p",
        required: false,
    })
    @IsOptional()
    optimize?: boolean

    @ApiProperty({
        description: "which product exported this asset, video-2-video or face-swap, etc...",
        required: false,
    })
    @IsOptional()
    exported_by?: string
}

export class UploadedByTaskDto extends UploadedDto {
    task_id: string
}

export class DeleteAssetDto {
    @ApiProperty({
        description: "id of the asset",
    })
    asset_id: number
}

export class VideoTranscodeDto {
    bucket: string
    file_name?: string
    bitrate?: number
    width?: number
    height?: number
}

export class VideoFormatDto {
    bucket: string
    file_name: string
}

export class RelateToIpDto {
    @ApiProperty({
        description: "id of the ip",
    })
    @IsNumber()
    ip_id: number

    @ApiProperty({
        description: "id of the asset",
    })
    @IsNumber()
    asset_id: number
}

export class SplitDto {
    @ApiProperty({
        description: "start time of the split",
    })
    start: number

    @ApiProperty({
        description: "end time of the split",
    })
    end: number
}

export class EditVideoAssetDto {
    @ApiProperty({
        description: "id of the asset",
    })
    id: number

    @ApiProperty({
        description: "splits of the video, currently only support one split",
        type: [SplitDto],
    })
    @IsArray()
    @IsOptional()
    split?: SplitDto[]
}

export class CreateEditJobDto {
    asset_id: number
    edit_params: {
        split?: SplitDto[]
    }
    current_status: "created" | "processing" | "completed" | "failed"
}
