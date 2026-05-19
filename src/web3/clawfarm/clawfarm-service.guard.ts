import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common"

@Injectable()
export class ClawfarmServiceGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const expected = process.env.CLAWFARM_SERVICE_KEY
        if (!expected) {
            throw new UnauthorizedException("Clawfarm service key not configured")
        }
        const request = context.switchToHttp().getRequest()
        const provided = request?.headers?.["x-clawfarm-service-key"]
        if (!provided || provided !== expected) {
            throw new UnauthorizedException("Invalid or missing x-clawfarm-service-key header")
        }
        return true
    }
}
