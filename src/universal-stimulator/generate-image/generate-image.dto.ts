import { IsEnum, IsNumber, IsOptional, IsString, ValidateIf } from "class-validator"

import { ApiProperty, PickType } from "@nestjs/swagger"
import { IsNotEmpty } from "class-validator"

export const supportedRatios = {
    "1:1": {
        width: 1024,
        height: 1024,
    },
    "16:9": {
        width: 1377,
        height: 768,
    },
    "9:16": {
        width: 768,
        height: 1377,
    },
    "4:3": {
        width: 1152,
        height: 896,
    },
    "3:4": {
        width: 896,
        height: 1152,
    },
    "3:2": {
        width: 1216,
        height: 832,
    },
    "2:3": {
        width: 832,
        height: 1216,
    },
}

export class GenerateImageRequestDto {
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
    @IsEnum(Object.keys(supportedRatios))
    @ValidateIf(
        (o) => {
            return !(o.from_asset_id === undefined && o.prompt !== undefined && o.prompt !== "")
        },
        {
            message:
                "ratio must be provided when prompt is provided, supported ratios: " +
                Object.keys(supportedRatios).join(", "),
        },
    )
    ratio: string

    @ApiProperty({ description: "count" })
    @IsNumber()
    @IsOptional()
    @IsEnum([1, 2, 4], {
        message: "count must be provided when prompt is provided, supported count: 1, 2, 4",
    })
    count: number

    @ApiProperty({ description: "seconds" })
    @IsNumber()
    @IsOptional()
    seconds?: number
}

export class TaskGenerateImageDto {
    bucket: string
    file_name?: string
    image_class?: "text" | "image"
    image_cnt: number
    user_args: {
        root: string
        name: string
        value: number | string
    }[]
}

export enum GenerateImageStatusDto {
    UPLOADED = "uploaded",
    PROCESSING = "generating",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled",
}

export class GenerateImageSummaryDto {
    id: number
    current_status: GenerateImageStatusDto
    object_key: string
    object_url: string
}

export class GenerateImageListDto {
    total: number
    data: GenerateImageSummaryDto[]
}
export class GenerateImageParamsDto {
    ratio: string
}

export class GenerateImageRequestDetailDto {
    id: number
    current_status: GenerateImageStatusDto
    object_key: string
    object_url: string
    progress: number
    type: string
    prompt: string
    generate_params: GenerateImageParamsDto
    generate_image_result: GenerateImageResultDto[]
}

export class GenerateImageResultDto {
    id: number
    generate_image_detail: GeneratedImage[]
    created_at: Date
    updated_at: Date
    current_status: GenerateImageStatusDto
    generate_params: GenerateImageParamsDto
}

export class GeneratedImage {
    id: number
    object_key: string
    object_url: string
    download_url: string
}

export type GenerateImageTaskResponseDto = string[]

export class ReGenerateImageRequestDto extends PickType(GenerateImageRequestDto, ["prompt", "ratio", "count"]) {
    @ApiProperty({ description: "generate image id" })
    @IsNumber()
    @IsNotEmpty()
    id: number
}

export class CancelGenerateImageRequestDto {
    @ApiProperty({ description: "generate image id" })
    @IsNumber()
    @IsNotEmpty()
    id: number
}
