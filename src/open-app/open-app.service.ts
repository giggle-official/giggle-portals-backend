import {
    BadRequestException,
    ConflictException,
    forwardRef,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    AddInviteEmailDto,
    AppIconDto,
    AppInfoDto,
    AppListDto,
    AppMenuDto,
    ApproveCreatorDto,
    ApproveCreatorResponseDto,
    CreateAppDto,
    DeleteAppDto,
    ManifestDto,
    OpenAppSettingsDto,
    RemoveInviteEmailDto,
    RequestCreatorDto,
    RequestCreatorResponseDto,
    TopIpSummaryDto,
    UpdateAppDto,
} from "./open-app.dto"
import { CreateUserDto, UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { ip_library } from "@prisma/client"
import { AuthService } from "src/auth/auth.service"
import * as crypto from "crypto"
import { IpLibraryService } from "src/ip-library/ip-library.service"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { PaginationDto } from "src/common/common.dto"
import { Response } from "express"
import { CronExpression } from "@nestjs/schedule"
import { Cron } from "@nestjs/schedule"
import { NotificationService } from "src/notification/notification.service"
import { WidgetConfigDto } from "./widgets/widget.dto"
import { IpLibraryDetailDto } from "src/ip-library/ip-library.dto"
import { WidgetsService } from "./widgets/widgets.service"
import { UtilitiesService } from "src/common/utilities.service"

@Injectable()
export class OpenAppService {
    private readonly logger = new Logger(OpenAppService.name)
    constructor(
        private readonly prisma: PrismaService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => AuthService))
        private readonly authService: AuthService,

        @Inject(forwardRef(() => IpLibraryService))
        private readonly ipLibraryService: IpLibraryService,

        @Inject(forwardRef(() => WidgetsService))
        private readonly widgetsService: WidgetsService,

        @Inject(forwardRef(() => NotificationService))
        private readonly notificationService: NotificationService,
    ) {}

    async getAppDetail(appId: string, userToken: string): Promise<AppInfoDto> {
        if (!appId) {
            throw new BadRequestException("App ID is required")
        }
        const app = await this.prisma.apps.findUnique({
            where: { app_id: appId },
            select: {
                app_id: true,
                creator: true,
                name: true,
                description: true,
                radius: true,
                style_name: true,
                sub_domain: true,
                configs: true,
                menus: true,
                app_icons: true,
                manifest: true,
                app_bind_ips: {
                    select: {
                        ip: true,
                    },
                },
                app_bind_widgets: {
                    select: {
                        widget_tag: true,
                        widget_configs: true,
                        widget_detail: {
                            select: {
                                id: true,
                                tag: true,
                                name: true,
                                summary: true,
                                pricing: true,
                                settings: true,
                            },
                        },
                        enabled: true,
                        order: true,
                        subscribe_detail: true,
                    },
                },
            },
        })
        if (!app) {
            throw new NotFoundException("App not found")
        }
        let userInfo: UserInfoDTO | null = null
        let ipInfo: ip_library | null = null
        const appIp = app.app_bind_ips.map((ip) => ip.ip)
        if (appIp.length === 0) {
            throw new NotFoundException("App not bind to any ip")
        }
        ipInfo = appIp[0]

        if (userToken) {
            const userBaseInfo = await this.authService.getUserInfoByToken(userToken)
            if (userBaseInfo) {
                userInfo = await this.userService.getUserInfoByUsernameShorted(userBaseInfo.usernameShorted)
            }
        }

        const ipDetail: IpLibraryDetailDto = await this.ipLibraryService.detail(
            ipInfo.id.toString(),
            null,
            null,
            userInfo,
        )
        delete ipDetail.child_ip_info

        return {
            app_id: app.app_id,
            app_name: app.name,
            description: app.description,
            user_info: userInfo,
            radius: app.radius,
            style_name: app.style_name,
            sub_domain: app.sub_domain,
            app_icons: app.app_icons as unknown as AppIconDto,
            manifest: app.manifest as unknown as ManifestDto,
            ip_info: ipDetail,
            is_admin: userInfo?.usernameShorted === ipInfo.owner,
            usdc_mint: GiggleService.GIGGLE_LEGAL_USDC,
            configs: this._processConfigs(app.configs),
            kline_url: process.env.GIGGLE_KLINE_URL,
            custom_sub_domain: process.env.OPEN_APP_SUB_DOMAIN || "app.giggle.pro",
            menus: this._mapAppMenus(app.menus),
            widgets: await Promise.all(
                app.app_bind_widgets.map(async (widget) => {
                    const subscribedDetail = widget.subscribe_detail
                    if (subscribedDetail) {
                        delete subscribedDetail.id
                    }
                    return {
                        tag: widget.widget_tag,
                        configs: (widget.widget_configs as unknown as WidgetConfigDto)?.public,
                        widget_detail: widget.widget_detail,
                        order: widget.order,
                        enabled: widget.enabled,
                        subscribed_detail: subscribedDetail,
                    }
                }),
            ),
        }
    }

    async getAppList(userInfo: UserInfoDTO, query: PaginationDto): Promise<AppListDto> {
        const appList = await this.prisma.apps.findMany({
            where: { creator: userInfo.usernameShorted, is_temp: false },
            skip: (parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
            include: {
                app_bind_ips: {
                    select: {
                        ip: true,
                    },
                },
            },
            orderBy: {
                created_at: "desc",
            },
        })
        const total = await this.prisma.apps.count({
            where: { creator: userInfo.usernameShorted, is_temp: false },
        })

        const ipIdList = appList.map((app) => app.app_bind_ips.map((ip) => ip.ip.id)[0])
        const ipSummaarayList = await this.ipLibraryService.getList(
            {
                page: "1",
                page_size: ipIdList.length.toString(),
            },
            null,
            null,
            ipIdList,
        )
        return {
            data: appList.map((app) => ({
                app_id: app.app_id,
                app_name: app.name,
                description: app.description,
                radius: app.radius,
                style_name: app.style_name,
                sub_domain: app.sub_domain,
                ip_info: ipSummaarayList.data.find((ip) => ip.id === app.app_bind_ips.map((ip) => ip.ip.id)[0]),
            })),
            total,
        }
    }

    async createApp(createData: CreateAppDto, userInfo: UserInfoDTO) {
        const ip = await this.prisma.ip_library.findUnique({
            where: { id: parseInt(createData.ip_id.toString()), owner: userInfo.usernameShorted },
        })
        if (!ip) {
            throw new BadRequestException("IP not found or you are not the owner of the ip")
        }

        /*if (!ip.token_info) {
            throw new BadRequestException("IP token info not found, please share to giggle first")
        }*/

        const hasParentIp = await this.prisma.ip_library_child.findFirst({
            where: { ip_id: ip.id },
        })

        if (hasParentIp) {
            throw new BadRequestException("Can not create app for ip with parent ip")
        }

        if (createData.sub_domain) {
            const appAlreadyExists = await this.prisma.apps.findFirst({
                where: { sub_domain: createData.sub_domain, is_temp: false },
            })
            if (appAlreadyExists) {
                throw new BadRequestException("Sub domain already exists")
            }
        }

        const app_id = crypto.randomBytes(16).toString("hex")
        const app_secret = crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex")
        const appCreated = await this.prisma.$transaction(async (tx) => {
            const app = await tx.apps.create({
                data: {
                    app_id: app_id,
                    name: ip.name,
                    description: ip.description,
                    radius: createData.radius,
                    style_name: createData.style_name,
                    sub_domain: createData.sub_domain,
                    menus: this._mapAppMenus(createData.menus) as any,
                    app_secret: app_secret,
                    creator: userInfo.usernameShorted,
                    configs: this._processConfigs(createData.configs) as any,
                },
                select: {
                    id: true,
                    app_id: true,
                    name: true,
                    description: true,
                    radius: true,
                    style_name: true,
                    sub_domain: true,
                    created_at: true,
                },
            })
            await tx.app_bind_ips.create({
                data: {
                    ip_id: ip.id,
                    app_id: app_id,
                },
            })

            //process widgets
            await Promise.all(
                createData.widgets.map(async (widget) => {
                    const widgetDetail = await this.prisma.widgets.findUnique({
                        where: { tag: widget.tag },
                    })
                    if (!widgetDetail) {
                        this.logger.error(
                            `user: ${userInfo.usernameShorted} widget: ${widget.tag} not found, ignore it`,
                        )
                        return
                    }
                    const subscription = await this.prisma.user_subscribed_widgets.findFirst({
                        where: { user: userInfo.usernameShorted, widget_tag: widget.tag },
                    })
                    if (!subscription) {
                        // not subscribed, ignore it
                        this.logger.error(
                            `user: ${userInfo.usernameShorted} not subscribed to widget: ${widget.tag}, ignore it`,
                        )
                        return
                    }

                    const widgetConfigs = {
                        public: subscription.public_config,
                        private: subscription.private_config,
                    }

                    await this.prisma.app_bind_widgets.create({
                        data: {
                            app_id: app_id,
                            widget_tag: widget.tag,
                            widget_configs: widgetConfigs,
                            subscription_id: subscription.id,
                            enabled: widget.enabled,
                            order: widget.order || 999,
                        },
                    })
                }),
            )
            return app
        })
        //notify to giggle.pro

        return appCreated
    }

    async previewApp(
        createData: CreateAppDto,
        userInfo: UserInfoDTO,
        cookies: Record<string, string>,
        res: Response,
    ): Promise<AppInfoDto> {
        userInfo = await this.userService.getUserInfoByUsernameShorted(userInfo.usernameShorted)
        const ip = await this.prisma.ip_library.findUnique({
            where: { id: parseInt(createData.ip_id.toString()), owner: userInfo.usernameShorted },
        })
        if (!ip) {
            throw new BadRequestException("IP not found or you are not the owner of the ip")
        }

        let app_id = ""
        if (cookies["preview_app_id"]) {
            const app = await this.prisma.apps.findUnique({
                where: { app_id: cookies["preview_app_id"] },
            })
            if (app) {
                app_id = app.app_id
            }
        }

        const appData = {
            creator: userInfo.usernameShorted,
            name: ip.name,
            description: ip.description,
            radius: createData.radius,
            style_name: createData.style_name,
            sub_domain: createData.sub_domain,
            is_temp: true,
            configs: this._processConfigs(createData.configs) as any,
        }
        const appBindIpData = {
            ip_id: ip.id,
            is_temp: true,
        }

        const previewApp = await this.prisma.$transaction(async (tx) => {
            let p = null
            if (app_id) {
                p = await tx.apps.update({
                    where: { app_id: app_id },
                    data: appData,
                })
            } else {
                const _app_id = crypto.randomBytes(16).toString("hex")
                p = await tx.apps.create({
                    data: { ...appData, app_id: _app_id },
                })
                res.cookie("preview_app_id", _app_id, {
                    httpOnly: true,
                    maxAge: 1000 * 60 * 60 * 24, // 1 days
                })
            }
            await tx.app_bind_ips.deleteMany({
                where: { app_id: p.app_id },
            })
            await tx.app_bind_ips.create({
                data: { ...appBindIpData, app_id: p.app_id },
            })
            return p
        })

        return this.getAppDetail(previewApp.app_id, "")
    }

    async updateApp(updateData: UpdateAppDto, userInfo: UserInfoDTO) {
        const app = await this.prisma.apps.findUnique({
            where: { app_id: updateData.app_id, creator: userInfo.usernameShorted },
        })
        if (!app) {
            throw new NotFoundException("App not found")
        }

        const ip = await this.prisma.ip_library.findUnique({
            where: { id: parseInt(updateData.ip_id.toString()), owner: userInfo.usernameShorted },
        })
        if (!ip) {
            throw new BadRequestException("IP not found or you are not the owner of the ip")
        }

        if (updateData.sub_domain) {
            const appAlreadyExists = await this.prisma.apps.findFirst({
                where: { sub_domain: updateData.sub_domain, app_id: { not: updateData.app_id }, is_temp: false },
            })
            if (appAlreadyExists) {
                throw new BadRequestException("Sub domain already exists")
            }
        }
        return await this.prisma.$transaction(async (tx) => {
            const app = await tx.apps.update({
                where: { app_id: updateData.app_id },
                data: {
                    name: ip.name,
                    description: ip.description,
                    radius: updateData.radius,
                    style_name: updateData.style_name,
                    sub_domain: updateData.sub_domain,
                    configs: this._processConfigs(updateData.configs) as any,
                    menus: this._mapAppMenus(updateData.menus) as any,
                    app_icons: updateData?.app_icons as any,
                    manifest: updateData?.manifest as any,
                },
                select: {
                    id: true,
                    app_id: true,
                    name: true,
                    description: true,
                    radius: true,
                    style_name: true,
                    sub_domain: true,
                    created_at: true,
                    menus: true,
                    app_icons: true,
                    manifest: true,
                },
            })

            await tx.app_bind_ips.deleteMany({
                where: { app_id: updateData.app_id },
            })
            await tx.app_bind_ips.create({
                data: {
                    ip_id: ip.id,
                    app_id: updateData.app_id,
                },
            })

            //process widgets
            //updated at: 2025-05-19, we are no longer support to update widgets if app created
            /*
            await Promise.all(
                updateData.widgets.map(async (widget) => {
                    const widgetDetail = await this.prisma.widgets.findUnique({
                        where: { tag: widget.tag },
                    })
                    if (!widgetDetail) {
                        this.logger.error(
                            `user: ${userInfo.usernameShorted} widget: ${widget.tag} not found, ignore it`,
                        )
                        return
                    }
                    const subscription = await this.prisma.user_subscribed_widgets.findFirst({
                        where: { user: userInfo.usernameShorted, widget_tag: widget.tag },
                    })
                    if (!subscription) {
                        // not subscribed, ignore it
                        this.logger.error(
                            `user: ${userInfo.usernameShorted} not subscribed to widget: ${widget.tag}, ignore it`,
                        )
                        return
                    }

                    const widgetConfigs = {
                        public: subscription.public_config,
                        private: subscription.private_config,
                    }

                    const isBind = await this.prisma.app_bind_widgets.findFirst({
                        where: { app_id: updateData.app_id, widget_tag: widget.tag },
                    })
                    if (!isBind && widget.enabled) {
                        // not bind, create it
                        await this.prisma.app_bind_widgets.create({
                            data: {
                                app_id: updateData.app_id,
                                widget_tag: widget.tag,
                                widget_configs: widgetConfigs,
                                subscription_id: subscription.id,
                                order: widget.order,
                                enabled: true,
                            },
                        })
                    } else if (isBind) {
                        // already bind, update it
                        await this.prisma.app_bind_widgets.update({
                            where: { id: isBind.id },
                            data: {
                                //widget_configs: widgetConfigs,
                                subscription_id: subscription.id,
                                enabled: widget.enabled,
                                order: widget.order,
                            },
                        })
                    }
                }),
            )*/

            return app
        })
    }

    async getTopIpList(userInfo: UserInfoDTO): Promise<TopIpSummaryDto[]> {
        const ipList = await this.prisma.ip_library.findMany({
            where: {
                owner: userInfo.usernameShorted,
                is_public: true,
                ip_library_child: {
                    none: {},
                },
            },
            orderBy: {
                created_at: "desc",
            },
            select: {
                id: true,
                name: true,
                ticker: true,
            },
        })
        return ipList
    }

    async deleteApp(deleteData: DeleteAppDto, userInfo: UserInfoDTO) {
        const app = await this.prisma.apps.findUnique({
            where: { app_id: deleteData.app_id, creator: userInfo.usernameShorted },
        })
        if (!app) {
            throw new NotFoundException("App not found")
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.apps.delete({
                where: { app_id: deleteData.app_id },
            })
            await tx.app_bind_ips.deleteMany({
                where: { app_id: deleteData.app_id },
            })
            await tx.app_bind_widgets.deleteMany({
                where: { app_id: deleteData.app_id },
            })
        })
        return {
            success: true,
        }
    }

    async uploadIcon(userInfo: UserInfoDTO, icon: Express.Multer.File) {
        const sharp = require("sharp")
        // Convert to PNG format
        const pngBuffer = await sharp(icon.buffer).png().toBuffer()

        // Replace original buffer with PNG version
        icon.buffer = pngBuffer

        // Resize to 512x512
        const icon512 = await sharp(icon.buffer)
            .resize(512, 512, {
                fit: "cover",
                position: "center",
            })
            .toBuffer()

        // Resize to 192x192
        const icon192 = await sharp(icon.buffer)
            .resize(192, 192, {
                fit: "cover",
                position: "center",
            })
            .toBuffer()
        // Update file name to .png
        icon.originalname = icon.originalname.split(".")[0] + ".png"

        // Upload both versions
        const icon512Url = await UtilitiesService.uploadToPublicS3(
            { ...icon, buffer: icon512 },
            userInfo.usernameShorted,
        )
        const icon192Url = await UtilitiesService.uploadToPublicS3(
            { ...icon, buffer: icon192 },
            userInfo.usernameShorted,
        )

        return {
            icon512_url: icon512Url,
            icon192_url: icon192Url,
        }
    }
    //clear temp app every 1 hour
    @Cron(CronExpression.EVERY_HOUR)
    async clearTempApp() {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        const yesterDay = new Date()
        yesterDay.setDate(yesterDay.getDate() - 1)

        const appPreDeleted = await this.prisma.apps.findMany({
            where: { is_temp: true, created_at: { lt: yesterDay } },
        })
        const appIds = appPreDeleted.map((app) => app.app_id)

        await this.prisma.apps.deleteMany({
            where: { app_id: { in: appIds } },
        })
        await this.prisma.app_bind_ips.deleteMany({
            where: { app_id: { in: appIds } },
        })
    }

    private _processConfigs(configs: any): Record<string, any> {
        return configs
    }

    async getOpenAppSettings(): Promise<OpenAppSettingsDto> {
        return {
            kline_url: process.env.GIGGLE_KLINE_URL,
            usdc_mint: GiggleService.GIGGLE_LEGAL_USDC,
            custom_sub_domain: process.env.OPEN_APP_SUB_DOMAIN || "app.giggle.pro",
        }
    }

    async requestCreator(requestData: RequestCreatorDto): Promise<RequestCreatorResponseDto> {
        // Get admin email from environment or config
        const adminEmail = process.env.CONTACT_EMAIL || "admin@giggle.pro"

        //check if invited user email is provided
        if (requestData.invited_user_email) {
            //check if the invited user exists
            const invitedUser = await this.prisma.users.findUnique({
                where: { email: requestData.invited_user_email, can_invite_user: true },
            })
            if (invitedUser) {
                const result = await this._processApproveCreator({ email: requestData.email })
                const invitedUserInfo = await this.prisma.users.findUnique({
                    where: { email: requestData.email },
                })
                if (result.success) {
                    const isExists = await this.prisma.user_invited_record.findMany({
                        where: { user: invitedUser.username_in_be, invited_user: invitedUserInfo.username_in_be },
                    })
                    if (isExists.length === 0) {
                        await this.prisma.user_invited_record.create({
                            data: {
                                user: invitedUser.username_in_be,
                                invited_user: invitedUserInfo.username_in_be,
                            },
                        })
                    } else {
                        await this.prisma.user_invited_record.updateMany({
                            where: { id: { in: isExists.map((item) => item.id) } },
                            data: {
                                updated_at: new Date(),
                            },
                        })
                    }
                }
                return result
            }
        }

        //check application already exists
        const application = await this.prisma.creator_applications.findFirst({
            where: { email: requestData.email },
        })
        if (application) {
            throw new ConflictException("Application already exists")
        }

        // Prepare email template context for admin
        const adminEmailContext = {
            subject: "New Creator Application",
            full_name: requestData.full_name || "",
            email: requestData.email,
            company: requestData.company || "",
            website: requestData.website || "",
            social_media: requestData.social_media || "",
            description: requestData.description || "",
        }

        await this.prisma.creator_applications.create({
            data: {
                full_name: requestData.full_name || "",
                email: requestData.email,
                company: requestData.company || "",
                website: requestData.website || "",
                social_media: requestData.social_media || "",
                description: requestData.description || "",
            },
        })

        // Send email to admin
        await this.notificationService.sendNotification(
            "New Creator Application Request",
            adminEmail,
            "creator_request",
            adminEmailContext,
            "mail.giggle.pro",
            "Giggle.Pro <app-noreply@giggle.pro>",
        )

        // Send a confirmation email to the requester
        const requesterContext = {
            summary: "Your creator application has been received",
            description:
                "Thank you for your interest in becoming a creator on Giggle.Pro. We've received your application and will review it shortly. We'll contact you at " +
                requestData.email +
                " if your application is approved.",
            app_name: "Giggle.Pro",
        }

        await this.notificationService.sendNotification(
            "Your Giggle.Pro Creator Application",
            requestData.email,
            "creator_request_confirmation",
            requesterContext,
            "mail.giggle.pro",
            "Giggle.Pro <app-noreply@giggle.pro>",
        )

        return {
            success: true,
            message: "Your creator application has been submitted successfully. We'll contact you soon.",
        }
    }

    async _processApproveCreator(approveData: ApproveCreatorDto): Promise<ApproveCreatorResponseDto> {
        // Find the user account
        let user = await this.prisma.users.findFirst({
            where: { email: approveData.email },
        })

        if (!user) {
            const userNameShorted = this.userService.generateShortName()
            const username = approveData.email.split("@")[0]
            const newUserInfo: CreateUserDto = {
                user_id: userNameShorted,
                username: username,
                password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                email: approveData.email,
                usernameShorted: userNameShorted,
                app_id: "",
                from_source_link: "",
                from_device_id: "",
            }
            await this.userService.createUser(newUserInfo)
            user = await this.prisma.users.findFirst({
                where: { email: approveData.email },
            })
        }

        // Update the user's permission to create IPs
        await this.prisma.users.update({
            where: { email: approveData.email },
            data: { can_create_ip: true, is_developer: true },
        })

        //remove creator application
        await this.prisma.creator_applications.deleteMany({
            where: { email: approveData.email },
        })

        // Send approval email to the creator
        const approvalContext = {
            full_name: user.username,
        }

        await this.notificationService.sendNotification(
            "Your Creator Application has been Approved!",
            approveData.email,
            "creator_request_approved",
            approvalContext,
            "mail.giggle.pro",
            "Giggle.Pro <app-noreply@giggle.pro>",
        )

        return {
            success: true,
            message: `Creator application for ${user.username} has been approved successfully.`,
        }
    }

    async approveCreator(approveData: ApproveCreatorDto, userInfo: UserInfoDTO): Promise<ApproveCreatorResponseDto> {
        // Check if requester is admin
        const adminUser = await this.prisma.users.findUnique({
            where: { username_in_be: userInfo.usernameShorted },
            select: { is_admin: true },
        })

        if (!adminUser || !adminUser.is_admin) {
            throw new BadRequestException("Only admins can approve creator applications")
        }

        return this._processApproveCreator(approveData)
    }

    async lookupBySubdomain(subdomain: string): Promise<AppInfoDto> {
        const app = await this.prisma.apps.findFirst({
            where: { sub_domain: subdomain, is_temp: false },
        })
        if (!app) {
            throw new NotFoundException("App not found")
        }
        return this.getAppDetail(app.app_id, "")
    }

    private _mapAppMenus(menus: any): AppMenuDto[] {
        //updated at: 2025-05-19, we are no longer support to update menus if app created
        return []
        /*
        const STATIC_MENUS: AppMenuDto[] = [
            { name: "IP Browser", path: "/ip-browser", order: 0, enabled: true },
            { name: "Community", path: "/community", order: 1, enabled: true },
        ]

        if (!menus) {
            return STATIC_MENUS
        }
        return menus.map((menu: any) => {
            const menuItem = STATIC_MENUS.find((m) => m.name === menu.name)
            if (!menuItem) {
                return null
            }
            return {
                name: menuItem.name,
                path: menuItem.path,
                order: menu.order < 0 ? menuItem.order : menu.order,
                enabled: menu.enabled === undefined ? menuItem.enabled : menu.enabled,
            }
        })
        */
    }

    async addInviteEmail(addInviteEmailDto: AddInviteEmailDto, userInfo: UserInfoDTO) {
        //check if the user is admin
        const adminUser = await this.prisma.users.findUnique({
            where: { username_in_be: userInfo.usernameShorted },
            select: { is_admin: true },
        })
        if (!adminUser || !adminUser.is_admin) {
            throw new BadRequestException("Only admins can add invite emails")
        }

        //check user exists
        const user = await this.prisma.users.findUnique({
            where: { email: addInviteEmailDto.email },
        })
        if (!user) {
            throw new NotFoundException("User not found")
        }

        //add the invite email
        await this.prisma.users.update({
            where: { email: addInviteEmailDto.email },
            data: { can_invite_user: true },
        })

        return {
            success: true,
            message: "Invite email added successfully",
        }
    }

    async removeInviteEmail(removeInviteEmailDto: RemoveInviteEmailDto, userInfo: UserInfoDTO) {
        //check if the user is admin
        const adminUser = await this.prisma.users.findUnique({
            where: { username_in_be: userInfo.usernameShorted },
            select: { is_admin: true },
        })
        if (!adminUser || !adminUser.is_admin) {
            throw new BadRequestException("Only admins can remove invite emails")
        }

        //check user exists
        const user = await this.prisma.users.findUnique({
            where: { email: removeInviteEmailDto.email },
        })
        if (!user) {
            throw new NotFoundException("User not found")
        }

        //remove the invite email
        await this.prisma.users.update({
            where: { email: removeInviteEmailDto.email },
            data: { can_invite_user: false },
        })

        return {
            success: true,
            message: "Invite email removed successfully",
        }
    }
}
