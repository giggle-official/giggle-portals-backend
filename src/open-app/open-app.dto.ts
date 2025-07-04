import { ApiProperty, PickType } from "@nestjs/swagger"
import { IsEmail, IsNotEmpty } from "class-validator"
import { IpLibraryDetailNoChildDto, IpSummaryDto } from "src/ip-library/ip-library.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { UserWidgetSubscribedDetailDto } from "./widgets/widget.dto"

export class AppMenuDto {
    @ApiProperty({
        description: "Menu ID",
    })
    name: string

    @ApiProperty({
        description: "Menu Path",
    })
    path: string

    @ApiProperty({
        description: "Menu Order",
    })
    order: number

    @ApiProperty({
        description: "Menu Enabled",
    })
    enabled: boolean
}

export class AppWidgetsDto {
    @ApiProperty({
        description: "Widget Tag",
    })
    tag: string

    @ApiProperty({
        description: "Widget Configs",
    })
    configs: Record<string, any>

    @ApiProperty({
        description: "Widget Detail",
        type: Object,
    })
    widget_detail: any

    @ApiProperty({
        description: "Widget Order",
    })
    order: number

    @ApiProperty({
        description: "Widget Enabled",
    })
    enabled: boolean

    @ApiProperty({
        description: "Widget Subscribed Detail",
        type: () => UserWidgetSubscribedDetailDto,
    })
    subscribed_detail: UserWidgetSubscribedDetailDto
}

export class ManifestDto {
    @ApiProperty({
        description: "Enabled",
    })
    enabled: boolean
    @ApiProperty({
        description: "Name",
    })
    name: string

    @ApiProperty({
        description: "Description",
    })
    description: string

    @ApiProperty({
        description: "Short Name",
    })
    theme_color: string
    @ApiProperty({
        description: "Background Color",
    })
    background_color: string
    @ApiProperty({
        description: "Display",
    })
    display: string
    @ApiProperty({
        description: "Orientation",
    })
    orientation: string
}

export class AppIconDto {
    @ApiProperty({
        description: "Icon 192*192",
    })
    icon192: string

    @ApiProperty({
        description: "Icon 512*512",
    })
    icon512: string
}

export class AppInfoDto {
    @ApiProperty({
        description: "App ID",
    })
    app_id: string
    @ApiProperty({
        required: false,
        description: "App Name",
    })
    app_name: string

    @ApiProperty({
        description: "App Description",
        required: false,
    })
    description: string

    @ApiProperty({
        description: "User Info",
        type: () => UserInfoDTO,
        nullable: true,
    })
    user_info: UserInfoDTO | null

    @ApiProperty({
        description: "IP Info",
        type: IpLibraryDetailNoChildDto,
    })
    ip_info: IpLibraryDetailNoChildDto

    @ApiProperty({
        description: "Is Admin",
    })
    is_admin: boolean

    @ApiProperty({
        description: "USDC Mint",
    })
    usdc_mint: string

    @ApiProperty({
        description: "Sub Domain",
    })
    sub_domain: string

    @ApiProperty({
        description: "Style Name",
    })
    style_name: string

    @ApiProperty({
        description: "Radius",
    })
    radius: string

    @ApiProperty({
        description: "App configs, you can pass any configs you want",
        required: false,
        type: Object,
    })
    configs: Record<string, any>

    @ApiProperty({
        description: "App menus",
        required: true,
        type: Object,
        isArray: true,
    })
    menus: AppMenuDto[]

    @ApiProperty({
        description: "Kline URL",
    })
    kline_url: string

    @ApiProperty({
        description: "Widgets",
        type: () => AppWidgetsDto,
        isArray: true,
    })
    widgets: AppWidgetsDto[]

    @ApiProperty({
        description: "Custom Sub Domain",
    })
    custom_sub_domain: string

    @ApiProperty({
        description: "App Icon",
        type: () => AppIconDto,
    })
    app_icons: AppIconDto

    @ApiProperty({
        description: "Manifest",
        type: () => ManifestDto,
    })
    manifest: ManifestDto
}

