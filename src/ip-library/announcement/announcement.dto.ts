import { ApiProperty, PickType, OmitType } from "@nestjs/swagger"
import { IsNotEmpty, IsString, IsOptional, MinLength, IsNumber, IsArray, IsDate } from "class-validator"
import { ip_announcement } from "@prisma/client"
import { PaginationDto } from "src/common/common.dto"

export class AnnouncementDto implements ip_announcement {
    @ApiProperty({
        description: "Id",
    })
    @IsNotEmpty()
    @IsNumber()
    id: number

    @ApiProperty({
        description: "Ip id",
    })
    @IsNotEmpty()
    @IsNumber()
    ip_id: number

    @ApiProperty({
        description: "Title of the announcement",
    })
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    title: string

    @ApiProperty({
        description: "Content of the announcement",
    })
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    description: string

    @ApiProperty({
        description: "Cover asset id",
        required: false,
    })
    @IsOptional()
    @IsNumber()
    cover_asset_id: number

    @ApiProperty({
        description: "Video asset id",
        required: false,
    })
    @IsOptional()
    @IsNumber()
    video_asset_id: number

    @ApiProperty({
        description: "Creator",
    })
    @IsOptional()
    @IsString()
    creator: string

    @ApiProperty({
        description: "Cover key",
        required: false,
    })
    @IsOptional()
    @IsString()
    cover_key: string

    @ApiProperty({
        description: "Video key",
        required: false,
    })
    @IsOptional()
    @IsString()
    video_key: string

    @ApiProperty({
        description: "Created at",
    })
    @IsOptional()
    @IsDate()
    created_at: Date

    @ApiProperty({
        description: "Updated at",
    })
    @IsOptional()
    @IsDate()
    updated_at: Date
}

export class CreateAnnouncementDto extends PickType(AnnouncementDto, [
    "ip_id",
    "title",
    "description",
    "cover_asset_id",
    "video_asset_id",
]) {}

export class UpdateAnnouncementDto extends PickType(AnnouncementDto, [
    "id",
    "title",
    "description",
    "cover_asset_id",
    "video_asset_id",
]) {}

export class AnnouncementDetailDto extends AnnouncementDto {
    @ApiProperty({
        description: "Cover url",
        required: false,
    })
    cover_url: string

    @ApiProperty({
        description: "Video url",
        required: false,
    })
    video_url: string
}

export class AnnouncementListDto {
    @ApiProperty({
        description: "Announcement list",
        type: [AnnouncementDetailDto],
    })
    data: AnnouncementDetailDto[]

    @ApiProperty({
        description: "Total number of announcements",
    })
    total: number
}

export class DeleteAnnouncementDto extends PickType(AnnouncementDto, ["id"]) {}

export class DeleteAnnouncementResponseDto {
    @ApiProperty({
        description: "Success",
    })
    success: boolean
}

export class AnnouncementListQueryDto extends PaginationDto {
    @ApiProperty({
        description: "Search by title",
        required: false,
    })
    @IsOptional()
    @IsString()
    search: string

    @ApiProperty({
        description: "App id",
        required: false,
    })
    @IsOptional()
    @IsString()
    app_id: string
}
