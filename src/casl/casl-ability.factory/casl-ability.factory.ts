import { AbilityBuilder, PureAbility, createMongoAbility } from "@casl/ability"
import { Injectable } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { z } from "zod"
import { AdminUserInfoDto } from "src/admin/auth/auth.dto"

export const PERMISSIONS_LIST = [
    {
        name: "Manage users",
        role: "manage_users",
    },
    {
        name: "Manage roles",
        role: "manage_roles",
    },
    {
        name: "Manage credits",
        role: "manage_credits",
    },
    {
        name: "Manage plans",
        role: "manage_plans",
    },
    {
        name: "Read Ip library",
        role: "read_ip_library",
    },
    {
        name: "Manage Ip library",
        role: "manage_ip_library",
    },
] as const

export type RoleProperties = (typeof PERMISSIONS_LIST)[number]["role"]
const ROLES: ["access_admin", ...RoleProperties[]] = ["access_admin", ...PERMISSIONS_LIST.map((p) => p.role)]

const permissionSchema = z.enum(ROLES)

export type Permissions = z.infer<typeof permissionSchema>

export type AppAbility = PureAbility<Permissions>

@Injectable()
export class CaslAbilityFactory {
    constructor(private readonly prisma: PrismaService) {}
    async createForUser(user: AdminUserInfoDto) {
        const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility)
        if (!user) return build()
        const userRecord = await this.prisma.users.findUnique({
            where: {
                username_in_be: user.usernameShorted,
                is_blocked: false,
            },
            include: {
                roles: {
                    include: {
                        role_detail: true,
                    },
                },
            },
        })

        if (userRecord.roles.length === 0) return build()
        can("access_admin")

        const roleRecord = userRecord.roles.find((r) => {
            return r.role_detail.id === user.currentRole
        })

        if (!roleRecord) return build()

        const permissionsList = permissionSchema._def.values.slice(1)
        const rolePermissionList = roleRecord.role_detail.permissions as any
        rolePermissionList.map((permission: any) => {
            if (
                //this indicate a super admin
                permission === "all"
            ) {
                permissionsList.map((p) => can(p))
                return
            } else {
                can(permission)
            }
        })

        return build()
    }
}
