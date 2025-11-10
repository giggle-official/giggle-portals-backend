import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from "@nestjs/common"
import { Credit2cService } from "./credit-2c.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { ApiTags } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { IsWidgetGuard } from "src/auth/is_widget.guard"
import { Credit2cPaymentCallbackDto } from "./credit-2c.dto"

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
    async topUpUrl(@Req() req: Request, @Query("amount") amount: number, @Query("order_id") order_id: string) {
        return this.credit2cService.getTopUpUrl(req.user as UserJwtExtractDto, amount, order_id)
    }

    @Post("/payment-callback")
    @UseGuards(IsWidgetGuard)
    @HttpCode(HttpStatus.OK)
    async paymentCallback(@Body() body: Credit2cPaymentCallbackDto) {
        return this.credit2cService.processPaymentCallback(body)
    }
}
