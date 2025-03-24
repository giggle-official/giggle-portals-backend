import { Post, Body, Controller, Req, Res, Get, UseGuards, HttpCode, HttpStatus } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
import { AdminAuthService } from "./auth.service"
import { Request, Response } from "express"
import { CheckPolicies } from "src/guards/policies.guard"
import { SwitchRoleDto } from "./auth.dto"
import { ApiExcludeController } from "@nestjs/swagger"
import { Recaptcha } from "@nestlab/google-recaptcha"

@ApiExcludeController()
@Controller({ path: "/api/v2/admin/auth" })
export class AdminAuthController {
    constructor(private readonly adminAuthService: AdminAuthService) {}
    @Post("/login")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("local"))
    @Recaptcha()
    async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        return this.adminAuthService.login(req, res)
    }

    @HttpCode(HttpStatus.OK)
    @Post("/logout")
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        return this.adminAuthService.logout(req, res)
    }

    @Get("/profile")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("access_admin"))
    async profile(@Req() req: Request) {
        return this.adminAuthService.profile(req)
    }

    @Get("/permissions")
    @CheckPolicies((abilities) => abilities.can("access_admin"))
    @UseGuards(AuthGuard("jwt"))
    async permissions(@Req() req: Request) {
        return this.adminAuthService.permissions(req)
    }

    @Post("/switchRole")
    @CheckPolicies((abilities) => abilities.can("access_admin"))
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async switchRole(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() roleInfo: SwitchRoleDto) {
        return this.adminAuthService.switchRole(req, res, roleInfo)
    }
}
