import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { Request, Response } from "express"
import { JwtService } from "@nestjs/jwt"
import { UserJwtExtractDto } from "src/user/user.controller"
import { CaslAbilityFactory } from "src/casl/casl-ability.factory/casl-ability.factory"
import { UserService } from "src/user/user.service"
import { AdminUserInfoDto, SwitchRoleDto } from "./auth.dto"

@Injectable()
export class AdminAuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private abilitiesFactory: CaslAbilityFactory,
        private userService: UserService,
    ) {}
    async login(req: Request, res: Response, asRole: number | undefined = undefined) {
        const userAbilities = await this.abilitiesFactory.createForUser(req.user as UserJwtExtractDto)
        if (!userAbilities.can("access_admin")) {
            throw new ForbiddenException("You don't have permission to this resource")
        }
        const userInfo = req.user as UserJwtExtractDto
        if (!asRole) {
            const userRoles = await this.prisma.user_roles.findMany({
                where: {
                    username_in_be: userInfo.usernameShorted,
                },
                select: {
                    role_detail: {
                        select: { id: true, name: true },
                    },
                },
            })
            asRole = userRoles.length > 0 ? userRoles[0].role_detail.id : null
        } else {
            const userRoleExists = await this.prisma.user_roles.findFirst({
                where: {
                    username_in_be: userInfo.usernameShorted,
                    role_id: asRole,
                },
            })
            if (!userRoleExists) throw new BadRequestException("you have no permission switch to this role")
        }
        const access_token = this.jwtService.sign({
            username: userInfo.username,
            usernameShorted: userInfo.usernameShorted,
            email: userInfo.email,
            avatar: userInfo.avatar,
            currentRole: asRole,
        })
        res.cookie("access_token", access_token, {
            path: "/",
            maxAge: 24 * 3600 * 1000,
        })

        await this.prisma.admin_logs.create({
            data: {
                action: "login",
                user: userInfo.usernameShorted,
                data: { ip: req.ip, role: asRole },
            },
        })
        return { access_token: access_token }
    }

    async logout(req: Request, res: Response) {
        res.clearCookie("access_token", {
            path: "/",
            maxAge: 24 * 3600 * 1000,
        })
        return {}
    }

    async profile(req: Request) {
        return this.userService.getProfile(req.user as UserJwtExtractDto)
    }

    async permissions(req: Request) {
        const userInfo = req.user as AdminUserInfoDto
        const userAbilities = await this.abilitiesFactory.createForUser(userInfo)
        const userRoles = await this.prisma.user_roles.findMany({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
            include: {
                role_detail: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        })
        return {
            can: userAbilities.rules.map((r) => r.action),
            profile: req.user,
            availableRole: userRoles.map((r) => {
                return r.role_detail
            }),
        }
    }

    async switchRole(req: Request, res: Response, roleInfo: SwitchRoleDto) {
        return this.login(req, res, roleInfo.role_id)
    }
}
