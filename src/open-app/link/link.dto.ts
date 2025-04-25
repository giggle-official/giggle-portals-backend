import { ApiProperty, PickType } from "@nestjs/swagger"
import { AppInfoDto } from "../open-app.dto"

export class CreateLinkRequestDto {
    @ApiProperty({
        description: "The link of the share, if target is link",
        required: false,
    })
    link?: string

    @ApiProperty({
        description: "The message of the share, if target is widget",
        required: false,
    })
    widget_message?: any
}

export class CreateLinkResponseDto {
    @ApiProperty({
        description: "The id of the link",
    })
    link_id: string

    @ApiProperty({
        description: "The url of the link",
    })
    link_url: string
}

export class LinkDetailDto {
    @ApiProperty({
        description: "The id of the link",
    })
    link_id: string

    @ApiProperty({
        description: "The url of the link",
    })
    link_url: string

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
    widget_message: any

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
        description: "The created at of the link",
    })
    created_at: Date

    @ApiProperty({
        description: "The updated at of the link",
    })
    updated_at: Date
}

export class LinkSummaryDto extends PickType(LinkDetailDto, ["creator", "link_url"]) {}
