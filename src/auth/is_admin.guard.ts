import { Injectable, ExecutionContext, ForbiddenException } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
@Injectable()
export class IsAdminGuard extends AuthGuard("jwt") {
    handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
        if (!user || !user.is_admin) {
            throw new ForbiddenException("You are not an admin")
        }
        return user
    }
}
