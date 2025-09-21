import {
    BadRequestException,
    ForbiddenException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
} from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    ApplyWidgetConfigToAppsDto,
    CreateWidgetDto,
    DeleteWidgetDto,
    GetAccessTokenDto,
    GetAccessTokenResponseDto,
    GetWidgetsRequestDto,
    MyWidgetsListResponseDto,
    SubscribeWidgetDto,
    UnbindWidgetConfigFromAppsDto,
    UnsubscribeWidgetDto,
    UpdateWidgetDto,
    WidgetBindAppDto,
    WidgetConfigDto,
    WidgetDetailDto,
    WidgetListResponseDto,
    WidgetSettingsDto,
    WidgetSummaryDto,
} from "./widget.dto"
import { app_bind_widgets, Prisma, user_subscribed_widgets, widgets } from "@prisma/client"
import { UserJwtExtractDto } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { JwtService } from "@nestjs/jwt"
import { v4 as uuidv4 } from "uuid"
import { JwtPermissions } from "src/casl/casl-ability.factory/jwt-casl-ability.factory"
import * as crypto from "crypto"

@Injectable()
export class WidgetsService {
    constructor(
        private readonly prisma: PrismaService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => JwtService))
        private readonly jwtService: JwtService,
    ) {}

    async createWidget(body: CreateWidgetDto, user: UserJwtExtractDto) {
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
            const identify = this.generateIdentity()
            const widget = await tx.widgets.create({
                data: {
                    tag: body.tag,
                    name: body.name,
                    summary: body.summary,
                    pricing: body.pricing,
                    is_featured: body.is_featured,
                    is_new: body.is_new,
                    is_official: true, //TODO: remove this after testing
                    category: body.category,
                    description: body.description,
                    coming_soon: body.coming_soon,
                    priority: body.priority,
                    author: body.author,
                    icon: body.icon,
                    settings: this.parseSettings(body.settings, body) as any,
                    secret_key: identify.secret_key,
                    access_key: identify.access_key,
                    request_permissions: process.env.ENV !== "product" ? { can_get_user_token: true } : null,
                },
            })
            return widget
        })
    }

    async getWidgets(query: GetWidgetsRequestDto, user?: UserJwtExtractDto): Promise<WidgetListResponseDto> {
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

        if (query.include) {
            where.tag = { in: query.include.split(",") }
        }

        const widgets = await this.prisma.widgets.findMany({
            where,
            include: {
                _count: {
                    select: {
                        user_subscribed_widgets: true,
                    },
                },
                app_bind_widgets: {
                    where: {
                        enabled: true,
                    },
                },
                author_info: {
                    select: {
                        username: true,
                        avatar: true,
                    },
                },
            },
            skip: (parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
            orderBy: {
                priority: "desc",
            },
        })

        const widgetsCount = await this.prisma.widgets.count({
            where,
        })

        let subscribedWidgets: user_subscribed_widgets[] = []
        if (user) {
            subscribedWidgets = await this.prisma.user_subscribed_widgets.findMany({
                where: { user: user.usernameShorted },
            })
        }

        return {
            total: widgetsCount,
            widgets: await this._mapToSummaryResponse(widgets, subscribedWidgets),
        }
    }

    async getWidgetByTag(tag: string, user: UserJwtExtractDto): Promise<WidgetDetailDto> {
        const widget = await this.prisma.widgets.findUnique({
            where: { tag, is_private: false, OR: [{ is_developing: false }, { demo_url: { not: null } }] },
            include: {
                app_bind_widgets: {
                    where: {
                        enabled: true,
                    },
                },
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
        let subscribedWidgets: user_subscribed_widgets | null = null
        if (user) {
            subscribedWidgets = await this.prisma.user_subscribed_widgets.findFirst({
                where: { user: user.usernameShorted, widget_tag: widget.tag },
            })
        }

        return this.mapToDetailResponse(widget, subscribedWidgets)
    }

    async subscribeWidget(body: SubscribeWidgetDto, user: UserJwtExtractDto) {
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
                subscription_id: this.generateId(),
                user: user.usernameShorted,
                widget_tag: widget.tag,
                started_at: new Date(),
                expired_at: new Date("2099-12-31"), //TODO: change to the actual expired time
            },
        })
    }

    async unsubscribeWidget(body: UnsubscribeWidgetDto, user: UserJwtExtractDto) {
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

    async deleteWidget(body: DeleteWidgetDto, user: UserJwtExtractDto) {
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

    async getMyWidgets(user: UserJwtExtractDto, query: GetWidgetsRequestDto): Promise<MyWidgetsListResponseDto> {
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

                app_bind_widgets: {
                    where: {
                        app_detail: {
                            app_bind_ips: {
                                some: {
                                    ip_id: parseInt(query.ip_id) || -1,
                                },
                            },
                        },
                        enabled: true,
                    },
                    select: {
                        widget_tag: true,
                        app_detail: {
                            select: {
                                app_id: true,
                                sub_domain: true,
                            },
                        },
                    },
                    take: 1,
                },
            },
        })

        const subscribedWidgetsCount = await this.prisma.user_subscribed_widgets.count({
            where: { user: user.usernameShorted, widget_info: filterWhere },
        })

        const subscribedWidgets = await this.prisma.user_subscribed_widgets.findMany({
            where: { user: user.usernameShorted },
        })

        const mappedWidgets = await this._mapToSummaryResponse(
            widgets.map((widget) => widget.widget_info),
            subscribedWidgets,
        )

        const res = mappedWidgets.map((widget: WidgetSummaryDto) => {
            delete widget.bind_apps
            return {
                ...widget,
                app_info: widgets.find((w) => w.widget_tag === widget.tag)?.app_bind_widgets?.[0]?.app_detail || null,
            }
        })

        return {
            total: subscribedWidgetsCount,
            widgets: res,
        }
    }

    async _mapToSummaryResponse(
        widgets: (widgets & {
            _count: { user_subscribed_widgets: number }
            author_info: { username: string; avatar: string }
        })[],
        subscribedWidgets: user_subscribed_widgets[],
    ): Promise<WidgetSummaryDto[]> {
        return Promise.all(
            widgets.map(async (widget) => {
                const subscribedDetail = subscribedWidgets.find(
                    (subscribedWidget) => subscribedWidget.widget_tag === widget.tag,
                )
                if (subscribedDetail) {
                    delete subscribedDetail.id
                }
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
                    is_subscribed: !!subscribedDetail,
                    subscribed_detail: subscribedDetail,
                    demo_url: widget.demo_url,
                    settings: this.parseSettings(widget.settings) as any,
                    bind_apps: await this.getWidgetsBindApps(widget),
                }
            }),
        )
    }

    async mapToDetailResponse(
        widget: widgets & {
            _count: { user_subscribed_widgets: number }
            app_bind_widgets: app_bind_widgets[]
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
            demo_url: widget.demo_url,
            test_users: widget.test_users as string[],
            subscribed_detail: subscribedWidgets,
            bind_apps: await this.getWidgetsBindApps(widget),
        }
    }

    async getWidgetsBindApps(widget: widgets): Promise<WidgetBindAppDto[]> {
        const appBindIps = await this.prisma.app_bind_widgets.findMany({
            where: {
                widget_tag: widget.tag,
                enabled: true,
                widget_detail: {
                    is_developing: false,
                    is_private: false,
                },
            },
            include: {
                app_detail: {
                    include: {
                        app_bind_ips: {
                            include: {
                                ip: {
                                    where: {
                                        ip_levels: 1,
                                        is_public: true,
                                    },
                                    select: {
                                        id: true,
                                        name: true,
                                        ticker: true,
                                        token_mint: true,
                                        current_token_info: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        })
        const parentIpIds = appBindIps
            .map((appBind) => appBind?.app_detail?.app_bind_ips?.[0]?.ip?.id)
            .filter((id) => id !== null && id !== undefined)

        const childIps = await this.prisma.ip_library_child.findMany({
            where: {
                parent_ip: {
                    in: parentIpIds,
                },
                ip_info: {
                    is_public: true,
                },
            },
            select: {
                parent_ip: true,
                ip_id: true,
                ip_info: {
                    select: {
                        id: true,
                        name: true,
                        ticker: true,
                        token_mint: true,
                        current_token_info: true,
                    },
                },
            },
        })

        const res = appBindIps
            .map((appBind) => {
                const app_id = appBind?.app_detail?.app_id
                const ipInfo = appBind?.app_detail?.app_bind_ips?.[0]?.ip
                const tokenInfo = ipInfo?.current_token_info as any
                if (!ipInfo) {
                    return null
                }
                return {
                    app_id: app_id,
                    ip_id: ipInfo.id,
                    ip_info: {
                        id: ipInfo.id,
                        name: ipInfo.name,
                        ticker: ipInfo.ticker,
                        mint: ipInfo.token_mint,
                        market_cap: (tokenInfo?.market_cap as string) || "",
                        trade_volume: (tokenInfo?.tradeVolume as string) || "",
                        price: (tokenInfo?.price as string) || "",
                        cover: (tokenInfo?.coverUrl as string) || "",
                        change_5m: (tokenInfo?.change5m as string) || "",
                        change_1h: (tokenInfo?.change1h as string) || "",
                        change_1d: (tokenInfo?.change24h as string) || "",
                        trade24hSol: (tokenInfo?.trade24hSol as string) || "",
                        child_ips: childIps
                            .filter((childIp) => childIp.parent_ip === ipInfo.id)
                            .map((childIp) => {
                                const childTokenInfo = childIp?.ip_info?.current_token_info as any
                                return {
                                    id: childIp.ip_info.id,
                                    name: childIp.ip_info.name,
                                    ticker: childIp.ip_info.ticker,
                                    mint: childIp.ip_info.token_mint,
                                    market_cap: (childTokenInfo?.market_cap as string) || "",
                                    trade_volume: (childTokenInfo?.tradeVolume as string) || "",
                                    price: (childTokenInfo?.price as string) || "",
                                    cover: (childTokenInfo?.coverUrl as string) || "",
                                    change_5m: (childTokenInfo?.change5m as string) || "",
                                    change_1h: (childTokenInfo?.change1h as string) || "",
                                    change_1d: (childTokenInfo?.change24h as string) || "",
                                    trade24hSol: (childTokenInfo?.trade24hSol as string) || "",
                                }
                            }),
                    },
                }
            })
            .filter((res) => res !== null)
        return res
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

    async getWidgetConfigs(tag: string, appId: string, user: UserJwtExtractDto): Promise<ApplyWidgetConfigToAppsDto[]> {
        const widget = await this.prisma.widgets.findUnique({ where: { tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        let userSubscribedWidget = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: tag },
            include: {
                app_bind_widgets: true,
            },
        })
        if (!userSubscribedWidget) {
            if (tag == "login_from_external") {
                await this.subscribeWidget({ tag: tag }, user)
                userSubscribedWidget = await this.prisma.user_subscribed_widgets.findFirst({
                    where: { user: user.usernameShorted, widget_tag: tag },
                    include: {
                        app_bind_widgets: true,
                    },
                })
            } else {
                throw new BadRequestException("You have not subscribed to this widget")
            }
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

    async applyWidgetConfigToApps(body: ApplyWidgetConfigToAppsDto, user: UserJwtExtractDto): Promise<WidgetConfigDto> {
        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        let userSubscribedWidget = await this.prisma.user_subscribed_widgets.findFirst({
            where: { user: user.usernameShorted, widget_tag: body.tag },
            include: {
                app_bind_widgets: true,
            },
        })

        //subscribe the widget if the widget is login_from_external
        if (!userSubscribedWidget) {
            if (body.tag == "login_from_external") {
                await this.subscribeWidget({ tag: body.tag }, user)
                userSubscribedWidget = await this.prisma.user_subscribed_widgets.findFirst({
                    where: { user: user.usernameShorted, widget_tag: body.tag },
                    include: {
                        app_bind_widgets: true,
                    },
                })
            } else {
                throw new BadRequestException("You have not subscribed to this widget")
            }
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

    async updateWidget(body: UpdateWidgetDto, user: UserJwtExtractDto) {
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
            data: {
                ...mappedBody,
                is_official: true, //TODO: remove this after testing
            },
        })
        return this.getWidgetByTag(body.tag, user)
    }

    async unbindWidgetConfigFromApps(
        body: UnbindWidgetConfigFromAppsDto,
        user: UserJwtExtractDto,
    ): Promise<{ status: string }> {
        const widget = await this.prisma.widgets.findUnique({ where: { tag: body.tag } })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        await this.prisma.app_bind_widgets.updateMany({
            where: { widget_tag: body.tag, app_id: body.app_id, app_detail: { creator: user.usernameShorted } },
            data: {
                enabled: false,
            },
        })
        return {
            status: "success",
        }
    }

    async getAccessToken(
        body: GetAccessTokenDto,
        user: UserJwtExtractDto,
        deviceId: string,
    ): Promise<GetAccessTokenResponseDto> {
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

        //app is exists
        let appId = ""
        if (body.app_id) {
            const app = await this.prisma.apps.findUnique({ where: { app_id: body.app_id } })
            if (!app) {
                appId = ""
            } else {
                appId = app.app_id
            }
        } else {
            appId = ""
        }

        //find exists widget session
        const existsWidgetSession = await this.prisma.widget_sessions.findFirst({
            where: {
                user: user.usernameShorted,
                widget_tag: body.tag,
                app_id: appId,
                expired_at: {
                    gt: new Date(),
                },
            },
        })

        if (existsWidgetSession) {
            return {
                access_token: existsWidgetSession.jwt_string,
            }
        }

        //create a widget session
        const widgetSessionId = uuidv4()
        const widgetSession = await this.prisma.widget_sessions.create({
            data: {
                session_id: widgetSessionId,
                device_id: deviceId,
                user: user.usernameShorted,
                widget_tag: body.tag,
                app_id: appId,
                permission: (widgetInfo.settings as any)?.permissions as JwtPermissions[],
                user_subscribed_widget: userSubscribedWidget ? true : false,
            },
        })
        if (!widgetSession) {
            throw new BadRequestException("Failed to create widget session")
        }
        const userInfo = await this.userService.getProfile(user)
        const userInfoForSign: UserJwtExtractDto = {
            user_id: userInfo.usernameShorted,
            username: userInfo.username,
            usernameShorted: userInfo.usernameShorted,
            email: userInfo.email,
            avatar: userInfo.avatar,
            widget_session_id: widgetSession.session_id,
            device_id: deviceId,
        }
        const eccess_token = this.jwtService.sign(userInfoForSign, {
            expiresIn: "1d",
        })

        //update the widget session
        await this.prisma.widget_sessions.update({
            where: { session_id: widgetSession.session_id },
            data: {
                jwt_string: eccess_token,
                expired_at: new Date(Date.now() + 1000 * 60 * 60 * 24),
            },
        })
        return {
            access_token: eccess_token,
        }
    }

    mapWidgetDetail(widget: widgets): widgets {
        delete widget.access_key
        delete widget.secret_key
        return widget
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
            enabled: appBind.enabled,
        }
    }

    generateId(prefix = "sub_"): string {
        return prefix + crypto.randomBytes(10).toString("hex")
    }

    generateIdentity(): { access_key: string; secret_key: string } {
        const access_key = "wgt_ak_" + crypto.randomBytes(64).toString("hex").slice(0, 25)
        const secret_key = "wgt_sk_" + crypto.randomBytes(64).toString("hex").slice(0, 57)
        return {
            access_key: access_key,
            secret_key: secret_key,
        }
    }
}
