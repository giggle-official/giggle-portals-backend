import { Injectable, SetMetadata, CanActivate, ExecutionContext } from "@nestjs/common"
import { WidgetAbility, WidgetCaslAbilityFactory } from "../casl/casl-ability.factory/widget-casl-ability.factory"
import { Reflector } from "@nestjs/core"

interface IPolicyHandler {
    handle(ability: WidgetAbility): boolean
}

type PolicyHandlerCallback = (ability: WidgetAbility) => boolean

export type WidgetPolicyHandler = IPolicyHandler | PolicyHandlerCallback
export const CHECK_WIDGET_POLICIES_KEY = "check_widget_policy"
export const CheckWidgetPolicies = (...handlers: WidgetPolicyHandler[]) =>
    SetMetadata(CHECK_WIDGET_POLICIES_KEY, handlers)

@Injectable()
export class WidgetPoliciesGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private widgetCaslAbilityFactory: WidgetCaslAbilityFactory,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const policyHandlers =
            this.reflector.get<WidgetPolicyHandler[]>(CHECK_WIDGET_POLICIES_KEY, context.getHandler()) || []

        const { user } = context.switchToHttp().getRequest()
        const ability = await this.widgetCaslAbilityFactory.createForWidget(user.developer_info?.tag)
        return policyHandlers.every((handler) => this.execPolicyHandler(handler, ability))
    }

    private execPolicyHandler(handler: WidgetPolicyHandler, ability: WidgetAbility) {
        if (typeof handler === "function") {
            return handler(ability)
        }
        return handler.handle(ability)
    }
}
