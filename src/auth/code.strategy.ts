import { ForbiddenException, Injectable } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { Strategy } from "passport-custom"
import { UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { Request } from "express"
import { PrismaService } from "src/common/prisma.service"

@Injectable()
export class CodeStrategy extends PassportStrategy(Strategy, "code") {
    constructor(
        private userService: UserService,
        private prismaService: PrismaService,
    ) {
        super()
    }

    async validate(req: Request): Promise<UserInfoDTO> {
        const { email, code } = req.body
        const userInfo = await this.prismaService.users.findUnique({
            where: {
                email: email,
            },
        })
        if (!userInfo) {
            throw new ForbiddenException("User not found")
        }
        if (!userInfo.login_code) {
            throw new ForbiddenException("User has not requested login code")
        }
        if (userInfo.login_code !== code || userInfo.login_code_expired < new Date()) {
            throw new ForbiddenException("Invalid code or code expired")
        }
        return {
            ...(await this.userService.getUserInfoByEmail(email)),
            device_id: (req.headers["x-device-id"] as string) || "",
        }
    }
}
