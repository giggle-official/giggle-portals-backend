import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common"
import { ApiExcludeController } from "@nestjs/swagger"

@ApiExcludeController()
@Controller({ path: "api/healthz" })
export class AppController {
    @Get()
    @HttpCode(HttpStatus.OK)
    async health() {
        return {
            status: "ok",
        }
    }
}
