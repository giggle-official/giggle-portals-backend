import { Body, Controller, Post, Req, UseGuards, Get, Query } from "@nestjs/common"
import { CreditService } from "./credit.service"
import {
    GetStatementQueryDto,
    GetStatementsResponseDto,
    IssueFreeCreditDto,
    TopUpDto,
    UserCreditBalanceDto,
} from "./credit.dto"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"
import { OrderDetailDto } from "../order/order.dto"
import { AuthGuard } from "@nestjs/passport"
import { ApiOperation, ApiResponse, ApiBody, ApiTags, ApiExcludeEndpoint } from "@nestjs/swagger"
import { IsWidgetGuard } from "src/auth/is_widget.guard"

@Controller("/api/v1/credit")
export class CreditController {
    constructor(private readonly creditService: CreditService) {}

    @Get("/balance")
    @ApiTags("Credit")
    @ApiOperation({ summary: "Get user credit balance", tags: ["Credit"] })
    @ApiResponse({
        type: UserCreditBalanceDto,
    })
    @UseGuards(AuthGuard("jwt"))
    async getUserCredits(@Req() req: Request) {
        const user = req.user as UserJwtExtractDto
        return this.creditService.getUserCredits(user.usernameShorted)
    }

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

    @Post("/issue-free-credit")
    @ApiOperation({
        summary: "Issue free credit",
        description: "Issue free credit to a user, you must be use widget jwt to call this api",
        tags: ["Credit"],
    })
    @ApiResponse({
        type: UserCreditBalanceDto,
    })
    @ApiBody({
        type: IssueFreeCreditDto,
    })
    @UseGuards(IsWidgetGuard)
    async issueFreeCredit(@Body() body: IssueFreeCreditDto, @Req() req: Request) {
        return this.creditService.issueFreeCredit(body, req.user as UserJwtExtractDto)
    }

    @Post("/pay-top-up-order")
    @ApiExcludeEndpoint()
    @UseGuards(IsWidgetGuard)
    async payTopUpOrder(@Body() body: TopUpDto, @Req() req: Request) {
        return this.creditService.payTopUpOrder(body, req.user as UserJwtExtractDto)
    }
}
