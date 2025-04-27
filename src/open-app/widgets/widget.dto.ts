import { ApiExcludeEndpoint, ApiProperty, OmitType, PartialType } from "@nestjs/swagger"
import { user_subscribed_widgets, widgets } from "@prisma/client"
import { JsonValue } from "@prisma/client/runtime/library"
import { PickType } from "@nestjs/swagger"
import { IsNotEmpty, IsString, MinLength, MaxLength } from "class-validator"
import { JwtPermissions, ROLES } from "src/casl/casl-ability.factory/jwt-casl-ability.factory"

export class WidgetSettingsDto {
    @ApiProperty({ description: "widget tag" })
    widget_tag: string

    @ApiProperty({ description: "management url" })
    management_url: string

    @ApiProperty({ description: "widget url" })
    widget_url: string

    @ApiProperty({ description: "metadata" })
    metadata: Record<string, any>

    @ApiProperty({ description: "repository url" })
    repository_url?: string

    @ApiProperty({ description: "permissions", required: true, enum: ROLES })
    permissions: JwtPermissions[]

    @ApiProperty({ description: "type", required: true, enum: ["iframe", "system"] })
    type: "iframe" | "system"
}

export class UserWidgetSubscribedDetailDto implements user_subscribed_widgets {
    @ApiProperty({ description: "id" })
    id: number

    @ApiProperty({ description: "user id" })
    user: string

    @ApiProperty({ description: "widget tag" })
    widget_tag: string

    @ApiProperty({ description: "public config" })
    public_config: JsonValue

    @ApiProperty({ description: "private config" })
    private_config: JsonValue

    @ApiProperty({ description: "subscription started at" })
    started_at: Date

    @ApiProperty({ description: "subscription expired at" })
    expired_at: Date

    @ApiProperty({ description: "subscription created at" })
    created_at: Date

    @ApiProperty({ description: "subscription updated at" })
    updated_at: Date

    @ApiProperty({ description: "subscription id" })
    subscription_id: string
}

export class UserWidgetSubscribedResponseDto extends OmitType(UserWidgetSubscribedDetailDto, ["id"]) {}

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

    is_private: boolean
    is_developing: boolean
    test_users: string[]
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
    "is_private",
    "is_developing",
    "test_users",
]) {}

export class UpdateWidgetDto extends PartialType(CreateWidgetDto) {
    @ApiProperty({ description: "widget tag" })
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(32)
    tag: string
}

export class AuthorInfoDto {
    @ApiProperty({ description: "widget author username" })
    username: string

    @ApiProperty({ description: "widget author avatar" })
    avatar: string
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
    "icon",
    "description",
    "settings",
    "coming_soon",
    "is_developing",
    "is_private",
    "priority",
]) {
    @ApiProperty({ description: "widget subscribers" })
    subscribers: number

    @ApiProperty({ description: "widget is subscribed" })
    is_subscribed: boolean

    @ApiProperty({ description: "widget author info", type: AuthorInfoDto })
    author_info: AuthorInfoDto

    @ApiProperty({ description: "widget subscribed detail" })
    subscribed_detail: UserWidgetSubscribedResponseDto
}

export class WidgetDetailDto extends WidgetSummaryDto {
    @ApiProperty({ description: "widget created at" })
    created_at: Date
    @ApiProperty({ description: "widget updated at" })
    updated_at: Date

    @ApiProperty({ description: "widget test users" })
    test_users: string[]
}

export class DeleteWidgetDto extends PickType(WidgetDto, ["tag"]) {}

export class SubscribeWidgetDto extends PickType(WidgetDto, ["tag"]) {
    @ApiProperty({ description: "public configuration for widget", required: false })
    publicConfig?: Record<string, any>

    @ApiProperty({ description: "private configuration for widget", required: false })
    privateConfig?: Record<string, any>
}

export class UnsubscribeWidgetDto extends PickType(WidgetDto, ["tag"]) {}
export class GetAccessTokenDto extends PickType(WidgetDto, ["tag"]) {}

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

    @ApiProperty({ description: "enabled", required: false })
    enabled?: boolean
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

    @ApiProperty({ description: "type", required: false, enum: ["iframe", "system"] })
    type?: "iframe" | "system"
}

export class GetAccessTokenResponseDto {
    @ApiProperty({ description: "access token" })
    access_token: string
}
