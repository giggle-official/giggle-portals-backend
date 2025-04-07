import { ApiProperty, PartialType } from "@nestjs/swagger"
import { widgets } from "@prisma/client"
import { JsonValue } from "@prisma/client/runtime/library"
import { PickType } from "@nestjs/swagger"
import { IsNotEmpty, IsString, MinLength, MaxLength } from "class-validator"
import { PaginationParams } from "src/admin/request.dto"

export class WidgetSettingsDto {
    @ApiProperty({ description: "widget tag" })
    widget_tag: string

    @ApiProperty({ description: "management url" })
    management_url: string

    @ApiProperty({ description: "widget url" })
    widget_url: string

    @ApiProperty({ description: "metadata" })
    metadata: Record<string, any>
}

export class WidgetDto implements widgets {
    @ApiProperty({ description: "widget id" })
    id: number

    @ApiProperty({ description: "widget tag" })
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(32)
    tag: string

    @ApiProperty({ description: "widget name" })
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(32)
    name: string

    @ApiProperty({ description: "widget summary", required: false })
    summary: string

    @ApiProperty({ description: "widget pricing", required: false })
    pricing: JsonValue

    @ApiProperty({ description: "widget settings", type: WidgetSettingsDto })
    settings: JsonValue

    @ApiProperty({ description: "widget is featured" })
    is_featured: boolean

    @ApiProperty({ description: "widget is new" })
    is_new: boolean

    @ApiProperty({ description: "widget is official" })
    is_official: boolean

    @ApiProperty({ description: "widget category" })
    category: string

    @ApiProperty({ description: "widget author" })
    author: string

    @ApiProperty({ description: "widget icon" })
    icon: string

    @ApiProperty({ description: "widget description" })
    description: string

    @ApiProperty({ description: "widget created at" })
    created_at: Date

    @ApiProperty({ description: "widget updated at" })
    updated_at: Date

    @ApiProperty({ description: "widget coming soon" })
    coming_soon: boolean

    @ApiProperty({ description: "widget priority" })
    priority: number
}

export class CreateWidgetDto extends PickType(WidgetDto, [
    "tag",
    "name",
    "summary",
    "pricing",
    "is_featured",
    "is_new",
    "is_official",
    "category",
    "author",
    "icon",
    "description",
    "settings",
    "coming_soon",
    "priority",
]) {}

export class UpdateWidgetDto extends PartialType(CreateWidgetDto) {
    @ApiProperty({ description: "widget tag" })
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(32)
    tag: string
}

export class WidgetSummaryDto extends PickType(WidgetDto, [
    "tag",
    "name",
    "summary",
    "pricing",
    "is_featured",
    "is_new",
    "is_official",
    "category",
    "author",
    "icon",
    "description",
    "settings",
    "coming_soon",
    "priority",
]) {
    @ApiProperty({ description: "widget subscribers" })
    subscribers: number

    @ApiProperty({ description: "widget is subscribed" })
    is_subscribed: boolean
}

export class WidgetDetailDto extends WidgetSummaryDto {
    @ApiProperty({ description: "widget created at" })
    created_at: Date
    @ApiProperty({ description: "widget updated at" })
    updated_at: Date
}

export class DeleteWidgetDto extends PickType(WidgetDto, ["tag"]) {}

export class SubscribeWidgetDto extends PickType(WidgetDto, ["tag"]) {
    @ApiProperty({ description: "public configuration for widget", required: false })
    publicConfig?: Record<string, any>

    @ApiProperty({ description: "private configuration for widget", required: false })
    privateConfig?: Record<string, any>
}

export class UnsubscribeWidgetDto extends PickType(WidgetDto, ["tag"]) {}

export class WidgetConfigDto {
    @ApiProperty({ description: "public configuration for widget" })
    public: Record<string, any>

    @ApiProperty({ description: "private configuration for widget" })
    private: Record<string, any>
}

export class ApplyWidgetConfigToAppsDto extends WidgetConfigDto {
    @ApiProperty({ description: "widget tag" })
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(32)
    tag: string

    @ApiProperty({ description: "app id" })
    @IsNotEmpty()
    @IsString()
    app_id: string
}

export class UnbindWidgetConfigFromAppsDto extends PickType(WidgetDto, ["tag"]) {
    @ApiProperty({ description: "app id" })
    @IsNotEmpty()
    @IsString()
    app_id: string
}

export class GetWidgetsRequestDto {
    @ApiProperty({ description: "category", required: false })
    category?: string

    @ApiProperty({ description: "limit", required: false })
    limit?: number

    @ApiProperty({ description: "exclude tags", required: false })
    exclude?: string
}
