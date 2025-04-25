import { ApiProperty } from "@nestjs/swagger"

export class LinkToWidgetDto {
    @ApiProperty({
        description: "The tag of the widget",
    })
    tag: string

    @ApiProperty({
        description:
            "When share to widget, you can add a message to the widget, this message will be send to the widget via postMessage",
    })
    message: string
}

export class LinkToDto {
    @ApiProperty({
        description: "The target of the share",
        enum: ["widget", "link"],
    })
    target: "widget" | "link"

    @ApiProperty({
        description: "The link of share, if you want to share to widget, you can leave it empty",
        required: false,
    })
    link: string

    @ApiProperty({
        description: "The settings of the widget",
        type: LinkToWidgetDto,
        required: false,
    })
    widget_settings: LinkToWidgetDto
}

export enum LinkType {
    INVITE = "invite",
}

export class CreateLinkRequestDto {
    @ApiProperty({
        description: "The target of the share",
        type: LinkToDto,
    })
    to: LinkToDto

    @ApiProperty({
        description:
            "The type of the share link, invite or share, currently only invite is supported, whatever you put here will be ignored",
        enum: [LinkType.INVITE],
        required: false,
    })
    type?: LinkType
}

export class CreateLinkResponseDto {
    @ApiProperty({
        description: "The link of the share",
    })
    link: string
}
