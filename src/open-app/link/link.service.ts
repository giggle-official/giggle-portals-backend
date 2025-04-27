import { BadRequestException, forwardRef, Inject, Injectable } from "@nestjs/common"
import {
    BindDeviceRequestDto,
    CreateLinkRequestDto,
    CreateLinkResponseDto,
    LinkDetailDto,
    LinkSummaryDto,
} from "./link.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { PrismaService } from "src/common/prisma.service"
import { OpenAppService } from "src/open-app/open-app.service"
import { Cron } from "@nestjs/schedule"
import { CronExpression } from "@nestjs/schedule"
import { HttpService } from "@nestjs/axios"
import { lastValueFrom } from "rxjs"
@Injectable()
export class LinkService {
    public shortLinkServiceEndpoint = ""
    public shortLinkServiceApiKey = ""
    constructor(
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => OpenAppService))
        private readonly appService: OpenAppService,

        private readonly prisma: PrismaService,
        private readonly httpService: HttpService,
    ) {
        this.shortLinkServiceEndpoint = process.env.SHORTLINK_API_ENDPOINT
        this.shortLinkServiceApiKey = process.env.SHORTLINK_API_KEY
        if (!this.shortLinkServiceEndpoint) throw Error("SHORTLINK_API_ENDPOINT not set")
        if (!this.shortLinkServiceApiKey) throw Error("SHORTLINK_API_KEY not set")
    }

    async create(body: CreateLinkRequestDto, userInfo: UserInfoDTO, appId: string): Promise<CreateLinkResponseDto> {
        //throw if we not found the app_id
        const userProfile = await this.userService.getProfile(userInfo)
        let app_id = userProfile?.widget_info?.app_id ?? appId
        if (!app_id) {
            throw new BadRequestException("App ID not found either in profile or in header")
        }

        //check if the app_id is valid
        const app = await this.prisma.apps.findUnique({
            where: {
                app_id: app_id,
            },
        })
        if (!app) {
            throw new BadRequestException("App ID is invalid")
        }

        let widgetTag = userProfile?.widget_info?.widget_tag || ""

        if (!widgetTag && !body.link) {
            throw new BadRequestException("Widget tag or link is required")
        }

        //find unique
        if (!widgetTag) {
            const existingLink = await this.prisma.app_links.findFirst({
                where: {
                    link: body.link,
                    app_id: app_id,
                    creator: userInfo.usernameShorted,
                },
            })
            if (existingLink) {
                return {
                    link_id: existingLink.unique_str,
                    short_link: existingLink.full_short_link,
                }
            }
        } else {
            const existingLink = await this.prisma.app_links.findFirst({
                where: {
                    widget_tag: widgetTag,
                    app_id: app_id,
                    widget_message: body.widget_message,
                    creator: userInfo.usernameShorted,
                },
            })
            if (existingLink) {
                return {
                    link_id: existingLink.unique_str,
                    short_link: existingLink.full_short_link,
                }
            }
        }

        //create new link
        const uniqueStr = "gig" + Math.random().toString(36).substring(2, 16)
        const url = this._generateLink(uniqueStr)
        const createShortLinkParams = {
            target: url,
        }

        const response = await lastValueFrom(
            this.httpService.post(`${this.shortLinkServiceEndpoint}/links`, createShortLinkParams, {
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.shortLinkServiceApiKey,
                },
            }),
        )

        if (!response.data?.link) {
            throw new BadRequestException("Failed to create short link")
        }

        const link = await this.prisma.app_links.create({
            data: {
                app_id: app_id,
                widget_tag: widgetTag,
                widget_message: body.widget_message,
                link: widgetTag ? "" : body.link,
                unique_str: uniqueStr,
                creator: userInfo.usernameShorted,
                full_short_link: response.data.link,
            },
        })

        return {
            link_id: link.unique_str,
            short_link: response.data.link,
        }
    }

    async getLink(uniqueStr: string): Promise<LinkDetailDto | null> {
        const link = await this.prisma.app_links.findUnique({
            where: {
                unique_str: uniqueStr,
            },
            include: {
                creator_info: true,
            },
        })

        if (!link) {
            return null
        }

        return {
            link_id: link.unique_str,
            short_link: link.full_short_link,
            creator: {
                username: link.creator_info.username,
                avatar: link.creator_info.avatar,
            },
            redirect_to_widget: link.widget_tag,
            widget_message: link.widget_message,
            redirect_to_link: link.link,
            app_id: link.app_id,
            created_at: link.created_at,
            updated_at: link.updated_at,
            app_info: await this.appService.getAppDetail(link.app_id, null),
        }
    }

    async bindDevice(body: BindDeviceRequestDto) {
        if (!body.device_id || !body.link_id) {
            return {}
        }
        const existBind = await this.prisma.link_devices.findFirst({
            where: {
                device_id: body.device_id,
                link_id: body.link_id,
                expired: false,
            },
        })
        if (existBind) {
            return {}
        }
        await this.prisma.link_devices.create({
            data: {
                device_id: body.device_id,
                link_id: body.link_id,
                expired: false,
            },
        })
        return {}
    }

    async getLinkSummary(uniqueStr: string): Promise<LinkSummaryDto> {
        const link = await this.getLink(uniqueStr)
        return {
            creator: link?.creator,
            short_link: link?.short_link,
        }
    }

    async getLinkByDeviceId(deviceId: string): Promise<string> {
        const link = await this.prisma.link_devices.findFirst({
            where: {
                device_id: deviceId,
                expired: false,
            },
        })
        return link?.link_id || ""
    }

    _generateLink(uniqueStr: string) {
        return `${process.env.FRONTEND_URL}/l/${uniqueStr}`
    }

    //mark link as expired if create more than 7 days
    @Cron(CronExpression.EVERY_HOUR)
    async markLinkAsExpired() {
        const links = await this.prisma.link_devices.findMany({
            where: {
                created_at: {
                    lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                },
                expired: false,
            },
        })
        for (const link of links) {
            await this.prisma.link_devices.update({
                where: { id: link.id },
                data: { expired: true, expired_at: new Date() },
            })
        }
    }
}
