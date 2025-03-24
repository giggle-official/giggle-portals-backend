import { BadRequestException, Injectable } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { FindOneParam, ListParams, ListResDto } from "../request.dto"
import { PERMISSIONS_LIST } from "src/casl/casl-ability.factory/casl-ability.factory"
import { UserInfoDTO } from "src/user/user.controller"
import { CreateRoleDto, DeleteRoleDto, UpdateRoleDto } from "./roles.dto"
import { user_roles } from "@prisma/client"

@Injectable()
export class RolesService {
    constructor(private prisma: PrismaService) {}
    async list(query: ListParams): Promise<ListResDto<any[]>> {
        const orderBy = {
            [query.sort.field]: query.sort.order.toLowerCase() as "asc" | "desc",
        }
        const [list, count] = await this.prisma.$transaction([
            this.prisma.roles.findMany({
                skip: (parseInt(query.pagination.page) - 1) * parseInt(query.pagination.perPage),
                take: parseInt(query.pagination.perPage),
                select: {
                    id: true,
                    name: true,
                    permissions: true,
                    created_at: true,
                },
                orderBy: orderBy,
            }),
            this.prisma.roles.count(),
        ])
        const roleList = list.map((r) => ({
            ...r,
            permissions: (r.permissions as string[]).map((p: string) => {
                return this._getPermissionName(p)
            }),
        }))
        return {
            list: roleList,
            count: count,
        }
    }

    async update(userInfo: UserInfoDTO, roleInfo: UpdateRoleDto) {
        const record = await this.prisma.roles.findUnique({
            where: {
                id: parseInt(roleInfo.id),
            },
            include: {
                assigned_users: true,
            },
        })
        if (!record) throw new BadRequestException("role not found")

        const namedRecord = await this.prisma.roles.findFirst({
            where: {
                NOT: {
                    id: parseInt(roleInfo.id),
                },
                name: roleInfo.name,
            },
        })
        if (namedRecord) throw new BadRequestException("this name of role alreay exists")
        const users = roleInfo.users.map((uid) => ({
            role_id: parseInt(roleInfo.id),
            username_in_be: uid,
            assigned_by: userInfo.usernameShorted,
        }))
        const [result] = await this.prisma.$transaction([
            this.prisma.roles.update({
                data: {
                    name: roleInfo.name,
                    permissions: roleInfo.permissions,
                },
                where: {
                    id: record.id,
                },
            }),
            this.prisma.audit_logs.create({
                data: {
                    user: userInfo.usernameShorted,
                    request: "update.role",
                    params: JSON.stringify({
                        previous: record,
                        new: roleInfo,
                    }),
                },
            }),
            this.prisma.user_roles.deleteMany({
                where: {
                    role_id: parseInt(roleInfo.id),
                },
            }),
            this.prisma.user_roles.createMany({
                data: users,
            }),
        ])
        return result
    }

    async create(userInfo: UserInfoDTO, roleInfo: CreateRoleDto) {
        const namedRecord = await this.prisma.roles.findFirst({
            where: {
                name: roleInfo.name,
            },
        })
        if (namedRecord) throw new BadRequestException("role alreay exists")

        const result = await this.prisma.$transaction(async (tx) => {
            const newRole = await tx.roles.create({
                data: {
                    name: roleInfo.name,
                    permissions: roleInfo.permissions,
                },
            })
            if (!newRole) throw new BadRequestException("create role fail")
            const users = roleInfo.users.map((uid) => ({
                role_id: newRole.id,
                username_in_be: uid,
                assigned_by: userInfo.usernameShorted,
            }))

            await tx.user_roles.createMany({
                data: users,
            })
            await tx.audit_logs.create({
                data: {
                    user: userInfo.usernameShorted,
                    request: "create.role",
                    params: JSON.stringify(roleInfo),
                },
            })
            return newRole
        })

        return result
    }

    async delete(userInfo: UserInfoDTO, roleInfo: DeleteRoleDto) {
        const roleRecord = await this.prisma.roles.findUnique({
            where: {
                id: parseInt(roleInfo.id),
            },
            include: {
                assigned_users: true,
            },
        })
        if (!roleRecord) throw new BadRequestException("role not found")

        const assignedUser = await this.prisma.user_roles.findFirst({
            where: {
                role_id: parseInt(roleInfo.id),
            },
        })
        if (assignedUser) throw new BadRequestException("remove assigned user first")

        const [result] = await this.prisma.$transaction([
            this.prisma.roles.delete({
                where: {
                    id: parseInt(roleInfo.id),
                },
            }),
            this.prisma.audit_logs.create({
                data: {
                    user: userInfo.usernameShorted,
                    request: "delete.role",
                    params: JSON.stringify(roleRecord),
                },
            }),
        ])
        return result
    }

    async findOne(param: FindOneParam) {
        const record = await this.prisma.roles.findUnique({
            where: {
                id: parseInt(param.id),
            },
            include: {
                assigned_users: {
                    select: {
                        username_in_be: true,
                    },
                },
            },
        })
        if (!record) throw new BadRequestException("record not found")
        const users = record.assigned_users.map((user) => {
            return user.username_in_be
        })
        delete record.assigned_users
        return { ...record, users: users }
    }

    async listPermissions(query: ListParams): Promise<ListResDto<any[]>> {
        return {
            list: [
                { id: "all", name: "All Permissions" },
                ...(PERMISSIONS_LIST.map((p) => ({ id: p.role, name: p.name })) as any),
            ],
            count: PERMISSIONS_LIST.length,
        }
    }

    async listUsers(query: ListParams): Promise<ListResDto<any[]>> {
        const record = await this.prisma.users.findMany({
            select: {
                username_in_be: true,
                username: true,
                email: true,
            },
        })
        return {
            list: record.map((u) => ({ id: u.username_in_be, name: u.email ? u.email : u.username })),
            count: record.length,
        }
    }

    private _getPermissionName(permission: string) {
        if (permission === "all") return "All Permissions"
        return PERMISSIONS_LIST.find((p) => p.role === permission)?.name || "Unknow"
    }
}
