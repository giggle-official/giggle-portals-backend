import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from "@nestjs/common"
import { OpenAppService } from "./open-app.service"
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiHeaders,
    ApiBody,
    ApiBearerAuth,
    ApiExcludeEndpoint,
} from "@nestjs/swagger"
import {
    AppInfoDto,
    AppListDto,
    ApproveCreatorDto,
    ApproveCreatorResponseDto,
    CreateAppDto,
    DeleteAppDto,
    DeleteAppResponseDto,
    OpenAppSettingsDto,
    RequestCreatorDto,
    RequestCreatorResponseDto,
    TopIpSummaryDto,
    UpdateAppDto,
    AddInviteEmailDto,
    RemoveInviteEmailDto,
} from "./open-app.dto"
import { AuthGuard } from "@nestjs/passport"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request, Response } from "express"
import { PaginationDto } from "src/common/common.dto"
import { Recaptcha } from "@nestlab/google-recaptcha"

@Controller("/api/v1/app")
export class OpenAppController {
    constructor(private readonly openAppService: OpenAppService) {}

    @Get("/list")
    @ApiOperation({
        summary: "Get app list",
        tags: ["IP Portal"],
    })
    @ApiResponse({
        type: AppListDto,
    })
    @ApiBearerAuth()
    @UseGuards(AuthGuard("jwt"))
    async getAppList(@Req() req: Request, @Query() query: PaginationDto): Promise<AppListDto> {
        return this.openAppService.getAppList(req.user as UserJwtExtractDto, query)
    }

    @Get("/info")
    @ApiOperation({
        summary: "Get portal info",
        tags: ["IP Portal"],
    })
    @ApiHeaders([
        {
            name: "app-id",
            description: "App ID, please contact us to get the app id",
            required: true,
        },
        {
            name: "authorization",
            description: "JWT Authorization, if set,this field is using to verify if user is admin of the app",
            required: false,
        },
    ])
    @ApiResponse({
        status: 200,
        description: "App info",
        type: AppInfoDto,
    })
    async getAppInfo(@Headers("app-id") appId: string, @Headers("authorization") authorization?: string) {
        const token = authorization?.split(" ")[1]
        return this.openAppService.getAppDetail(appId, token)
    }

    @Get("/settings")
    @ApiOperation({
        summary: "Get open-app settings",
    })
    @ApiResponse({
        status: 200,
        description: "Open-app settings",
        type: OpenAppSettingsDto,
    })
    @ApiExcludeEndpoint()
    async getOpenAppSettings() {
        return this.openAppService.getOpenAppSettings()
    }

    @Post("/create")
    @ApiExcludeEndpoint()
    @ApiBody({
        type: CreateAppDto,
    })
    @ApiOperation({
        summary: "Create app",
    })
    @ApiResponse({
        status: 200,
    })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async createApp(@Body() createAppDto: CreateAppDto, @Req() req: Request) {
        return this.openAppService.createApp(createAppDto, req.user as UserJwtExtractDto)
    }

