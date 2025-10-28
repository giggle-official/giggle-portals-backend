import { Controller, Get, Req, UseGuards } from "@nestjs/common"
import { Credit2cService } from "./credit-2c.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { ApiTags } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"

@Controller("/api/v1/credit-2c")
@ApiTags("Credit2c Management")
export class Credit2cController {
    constructor(private readonly credit2cService: Credit2cService) {}

    @Get("/balance")
    @UseGuards(AuthGuard("jwt"))
    async getBalance(@Req() req: Request) {
        return this.credit2cService.getCredit2cBalance(req.user as UserJwtExtractDto)
    }

    @Get("/top-up-url")
    @UseGuards(AuthGuard("jwt"))
    async topUpUrl(@Req() req: Request) {
        return this.credit2cService.getTopUpUrl(req.user as UserJwtExtractDto)
    }
}
