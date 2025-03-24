import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Inject } from "@nestjs/common"
import { TransformInterceptor } from "./response.interceptor"

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
    constructor(private readonly transformInterceptor: TransformInterceptor<any>) {}
    catch(exception: HttpException, host: ArgumentsHost) {
        const ctx = host.switchToHttp()
        const request = ctx.getRequest()
        const response = ctx.getResponse()
        const status = exception.getStatus()
        const exceptionResponse = exception.getResponse()
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
