import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { CreateLinkRequestDto, LinkDetailDto } from "./link.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { PrismaService } from "src/common/prisma.service"
import { OpenAppService } from "src/open-app/open-app.service"

@Injectable()
export class LinkService {
    constructor(
        private readonly userService: UserService,
        private readonly prisma: PrismaService,
        private readonly appService: OpenAppService,
    ) {}

    async create(body: CreateLinkRequestDto, userInfo: UserInfoDTO, appId: string) {
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
        const uniqueStr = "gig" + Math.random().toString(36).substring(2, 16)
        const url = this._generateLink(uniqueStr)

        const link = await this.prisma.app_links.create({
            data: {
                app_id: app_id,
                widget_tag: widgetTag,
                widget_message: body.widget_message,
                link: widgetTag ? "" : body.link,
                unique_str: uniqueStr,
                creator: userInfo.usernameShorted,
            },
        })

        return {
            link_id: link.id,
            link_url: url,
        }
    }

    async getLink(uniqueStr: string): Promise<LinkDetailDto> {
        const link = await this.prisma.app_links.findUnique({
            where: {
                unique_str: uniqueStr,
            },
            include: {
                creator_info: true,
            },
        })

        if (!link) {
            throw new NotFoundException("Link not found")
        }

        return {
            link_id: link.unique_str,
            link_url: this._generateLink(link.unique_str),
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

    _generateLink(uniqueStr: string) {
        return `${process.env.FRONTEND_URL}/l/${uniqueStr}`
    }
}
