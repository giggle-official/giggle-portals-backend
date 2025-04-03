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

        let exceptionResponse = { message: "Internal server error" }
        let status = HttpStatus.INTERNAL_SERVER_ERROR

        if (exception instanceof HttpException) {
            exceptionResponse = exception.getResponse() as any
            status = exception.getStatus()
        } else {
            this.logger.error(request.method + " " + request.url + " " + exception)
        }

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
