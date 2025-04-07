import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    ApplyWidgetConfigToAppsDto,
    CreateWidgetDto,
    DeleteWidgetDto,
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
import { WidgetFactory } from "./widget.factory"
import { JsonValue } from "@prisma/client/runtime/library"

@Injectable()
export class WidgetsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly widgetFactory: WidgetFactory,
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
                    author: body.author,
                    icon: body.icon,
                    settings: this._parseSettings(body.settings, body),
                },
            })
            return widget
        })
    }

    async getWidgets(user: UserInfoDTO): Promise<WidgetSummaryDto[]> {
        const widgets = await this.prisma.widgets.findMany({
            include: {
                _count: {
                    select: {
                        user_subscribed_widgets: true,
                    },
                },
                user_subscribed_widgets: true,
            },
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
            where: { tag },
            include: {
                _count: {
                    select: { user_subscribed_widgets: true },
                },
            },
        })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        const subscribedWidgets = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: widget.tag },
        })

        return this._mapToDetailResponse(widget, subscribedWidgets)
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

        // Get the widget implementation
        const widgetImpl = this.widgetFactory.getWidget(widget.tag)
        if (widgetImpl) {
            await widgetImpl.onSubscribe(user)
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

        // Get the widget implementation
        const widgetImpl = this.widgetFactory.getWidget(widget.tag)
        if (widgetImpl) {
            // Call onUnsubscribe with userInfo
            await widgetImpl.onUnsubscribe(user)
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

    async getMyWidgets(user: UserInfoDTO): Promise<WidgetSummaryDto[]> {
        const widgets = await this.prisma.user_subscribed_widgets.findMany({
            where: { user: user.usernameShorted },
            include: {
                widget_info: {
                    include: {
                        _count: {
                            select: { user_subscribed_widgets: true },
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
        widgets: (widgets & { _count: { user_subscribed_widgets: number } })[],
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
            description: widget.description,
            subscribers: widget._count.user_subscribed_widgets,
            coming_soon: widget.coming_soon,
            priority: widget.priority,
            is_subscribed: !!subscribedWidgets.find((subscribedWidget) => subscribedWidget.widget_tag === widget.tag),
            settings: this._parseSettings(widget.settings),
        }))
    }

    async _mapToDetailResponse(
        widget: widgets & { _count: { user_subscribed_widgets: number } },
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
            author: widget.author,
            icon: widget.icon,
            description: widget.description,
            coming_soon: widget.coming_soon,
            priority: widget.priority,
            created_at: widget.created_at,
            updated_at: widget.updated_at,
            subscribers: widget._count.user_subscribed_widgets,
            is_subscribed: !!subscribedWidgets,
            settings: this._parseSettings(widget.settings),
        }
    }

    _parseSettings(settings: any, createDto?: CreateWidgetDto): JsonValue {
        let settingsDto: WidgetSettingsDto = {
            widget_tag: createDto?.tag || settings?.widget_tag || "",
            management_url: settings?.management_url || "",
            widget_url: settings?.widget_url || "",
            metadata: settings?.metadata || {},
        }
        return settingsDto as unknown as JsonValue
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

        return appBinds.map((appBind) => this._mapToApplyWidgetConfigToAppsDto(appBind))
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
                },
            })
        }

        return this._mapToApplyWidgetConfigToAppsDto(existingAppBindWidget)
    }

    async updateWidget(body: UpdateWidgetDto, user: UserInfoDTO) {
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

        const mappedBody = this._mapToUpdateWidgetDto(body, widget)
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

    _mapToUpdateWidgetDto(body: UpdateWidgetDto, originalWidget: widgets): Prisma.widgetsUpdateInput {
        return {
            name: body.name || originalWidget.name,
            summary: body.summary || originalWidget.summary,
            pricing: body.pricing || originalWidget.pricing,
            is_featured: body.is_featured || originalWidget.is_featured,
            is_new: body.is_new || originalWidget.is_new,
            is_official: body.is_official || originalWidget.is_official,
            category: body.category || originalWidget.category,
            author: body.author || originalWidget.author,
            icon: body.icon || originalWidget.icon,
            description: body.description || originalWidget.description,
            settings: this._parseSettings(body.settings),
            coming_soon: body.coming_soon || originalWidget.coming_soon,
            priority: body.priority || originalWidget.priority,
        }
    }

    _mapToApplyWidgetConfigToAppsDto(appBind: app_bind_widgets): ApplyWidgetConfigToAppsDto {
        return {
            public: (appBind.widget_configs as any).public as Record<string, any>,
            private: (appBind.widget_configs as any).private as Record<string, any>,
            tag: appBind.widget_tag,
            app_id: appBind.app_id,
        }
    }
}
