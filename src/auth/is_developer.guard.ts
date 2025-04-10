import { Injectable, ExecutionContext, ForbiddenException } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"

@Injectable()
export class IsDeveloperGuard extends AuthGuard("jwt") {
    handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
        if (!user || !user.is_developer) {
            throw new ForbiddenException("You are not an authorized developer")
        }
        return user
    }
}
