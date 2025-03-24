import {
    Controller,
    Get,
    Query,
    UseGuards,
    Param,
    ParseIntPipe,
    Body,
    HttpStatus,
    Post,
    HttpCode,
} from "@nestjs/common"
import { ApiExcludeController } from "@nestjs/swagger"
import { UsersService } from "./users.service"
import { ListParams } from "../request.dto"
import { CheckPolicies } from "src/guards/policies.guard"
import { AuthGuard } from "@nestjs/passport"
import { UserPlanSettingsDto } from "src/user/user.dto"

@ApiExcludeController()
@Controller("/api/v2/admin/users")
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get("/")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_users"))
    async list(@Query() query: ListParams) {
        return this.usersService.list(query)
    }

    @Get("/plan/:id")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_plans"))
    async getPlan(@Param("id", ParseIntPipe) id: number) {
        return this.usersService.getPlan(id)
    }

    @Post("/plan/update")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @CheckPolicies((abilities) => abilities.can("manage_plans"))
    async updatePlan(@Body() body: UserPlanSettingsDto) {
        return this.usersService.updatePlan(body)
    }

    @Get("/:id")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_users"))
    async get(@Param("id", ParseIntPipe) id: number) {
        return this.usersService.detail(id)
    }
}
