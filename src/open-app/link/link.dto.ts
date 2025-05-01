import { ApiProperty, PickType } from "@nestjs/swagger"
import { AppInfoDto } from "../open-app.dto"
import { IsOptional, IsString, MaxLength } from "class-validator"

export class CreateLinkRequestDto {
    @ApiProperty({
        description: "The link of the share, if target is link",
        required: false,
    })
    link?: string

    @ApiProperty({
        description: "The message of the share, if target is widget",
        required: false,
        maxLength: 2048,
    })
    @MaxLength(2048)
    @IsOptional()
    @IsString()
    widget_message?: string
}

export class LinkStatisticsDto {
    @ApiProperty({
        description: "bind device count",
    })
    bind_device_count: number

    @ApiProperty({
        description: "invited new user count",
    })
    invited_new_user_count: number
}

export class UserLinkStatisticsDto extends LinkStatisticsDto {
    @ApiProperty({
        description: "link count",
    })
    link_count: number
}

export class CreateLinkResponseDto {
    @ApiProperty({
        description: "The id of the link",
    })
    link_id: string

    @ApiProperty({
        description: "Short link of url",
    })
    short_link: string
}

export class LinkDetailDto {
    @ApiProperty({
        description: "The id of the link",
    })
    link_id: string

    @ApiProperty({
        description: "short link",
    })
    short_link: string

    @ApiProperty({
        description: "The creator of the link",
        properties: {
            username: { type: "string" },
            avatar: { type: "string" },
        },
    })
    creator: {
        username: string
        avatar: string
    }

    @ApiProperty({
        description: "The widget tag of the link",
    })
    redirect_to_widget: string

    @ApiProperty({
        description: "The widget message of the link",
    })
    widget_message: string

    @ApiProperty({
        description: "The link of the link",
    })
    redirect_to_link: string

    @ApiProperty({
        description: "The app id of the link",
    })
    app_id: string

    @ApiProperty({
        description: "The app info of the link",
    })
    app_info: AppInfoDto

    @ApiProperty({
        description: "The statistics of the link",
    })
    statistics: LinkStatisticsDto

    @ApiProperty({
        description: "The created at of the link",
    })
    created_at: Date

    @ApiProperty({
        description: "The updated at of the link",
    })
    updated_at: Date
}

export class LinkSummaryDto extends PickType(LinkDetailDto, ["creator", "short_link"]) {}

export class BindDeviceRequestDto {
    @ApiProperty({
        description: "The device id of the user",
    })
    device_id: string

    @ApiProperty({
        description: "The link id of the user",
    })
    link_id: string
}
