import { Body, Controller, Post, Req, UseGuards, Get, Query } from "@nestjs/common"
import { CreditService } from "./credit.service"
import { GetStatementQueryDto, GetStatementsResponseDto, TopUpDto } from "./credit.dto"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"
import { OrderDetailDto } from "../order/order.dto"
import { AuthGuard } from "@nestjs/passport"
import { ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger"

@Controller("/api/v1/credit")
export class CreditController {
    constructor(private readonly creditService: CreditService) {}

    @Post("/top-up")
    @ApiOperation({ summary: "Create a top up credit order", tags: ["Credit"] })
    @ApiResponse({
        type: OrderDetailDto,
    })
    @ApiBody({
        type: TopUpDto,
    })
    @UseGuards(AuthGuard("jwt"))
    async topUp(@Body() body: TopUpDto, @Req() req: Request) {
        return this.creditService.topUp(body, req.user as UserJwtExtractDto)
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
