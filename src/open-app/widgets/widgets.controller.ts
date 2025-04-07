import { Controller, Body, Post, HttpCode, HttpStatus, UseGuards, Req, Get, Param, Query } from "@nestjs/common"
import { WidgetsService } from "./widgets.service"
import { ApiResponse } from "@nestjs/swagger"
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
} from "./widget.dto"
import { AuthGuard } from "@nestjs/passport"
import { UserInfoDTO } from "src/user/user.controller"
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
    async getWidgets(@Req() req: Request) {
        return this.widgetService.getWidgets(req?.user as UserInfoDTO)
    }

    @Get("/my")
    @ApiOperation({ summary: "get all my widgets" })
    @ApiResponse({ type: WidgetSummaryDto, isArray: true })
    @UseGuards(AuthGuard("jwt"))
    async getMyWidgets(@Req() req: Request) {
        return this.widgetService.getMyWidgets(req.user as UserInfoDTO)
    }

    @Get("/getConfigs")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "get a widget config" })
    @ApiResponse({ type: [ApplyWidgetConfigToAppsDto], isArray: true })
    async getWidgetConfig(
        @Query("widget_tag") tag: string,
        @Query("app_id") appId: string,
        @Req() req: Request,
    ): Promise<ApplyWidgetConfigToAppsDto[]> {
        return this.widgetService.getWidgetConfigs(tag, appId, req.user as UserInfoDTO)
    }

    @Post("/create")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "create a widget" })
    @ApiBody({ type: CreateWidgetDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: LoginResponseDto })
    async createWidget(@Body() body: CreateWidgetDto, @Req() req: Request) {
        return this.widgetService.createWidget(body, req.user as UserInfoDTO)
    }

    @Post("/update")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "update a widget" })
    @ApiBody({ type: UpdateWidgetDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: LoginResponseDto })
    async updateWidget(@Body() body: UpdateWidgetDto, @Req() req: Request) {
        return this.widgetService.updateWidget(body, req.user as UserInfoDTO)
    }

    @Post("/delete")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "delete a widget" })
    @ApiBody({ type: DeleteWidgetDto })
    @ApiResponse({ type: LoginResponseDto })
    async deleteWidget(@Body() body: DeleteWidgetDto, @Req() req: Request) {
        return this.widgetService.deleteWidget(body, req.user as UserInfoDTO)
    }

    @Post("/applyConfigToApps")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "apply a widget config to apps" })
    @ApiBody({ type: ApplyWidgetConfigToAppsDto })
    @ApiResponse({ type: LoginResponseDto })
    async applyWidgetConfigToApps(
        @Body() body: ApplyWidgetConfigToAppsDto,
        @Req() req: Request,
    ): Promise<WidgetConfigDto> {
        return this.widgetService.applyWidgetConfigToApps(body, req.user as UserInfoDTO)
    }

    @Post("/unbindConfigFromApps")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "unbind a widget config from apps" })
    @ApiBody({ type: UnbindWidgetConfigFromAppsDto })
    @ApiResponse({ schema: { type: "object", properties: { status: { type: "string" } } } })
    async unbindWidgetConfigFromApps(
        @Body() body: UnbindWidgetConfigFromAppsDto,
        @Req() req: Request,
    ): Promise<{ status: string }> {
        return this.widgetService.unbindWidgetConfigFromApps(body, req.user as UserInfoDTO)
    }

    @Get("/:tag")
    @ApiOperation({ summary: "get a widget by tag" })
    @ApiResponse({ type: LoginResponseDto })
    @UseGuards(OptionalJwtAuthGuard)
    async getWidgetByTag(@Param("tag") tag: string, @Req() req: Request) {
        return this.widgetService.getWidgetByTag(tag, req?.user as UserInfoDTO)
    }

    @Post("/subscribe")
    @ApiOperation({ summary: "subscribe a widget" })
    @ApiBody({ type: SubscribeWidgetDto })
    @ApiResponse({ type: LoginResponseDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async subscribeWidget(@Body() body: SubscribeWidgetDto, @Req() req: Request) {
        return this.widgetService.subscribeWidget(body, req.user as UserInfoDTO)
    }

    @Post("/unsubscribe")
    @ApiOperation({ summary: "unsubscribe a widget" })
    @ApiBody({ type: UnsubscribeWidgetDto })
    @ApiResponse({ type: LoginResponseDto })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    async unsubscribeWidget(@Body() body: UnsubscribeWidgetDto, @Req() req: Request) {
        return this.widgetService.unsubscribeWidget(body, req.user as UserInfoDTO)
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
  "summary": "Generate professional music videos with AI, combining audio tracks with synchronized visual content",
  "description": "Create stunning music videos using AI technology that analyzes audio tracks and generates perfectly synchronized visual content. Customize styles, themes, and visual elements to match your musical vision.",
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
  "summary": "Intelligent film direction assistant that helps with scene planning, shot composition, and cinematic storytelling",
  "description": "An AI-powered film direction tool that guides creators through scene planning, shot composition, and storytelling techniques. Provides real-time feedback on pacing, visual composition, and narrative flow to enhance the quality of your video productions.",
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
  "summary": "Tokenized real-world asset crowdfunding platform for intellectual property projects",
  "description": "A crowdfunding platform that tokenizes intellectual property as real-world assets (RWA), enabling creators to raise funds while giving supporters fractional ownership. Includes legal compliance tools, transparent milestone tracking, and integrated royalty distribution.",
  "coming_soon": true,
  "priority": 7,
  "settings": {
    "widget_tag": "ip_rwa_crowdfunding",
    "management_url": "/widgets/ip_rwa_crowdfunding",
    "widget_url": "/widgets/ip_rwa_crowdfunding",
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
  "summary": "Interactive platform for remixing and transforming existing film content into new creative works",
  "description": "An interactive studio for legally remixing and transforming existing film content. Leverage AI tools to modify scenes, add effects, change narratives, and blend multiple sources while respecting copyright. Create derivative works with proper attribution and licensing.",
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
  "summary": "Decentralized prediction marketplace for entertainment outcomes and creator success metrics",
  "description": "A decentralized prediction market focused on entertainment and creator outcomes. Make forecasts on box office performance, content virality, award winners, and more. Earn rewards for accurate predictions while generating valuable market intelligence for the creative industry.",
  "coming_soon": true,
  "priority": 5,
  "settings": {
    "widget_tag": "prediction_market",
    "management_url": "/widgets/prediction_market",
    "widget_url": "/widgets/prediction_market",
    "metadata": {}
  }
}


     */
}
