import { Injectable, ExecutionContext, ForbiddenException } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
@Injectable()
export class IsWidgetGuard extends AuthGuard("jwt") {
    handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
        if (!user.developer_info) {
            throw new ForbiddenException("You are not an authorized widget")
        }
        return user
    }
}
