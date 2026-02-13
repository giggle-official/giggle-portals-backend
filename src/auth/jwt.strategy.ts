// src/auth/jwt.strategy.ts
import { ExtractJwt, Strategy } from "passport-jwt"
import { PassportStrategy } from "@nestjs/passport"
import { Injectable, UnauthorizedException } from "@nestjs/common"
import { UserJwtExtractDto } from "src/user/user.controller"
import { PrismaService } from "src/common/prisma.service"
import { JwtService } from "@nestjs/jwt"

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly jwtService: JwtService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                (req) => {
                    const authorization = req?.headers?.["authorization"]
                    const appId = req?.headers?.["app-id"]
                    const apiKey = req?.headers?.["x-api-key"]
                    const token = authorization?.split(" ")[1]
                    if (apiKey) {
                        return this.jwtService.sign({ api_key: apiKey })
                    }
                    if (token) return this.jwtService.sign({ token: token, app_id: appId })
                    return null
                },
            ]),
            ignoreExpiration: false,
            secretOrKey: process.env.SESSION_SECRET,
        })
    }

    validateEmail(email: string): void {
        const emailDomain = email?.split("@")[1]
        const disabledDomain = process.env.DISABLED_EMAIL_DOMAINS?.split(",") || []
        if (emailDomain && disabledDomain.includes(emailDomain)) {
            throw new UnauthorizedException("This email domain is unavailable")
        }
    }

    async validateApiKey(apiKey: string): Promise<UserJwtExtractDto> {
        const apiKeyInfo = await this.prismaService.user_api_keys.findFirst({
            where: {
                api_key: apiKey,
            },
            include: {
                user_info: true
            }
        })
        if (!apiKeyInfo || apiKeyInfo.discarded) {
            throw new UnauthorizedException("Invalid api key")
        }

        if (apiKeyInfo.user_info.is_blocked) {
            throw new UnauthorizedException("User is blocked")
        }
        this.validateEmail(apiKeyInfo.user_info.email)
        return {
            user_id: apiKeyInfo.user_info.username_in_be,
            username: apiKeyInfo.user_info.username,
            usernameShorted: apiKeyInfo.user_info.username_in_be,
            email: apiKeyInfo.user_info.email,
            avatar: apiKeyInfo.user_info.avatar,
            wallet_address: apiKeyInfo.user_info.wallet_address,
            device_id: "",
            is_developer: apiKeyInfo.user_info.is_developer,
            is_admin: apiKeyInfo.user_info.is_admin,
            widget_session_id: null,
            app_id: apiKeyInfo.app_id,
            developer_info: null,
        }
    }

    async validate(payload: { token: string; app_id: string; api_key: string }): Promise<UserJwtExtractDto> {
        try {
            if (payload.api_key) {
                return this.validateApiKey(payload.api_key)
            }
            const extractedPayload = this.jwtService.decode(payload.token)
            //check if token is a widget access key
            if (extractedPayload?.iss && extractedPayload.iss.startsWith("wgt_ak_")) {
                const widgetInfo = await this.prismaService.widgets.findFirst({
                    where: {
                        access_key: extractedPayload.iss,
                    },
                })
                if (
                    widgetInfo &&
                    (await this.jwtService.verifyAsync(payload.token, { secret: widgetInfo.secret_key }))
                ) {
                    const userInfo = await this.prismaService.users.findFirst({
                        where: {
                            username_in_be: widgetInfo.author,
                        },
                    })
                    return {
                        user_id: userInfo.username_in_be,
                        username: userInfo.username,
                        usernameShorted: userInfo.username_in_be,
                        email: userInfo.email,
                        avatar: userInfo.avatar,
                        device_id: extractedPayload?.device_id,
                        is_developer: userInfo.is_developer,
                        is_admin: userInfo.is_admin,
                        widget_session_id: extractedPayload?.widget_session_id,
                        app_id: payload.app_id,
                        developer_info: {
                            usernameShorted: userInfo.username_in_be,
                            tag: widgetInfo.tag,
                        },
                    }
                }
            }

            await this.jwtService.verifyAsync(payload.token, { secret: process.env.SESSION_SECRET })

            if (!extractedPayload?.usernameShorted) {
                return null
            }
            const userInfo = await this.prismaService.users.findFirst({
                where: {
                    username_in_be: extractedPayload?.usernameShorted,
                    is_blocked: false,
                },
            })

            if (!userInfo) {
                return null
            }

            this.validateEmail(userInfo.email)

            return {
                user_id: userInfo.username_in_be,
                username: userInfo.username,
                usernameShorted: userInfo.username_in_be,
                email: userInfo.email,
                avatar: userInfo.avatar,
                wallet_address: userInfo.wallet_address,
                device_id: extractedPayload?.device_id,
                is_developer: userInfo.is_developer,
                is_admin: userInfo.is_admin,
                widget_session_id: extractedPayload?.widget_session_id,
                app_id: payload.app_id,
                developer_info: null,
            }
        } catch (error) {
            return null
        }
    }
}
