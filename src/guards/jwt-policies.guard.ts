import { Injectable, SetMetadata, CanActivate, ExecutionContext } from "@nestjs/common"
import { JwtAbility, JwtCaslAbilityFactory } from "../casl/casl-ability.factory/jwt-casl-ability.factory"
import { Reflector } from "@nestjs/core"

interface IPolicyHandler {
    handle(ability: JwtAbility): boolean
}

type PolicyHandlerCallback = (ability: JwtAbility) => boolean

export type JwtPolicyHandler = IPolicyHandler | PolicyHandlerCallback
export const CHECK_JWT_POLICIES_KEY = "check_jwt_policy"
export const CheckJwtPolicies = (...handlers: JwtPolicyHandler[]) => SetMetadata(CHECK_JWT_POLICIES_KEY, handlers)

@Injectable()
export class JwtPoliciesGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private jwtCaslAbilityFactory: JwtCaslAbilityFactory,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const policyHandlers =
            this.reflector.get<JwtPolicyHandler[]>(CHECK_JWT_POLICIES_KEY, context.getHandler()) || []

        const { user } = context.switchToHttp().getRequest()
        const ability = await this.jwtCaslAbilityFactory.createForUser(user)
        return policyHandlers.every((handler) => this.execPolicyHandler(handler, ability))
    }

    private execPolicyHandler(handler: JwtPolicyHandler, ability: JwtAbility) {
        if (typeof handler === "function") {
            return handler(ability)
        }
        return handler.handle(ability)
    }
}
