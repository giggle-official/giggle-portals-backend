// src/common/decorators/bypass-interceptor.decorator.ts
import { SetMetadata } from "@nestjs/common"

export const BYPASS_INTERCEPTOR = "bypassInterceptor"
export const BypassInterceptor = () => SetMetadata(BYPASS_INTERCEPTOR, true)
