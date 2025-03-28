import { Injectable, UnauthorizedException } from "@nestjs/common"
import { LoginDto } from "./auto.dto"
import { PrismaService } from "src/common/prisma.service"
import crypto from "crypto"
import { JwtService } from "@nestjs/jwt"
import { UserService } from "src/user/user.service"
import { UserInfoDTO } from "src/user/user.controller"
@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly userService: UserService,
    ) {}

    async checkSignature(requestParams: Record<string, any>, host: string): Promise<void> {
        //remove port from host
        host = host.split(":")[0]
        if (!requestParams?.app_id) {
            throw new UnauthorizedException("App id is required")
        }
        const appInfo = await this.prisma.apps.findUnique({ where: { app_id: requestParams.app_id } })
        if (!appInfo) {
            throw new UnauthorizedException("App not found")
        }

        const appAllowdDomains = await this.prisma.app_registered_domain.findMany({ where: { app_id: appInfo.app_id } })
        if (!appAllowdDomains.some((domain) => host.endsWith(domain.domain))) {
            throw new UnauthorizedException("Host not allowed")
        }

        if (!requestParams?.sign) {
            throw new UnauthorizedException("Signature is required")
        }
        const signature: string = requestParams.sign
        delete requestParams.sign

        if (!requestParams?.timestamp) {
            throw new UnauthorizedException("Timestamp is required")
        }

        console.log(requestParams.timestamp)
        console.log(Date.now() - 1000 * 60 * 5)
        if (
            requestParams.timestamp * 1000 < Date.now() - 1000 * 60 * 5 ||
            requestParams.timestamp * 1000 > Date.now() + 1000 * 60 * 5
        ) {
            // in 5 minutes
            throw new UnauthorizedException("Timestamp expired")
        }

        const sortedKeys = Object.keys(requestParams)
            .filter((key) => key !== "sign" && requestParams[key] !== undefined && requestParams[key] !== null)
            .sort()
        const stringA = sortedKeys.map((key) => `${key}=${requestParams[key]}`).join(",")

        const stringSignTemp = `${stringA},key=${appInfo.app_secret}`

        const hash = crypto.createHash("md5").update(stringSignTemp).digest("hex").toUpperCase()

        if (signature !== hash) {
            throw new UnauthorizedException("Signature not match")
        }
    }

    async login(body: LoginDto, host: string) {
        await this.checkSignature(body, host)
        const user = await this.prisma.users.findUnique({ where: { email: body.email } })
        //create user if not exists
        if (!user) {
            const userNameShorted = this.userService.generateShortName()
            const username = body.email.split("@")[0]
            const newUserInfo: UserInfoDTO = {
                username: username,
                password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                email: body.email,
                usernameShorted: userNameShorted,
                emailConfirmed: false,
                app_id: body.app_id,
            }
            await this.userService.createUser(newUserInfo)
        }
        return {
            token: this.jwtService.sign({
                host: host,
                app_id: body.app_id,
                email: body.email,
            }),
        }
    }
}
