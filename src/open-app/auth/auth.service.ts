import { BadRequestException, Injectable, UnauthorizedException, Logger } from "@nestjs/common"
import {
    CheckTokenDto,
    CheckTokenResponseDto,
    ConfirmBindDto,
    ConfirmBindResponseDto,
    GetBindCodeDto,
    GetBindCodeResponseDto,
    LoginDto,
} from "./auto.dto"
import { PrismaService } from "src/common/prisma.service"
import crypto from "crypto"
import { JwtService } from "@nestjs/jwt"
import { UserService } from "src/user/user.service"
import { UserInfoDTO } from "src/user/user.controller"
import { AuthService as AuthUserService } from "src/auth/auth.service"
import { NotificationService } from "src/notification/notification.service"

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name)
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly userService: UserService,
        private readonly authUserService: AuthUserService,
        private readonly notificationService: NotificationService,
    ) {}

    async checkSignature(
        requestParams: Record<string, any>,
        origin: string,
    ): Promise<{ host: string; app_id: string }> {
        //remove port from host
        const urlObj = new URL(origin)
        const host = urlObj.hostname
        if (!requestParams?.app_id) {
            throw new UnauthorizedException("App id is required")
        }
        const appInfo = await this.prisma.apps.findUnique({ where: { app_id: requestParams.app_id } })
        if (!appInfo) {
            this.logger.error(
                `requested app not found:  ${requestParams.app_id}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("App not found")
        }

        const appAllowdDomains = await this.prisma.app_registered_domain.findMany({ where: { app_id: appInfo.app_id } })

        const foundedDomain = appAllowdDomains.find((domain) => host.endsWith(domain.domain))
        if (!foundedDomain) {
            this.logger.error(`requested host not allowed: ${host}, requested params: ${JSON.stringify(requestParams)}`)
            throw new UnauthorizedException("Host not allowed")
        }

        if (!requestParams?.sign) {
            this.logger.error(
                `requested signature is required: ${host}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("Signature is required")
        }
        const signature: string = requestParams.sign
        delete requestParams.sign

        if (!requestParams?.timestamp) {
            this.logger.error(
                `requested timestamp is required: ${host}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("Timestamp is required")
        }

        if (
            requestParams.timestamp * 1000 < Date.now() - 1000 * 60 * 5 ||
            requestParams.timestamp * 1000 > Date.now() + 1000 * 60 * 5
        ) {
            // in 5 minutes
            this.logger.error(
                `requested timestamp expired: ${host}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("Timestamp expired")
        }

        const sortedKeys = Object.keys(requestParams)
            .filter((key) => key !== "sign" && requestParams[key] !== undefined && requestParams[key] !== null)
            .sort()
        const stringA = sortedKeys.map((key) => `${key}=${requestParams[key]}`).join(",")

        const stringSignTemp = `${stringA},key=${appInfo.app_secret}`

        const hash = crypto.createHash("md5").update(stringSignTemp).digest("hex").toUpperCase()

        if (signature !== hash) {
            this.logger.error(
                `requested signature not match: ${host}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("Signature not match")
        }
        return { host: foundedDomain.domain, app_id: appInfo.app_id }
    }

    async login(body: LoginDto, origin: string) {
        const { host, app_id } = await this.checkSignature(body, origin)
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
            token: this.jwtService.sign(
                {
                    host: host,
                    app_id: app_id,
                    email: body.email,
                },
                {
                    expiresIn: "5m",
                },
            ),
        }
    }

    async checkToken(body: CheckTokenDto): Promise<CheckTokenResponseDto> {
        let decoded: any
        try {
            decoded = this.jwtService.verify(body.token, {
                ignoreExpiration: true,
            })

            if (!decoded?.host || !decoded?.app_id || !decoded?.email) {
                throw new UnauthorizedException("Invalid token")
            }
        } catch (error) {
            throw new UnauthorizedException("Invalid token")
        }

        const user = await this.prisma.users.findUnique({ where: { email: decoded.email } })
        if (!user) {
            throw new UnauthorizedException("User not found")
        }

        //remove port from host
        const host = decoded.host.split(":")[0]

        const appTrusted = await this.prisma.user_trusted_apps.findFirst({
            where: { user: user.username_in_be, app_id: decoded.app_id, original: { endsWith: host } },
        })
        if (!appTrusted || !appTrusted.is_trusted) {
            return {
                is_bind: false,
                access_token: "",
                host: host,
                email: user.email,
            }
        }

        const userProfile = await this.userService.getProfile({
            username: user.username,
            email: user.email,
            usernameShorted: user.username_in_be,
            emailConfirmed: user.email_confirmed,
            app_id: decoded.app_id,
        })
        const accessToken = await this.authUserService.login(userProfile)
        return {
            is_bind: true,
            access_token: accessToken.access_token,
            host: host,
            email: user.email,
        }
    }

    async sendBindCode(body: GetBindCodeDto): Promise<GetBindCodeResponseDto> {
        try {
            // Find the user
            const user = await this.prisma.users.findUnique({
                where: { email: body.email },
            })

            if (!user) {
                throw new BadRequestException("User not found")
            }

            // Check if this app is already trusted
            const existingTrust = await this.prisma.user_trusted_apps.findFirst({
                where: {
                    user: user.username_in_be,
                    app_id: body.app_id,
                    original: body.host,
                },
            })

            if (existingTrust && existingTrust.is_trusted) {
                return {
                    success: false,
                    message: "App is already trusted",
                }
            }

            // Check rate limit - only one request per minute
            if (existingTrust && existingTrust.confirm_code_requested_at) {
                const oneMinuteAgo = new Date(Date.now() - 60 * 1000)
                if (existingTrust.confirm_code_requested_at > oneMinuteAgo) {
                    return {
                        success: false,
                        message: "Please wait 1 minute before requesting another code",
                    }
                }
            }

            // Generate a random 6-digit code
            const code = Math.floor(100000 + Math.random() * 900000).toString()
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

            // Save or update the trust record with the code
            if (existingTrust) {
                await this.prisma.user_trusted_apps.update({
                    where: { id: existingTrust.id },
                    data: {
                        confirm_code: code,
                        confirm_code_expire: expiresAt,
                        confirm_code_requested_at: new Date(),
                    },
                })
            } else {
                await this.prisma.user_trusted_apps.create({
                    data: {
                        user: user.username_in_be,
                        app_id: body.app_id,
                        original: body.host,
                        is_trusted: false,
                        confirm_code: code,
                        confirm_code_expire: expiresAt,
                        confirm_code_requested_at: new Date(),
                    },
                })
            }

            // Send email with the code
            await this.notificationService.sendNotification(
                "[Giggle] App Login Verification Code",
                body.email,
                "app_bind_code",
                {
                    host: body.host,
                    email: body.email,
                    code: code,
                },
                "mail.giggle.pro",
                "Giggle.Pro <app-noreply@giggle.pro>",
            )

            return {
                success: true,
                message: "Verification code sent to your email",
            }
        } catch (error) {
            console.error("Error sending bind code:", error)
            return {
                success: false,
                message: error.message || "Failed to send verification code",
            }
        }
    }

    async confirmBindApp(body: ConfirmBindDto): Promise<ConfirmBindResponseDto> {
        try {
            // Find the user
            const user = await this.prisma.users.findUnique({
                where: { email: body.email },
            })

            if (!user) {
                throw new BadRequestException("User not found")
            }

            const app = await this.prisma.apps.findUnique({
                where: { app_id: body.app_id },
            })

            if (!app) {
                throw new BadRequestException("App not found")
            }

            // Find the trust record
            const trustRecord = await this.prisma.user_trusted_apps.findFirst({
                where: {
                    user: user.username_in_be,
                    app_id: body.app_id,
                    original: body.host,
                },
            })

            if (!trustRecord) {
                throw new BadRequestException("No bind request found")
            }

            // Check if code is correct
            if (trustRecord.confirm_code !== body.code) {
                throw new BadRequestException("Invalid code")
            }

            // Check if code is expired
            if (new Date() > trustRecord.confirm_code_expire) {
                throw new BadRequestException("Code has expired")
            }

            // Update the trust record
            await this.prisma.user_trusted_apps.update({
                where: { id: trustRecord.id },
                data: {
                    is_trusted: true,
                    confirm_code: null,
                    confirm_code_expire: null,
                    confirmed_time: new Date(),
                },
            })

            // Generate an access token
            const userProfile = await this.userService.getProfile({
                username: user.username,
                email: user.email,
                usernameShorted: user.username_in_be,
                emailConfirmed: user.email_confirmed,
                app_id: body.app_id,
            })

            const accessToken = await this.authUserService.login(userProfile)

            return {
                success: true,
                access_token: accessToken.access_token,
            }
        } catch (error) {
            console.error("Error confirming bind:", error)
            throw new BadRequestException(error.message || "Failed to confirm bind")
        }
    }
}
