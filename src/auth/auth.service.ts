import { BadRequestException, forwardRef, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common"
import { CreateUserDto, UserJwtExtractDto } from "src/user/user.controller"
import { JwtService } from "@nestjs/jwt"
import { PrismaService } from "src/common/prisma.service"
import { UserService } from "src/user/user.service"
import { EmailConfirmationDto, GoogleLoginConfigDto, LoginResponseDTO } from "./auth.dto"
import { JwtPermissions } from "src/casl/casl-ability.factory/jwt-casl-ability.factory"
import { lastValueFrom } from "rxjs"
import { HttpService } from "@nestjs/axios"
import { HttpsProxyAgent } from "https-proxy-agent"
import axios, { AxiosResponse } from "axios"
import https from "https"
import crypto from "crypto"
import { LinkService } from "src/open-app/link/link.service"

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name)
    constructor(
        private jwtService: JwtService,
        private prismaService: PrismaService,
        private googleLoginhttpService: HttpService,

        @Inject(forwardRef(() => UserService))
        private userService: UserService,

        @Inject(forwardRef(() => LinkService))
        private readonly linkService: LinkService,
    ) {
        if (process.env.HTTP_PROXY) {
            this.googleLoginhttpService = new HttpService(
                axios.create({
                    httpsAgent: new HttpsProxyAgent(process.env.HTTP_PROXY, { keepAlive: false }),
                }),
            )
        } else {
            this.googleLoginhttpService = new HttpService(
                axios.create({
                    httpsAgent: new https.Agent({ keepAlive: false }),
                }),
            )
        }
    }

    async verifyUserInfo(user: UserJwtExtractDto, secretKey: string): Promise<UserJwtExtractDto> {
        const userInfo = await this.prismaService.users.findFirst({
            where: {
                username_in_be: user.usernameShorted,
                password: UserService.cryptoString(secretKey),
            },
        })
        if (!userInfo) {
            return null
        }
        return user
    }

    async login(userInfo: UserJwtExtractDto, permissions?: JwtPermissions[]): Promise<LoginResponseDTO> {
        // Check if the user is blocked
        const user = await this.prismaService.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })

        if (!user || user.is_blocked) {
            throw new UnauthorizedException("User not exists")
        }

        const access_token = this.jwtService.sign(userInfo)
        return { access_token: access_token }
    }

    async getUserInfoByToken(access_token: string): Promise<UserJwtExtractDto> {
        return (this.jwtService.decode(access_token) as UserJwtExtractDto) || null
    }

    async confirmEmail(confirmInfo: EmailConfirmationDto) {
        const user = await this.prismaService.users.findFirst({
            where: {
                email: confirmInfo.email,
                email_confirm_token: confirmInfo.token,
            },
        })
        if (!user) {
            throw new BadRequestException("Invalid token")
        }

        if (user.email_confirmed) {
            throw new BadRequestException("Email already confirmed")
        }

        const hoursAgo24 = new Date()
        hoursAgo24.setHours(hoursAgo24.getHours() - 24)

        if (user.email_confirm_token_created_at < hoursAgo24) {
            throw new BadRequestException("Token expired")
        }

        await this.prismaService.users.update({
            where: {
                id: user.id,
            },
            data: {
                email_confirmed: true,
            },
        })
        return {}
    }

    async exchangeCode(code: string, app_id: string, device_id: string, invite_code?: string) {
        try {
            const tokenResponse = await lastValueFrom(
                this.googleLoginhttpService.post(
                    "https://oauth2.googleapis.com/token",
                    {
                        client_id: process.env.GOOGLE_CLIENT_ID!,
                        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                        code: code,
                        grant_type: "authorization_code",
                        redirect_uri: process.env.GOOGLE_CALLBACK_URL!,
                    },

                    {
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                        timeout: 10000, // 10 seconds
                    },
                ),
            )

            if (tokenResponse.status !== 200) {
                this.logger.error("Google token exchange failed: code: " + code, tokenResponse.data)
                throw new BadRequestException("Failed to exchange code for tokens")
            }

            const tokens = tokenResponse.data

            // Get user info from Google
            const userResponse: AxiosResponse<{
                email: string
            }> = await lastValueFrom(
                this.googleLoginhttpService.get("https://www.googleapis.com/oauth2/v3/userinfo", {
                    headers: {
                        Authorization: `Bearer ${tokens.access_token}`,
                    },
                    timeout: 10000, // 10 seconds
                }),
            )

            if (userResponse.status !== 200 || !userResponse.data.email) {
                this.logger.error("Google user info failed: code: " + code, userResponse.data)
                throw new BadRequestException("Failed to get user info")
            }

            const userInfo = userResponse.data

            let invited_by = ""
            if (invite_code) {
                const inviteUser = await this.prismaService.users.findFirst({
                    where: {
                        invite_code: invite_code,
                    },
                })
                invited_by = inviteUser?.username_in_be || ""
            }

            let user = await this.prismaService.users.findFirst({
                where: {
                    email: userInfo.email,
                },
            })
            if (!user) {
                const userNameShorted = this.userService.generateShortName()
                const username = userInfo.email.split("@")[0]
                const newUserInfo: CreateUserDto = {
                    user_id: userNameShorted,
                    username: username,
                    password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                    email: userInfo.email,
                    usernameShorted: userNameShorted,
                    app_id: app_id,
                    from_source_link: "",
                    from_device_id: device_id,
                    can_create_ip: invited_by ? true : false,
                    invited_by: invited_by,
                }
                if (device_id) {
                    //update register source link
                    const sourceLink = await this.linkService.getLinkByDeviceId(device_id)
                    newUserInfo.from_source_link = sourceLink
                }
                const createdUser = await this.userService.createUser(newUserInfo)
                user = await this.prismaService.users.findUnique({
                    where: {
                        username_in_be: createdUser.usernameShorted,
                    },
                })
            }

            //we need to update the can_create_ip to true if the user is invited by someone
            if (!user.can_create_ip && invited_by) {
                await this.prismaService.users.update({
                    where: {
                        username_in_be: user.username_in_be,
                    },
                    data: {
                        can_create_ip: true,
                    },
                })
            }

            return await this.login({
                user_id: user.username_in_be,
                username: user.username,
                usernameShorted: user.username_in_be,
                email: user.email,
                avatar: user.avatar,
                device_id: device_id,
            })
        } catch (error) {
            this.logger.error("Google token exchange failed: code: " + code, error)
            throw new BadRequestException("Failed to exchange code for tokens")
        }
    }
}
