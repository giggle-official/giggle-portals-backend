import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from "@nestjs/common"
import { TransformInterceptor } from "./response.interceptor"

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(HttpExceptionFilter.name)
    constructor(private readonly transformInterceptor: TransformInterceptor<any>) {}
    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp()
        const request = ctx.getRequest()
        const response = ctx.getResponse()
        const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR

        this.logger.error(exception)
        const exceptionResponse =
            exception instanceof HttpException ? exception.getResponse() : { message: "Internal server error" }
        let msg: string = ""

        if (typeof exceptionResponse === "object") {
            msg = (exceptionResponse as any)?.message.toString() || exception.message
        } else {
            msg = exceptionResponse
        }

        if (request.method === "POST") {
            this.transformInterceptor.recordLog(request, msg, status)
        }

        // custom error response structure
        response.status(status).json({
            code: status,
            msg: msg,
            data: null,
        })
    }
}
