import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common"
import { CreditService } from "./credit.service"
import { TopUpDto } from "./credit.dto"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"
import { OrderDetailDto } from "../order/order.dto"
import { AuthGuard } from "@nestjs/passport"
import { ApiExcludeController } from "@nestjs/swagger"

@Controller("/api/v1/credit")
@ApiExcludeController()
export class CreditController {
    constructor(private readonly creditService: CreditService) {}

    @Post("/top-up")
    @UseGuards(AuthGuard("jwt"))
    async topUp(@Body() body: TopUpDto, @Req() req: Request) {
        return this.creditService.topUp(body, req.user as UserJwtExtractDto)
    }

    @Post("/top-up-callback")
    async topUpCallback(@Body() body: OrderDetailDto) {
        return this.creditService.topUpCallback(body)
    }
}
