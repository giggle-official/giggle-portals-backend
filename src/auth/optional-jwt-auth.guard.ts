import { Injectable, ExecutionContext } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
    // Override handleRequest to not throw an error if validation fails
    handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
        // Return the user or null instead of throwing an error
        return user || null
    }

    // We need to override canActivate because the base implementation
    // will still throw an exception if super.canActivate() fails
    async canActivate(context: ExecutionContext): Promise<boolean> {
        try {
            // Attempt to authenticate the user
            await super.canActivate(context)
        } catch (error) {
            // Ignore authentication errors
        }

        // Always return true to allow the request to proceed
        return true
    }
}
