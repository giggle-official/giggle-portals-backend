import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
import { CheckPolicies, PoliciesGuard } from "src/guards/policies.guard"
import { RolesService } from "./roles.service"
import { FindOneParam, ListParams } from "src/admin/request.dto"
import { CreateRoleDto, DeleteRoleDto, UpdateRoleDto } from "./roles.dto"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"
import { ApiExcludeController } from "@nestjs/swagger"

@ApiExcludeController()
@UseGuards(AuthGuard("jwt"), PoliciesGuard)
@Controller({ path: "api/v2/admin/roles" })
export class RolesController {
    constructor(private readonly rolesService: RolesService) {}
    @Get("/")
    @CheckPolicies((abilities) => abilities.can("manage_roles"))
    async list(@Query() query: ListParams) {
        return this.rolesService.list(query)
    }

    @Get("/permissions")
    @CheckPolicies((abilities) => abilities.can("manage_roles"))
    async permissions(@Query() query: ListParams) {
        return this.rolesService.listPermissions(query)
    }

    @Get("/users")
    @CheckPolicies((abilities) => abilities.can("manage_roles"))
    async users(@Query() query: ListParams) {
        return this.rolesService.listUsers(query)
    }

    @Get("/:id")
    @CheckPolicies((abilities) => abilities.can("manage_roles"))
    async detail(@Param() param: FindOneParam) {
        return this.rolesService.findOne(param)
    }

    @Post("/update")
    @HttpCode(HttpStatus.OK)
    @CheckPolicies((abilities) => abilities.can("manage_roles"))
    async update(@Req() req: Request, @Body() roleInfo: UpdateRoleDto) {
        return this.rolesService.update(req.user as UserJwtExtractDto, roleInfo)
    }

    @Post("/create")
    @HttpCode(HttpStatus.OK)
    @CheckPolicies((abilities) => abilities.can("manage_roles"))
    async create(@Req() req: Request, @Body() roleInfo: CreateRoleDto) {
        return this.rolesService.create(req.user as UserJwtExtractDto, roleInfo)
    }

    @Post("/delete")
    @HttpCode(HttpStatus.OK)
    @CheckPolicies((abilities) => abilities.can("manage_roles"))
    async delete(@Req() req: Request, @Body() roleInfo: DeleteRoleDto) {
        return this.rolesService.delete(req.user as UserJwtExtractDto, roleInfo)
    }
}
