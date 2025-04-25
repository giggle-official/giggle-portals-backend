import { BadRequestException, Injectable } from "@nestjs/common"
import { CreateLinkRequestDto } from "./share.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { PrismaService } from "src/common/prisma.service"

@Injectable()
export class ShareService {
    constructor(
        private readonly userService: UserService,
        private readonly prisma: PrismaService,
    ) {}

    async create(body: CreateLinkRequestDto, appId: string, userInfo: UserInfoDTO) {
        //throw if we not found the app_id
        const userProfile = await this.userService.getProfile(userInfo)
        let app_id = userProfile.app_id ?? appId
        if (!app_id) {
            throw new BadRequestException("App ID not found either in profile or in appId")
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

        if (body.to.target === "link") {
        }

        return `${process.env.FRONTEND_URL}/share/${body.to.link}`
    }
}
