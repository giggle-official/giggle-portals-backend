import {
    Controller,
    Body,
    Post,
    HttpCode,
    HttpStatus,
    UseGuards,
    Req,
    Get,
    Param,
    Query,
    Headers,
} from "@nestjs/common"
import { WidgetsService } from "./widgets.service"
import { ApiExcludeController, ApiExcludeEndpoint, ApiResponse } from "@nestjs/swagger"
import { ApiBody } from "@nestjs/swagger"
import { LoginResponseDto } from "../auth/auto.dto"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import {
    CreateWidgetDto,
    DeleteWidgetDto,
    SubscribeWidgetDto,
    UnsubscribeWidgetDto,
    ApplyWidgetConfigToAppsDto,
    WidgetConfigDto,
    WidgetSummaryDto,
    UnbindWidgetConfigFromAppsDto,
    UpdateWidgetDto,
    GetWidgetsRequestDto,
    GetAccessTokenDto,
    GetAccessTokenResponseDto,
    MyWidgetsSummaryDto,
} from "./widget.dto"
import { AuthGuard } from "@nestjs/passport"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request } from "express"
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard"

@Controller("/api/v1/app/widgets")
@ApiTags("Widgets")
export class WidgetsController {
    constructor(private readonly widgetService: WidgetsService) {}

    @Get("/")
    @ApiOperation({ summary: "get all widgets" })
    @ApiResponse({ type: WidgetSummaryDto, isArray: true })
    @UseGuards(OptionalJwtAuthGuard)
    async getWidgets(@Req() req: Request, @Query() query: GetWidgetsRequestDto) {
        return this.widgetService.getWidgets(query, req?.user as UserJwtExtractDto)
    }

