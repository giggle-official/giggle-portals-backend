// src/auth/jwt.strategy.ts
import { ExtractJwt, Strategy } from "passport-jwt"
import { PassportStrategy } from "@nestjs/passport"
import { Injectable } from "@nestjs/common"
import { ApiKeyDTO, UserInfoDTO } from "src/user/user.controller"
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
                    const apiKey = req?.headers?.["x-api-key"]
                    if (token) return token
                    if (apiKey) return this.jwtService.sign({ apiKey: req?.headers?.["x-api-key"] as string })
                    return null
                },
            ]),
            ignoreExpiration: false,
            secretOrKey: process.env.SESSION_SECRET,
        })
    }

    async validate(payload: UserInfoDTO & ApiKeyDTO): Promise<UserInfoDTO> {
        if (payload.apiKey) {
            //api key exists
            const apiKey = await this.prismaService.user_api_keys.findFirst({
                where: {
                    api_key: payload.apiKey,
                    discarded: false,
                },
                include: {
                    user_info: {
                        where: {
                            is_blocked: false,
                        },
                    },
                },
            })
            if (apiKey && apiKey?.user_info) {
                return {
                    username: apiKey.user_info.username,
                    usernameShorted: apiKey.user_info.username_in_be,
                    email: apiKey.user_info.email,
                }
            }

            //agent key exists
            const agentKey = await this.prismaService.users.findFirst({
                where: {
                    agent_user: payload.apiKey,
                    is_blocked: false,
                },
            })
            if (agentKey) {
                return {
                    username: agentKey.username,
                    usernameShorted: agentKey.username_in_be,
                    email: agentKey.email,
                }
            }

            //no key exists
            return null
        }
        if (!payload.permissions) {
            return null
        }
        return payload as UserInfoDTO
    }
}
