import { ForbiddenException, Injectable } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { CreateWidgetDto } from "./widget.dto"
import { Prisma } from "@prisma/client"
import { UserInfoDTO } from "src/user/user.controller"

@Injectable()
export class WidgetsService {
    constructor(private readonly prisma: PrismaService) {}

    async createWidget(body: CreateWidgetDto, user: UserInfoDTO) {
        const userInfo = await this.prisma.users.findUnique({
            where: {
                username_in_be: user.usernameShorted,
            },
        })
        if (!userInfo || !userInfo.is_admin) {
            throw new ForbiddenException("You are not authorized to create a widget")
        }
        return await this.prisma.$transaction(async (tx) => {
            const widget = await tx.widgets.create({
                data: {
                    tag: body.tag,
                    name: body.name,
                    for_all_users: body.for_all_user,
                },
            })
            if (body.for_all_user) {
                const apps = await tx.apps.findMany()
                const createData: Prisma.app_bind_widgetsCreateManyInput[] = apps.map((app) => ({
                    app_id: app.app_id,
                    widget_tag: body.tag,
                    widget_configs: {
                        enabled: true,
                    },
                }))
                await tx.app_bind_widgets.createMany({
                    data: createData,
                })
            }
            return widget
        })
    }
}
