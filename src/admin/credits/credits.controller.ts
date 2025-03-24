import { Controller, Get, Post, HttpCode, Body, Query, UseGuards, HttpStatus } from "@nestjs/common"
import { ApiExcludeController } from "@nestjs/swagger"
import { CreditsService } from "./credits.service"
import { AuthGuard } from "@nestjs/passport"
import { CheckPolicies } from "src/guards/policies.guard"
import { ListParams } from "../request.dto"
import { IssueCreditDto } from "src/credit/credit.dto"

@ApiExcludeController()
@Controller("/api/v2/admin/credits")
export class CreditsController {
    constructor(private readonly creditsService: CreditsService) {}

    @Get("/issues")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_credits"))
    async list(@Query() query: ListParams) {
        return this.creditsService.list(query)
    }

    @Post("/issue/create")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @CheckPolicies((abilities) => abilities.can("manage_credits"))
    async create(@Body() body: IssueCreditDto) {
        return this.creditsService.issueCredit(body)
    }
}
