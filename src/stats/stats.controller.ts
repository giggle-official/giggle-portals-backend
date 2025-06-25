import { Controller, Post, Body } from "@nestjs/common"
import { StatsService } from "./stats.service"
import { ApiExcludeController } from "@nestjs/swagger"
import { AppendAccessLogDto } from "./stats.dto"

@Controller("/api/v1/stats")
@ApiExcludeController()
export class StatsController {
    constructor(private readonly statsService: StatsService) {}

    @Post("/access-log")
    async appendAccessLog(@Body() body: AppendAccessLogDto) {
        return this.statsService.appendAccessLog(body)
    }
}
