import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { isEmail } from "class-validator"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { WidgetsService } from "../widgets/widgets.service"
import { GetUserTokenDto } from "./users.dto"
import { users } from "@prisma/client"

@Injectable()
export class UsersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userService: UserService,
        private readonly widgetService: WidgetsService,
    ) {}

    async getUserInfo(reqUser: UserJwtExtractDto, email: string) {
        const user = await this.prisma.users.findUnique({
            where: { email: email },
        })
        if (!user) {
            throw new NotFoundException("User not found")
        }
        return this.userService.getProfile({ user_id: user.username_in_be, usernameShorted: user.username_in_be })
    }

    async getToken(reqDeveloper: UserJwtExtractDto, body: GetUserTokenDto) {
        let user: users | null = null
        if (body?.user_id) {
            user = await this.prisma.users.findUnique({
                where: { username_in_be: body.user_id },
            })

            if (!user) {
                throw new NotFoundException("User not found")
            }
        } else if (body?.email) {
            if (!isEmail(body.email)) {
                throw new BadRequestException("Email is not valid")
            }
            user = await this.prisma.users.findUnique({
                where: { email: body.email },
            })

            //create user if user not exists
            if (!user) {
                const userNameShorted = this.userService.generateShortName()
                await this.userService.createUser({
                    username: body.email.split("@")[0],
                    email: body.email,
                    password: UtilitiesService.generateRandomApiKey(),
                    usernameShorted: userNameShorted,
                    app_id: reqDeveloper.app_id,
                    from_source_link: "",
                    from_device_id: reqDeveloper.device_id,
                    can_create_ip: true,
                    user_id: userNameShorted,
                    invited_by: "",
                })
                user = await this.prisma.users.findUnique({
                    where: { username_in_be: userNameShorted },
                })
            }
        } else {
            throw new BadRequestException("user_id or email is required")
        }

        const widgetTag = reqDeveloper?.developer_info?.tag
        if (!widgetTag) {
            throw new NotFoundException("Widget not found")
        }
        const widget = await this.prisma.widgets.findUnique({
            where: { tag: widgetTag },
            select: {
                secret_key: true,
                request_permissions: true,
            },
        })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        const permissions = widget.request_permissions as { can_get_user_token: boolean }
        if (!permissions?.can_get_user_token) {
            throw new ForbiddenException("Widget does not have permission to get user token")
        }

        return this.widgetService.getAccessToken(
            {
                tag: widgetTag,
                app_id: reqDeveloper.app_id,
            },
            {
                user_id: user.username_in_be,
                username: user.username,
                usernameShorted: user.username_in_be,
                email: user.email,
                avatar: user.avatar,
                device_id: reqDeveloper.device_id,
                is_developer: false,
                app_id: body.app_id,
            },
            reqDeveloper.device_id,
        )
    }
}
