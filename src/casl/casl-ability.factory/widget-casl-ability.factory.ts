import { AbilityBuilder, PureAbility, createMongoAbility } from "@casl/ability"
import { ConsoleLogger, Injectable } from "@nestjs/common"
import { z } from "zod"
import { PrismaService } from "src/common/prisma.service"

export enum WIDGET_PERMISSIONS_LIST {
    CAN_ISSUE_TOKEN = "can_issue_token",
    CAN_GET_USER_TOKEN = "can_get_user_token",
    CAN_GET_PLATFORM_REVENUE = "can_get_platform_revenue",
    CAN_AIRDROP = "can_airdrop",
}

export type WidgetRequestPermissions = {
    [key in keyof typeof WIDGET_PERMISSIONS_LIST]: boolean
}

const widgetPermissionSchema = z.enum(Object.values(WIDGET_PERMISSIONS_LIST) as [string, ...string[]])

export type WidgetPermissions = z.infer<typeof widgetPermissionSchema>

export type WidgetAbility = PureAbility<WidgetPermissions>

@Injectable()
export class WidgetCaslAbilityFactory {
    constructor(private readonly prisma: PrismaService) {}
    async createForWidget(widgetTag: string) {
        const { can, build } = new AbilityBuilder<WidgetAbility>(createMongoAbility)
        if (!widgetTag) return build()
        const widget = await this.prisma.widgets.findUnique({
            where: {
                tag: widgetTag,
            },
        })
        if (!widget) return build()
        const widgetPermissions = widget.request_permissions as WidgetRequestPermissions
        Object.values(WIDGET_PERMISSIONS_LIST).forEach((permission) => {
            if (widgetPermissions[permission]) {
                can(permission)
            }
        })
        return build()
    }
}
