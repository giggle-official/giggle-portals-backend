import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common"
import { UserInfoDTO } from "src/user/user.controller"
import { JwtService } from "@nestjs/jwt"
import { PrismaService } from "src/common/prisma.service"
import { UserService } from "src/user/user.service"
import { EmailConfirmationDto, LoginResponseDTO } from "./auth.dto"
import { Request } from "express"
@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
        private prismaService: PrismaService,
    ) {}

    async verifyUserInfo(user: UserInfoDTO, secretKey: string): Promise<UserInfoDTO> {
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

    async login(userInfo: UserInfoDTO): Promise<LoginResponseDTO> {
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

    async getUserInfoByToken(access_token: string): Promise<UserInfoDTO> {
        return (this.jwtService.decode(access_token) as UserInfoDTO) || null
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
}
