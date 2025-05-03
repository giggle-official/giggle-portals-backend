// src/auth/jwt.strategy.ts
import { ExtractJwt, Strategy } from "passport-jwt"
import { PassportStrategy } from "@nestjs/passport"
import { Injectable } from "@nestjs/common"
import { ApiKeyDTO, UserInfoDTO, UserJwtExtractDto } from "src/user/user.controller"
import { JwtService } from "@nestjs/jwt"
import { PrismaService } from "src/common/prisma.service"

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prismaService: PrismaService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                (req) => {
                    let authorization = req?.headers?.["authorization"]
                    const token = authorization?.split(" ")[1]
                    if (token) return token
                    return null
                },
            ]),
            ignoreExpiration: false,
            secretOrKey: process.env.SESSION_SECRET,
        })
    }

    async validate(payload: any): Promise<UserJwtExtractDto> {
        if (!payload?.usernameShorted) {
            return null
        }

        if (payload?.followers) {
            return null
        }
        const userInfo = await this.prismaService.users.findFirst({
            where: {
                username_in_be: payload.usernameShorted,
                is_blocked: false,
            },
        })

        if (!userInfo) {
            return null
        }

        return {
            username: payload?.username,
            usernameShorted: payload?.usernameShorted,
            email: payload?.email,
            avatar: payload?.avatar,
            device_id: payload?.device_id,
            is_developer: userInfo.is_developer,
            is_admin: userInfo.is_admin,
            widget_session_id: payload?.widget_session_id,
        }
    }
}
