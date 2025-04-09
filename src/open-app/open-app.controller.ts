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
import { ApiTags, ApiOperation, ApiResponse, ApiHeaders, ApiBody, ApiBearerAuth } from "@nestjs/swagger"
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
} from "./open-app.dto"
import { AuthGuard } from "@nestjs/passport"
import { UserInfoDTO } from "src/user/user.controller"
import { Request, Response } from "express"
import { PaginationDto } from "src/common/common.dto"
import { Recaptcha } from "@nestlab/google-recaptcha"

@ApiTags("IP Portal")
@Controller("/api/v1/app")
export class OpenAppController {
    constructor(private readonly openAppService: OpenAppService) {}

    @Get("/list")
    @ApiOperation({
        summary: "Get app list",
    })
    @ApiResponse({
        type: AppListDto,
    })
    @ApiBearerAuth()
    @UseGuards(AuthGuard("jwt"))
    async getAppList(@Req() req: Request, @Query() query: PaginationDto): Promise<AppListDto> {
        return this.openAppService.getAppList(req.user as UserInfoDTO, query)
    }

    @Get("/info")
    @ApiOperation({
        summary: "Get app info",
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
    async getOpenAppSettings() {
        return this.openAppService.getOpenAppSettings()
    }

    @Post("/create")
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
        return this.openAppService.createApp(createAppDto, req.user as UserInfoDTO)
    }

    @Post("/preview")
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
        return this.openAppService.previewApp(createAppDto, req.user as UserInfoDTO, req.cookies, res)
    }

    @Post("/delete")
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
        return this.openAppService.deleteApp(deleteAppDto, req.user as UserInfoDTO)
    }

    @Post("/update-app")
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
        return this.openAppService.updateApp(updateAppDto, req.user as UserInfoDTO)
    }

    @Get("/top-ip-list")
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
        return this.openAppService.getTopIpList(req.user as UserInfoDTO)
    }

    @Post("/request-creator")
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
        return this.openAppService.approveCreator(approveCreatorDto, req.user as UserInfoDTO)
    }

    @Get("/lookup-by-subdomain/:subdomain")
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
        summary: "Get app info by app id",
        description: "Get app info by app id",
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
}
