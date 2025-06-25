import { BadRequestException, Injectable, UnauthorizedException, Logger } from "@nestjs/common"
import {
    CheckTokenDto,
    CheckTokenResponseDto,
    ConfirmBindDto,
    ConfirmBindResponseDto,
    GetBindCodeDto,
    GetBindCodeResponseDto,
    LoginDto,
    WidgetAuthDto,
} from "./auto.dto"
import { PrismaService } from "src/common/prisma.service"
import crypto from "crypto"
import { JwtService } from "@nestjs/jwt"
import { UserService } from "src/user/user.service"
import { CreateUserDto, UserJwtExtractDto } from "src/user/user.controller"
import { AuthService as AuthUserService } from "src/auth/auth.service"
import { NotificationService } from "src/notification/notification.service"

@Injectable()
export class AuthService {
    private readonly authWidgetTag = "login_from_external"
    private readonly logger = new Logger(AuthService.name)
    private readonly appDomainWhiteList: string[] = []
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly userService: UserService,
        private readonly authUserService: AuthUserService,
        private readonly notificationService: NotificationService,
    ) {
        this.appDomainWhiteList = process.env.APP_DOMAIN_WHITELIST.split(",")
    }

    async checkSignature(
        requestParams: Record<string, any>,
        origin: string,
    ): Promise<{ host: string; app_id: string }> {
        //remove port from host
        if (!origin) {
            this.logger.error(`header origin is required, requested params: ${JSON.stringify(requestParams)}`)
            throw new UnauthorizedException("Origin in header is required")
        }
        this.logger.log(`requested origin: ${origin}, requested params: ${JSON.stringify(requestParams)}`)
        const urlObj = new URL(origin)
        const host = urlObj.hostname
        if (!requestParams?.app_id) {
            this.logger.error(`requested app id is required, requested params: ${JSON.stringify(requestParams)}`)
            throw new UnauthorizedException("App id is required")
        }
        const appInfo = await this.prisma.apps.findUnique({ where: { app_id: requestParams.app_id } })
        if (!appInfo) {
            this.logger.error(
                `requested app not found:  ${requestParams.app_id}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("App not found")
        }

        const bindRecord = await this.prisma.app_bind_widgets.findFirst({
            where: {
                widget_tag: this.authWidgetTag,
                app_id: appInfo.app_id,
            },
            select: {
                widget_configs: true,
            },
        })
        if (!bindRecord) {
            this.logger.error(
                `requested app not allowed:  ${requestParams.app_id}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("App not allowed")
        }

        const widgetConfig: WidgetAuthDto = bindRecord.widget_configs as unknown as WidgetAuthDto
        if (!widgetConfig.public?.allowed_domains || !widgetConfig.private?.secret_key) {
            this.logger.error(
                `requested app not allowed:  ${requestParams.app_id}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("App not allowed")
        }

        const appAllowdDomains = [...widgetConfig.public.allowed_domains, ...this.appDomainWhiteList]
        const foundedDomain = appAllowdDomains.find((domain) => host.endsWith(domain))
        if (!foundedDomain) {
            this.logger.error(`requested host not allowed: ${host}, requested params: ${JSON.stringify(requestParams)}`)
            throw new UnauthorizedException("Host not allowed")
        }

        if (!requestParams?.sign) {
            this.logger.error(`requested signature is required, requested params: ${JSON.stringify(requestParams)}`)
            throw new UnauthorizedException("Signature is required")
        }
        const signature: string = requestParams.sign
        delete requestParams.sign

        if (!requestParams?.timestamp) {
            this.logger.error(`requested timestamp is required, requested params: ${JSON.stringify(requestParams)}`)
            throw new UnauthorizedException("Timestamp is required")
        }

        if (
            requestParams.timestamp * 1000 < Date.now() - 1000 * 60 * 5 ||
            requestParams.timestamp * 1000 > Date.now() + 1000 * 60 * 5
        ) {
            // in 5 minutes
            this.logger.error(`requested timestamp expired, requested params: ${JSON.stringify(requestParams)}`)
            throw new UnauthorizedException("Timestamp expired")
        }

        const sortedKeys = Object.keys(requestParams)
            .filter((key) => key !== "sign" && requestParams[key] !== undefined && requestParams[key] !== null)
            .sort()
        const stringA = sortedKeys.map((key) => `${key}=${requestParams[key]}`).join(",")

        const stringSignTemp = `${stringA},key=${widgetConfig.private.secret_key}`

        const hash = crypto.createHash("md5").update(stringSignTemp).digest("hex").toUpperCase()

        if (signature !== hash) {
            this.logger.error(
                `requested signature not match: ${signature}, expected: ${hash}, requested params: ${JSON.stringify(requestParams)}`,
            )
            throw new UnauthorizedException("Signature not match")
        }
        return { host: foundedDomain, app_id: appInfo.app_id }
    }

    async login(body: LoginDto, origin: string) {
        const { host, app_id } = await this.checkSignature(body, origin)
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

        let user = await this.prisma.users.findUnique({ where: { email: decoded.email } })
        //create user if not exists
        if (!user) {
            //find source link
            const sourceLink = await this.prisma.link_devices.findFirst({
                where: {
                    device_id: body.device_id,
                },
            })

            const userNameShorted = this.userService.generateShortName()
            const username = decoded.email.split("@")[0]
            const newUserInfo: CreateUserDto = {
                user_id: userNameShorted,
                username: username,
                password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                email: decoded.email,
                usernameShorted: userNameShorted,
                app_id: decoded.app_id,
                from_source_link: sourceLink?.link_id || "",
                from_device_id: body.device_id,
            }
            await this.userService.createUser(newUserInfo)
            user = await this.prisma.users.findUnique({ where: { email: decoded.email } })
        }

        //remove port from host
        const host = decoded.host.split(":")[0]

        if (!this.appDomainWhiteList.includes(host)) {
            //not in white list, need bind app first
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
        }

        const userJwtInfo: UserJwtExtractDto = {
            user_id: user.username_in_be,
            username: user.username,
            usernameShorted: user.username_in_be,
            email: user.email,
            device_id: body.device_id,
        }
        const accessToken = await this.authUserService.login(userJwtInfo)
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
            this.logger.error("Error sending bind code:", error)
            throw new BadRequestException(error.message || "Failed to send verification code")
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

            const accessToken = await this.authUserService.login({
                user_id: user.username_in_be,
                username: user.username,
                email: user.email,
                usernameShorted: user.username_in_be,
                device_id: body.device_id,
            })

            return {
                success: true,
                access_token: accessToken.access_token,
            }
        } catch (error) {
            this.logger.error(
                `Error confirming bind: ${JSON.stringify(error)}, requested params: ${JSON.stringify(body)}`,
            )
            throw new BadRequestException(error.message || "Failed to confirm bind")
        }
    }
}
