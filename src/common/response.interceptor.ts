import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { async, Observable } from "rxjs"
import { map } from "rxjs/operators"
import { BYPASS_INTERCEPTOR } from "./bypass-interceptor.decorator"
import { LogsService } from "src/user/logs/logs.service"
import { UserInfoDTO } from "src/user/user.controller"
import { ProductType } from "src/credit/credit.dto"
import { NO_LOG } from "./bypass-nolog.decorator"

export interface Response<T> {
    code: number
    msg: string
    data: T
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
    constructor(
        private reflector: Reflector,
        private readonly logsService: LogsService,
    ) {}
    intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
        const bypassInterceptor = this.reflector.get(BYPASS_INTERCEPTOR, context.getHandler())
        const noLogInterceptor = this.reflector.get(NO_LOG, context.getHandler())
        const request = context.switchToHttp().getRequest()
        const response = context.switchToHttp().getResponse()
        let status = context.switchToHttp().getResponse().statusCode

        if (status === 201) {
            status = 200
            response.status(200)
        }

        if (bypassInterceptor) {
            if (request.method === "POST" && !noLogInterceptor) {
                this.recordLog(request, response, status)
            }
            return next.handle()
        }
        return next.handle().pipe(
            map((data) => {
                //record post request log
                if (request.method === "POST" && !noLogInterceptor) {
                    this.recordLog(request, data, status)
                }
                return {
                    code: status,
                    msg: data?.message || "ok",
                    data: data || {},
                }
            }),
        )
    }

    async recordLog(request: any, data: any, status: number) {
        let product: ProductType | "web" | "openapi" = "web"
        if (request?.headers?.["x-api-key"]) {
            product = "openapi"
        }
        this.logsService.create((request?.user as UserInfoDTO) || { usernameShorted: "" }, {
            product: product,
            action: (request?.method + " " + request?.path).substring(0, 4095),
            detail: {
                request: {
                    path: request?.path,
                    method: request?.method,
                    body: request?.body,
                    query: request?.query,
                    params: request?.params,
                    headers: request?.headers,
                },
                response: {
                    status: status,
                    data: data,
                },
            },
            status: status,
        })
    }
}