export class CreateAppDto extends PickType(AppInfoDto, [
    "radius",
    "style_name",
    "sub_domain",
    "configs",
    "widgets",
    "menus",
    "app_icons",
    "manifest",
]) {
    @ApiProperty({
        description:
            "IP ID, this ip must be shared to giggle and have no parent ip and ip owner is the same as the app owner",
    })
    ip_id: number
}

export class UploadIconDto {
    @ApiProperty({
        description: "App ID",
    })
    @IsNotEmpty()
    app_id: string

    @ApiProperty({
        description: "Icon type",
        enum: ["192", "512"],
    })
    @IsNotEmpty()
    icon_type: "192" | "512"
}

export class UploadIconResponseDto {
    @ApiProperty({
        description: "Icon URL",
    })
    icon_url: string
}

export class UpdateAppDto extends PickType(AppInfoDto, [
    "radius",
    "style_name",
    "sub_domain",
    "configs",
    "widgets",
    "menus",
    "app_icons",
    "manifest",
]) {
    @ApiProperty({
        description: "App ID",
    })
    app_id: string

    @ApiProperty({
        description: "IP ID",
    })
    ip_id: number
}

export class TopIpSummaryDto extends PickType(IpSummaryDto, ["id", "name", "ticker"]) {}
export class AppInfoSummaryDto extends PickType(AppInfoDto, [
    "app_id",
    "app_name",
    "description",
    "radius",
    "style_name",
    "sub_domain",
]) {}
export class AppListDto {
    data: AppInfoSummaryDto[]
    total: number
}

export class DeleteAppDto {
    @ApiProperty({
        description: "App ID",
    })
    app_id: string
}

export class DeleteAppResponseDto {
    @ApiProperty({
        description: "Success",
    })
    success: boolean
}

export class OpenAppSettingsDto extends PickType(AppInfoDto, ["kline_url", "usdc_mint"]) {
    @ApiProperty({
        description: "Custom Sub Domain",
    })
    custom_sub_domain: string
}

export class RequestCreatorDto {
    @ApiProperty({
        description: "Full name of the requester",
        example: "John Doe",
    })
    full_name?: string

    @ApiProperty({
        description: "Email of the requester",
        example: "johndoe@example.com",
    })
    @IsEmail()
    @IsNotEmpty()
    email: string

    @ApiProperty({
        description: "Company name",
        example: "Example Inc.",
        required: false,
    })
    company?: string

    @ApiProperty({
        description: "Website URL",
        example: "https://example.com",
        required: false,
    })
    website?: string

    @ApiProperty({
        description: "Social media links (comma separated)",
        example: "https://twitter.com/example, https://linkedin.com/in/example",
        required: false,
    })
    social_media?: string

    @ApiProperty({
        description: "Description of the request or project ideas",
        example: "I would like to create apps related to digital art and NFTs...",
    })
    description: string

    @ApiProperty({
        description: "Invited user email",
        example: "johndoe@example.com",
        required: false,
    })
    invited_user_email?: string
}

export class RequestCreatorResponseDto {
    @ApiProperty({
        description: "Whether the request was successful",
        example: true,
    })
    success: boolean

    @ApiProperty({
        description: "Message to display to the user",
        example: "Your request has been sent to the creator",
    })
    message: string
}

export class ApproveCreatorDto {
    @ApiProperty({
        description: "Email of the creator to approve",
        example: "johndoe@example.com",
    })
    email: string
}

export class ApproveCreatorResponseDto {
    @ApiProperty({
        description: "Whether the request was successful",
        example: true,
    })
    success: boolean

    @ApiProperty({
        description: "Message to display to the user",
        example: "Creator has been approved successfully",
    })
    message: string
}

export class AddInviteEmailDto {
    @ApiProperty({
        description: "Invite email, this email will be used to invite users to create app permission",
        example: "johndoe@example.com",
    })
    email: string
}

export class RemoveInviteEmailDto extends AddInviteEmailDto {}
