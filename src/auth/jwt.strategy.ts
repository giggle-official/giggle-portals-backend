// src/auth/jwt.strategy.ts
import { ExtractJwt, Strategy } from "passport-jwt"
import { PassportStrategy } from "@nestjs/passport"
import { Injectable } from "@nestjs/common"
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
                    let authorization = req?.headers?.["authorization"]
                    const token = authorization?.split(" ")[1]
                    if (token) return this.jwtService.sign({ token: token })
                    return null
                },
            ]),
            ignoreExpiration: false,
            secretOrKey: process.env.SESSION_SECRET,
        })
    }

    async validate(payload: { token: string }): Promise<UserJwtExtractDto> {
        try {
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
                        username: userInfo.username,
                        usernameShorted: userInfo.username_in_be,
                        email: userInfo.email,
                        avatar: userInfo.avatar,
                        device_id: extractedPayload?.device_id,
                        is_developer: userInfo.is_developer,
                        is_admin: userInfo.is_admin,
                        widget_session_id: extractedPayload?.widget_session_id,
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

            return {
                username: userInfo.username,
                usernameShorted: userInfo.username_in_be,
                email: userInfo.email,
                avatar: userInfo.avatar,
                wallet_address: userInfo.wallet_address,
                device_id: extractedPayload?.device_id,
                is_developer: userInfo.is_developer,
                is_admin: userInfo.is_admin,
                widget_session_id: extractedPayload?.widget_session_id,
                developer_info: null,
            }
        } catch (error) {
            return null
        }
    }
}
