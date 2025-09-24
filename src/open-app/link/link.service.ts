import { BadRequestException, forwardRef, Inject, Injectable } from "@nestjs/common"
import {
    BindDeviceRequestDto,
    CreateLinkRequestDto,
    CreateLinkResponseDto,
    LinkDetailDto,
    LinkSummaryDto,
    UserLinkStatisticsDto,
} from "./link.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { PrismaService } from "src/common/prisma.service"
import { OpenAppService } from "src/open-app/open-app.service"
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

        const isExternalLink = body?.link && (body.link.startsWith("http://") || body.link.startsWith("https://"))

        //find unique
        if (!widgetTag && !isExternalLink) {
            const existingLink = await this.prisma.app_links.findFirst({
                where: {
                    link: body.link,
                    app_id: app_id,
                    creator: userInfo.usernameShorted,
                    enable_login: body.enable_login,
                    link_pic: body.link_pic,
                },
            })
            if (existingLink) {
                return {
                    link_id: existingLink.unique_str,
                    short_link: existingLink.full_short_link,
                    enable_login: existingLink.enable_login,
                    link_pic: existingLink.link_pic,
                    destination: existingLink.destination,
                }
            }
        }

        if (widgetTag && !isExternalLink) {
            const existingLink = await this.prisma.app_links.findFirst({
                where: {
                    widget_tag: widgetTag,
                    app_id: app_id,
                    widget_message: body.widget_message,
                    creator: userInfo.usernameShorted,
                    enable_login: body.enable_login,
                    link_pic: body.link_pic,
                },
            })
            if (existingLink) {
                return {
                    link_id: existingLink.unique_str,
                    short_link: existingLink.full_short_link,
                    enable_login: existingLink.enable_login,
                    link_pic: existingLink.link_pic,
                    destination: existingLink.destination,
                }
            }
        }

        if (isExternalLink) {
            const existingLink = await this.prisma.app_links.findFirst({
                where: {
                    destination: body.link,
                    app_id: app_id,
                    creator: userInfo.usernameShorted,
                    widget_tag: widgetTag || "",
                    widget_message: body.widget_message || "",
                    enable_login: body.enable_login,
                    link_pic: body.link_pic,
                },
            })
            if (existingLink) {
                return {
                    link_id: existingLink.unique_str,
                    short_link: existingLink.full_short_link,
                    enable_login: existingLink.enable_login,
                    link_pic: existingLink.link_pic,
                    destination: existingLink.destination,
                }
            }
        }

        //create new link
        const uniqueStr = "gig" + Math.random().toString(36).substring(2, 16)
        const url = isExternalLink ? body.link : this._generateLink(uniqueStr)

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
                short_link_id: response.data.id,
                enable_login: body.enable_login,
                link_pic: body.link_pic,
                destination: url,
            },
        })

        return {
            link_id: link.unique_str,
            short_link: response.data.link,
            enable_login: body.enable_login,
            link_pic: body.link_pic,
            destination: url,
        }
    }

    async getLink(uniqueStr: string): Promise<LinkDetailDto | null> {
        if (!uniqueStr) {
            return null
        }
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

        const statistics = await this.prisma.link_devices.count({
            where: {
                link_id: link.unique_str,
                expired: false,
            },
        })

        const invitedNewUserCount = await this.prisma.users.count({
            where: {
                from_source_link: link.unique_str,
            },
        })

        return {
            link_id: link.unique_str,
            short_link: link.full_short_link,
            enable_login: link.enable_login,
            creator: {
                username: link?.creator_info?.username,
                avatar: link?.creator_info?.avatar,
                email: link?.creator_info?.email,
            },
            redirect_to_widget: link.widget_tag,
            widget_message: link.widget_message,
            link_pic: link.link_pic,
            redirect_to_link: link.link,
            destination: link.destination,
            app_id: link.app_id,
            statistics: {
                bind_device_count: statistics,
                invited_new_user_count: invitedNewUserCount,
                short_link_status: await this.getShortLinkStatus(link.short_link_id),
            },
            created_at: link.created_at,
            updated_at: link.updated_at,
            app_info: await this.appService.getAppDetail(link.app_id, null),
        }
    }

    async getShortLinkStatus(link_id: string) {
        try {
            if (!link_id) {
                return null
            }
            const shortLinkStatus = await lastValueFrom(
                this.httpService.get(`${this.shortLinkServiceEndpoint}/links/${link_id}/stats`, {
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": this.shortLinkServiceApiKey,
                    },
                }),
            )
            return shortLinkStatus.data
        } catch (error) {
            return null
        }
    }

    async bindDevice(body: BindDeviceRequestDto) {
        if (!body.device_id || !body.link_id) {
            return {}
        }
        const bindExist = await this.prisma.link_devices.findFirst({
            where: {
                device_id: body.device_id,
                link_id: body.link_id,
                expired: false,
            },
        })
        if (bindExist) {
            return {}
        }

        await this.prisma.$transaction(async (tx) => {
            //expire all the bind
            await tx.link_devices.updateMany({
                where: {
                    device_id: body.device_id,
                    expired: false,
                },
                data: { expired: true },
            })
            //create new bind
            await tx.link_devices.create({
                data: {
                    device_id: body.device_id,
                    link_id: body.link_id,
                    expired: false,
                },
            })
        })

        return {}
    }

    async getLinkSummary(uniqueStr: string): Promise<LinkSummaryDto> {
        const link = await this.getLink(uniqueStr)
        return {
            creator: link?.creator,
            short_link: link?.short_link,
            link_pic: link?.link_pic,
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

    async getMyLinkStatistics(userInfo: UserInfoDTO): Promise<UserLinkStatisticsDto> {
        const links = await this.prisma.app_links.findMany({
            where: {
                creator: userInfo.usernameShorted,
            },
        })
        if (links.length === 0) {
            return {
                link_count: 0,
                bind_device_count: 0,
                invited_new_user_count: 0,
            }
        }
        const bindDeviceCount = await this.prisma.link_devices.count({
            where: {
                link_id: { in: links.map((link) => link.unique_str) },
                expired: false,
            },
        })
        const invitedNewUserCount = await this.prisma.users.count({
            where: {
                from_source_link: { in: links.map((link) => link.unique_str) },
            },
        })

        return {
            link_count: links.length,
            bind_device_count: bindDeviceCount,
            invited_new_user_count: invitedNewUserCount,
        }
    }

    //mark link as expired if create more than 7 days
    //@Cron(CronExpression.EVERY_HOUR)
    //TODO: remove this cron job
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
