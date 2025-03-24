import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    AppConfigDto,
    AppInfoDto,
    AppListDto,
    ApproveCreatorDto,
    ApproveCreatorResponseDto,
    CreateAppDto,
    DeleteAppDto,
    OpenAppSettingsDto,
    RequestCreatorDto,
    RequestCreatorResponseDto,
    TopIpSummaryDto,
    UpdateAppDto,
} from "./open-app.dto"
import { UserInfoDTO } from "src/user/user.controller"
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

@Injectable()
export class OpenAppService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userService: UserService,
        private readonly authService: AuthService,
        private readonly ipLibraryService: IpLibraryService,
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
                app_bind_ips: {
                    select: {
                        ip: true,
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

        return {
            app_id: app.app_id,
            app_name: app.name,
            description: app.description,
            user_info: userInfo,
            radius: app.radius,
            style_name: app.style_name,
            sub_domain: app.sub_domain,
            ip_info: await this.ipLibraryService.detail(ipInfo.id.toString()),
            is_admin: userInfo?.usernameShorted === ipInfo.owner,
            usdc_mint: GiggleService.GIGGLE_LEGAL_USDC,
            configs: this._processConfigs(app.configs),
            kline_url: process.env.GIGGLE_KLINE_URL,
        }
    }

    async getAppList(userInfo: UserInfoDTO, query: PaginationDto): Promise<AppListDto> {
        const appList = await this.prisma.apps.findMany({
            where: { creator: userInfo.usernameShorted, is_temp: false },
            skip: (parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
            orderBy: {
                created_at: "desc",
            },
        })
        const total = await this.prisma.apps.count({
            where: { creator: userInfo.usernameShorted, is_temp: false },
        })
        return {
            data: appList.map((app) => ({
                app_id: app.app_id,
                app_name: app.name,
                description: app.description,
                radius: app.radius,
                style_name: app.style_name,
                sub_domain: app.sub_domain,
            })),
            total,
        }
    }

    async createApp(createData: CreateAppDto, userInfo: UserInfoDTO) {
        const ip = await this.prisma.ip_library.findUnique({
            where: { id: createData.ip_id, owner: userInfo.usernameShorted },
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
        return await this.prisma.$transaction(async (tx) => {
            const app = await tx.apps.create({
                data: {
                    app_id: app_id,
                    name: ip.name,
                    description: ip.description,
                    radius: createData.radius,
                    style_name: createData.style_name,
                    sub_domain: createData.sub_domain,
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
            return app
        })
    }

    async previewApp(
        createData: CreateAppDto,
        userInfo: UserInfoDTO,
        cookies: Record<string, string>,
        res: Response,
    ): Promise<AppInfoDto> {
        userInfo = await this.userService.getUserInfoByUsernameShorted(userInfo.usernameShorted)
        const ip = await this.prisma.ip_library.findUnique({
            where: { id: createData.ip_id, owner: userInfo.usernameShorted },
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
            where: { id: updateData.ip_id, owner: userInfo.usernameShorted },
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
            await tx.app_bind_ips.deleteMany({
                where: { app_id: updateData.app_id },
            })
            await tx.app_bind_ips.create({
                data: {
                    ip_id: ip.id,
                    app_id: updateData.app_id,
                },
            })
            return app
        })
    }

    async getTopIpList(userInfo: UserInfoDTO): Promise<TopIpSummaryDto[]> {
        const ipList = await this.prisma.ip_library.findMany({
            where: {
                owner: userInfo.usernameShorted,
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
        })
        return {
            success: true,
        }
    }

    //clear temp app every 1 hour
    @Cron(CronExpression.EVERY_HOUR)
    async clearTempApp() {
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

    private _processConfigs(configs: any): AppConfigDto {
        const menus = configs?.menus || []
        return {
            menus: menus,
        }
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
            full_name: requestData.full_name,
            email: requestData.email,
            company: requestData.company || "",
            website: requestData.website || "",
            social_media: requestData.social_media || "",
            description: requestData.description,
        }

        await this.prisma.creator_applications.create({
            data: {
                full_name: requestData.full_name,
                email: requestData.email,
                company: requestData.company || "",
                website: requestData.website || "",
                social_media: requestData.social_media || "",
                description: requestData.description,
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

    async approveCreator(approveData: ApproveCreatorDto, userInfo: UserInfoDTO): Promise<ApproveCreatorResponseDto> {
        // Check if requester is admin
        const adminUser = await this.prisma.users.findUnique({
            where: { username_in_be: userInfo.usernameShorted },
            select: { is_admin: true },
        })

        if (!adminUser || !adminUser.is_admin) {
            throw new BadRequestException("Only admins can approve creator applications")
        }

        // Find the user account
        const user = await this.prisma.users.findFirst({
            where: { email: approveData.email },
        })

        if (!user) {
            throw new NotFoundException("User account not found for this email")
        }

        // Update the user's permission to create IPs
        await this.prisma.users.update({
            where: { email: approveData.email },
            data: { can_create_ip: true },
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

    async lookupBySubdomain(subdomain: string): Promise<AppInfoDto> {
        const app = await this.prisma.apps.findFirst({
            where: { sub_domain: subdomain, is_temp: false },
        })
        if (!app) {
            throw new NotFoundException("App not found")
        }
        return this.getAppDetail(app.app_id, "")
    }
}