    @Get("/my")
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: "get all my widgets" })
    @ApiResponse({ type: MyWidgetsSummaryDto, isArray: true })
    @UseGuards(AuthGuard("jwt"))
    async getMyWidgets(@Req() req: Request, @Query() query: GetWidgetsRequestDto) {
        return this.widgetService.getMyWidgets(req.user as UserJwtExtractDto, query)
    }

    @Get("/getConfigs")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "get a widget config" })
    @ApiExcludeEndpoint()
    @ApiResponse({ type: [ApplyWidgetConfigToAppsDto], isArray: true })
    async getWidgetConfig(
        @Query("widget_tag") tag: string,
        @Query("app_id") appId: string,
        @Req() req: Request,
    ): Promise<ApplyWidgetConfigToAppsDto[]> {
        return this.widgetService.getWidgetConfigs(tag, appId, req.user as UserJwtExtractDto)
    }

    @Post("/create")
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "create a widget" })
    @ApiBody({ type: CreateWidgetDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: LoginResponseDto })
    async createWidget(@Body() body: CreateWidgetDto, @Req() req: Request) {
        return this.widgetService.createWidget(body, req.user as UserJwtExtractDto)
    }

    @Post("/getAccessToken")
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: "get access token for a widget" })
    @ApiBody({ type: GetAccessTokenDto })
    @ApiResponse({ type: GetAccessTokenResponseDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async getAccessToken(
        @Body() body: GetAccessTokenDto,
        @Req() req: Request,
        @Headers("x-device-id") deviceId: string,
    ) {
        return this.widgetService.getAccessToken(body, req.user as UserJwtExtractDto, deviceId || "")
    }

    @Post("/update")
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "update a widget" })
    @ApiBody({ type: UpdateWidgetDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: LoginResponseDto })
    async updateWidget(@Body() body: UpdateWidgetDto, @Req() req: Request) {
        return this.widgetService.updateWidget(body, req.user as UserJwtExtractDto)
    }

    @Post("/delete")
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "delete a widget" })
    @ApiBody({ type: DeleteWidgetDto })
    @ApiResponse({ type: LoginResponseDto })
    async deleteWidget(@Body() body: DeleteWidgetDto, @Req() req: Request) {
        return this.widgetService.deleteWidget(body, req.user as UserJwtExtractDto)
    }

    @Post("/applyConfigToApps")
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "apply a widget config to apps" })
    @ApiBody({ type: ApplyWidgetConfigToAppsDto })
    @ApiResponse({ type: LoginResponseDto })
    async applyWidgetConfigToApps(
        @Body() body: ApplyWidgetConfigToAppsDto,
        @Req() req: Request,
    ): Promise<WidgetConfigDto> {
        return this.widgetService.applyWidgetConfigToApps(body, req.user as UserJwtExtractDto)
    }

    @Post("/unbindConfigFromApps")
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "unbind a widget config from apps" })
    @ApiBody({ type: UnbindWidgetConfigFromAppsDto })
    @ApiResponse({ schema: { type: "object", properties: { status: { type: "string" } } } })
    async unbindWidgetConfigFromApps(
        @Body() body: UnbindWidgetConfigFromAppsDto,
        @Req() req: Request,
    ): Promise<{ status: string }> {
        return this.widgetService.unbindWidgetConfigFromApps(body, req.user as UserJwtExtractDto)
    }

    @Get("/:tag")
    @ApiOperation({ summary: "get a widget by tag" })
    @ApiResponse({ type: LoginResponseDto })
    @UseGuards(OptionalJwtAuthGuard)
    async getWidgetByTag(@Param("tag") tag: string, @Req() req: Request) {
        return this.widgetService.getWidgetByTag(tag, req?.user as UserJwtExtractDto)
    }

    @Post("/subscribe")
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: "subscribe a widget" })
    @ApiBody({ type: SubscribeWidgetDto })
    @ApiResponse({ type: LoginResponseDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async subscribeWidget(@Body() body: SubscribeWidgetDto, @Req() req: Request) {
        return this.widgetService.subscribeWidget(body, req.user as UserJwtExtractDto)
    }

    @Post("/unsubscribe")
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: "unsubscribe a widget" })
    @ApiBody({ type: UnsubscribeWidgetDto })
    @ApiResponse({ type: LoginResponseDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async unsubscribeWidget(@Body() body: UnsubscribeWidgetDto, @Req() req: Request) {
        return this.widgetService.unsubscribeWidget(body, req.user as UserJwtExtractDto)
    }

    /**
     * 
     * 
{
  "tag": "login_from_external",
  "name": "Host-Side Login",
  "pricing": {
    "model":"free"
   },
  "is_featured": true,
  "is_new": true,
  "is_official": true,
  "category": "account",
  "author": "Giggle",
  "icon": "account",
  "summary": "Move iframe logins to your main site while locking embedded authentication",
  "description": "Shift your embedded iframe's authentication process entirely to your main website. This tool disables the default login interface within the iframe and routes user credentials through your existing site infrastructure, ensuring brand-consistent authentication flows with automatic Giggle platform session continuity.",
  "settings": {
    "widget_tag": "login_from_external",
    "management_url": "/widgets/login_from_external",
    "widget_url": "/widgets/login_from_external",
    "metadata": {}
  }
}

{
  "tag": "creator_agent",
  "name": "Creator Agent",
  "pricing": {
    "model":"free"
   },
  "is_featured": true,
  "is_new": true,
  "is_official": true,
  "category": "ai",
  "author": "Giggle",
  "icon": "bot",
  "summary": "An AI agent dedicated to creators,supporting content broadcasting, social interaction,and monetization",
  "description": "An AI agent dedicated to creators,supporting content broadcasting, social interaction,and monetization",
  "coming_soon": false,
  "priority": 10,
  "settings": {
    "widget_tag": "creator_agent",
    "management_url": "/widgets/creator_agent",
    "widget_url": "/widgets/creator_agent",
    "metadata": {
    }
  }
}

{
  "tag": "ai_music_video",
  "name": "AI Music Video Platform",
  "pricing": {
    "model": "free"
  },
  "is_featured": true,
  "is_new": true,
  "is_official": true,
  "category": "ai",
  "author": "Giggle",
  "icon": "music",
  "summary": "A one-click deployable AI video creation platform powered by music IP, enabling user to generate AI music Videos, issue their own tokens",
  "description": "A one-click deployable AI video creation platform powered by music IP, enabling user to generate AI music Videos, issue their own tokens",
  "coming_soon": true,
  "priority": 8,
  "settings": {
    "widget_tag": "ai_music_video",
    "management_url": "/widgets/ai_music_video",
    "widget_url": "/widgets/ai_music_video",
    "metadata": {}
  }
}

{
  "tag": "ai_director",
  "name": "AI Director",
  "pricing": {
    "model": "free"
  },
  "is_featured": true,
  "is_new": true,
  "is_official": true,
  "category": "ai",
  "author": "Giggle",
  "icon": "video",
  "summary": "A one-click deployable AI film creation platform that helps creators turn ideas into scripts,voiceovers,and full generated short drama or feature-length movies ",
  "description": "A one-click deployable AI film creation platform that helps creators turn ideas into scripts,voiceovers,and full generated short drama or feature-length movies ",
  "coming_soon": true,
  "priority": 9,
  "settings": {
    "widget_tag": "ai_director",
    "management_url": "/widgets/ai_director",
    "widget_url": "/widgets/ai_director",
    "metadata": {}
  }
}

{
  "tag": "ip_rwa_crowdfunding",
  "name": "IP RWA Crowdfunding",
  "pricing": {
    "model": "free"
  },
  "is_featured": true,
  "is_new": true,
  "is_official": true,
  "category": "finance",
  "author": "Giggle",
  "icon": "dollar",
  "summary": "Easily launch a crowdfunding page for your creative  IP , tokenize it as an RWA asset,issure equity tokens,and enable Web3-based monetization and community profit sharing.",
  "description": "Easily launch a crowdfunding page for your creative  IP , tokenize it as an RWA asset,issure equity tokens,and enable Web3-based monetization and community profit sharing.",
  "coming_soon": true,
  "priority": 7,
  "settings": {
    "widget_tag": "ip_rwa_crowdfunding",
    "management_url": "/widgets/ip_rwa_crowdfunding",
    "widget_url": "/widgets/ip_rwa_crowdfunding",
    "permissions": ["all"],
    "type": "iframe",
    "metadata": {}
  }
}

{
  "tag": "film_remix",
  "name": "Film Remix Studio",
  "pricing": {
    "model": "free"
  },
  "is_featured": true,
  "is_new": true,
  "is_official": true,
  "category": "creation",
  "author": "Giggle",
  "icon": "edit",
  "summary": "A one-click deployable Web3 AI remix platform for IP holders to open up their film IPs,empower creattors to remix and tokenize content, ad earn layered on-chain revenue",
  "description": "A one-click deployable Web3 AI remix platform for IP holders to open up their film IPs,empower creattors to remix and tokenize content, ad earn layered on-chain revenue",
  "coming_soon": true,
  "priority": 6,
  "settings": {
    "widget_tag": "film_remix",
    "management_url": "/widgets/film_remix",
    "widget_url": "/widgets/film_remix",
    "metadata": {}
  }
}

{
  "tag": "prediction_market",
  "name": "Prediction Market",
  "pricing": {
    "model": "free"
  },
  "is_featured": true,
  "is_new": true,
  "is_official": true,
  "category": "finance",
  "author": "Giggle",
  "icon": "chart",
  "summary": "A one-click deployable Web3 prediction market  for event or IP holders,enabling users to predict outcomes,place bets,and receive rewards via smart contracts.",
  "description": "A one-click deployable Web3 prediction market  for event or IP holders,enabling users to predict outcomes,place bets,and receive rewards via smart contracts.",
  "coming_soon": true,
  "priority": 5,
  "settings": {
    "widget_tag": "prediction_market",
    "management_url": "/widgets/prediction_market",
    "widget_url": "/widgets/prediction_market",
    "metadata": {}
  }
}


{
  "tag": "giggle_createfi",
  "name": "CreateFi",
  "pricing": {
    "model": "free"
  },
  "is_featured": true,
  "is_new": true,
  "is_official": true,
  "category": "ai",
  "author": "Giggle",
  "icon": "sparkles",
  "summary": "Generate AI videos and music based on IP holders' assets, earn token rewards, and establish a sustainable creative ecosystem through Web3 incentives.",
  "description": "CreateFi connects IP holders with content creators through a unique reward system. IP holders create token-funded pools, while creators use AI tools to generate videos and music based on the IP, earning rewards locked in the pool. This creates a sustainable ecosystem where IP holders monetize assets while incentivizing high-quality content creation.",
  "coming_soon": false,
  "priority": 8,
  "settings": {
    "widget_tag": "giggle_createfi",
    "management_url": "http://localhost:4290/management",
    "widget_url": "http://localhost:4290/create",
    "permissions": ["all"],
    "type": "iframe",
    "metadata": {
      "content_types": ["video", "music"],
      "reward_token": "TOKENS"
    }
  }
}

     */
}
