import { Injectable, UnauthorizedException } from "@nestjs/common"
import { Strategy } from "passport-custom"
import { PassportStrategy } from "@nestjs/passport"
import { isEmail } from "class-validator"
import { CreateUserDto, UserJwtExtractDto } from "src/user/user.controller"
import { Request } from "express"
import { PrismaService } from "src/common/prisma.service"
import * as crypto from "crypto"
import { UserService } from "src/user/user.service"
@Injectable()
export class AppStrategy extends PassportStrategy(Strategy, "app") {
    constructor(
        private prismaService: PrismaService,
        private userService: UserService,
    ) {
        super()
    }

    async validate(req: Request): Promise<UserJwtExtractDto> {
        const { app_id, signature, timestamp, expires_in, email } = req.body
        const app = await this.prismaService.apps.findUnique({
            where: {
                app_id: app_id,
            },
        })
        if (!app) {
            throw new UnauthorizedException("App not found")
        }

        if (timestamp < Date.now() / 1000 - 5 * 60 || timestamp > Date.now() / 1000 + 5 * 60) {
            throw new UnauthorizedException("Timestamp expired")
        }

        const expectedSignature = crypto
            .createHash("md5")
            .update(`${email}${app_id}${timestamp}${app.app_secret}`)
            .digest("hex")

        if (!isEmail(email)) {
            throw new UnauthorizedException("Invalid email")
        }

        if (expires_in && expires_in < 60) {
            throw new UnauthorizedException("Expires in must be greater than 60 seconds if you want to use it")
        }

        if (signature !== expectedSignature) {
            throw new UnauthorizedException("Invalid signature")
        }

        let userInfo = await this.userService.getUserInfoByEmail(email)
        if (!userInfo) {
            const userNameShorted = this.userService.generateShortName()
            const username = email.split("@")[0]
            const newUserInfo: CreateUserDto = {
                username: username,
                password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                email: email,
                usernameShorted: userNameShorted,
                app_id: app_id,
                from_source_link: "",
                from_device_id: "",
            }
            userInfo = await this.userService.createUser(newUserInfo)
        }
        return userInfo
    }
}
