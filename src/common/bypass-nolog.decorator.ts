// src/common/decorators/bypass-interceptor.decorator.ts
import { SetMetadata } from "@nestjs/common"

export const NO_LOG = "noLog"
export const NologInterceptor = () => SetMetadata(NO_LOG, true)
