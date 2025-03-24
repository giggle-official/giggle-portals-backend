import { IsEnum, IsNumber, IsOptional, IsString, ValidateIf } from "class-validator"

import { ApiProperty, PickType } from "@nestjs/swagger"
import { IsNotEmpty } from "class-validator"

export class GenerateVideoRequestDto {
    @ApiProperty({ description: "from asset id" })
    @IsNumber()
    @IsOptional()
    @ValidateIf(
        (o) => {
            return !(o.from_asset_id === undefined && o.prompt === undefined)
        },
        { message: "Either from_asset_id or prompt must be provided" },
    )
    from_asset_id?: number

    @ApiProperty({ description: "prompt" })
    @IsOptional()
    @ValidateIf(
        (o) => {
            return !(o.from_asset_id === undefined && o.prompt === undefined)
        },
        { message: "Either from_asset_id or prompt must be provided" },
    )
    prompt?: string

    @ApiProperty({ description: "ratio" })
    @IsOptional()
    @IsEnum(["16:9", "9:16", "1:1"])
    @ValidateIf(
        (o) => {
            return !(o.from_asset_id === undefined && o.prompt !== undefined && o.prompt !== "")
        },
        {
            message: "ratio must be provided when prompt is provided",
        },
    )
    ratio: "16:9" | "9:16" | "1:1"

    @ApiProperty({ description: "model" })
    @IsNotEmpty()
    @IsString()
    model: string

    @ApiProperty({ description: "seconds" })
    @IsNumber()
    @IsOptional()
    seconds?: number
}

export class TaskGenerateVideoDto {
    bucket: string
    file_name?: string
    style_name?: string
    user_args: {
        root: string
        name: string
        value: number | string
    }[]
}

export enum GenerateStatusDto {
    UPLOADED = "uploaded",
    PROCESSING = "generating",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled",
}

export class GenerateVideoSummaryDto {
    id: number
    current_status: GenerateStatusDto
    object_key: string
    object_url: string
}

export class GenerateVideoListDto {
    total: number
    data: GenerateVideoSummaryDto[]
}
export class GenerateVideoParamsDto {
    @ApiProperty({
        enum: ["16:9", "9:16", "1:1"],
    })
    ratio: "16:9" | "9:16" | "1:1"
}

export class GenerateVideoDetailDto {
    @ApiProperty()
    id: number
    @ApiProperty({
        enum: GenerateStatusDto,
    })
    current_status: GenerateStatusDto
    @ApiProperty()
    progress: number
    @ApiProperty()
    model: string
    @ApiProperty()
    object_key: string
    @ApiProperty()
    object_url: string
    @ApiProperty()
    type: string
    @ApiProperty()
    prompt: string
    @ApiProperty({
        type: GenerateVideoParamsDto,
    })
    generate_params: GenerateVideoParamsDto
    @ApiProperty()
    generate_video_result: GenerateVideoResultDto[]
}

export class GenerateVideoResultDto {
    @ApiProperty()
    id: number
    @ApiProperty()
    thumbnail: string
    @ApiProperty()
    thumbnail_url: string
    @ApiProperty()
    object_key: string
    @ApiProperty()
    object_url: string
    @ApiProperty()
    object_download_url: string
    @ApiProperty()
    to_asset_id: number
}

export type GenerateVideoTaskResponseDto = string

export class ReGenerateVideoRequestDto extends PickType(GenerateVideoRequestDto, ["prompt", "ratio", "model"]) {
    @ApiProperty({ description: "generate video id" })
    @IsNumber()
    @IsNotEmpty()
    id: number
}

export class CancelGenerateVideoRequestDto {
    @ApiProperty({ description: "generate video id" })
    @IsNumber()
    @IsNotEmpty()
    id: number
}