    @Post("/preview")
    @ApiExcludeEndpoint()
    @ApiBody({
        type: CreateAppDto,
    })
    @ApiOperation({
        summary: "Preview app",
    })
    @ApiResponse({
        type: AppInfoDto,
        status: 200,
    })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async previewApp(
        @Body() createAppDto: CreateAppDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<AppInfoDto> {
        return this.openAppService.previewApp(createAppDto, req.user as UserJwtExtractDto, req.cookies, res)
    }

    @Post("/delete")
    @ApiExcludeEndpoint()
    @ApiBody({
        type: DeleteAppDto,
    })
    @ApiOperation({
        summary: "Delete app",
    })
    @ApiResponse({
        status: 200,
    })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async deleteApp(@Body() deleteAppDto: DeleteAppDto, @Req() req: Request): Promise<DeleteAppResponseDto> {
        return this.openAppService.deleteApp(deleteAppDto, req.user as UserJwtExtractDto)
    }

    @Post("/update-app")
    @ApiExcludeEndpoint()
    @ApiBody({
        type: UpdateAppDto,
    })
    @ApiOperation({
        summary: "Update app",
    })
    @ApiResponse({
        status: 200,
    })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async updateApp(@Body() updateAppDto: UpdateAppDto, @Req() req: Request) {
        return this.openAppService.updateApp(updateAppDto, req.user as UserJwtExtractDto)
    }

    @Get("/top-ip-list")
    @ApiExcludeEndpoint()
    @ApiOperation({
        summary: "Get top IP list",
    })
    @ApiResponse({
        type: TopIpSummaryDto,
        isArray: true,
        status: 200,
    })
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async getTopIpList(@Req() req: Request) {
        return this.openAppService.getTopIpList(req.user as UserJwtExtractDto)
    }

    @Post("/request-creator")
    @ApiExcludeEndpoint()
    @ApiBody({
        type: RequestCreatorDto,
    })
    @ApiOperation({
        summary: "Request to become a creator on the platform",
        description: "Sends an application to become a creator on the platform with contact details and project ideas",
    })
    @ApiResponse({
        status: 200,
        description: "Request sent successfully",
        type: RequestCreatorResponseDto,
    })
    @HttpCode(HttpStatus.OK)
    @Recaptcha()
    async requestCreator(@Body() requestCreatorDto: RequestCreatorDto): Promise<RequestCreatorResponseDto> {
        return this.openAppService.requestCreator(requestCreatorDto)
    }

    @Post("/approve-creator")
    @ApiBody({
        type: ApproveCreatorDto,
    })
    @ApiOperation({
        tags: ["App Management"],
        summary: "Approve a creator application",
        description: "Approves a creator application, enables IP creation permissions, and sends a confirmation email",
    })
    @ApiResponse({
        status: 200,
        description: "Creator approved successfully",
        type: ApproveCreatorResponseDto,
    })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async approveCreator(
        @Body() approveCreatorDto: ApproveCreatorDto,
        @Req() req: Request,
    ): Promise<ApproveCreatorResponseDto> {
        return this.openAppService.approveCreator(approveCreatorDto, req.user as UserJwtExtractDto)
    }

    @Get("/lookup-by-subdomain/:subdomain")
    @ApiExcludeEndpoint()
    @ApiOperation({
        summary: "Lookup app by subdomain",
    })
    @ApiResponse({
        status: 200,
        description: "App info",
        type: AppInfoDto,
    })
    async lookupBySubdomain(@Param("subdomain") subdomain: string) {
        return this.openAppService.lookupBySubdomain(subdomain)
    }

    @Get("/info/:appId")
    @ApiOperation({
        summary: "Get portal info by app id",
        description: "Get portal info by app id",
        tags: ["IP Portal"],
    })
    @ApiHeaders([
        {
            name: "authorization",
            description: "JWT Auth orization, if set,this field is using to verify if user is admin of the app",
            required: false,
        },
    ])
    @ApiResponse({
        status: 200,
        description: "App info",
        type: AppInfoDto,
    })
    async getAppInfoByAppId(@Param("appId") appId: string, @Headers("authorization") authorization?: string) {
        const token = authorization?.split(" ")[1]
        return this.openAppService.getAppDetail(appId, token)
    }

    @Post("/add-invite-email")
    @ApiBody({
        type: AddInviteEmailDto,
    })
    @ApiOperation({
        summary: "Add invite email",
        tags: ["App Management"],
    })
    @ApiResponse({
        status: 200,
        description: "Invite email added successfully",
    })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async addInviteEmail(@Body() addInviteEmailDto: AddInviteEmailDto, @Req() req: Request) {
        return this.openAppService.addInviteEmail(addInviteEmailDto, req.user as UserJwtExtractDto)
    }

    @Post("/remove-invite-email")
    @ApiBody({
        type: RemoveInviteEmailDto,
    })
    @ApiOperation({
        summary: "Remove invite email",
        tags: ["App Management"],
    })
    @ApiResponse({
        status: 200,
        description: "Invite email removed successfully",
    })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async removeInviteEmail(@Body() removeInviteEmailDto: RemoveInviteEmailDto, @Req() req: Request) {
        return this.openAppService.removeInviteEmail(removeInviteEmailDto, req.user as UserJwtExtractDto)
    }
}
