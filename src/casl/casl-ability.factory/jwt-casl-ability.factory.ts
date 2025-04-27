import { AbilityBuilder, PureAbility, createMongoAbility } from "@casl/ability"
import { Injectable } from "@nestjs/common"
import { z } from "zod"
import { UserJwtExtractDto } from "src/user/user.controller"

export const PERMISSIONS_LIST = [
    {
        name: "Read Ip libraries",
        role: "read_ip",
    },
    {
        name: "Manage Ip libraries",
        role: "manage_ip",
    },
    {
        name: "Read Portal",
        role: "read_portal",
    },
    {
        name: "Manage Portal",
        role: "manage_portal",
    },
    {
        name: "Get User Info (Include wallet info)",
        role: "get_user_info",
    },
    {
        name: "Manage Wallet (Payment, Send, Receive)",
        role: "manage_wallet",
    },
] as const

export type RoleProperties = (typeof PERMISSIONS_LIST)[number]["role"]
export const ROLES: RoleProperties[] = PERMISSIONS_LIST.map((p) => p.role)

const permissionSchema = z.enum(["all", ...ROLES])

export type JwtPermissions = z.infer<typeof permissionSchema>

export type JwtAbility = PureAbility<JwtPermissions>

@Injectable()
export class JwtCaslAbilityFactory {
    async createForUser(user: UserJwtExtractDto) {
        const { can, build } = new AbilityBuilder<JwtAbility>(createMongoAbility)
        if (!user) return build()
        const permissionsList = permissionSchema._def.values
        //todo:
        /*if (user.permissions.includes("all")) {
            return build()
        }
        user.permissions.map((p) => can(p))*/
        permissionsList.map((p) => p !== "all" && can(p))
        return build()
    }
}
