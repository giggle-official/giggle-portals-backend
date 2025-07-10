import { Body, Controller, Post, Req, UseGuards, Headers, Get, Query } from "@nestjs/common"
import { CreditService } from "./credit.service"
import { GetStatementQueryDto, GetStatementsResponseDto, TopUpDto } from "./credit.dto"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"
import { OrderDetailDto } from "../order/order.dto"
import { AuthGuard } from "@nestjs/passport"
import { ApiExcludeEndpoint, ApiOperation, ApiResponse } from "@nestjs/swagger"

@Controller("/api/v1/credit")
export class CreditController {
    constructor(private readonly creditService: CreditService) {}

    @Post("/top-up")
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    async topUp(@Body() body: TopUpDto, @Req() req: Request, @Headers("app-id") appId: string) {
        return this.creditService.topUp(body, req.user as UserJwtExtractDto, appId)
    }

    @Post("/top-up-callback")
    @ApiExcludeEndpoint()
    async topUpCallback(@Body() body: OrderDetailDto) {
        return this.creditService.topUpCallback(body)
    }

    @Get("/statement")
    @ApiOperation({ summary: "Get credit statements", tags: ["Credit"] })
    @ApiResponse({
        type: GetStatementsResponseDto,
    })
    @UseGuards(AuthGuard("jwt"))
    async getStatements(@Query() query: GetStatementQueryDto, @Req() req: Request) {
        return this.creditService.getStatements(query, req.user as UserJwtExtractDto)
    }
}
