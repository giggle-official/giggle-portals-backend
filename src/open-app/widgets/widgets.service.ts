import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    ApplyWidgetConfigToAppsDto,
    CreateWidgetDto,
    DeleteWidgetDto,
    GetAccessTokenDto,
    GetAccessTokenResponseDto,
    GetWidgetsRequestDto,
    SubscribeWidgetDto,
    UnbindWidgetConfigFromAppsDto,
    UnsubscribeWidgetDto,
    UpdateWidgetDto,
    WidgetConfigDto,
    WidgetDetailDto,
    WidgetSettingsDto,
    WidgetSummaryDto,
} from "./widget.dto"
import { app_bind_widgets, Prisma, user_subscribed_widgets, widgets } from "@prisma/client"
import { UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { JwtService } from "@nestjs/jwt"
import { JwtPermissions } from "src/casl/casl-ability.factory/jwt-casl-ability.factory"

@Injectable()
export class WidgetsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userService: UserService,
        private readonly jwtService: JwtService,
    ) {}

    async createWidget(body: CreateWidgetDto, user: UserInfoDTO) {
        const userInfo = await this.prisma.users.findUnique({
            where: {
                username_in_be: user.usernameShorted,
            },
        })
        if (!userInfo || !userInfo.is_admin) {
            throw new ForbiddenException("You are not authorized to create a widget")
        }

        //check if the widget already exists
        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (widget) {
            throw new BadRequestException("Widget already exists")
        }

        return await this.prisma.$transaction(async (tx) => {
            const widget = await tx.widgets.create({
                data: {
                    tag: body.tag,
                    name: body.name,
                    summary: body.summary,
                    pricing: body.pricing,
                    is_featured: body.is_featured,
                    is_new: body.is_new,
                    is_official: body.is_official,
                    category: body.category,
                    description: body.description,
                    coming_soon: body.coming_soon,
                    priority: body.priority,
                    author: body.author,
                    icon: body.icon,
                    settings: this.parseSettings(body.settings, body) as any,
                },
            })
            return widget
        })
    }

    async getWidgets(user: UserInfoDTO, query: GetWidgetsRequestDto): Promise<WidgetSummaryDto[]> {
        const where: Prisma.widgetsWhereInput = {
            is_developing: false,
            is_private: false,
        }

        if (query.category) {
            where.category = query.category
        }

        if (query.exclude) {
            where.tag = { notIn: query.exclude.split(",") }
        }

        const limit = parseInt(query?.limit?.toString() || "999")

        const widgets = await this.prisma.widgets.findMany({
            where,
            include: {
                _count: {
                    select: {
                        user_subscribed_widgets: true,
                    },
                },
                author_info: {
                    select: {
                        username: true,
                        avatar: true,
                    },
                },
            },
            take: limit,
            orderBy: {
                priority: "desc",
            },
        })

        const subscribedWidgets = await this.prisma.user_subscribed_widgets.findMany({
            where: { user: user.usernameShorted },
        })

        return this._mapToSummaryResponse(widgets, subscribedWidgets)
    }

    async getWidgetByTag(tag: string, user: UserInfoDTO): Promise<WidgetDetailDto> {
        const widget = await this.prisma.widgets.findUnique({
            where: { tag, is_private: false, is_developing: false },
            include: {
                _count: {
                    select: { user_subscribed_widgets: true },
                },
                author_info: {
                    select: {
                        username: true,
                        avatar: true,
                    },
                },
            },
        })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        const subscribedWidgets = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: widget.tag },
        })

        return this.mapToDetailResponse(widget, subscribedWidgets)
    }

    async subscribeWidget(body: SubscribeWidgetDto, user: UserInfoDTO) {
        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        if (widget.coming_soon) {
            throw new BadRequestException("This widget is coming soon")
        }

        //already subscribed
        const alreadySubscribed = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: widget.tag },
        })
        if (alreadySubscribed) {
            throw new BadRequestException("You have already subscribed to this widget")
        }

        return await this.prisma.user_subscribed_widgets.create({
            data: {
                user: user.usernameShorted,
                widget_tag: widget.tag,
                started_at: new Date(),
                expired_at: new Date("-12-31"), //TODO: change to the actual expired time
            },
        })
    }

    async unsubscribeWidget(body: UnsubscribeWidgetDto, user: UserInfoDTO) {
        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        //not subscribed
        const notSubscribed = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: widget.tag },
        })
        if (!notSubscribed) {
            throw new BadRequestException("You have not subscribed to this widget")
        }

        await this.prisma.user_subscribed_widgets.delete({ where: { id: notSubscribed.id } })
        return {
            message: "Widget unsubscribed successfully",
        }
    }

    async deleteWidget(body: DeleteWidgetDto, user: UserInfoDTO) {
        const userInfo = await this.prisma.users.findUnique({
            where: {
                username_in_be: user.usernameShorted,
            },
        })
        if (!userInfo || !userInfo.is_admin) {
            throw new ForbiddenException("You are not authorized to delete a widget")
        }

        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }
        await this.prisma.widgets.delete({ where: { tag: body.tag } })
        await this.prisma.app_bind_widgets.deleteMany({ where: { widget_tag: body.tag } })
        await this.prisma.user_subscribed_widgets.deleteMany({ where: { widget_tag: body.tag } })
        return {
            message: "Widget deleted successfully",
        }
    }

    async getMyWidgets(user: UserInfoDTO, query: GetWidgetsRequestDto): Promise<WidgetSummaryDto[]> {
        const filterWhere: Prisma.widgetsWhereInput = {}

        if (query.type) {
            filterWhere.settings = {
                path: "$.type",
                equals: query.type,
            }
        }

        const widgets = await this.prisma.user_subscribed_widgets.findMany({
            where: { user: user.usernameShorted, widget_info: filterWhere },
            include: {
                widget_info: {
                    include: {
                        _count: {
                            select: { user_subscribed_widgets: true },
                        },
                        author_info: {
                            select: {
                                username: true,
                                avatar: true,
                            },
                        },
                    },
                },
            },
        })

        const subscribedWidgets = await this.prisma.user_subscribed_widgets.findMany({
            where: { user: user.usernameShorted },
        })

        return this._mapToSummaryResponse(
            widgets.map((widget) => widget.widget_info),
            subscribedWidgets,
        )
    }

    async _mapToSummaryResponse(
        widgets: (widgets & {
            _count: { user_subscribed_widgets: number }
            author_info: { username: string; avatar: string }
        })[],
        subscribedWidgets: user_subscribed_widgets[],
    ): Promise<WidgetSummaryDto[]> {
        return widgets.map((widget) => ({
            tag: widget.tag,
            name: widget.name,
            summary: widget.summary,
            pricing: widget.pricing,
            is_featured: widget.is_featured,
            is_new: widget.is_new,
            is_official: widget.is_official,
            category: widget.category,
            author: widget.author,
            icon: widget.icon,
            author_info: {
                username: widget.author_info.username,
                avatar: widget.author_info.avatar,
            },
            description: widget.description,
            subscribers: widget._count.user_subscribed_widgets,
            is_private: widget.is_private,
            is_developing: widget.is_developing,
            coming_soon: widget.coming_soon,
            priority: widget.priority,
            is_subscribed: !!subscribedWidgets.find((subscribedWidget) => subscribedWidget.widget_tag === widget.tag),
            settings: this.parseSettings(widget.settings) as any,
        }))
    }

    async mapToDetailResponse(
        widget: widgets & {
            _count: { user_subscribed_widgets: number }
            author_info: { username: string; avatar: string }
        },
        subscribedWidgets: user_subscribed_widgets,
    ): Promise<WidgetDetailDto> {
        return {
            tag: widget.tag,
            name: widget.name,
            summary: widget.summary,
            pricing: widget.pricing,
            is_featured: widget.is_featured,
            is_new: widget.is_new,
            is_official: widget.is_official,
            category: widget.category,
            author_info: {
                username: widget.author_info.username,
                avatar: widget.author_info.avatar,
            },
            icon: widget.icon,
            description: widget.description,
            coming_soon: widget.coming_soon,
            priority: widget.priority,
            created_at: widget.created_at,
            updated_at: widget.updated_at,
            subscribers: widget._count.user_subscribed_widgets,
            is_subscribed: !!subscribedWidgets,
            is_private: widget.is_private,
            is_developing: widget.is_developing,
            settings: this.parseSettings(widget.settings) as any,
            test_users: widget.test_users as string[],
        }
    }

    parseSettings(settings: any, createDto?: CreateWidgetDto): WidgetSettingsDto {
        let settingsDto: WidgetSettingsDto = {
            widget_tag: createDto?.tag || settings?.widget_tag || "",
            management_url: settings?.management_url || "",
            widget_url: settings?.widget_url || "",
            repository_url: settings?.repository_url || "",
            metadata: settings?.metadata || {},
            permissions: (createDto?.settings as any)?.permissions || [],
            type: (createDto?.settings as any)?.type || "iframe",
        }
        return settingsDto
    }

    parseSettingsForUpdate(settings: any, originalSettings: any, tag: string): WidgetSettingsDto {
        return {
            widget_tag: tag,
            management_url: settings?.management_url || originalSettings?.management_url || "",
            widget_url: settings?.widget_url || originalSettings?.widget_url || "",
            metadata: settings?.metadata || originalSettings?.metadata || {},
            permissions: settings?.permissions || originalSettings?.permissions || [],
            type: settings?.type || originalSettings?.type || "iframe",
        }
    }

    async getWidgetConfigs(tag: string, appId: string, user: UserInfoDTO): Promise<ApplyWidgetConfigToAppsDto[]> {
        const widget = await this.prisma.widgets.findUnique({ where: { tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        const userSubscribedWidget = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: tag },
            include: {
                app_bind_widgets: true,
            },
        })
        if (!userSubscribedWidget) {
            throw new BadRequestException("You have not subscribed to this widget")
        }

        const bindWhere: Prisma.app_bind_widgetsWhereInput = {
            widget_tag: tag,
            app_detail: {
                creator: user.usernameShorted,
            },
        }
        if (appId) {
            bindWhere.app_id = appId
        }

        const appBinds = await this.prisma.app_bind_widgets.findMany({
            where: bindWhere,
        })

        return appBinds.map((appBind) => this.mapToApplyWidgetConfigToAppsDto(appBind))
    }

    async applyWidgetConfigToApps(body: ApplyWidgetConfigToAppsDto, user: UserInfoDTO): Promise<WidgetConfigDto> {
        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        const userSubscribedWidget = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: body.tag },
            include: {
                app_bind_widgets: true,
            },
        })
        if (!userSubscribedWidget) {
            throw new BadRequestException("You have not subscribed to this widget")
        }

        const app = await this.prisma.apps.findUnique({ where: { app_id: body.app_id } })
        if (!app) {
            throw new NotFoundException("App not found")
        }

        let existingAppBindWidget = await this.prisma.app_bind_widgets.findFirst({
            where: { widget_tag: body.tag, app_id: body.app_id, app_detail: { creator: user.usernameShorted } },
        })
        if (!existingAppBindWidget) {
            existingAppBindWidget = await this.prisma.app_bind_widgets.create({
                data: {
                    widget_tag: body.tag,
                    app_id: body.app_id,
                    enabled: body.enabled !== undefined ? body.enabled : true,
                    subscription_id: userSubscribedWidget.id,
                    widget_configs: {
                        public: body.public,
                        private: body.private,
                    },
                },
            })
        } else {
            existingAppBindWidget = await this.prisma.app_bind_widgets.update({
                where: { id: existingAppBindWidget.id },
                data: {
                    widget_configs: {
                        public: body.public,
                        private: body.private,
                    },
                    subscription_id: userSubscribedWidget.id,
                    enabled: body.enabled !== undefined ? body.enabled : existingAppBindWidget.enabled,
                },
            })
        }

        return this.mapToApplyWidgetConfigToAppsDto(existingAppBindWidget)
    }

    async updateWidget(body: UpdateWidgetDto, user: UserInfoDTO) {
        if (!body.tag) {
            throw new BadRequestException("Widget tag is required")
        }

        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        const userInfo = await this.prisma.users.findUnique({
            where: {
                username_in_be: user.usernameShorted,
            },
        })
        if (!userInfo || !userInfo.is_admin) {
            throw new ForbiddenException("You are not authorized to update a widget")
        }

        const mappedBody = this.mapToUpdateWidgetDto(body, widget)
        await this.prisma.widgets.update({
            where: { tag: body.tag },
            data: mappedBody,
        })
        return this.getWidgetByTag(body.tag, user)
    }

    async unbindWidgetConfigFromApps(
        body: UnbindWidgetConfigFromAppsDto,
        user: UserInfoDTO,
    ): Promise<{ status: string }> {
        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        await this.prisma.app_bind_widgets.deleteMany({
            where: { widget_tag: body.tag, app_id: body.app_id, app_detail: { creator: user.usernameShorted } },
        })
        return {
            status: "success",
        }
    }

    async getAccessToken(body: GetAccessTokenDto, user: UserInfoDTO): Promise<GetAccessTokenResponseDto> {
        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        //user is subscribed to the widget
        const userSubscribedWidget = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: body.tag },
        })

        const widgetInfo = await this.prisma.widgets.findUnique({
            where: { tag: body.tag },
        })
        const userInfo = await this.userService.getProfile(user)
        const userInfoForSign: UserInfoDTO = {
            username: userInfo.username,
            usernameShorted: userInfo.usernameShorted,
            email: userInfo.email,
            emailConfirmed: userInfo.emailConfirmed,
            avatar: userInfo.avatar,
            giggle_wallet_address: userInfo.giggle_wallet_address,
            description: userInfo.description,
            followers: userInfo.followers,
            following: userInfo.following,
            permissions: (widgetInfo.settings as any)?.permissions as JwtPermissions[],
            widget_info: {
                user_subscribed: !!userSubscribedWidget,
                widget_tag: body.tag,
            },
        }
        const eccess_token = this.jwtService.sign(userInfoForSign, {
            expiresIn: "1d",
        })
        return {
            access_token: eccess_token,
        }
    }

    mapToUpdateWidgetDto(body: UpdateWidgetDto, originalWidget: widgets): Prisma.widgetsUpdateInput {
        return {
            name: body.name !== undefined ? body.name : originalWidget.name,
            summary: body.summary !== undefined ? body.summary : originalWidget.summary,
            pricing: body.pricing !== undefined ? body.pricing : originalWidget.pricing,
            is_featured: body.is_featured !== undefined ? body.is_featured : originalWidget.is_featured,
            is_new: body.is_new !== undefined ? body.is_new : originalWidget.is_new,
            is_official: body.is_official !== undefined ? body.is_official : originalWidget.is_official,
            category: body.category !== undefined ? body.category : originalWidget.category,
            icon: body.icon !== undefined ? body.icon : originalWidget.icon,
            description: body.description !== undefined ? body.description : originalWidget.description,
            settings:
                body.settings !== undefined
                    ? (this.parseSettingsForUpdate(body.settings, originalWidget.settings, body.tag) as any)
                    : originalWidget.settings,
            coming_soon: body.coming_soon !== undefined ? body.coming_soon : originalWidget.coming_soon,
            priority: body.priority !== undefined ? body.priority : originalWidget.priority,
        }
    }

    mapToApplyWidgetConfigToAppsDto(appBind: app_bind_widgets): ApplyWidgetConfigToAppsDto {
        return {
            public: (appBind.widget_configs as any).public as Record<string, any>,
            private: (appBind.widget_configs as any).private as Record<string, any>,
            tag: appBind.widget_tag,
            app_id: appBind.app_id,
        }
    }
}
