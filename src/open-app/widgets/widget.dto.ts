import { ApiProperty } from "@nestjs/swagger"

export class CreateWidgetDto {
    @ApiProperty({ description: "widget tag" })
    tag: string
    @ApiProperty({ description: "widget name" })
    name: string
    @ApiProperty({ description: "for all user" })
    for_all_user: boolean
}
