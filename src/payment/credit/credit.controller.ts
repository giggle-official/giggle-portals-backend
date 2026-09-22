import { Body, Controller, Param, Post, Req, UseGuards, Get, Query, BadRequestException } from "@nestjs/common"
import { CreditService } from "./credit.service"
import {
    AdminReverseStatementDto,
    AdminReverseStatementResponseDto,
    CancelWidgetSubscriptionDto,
    GetStatementQueryDto,
    GetStatementsResponseDto,
    IssueFreeCreditDto,
    PayTopUpOrderDto,
    TopUpDto,
    TransferCreditDto,
    TransferCreditResponseDto,
    TransferLimitDto,
    AdminSetTransferLimitDto,
    UpdateWidgetSubscriptionsDto,
    UserCreditBalanceDto,
    WidgetConsumptionQueryDto,
    WidgetConsumptionResponseDto,
} from "./credit.dto"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"
import { OrderDetailDto } from "../order/order.dto"
import { AuthGuard } from "@nestjs/passport"
import { ApiOperation, ApiResponse, ApiBody, ApiTags, ApiExcludeEndpoint, ApiHeader } from "@nestjs/swagger"
import { IsAdminGuard } from "src/auth/is_admin.guard"
import { IsWidgetGuard } from "src/auth/is_widget.guard"
import { CheckWidgetPolicies, WidgetPoliciesGuard } from "src/guards/widget-policies.guard"
import { WIDGET_PERMISSIONS_LIST } from "src/casl/casl-ability.factory/widget-casl-ability.factory"

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

    @Post("/transfer")
    @ApiTags("Credit")
    @ApiOperation({
        summary: "Transfer credit to another account",
        description:
            "Moves paid and subscription credit to another account. Free credit cannot be transferred. " +
            "The recipient must already exist. Send the same `request_id` again to retry safely.",
        tags: ["Credit"],
    })
    @ApiResponse({ type: TransferCreditResponseDto })
    @ApiBody({ type: TransferCreditDto })
    @UseGuards(AuthGuard("jwt"))
    async transferCredit(@Body() body: TransferCreditDto, @Req() req: Request) {
        return this.creditService.transferCredit(body, req.user as UserJwtExtractDto)
    }

    @Get("/transfer-limit")
    @ApiTags("Credit")
    @ApiOperation({
        summary: "Transfer caps and what is left of them today",
        tags: ["Credit"],
    })
    @ApiResponse({ type: TransferLimitDto })
    @UseGuards(AuthGuard("jwt"))
    async getTransferLimit(@Req() req: Request) {
        const user = req.user as UserJwtExtractDto
        return this.creditService.getTransferLimit(user.usernameShorted)
    }

    @Post("/admin/users/:user/transfer-limit")
    @ApiExcludeEndpoint()
    @UseGuards(IsAdminGuard)
    async adminSetTransferLimit(
        @Param("user") user: string,
        @Body() body: AdminSetTransferLimitDto,
        @Req() req: Request,
    ) {
        return this.creditService.adminSetTransferLimit(user, body, req.user as UserJwtExtractDto)
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
    @UseGuards(IsWidgetGuard, WidgetPoliciesGuard)
    @CheckWidgetPolicies((abilities) => abilities.can(WIDGET_PERMISSIONS_LIST.CAN_ISSUE_FREE_CREDIT))
    async issueFreeCredit(@Body() body: IssueFreeCreditDto, @Req() req: Request) {
        return this.creditService.issueFreeCredit(body, req.user as UserJwtExtractDto)
    }

    @Post("/issue-credit")
    @ApiOperation({
        summary: "Issue credit",
        description: "Issue credit to a user, you must be use widget jwt to call this api",
        tags: ["Credit"],
    })
    @CheckWidgetPolicies((abilities) => abilities.can(WIDGET_PERMISSIONS_LIST.CAN_ISSUE_TOKEN))
    @UseGuards(IsWidgetGuard)
    @ApiResponse({
        type: UserCreditBalanceDto,
    })
    @ApiBody({
        type: PayTopUpOrderDto,
    })
    @ApiResponse({
        schema: {
            type: "object",
            properties: {
                success: {
                    type: "boolean",
                },
            },
        },
    })
    async payTopUpOrder(@Body() body: PayTopUpOrderDto, @Req() request: Request) {
        return this.creditService.payTopUpOrder(body, request.user as UserJwtExtractDto)
    }

    @Get("/credit-statictics")
    @ApiOperation({ summary: "Get credit statictics", tags: ["Credit"] })
    @UseGuards(IsWidgetGuard)
    async getCreditStatictics(@Req() req: Request) {
        const widgetTag = (req.user as UserJwtExtractDto).developer_info?.tag
        if (!widgetTag) {
            throw new BadRequestException("Widget tag is required")
        }
        return this.creditService.getCreditStatictics(widgetTag)
    }

    @Get("/widget-consumption")
    @ApiTags("Credit")
    @ApiOperation({
        summary: "Per-user credit and consumption for one widget",
        description:
            "Credit granted counts every widget, because a credit balance is global; consumption counts only " +
            "this widget's orders. Emails are masked, and internal staff accounts are excluded. Admin only.",
        tags: ["Credit"],
    })
    @UseGuards(IsAdminGuard)
    @ApiHeader({ name: "x-api-key", required: true })
    @ApiResponse({ type: WidgetConsumptionResponseDto })
    async getWidgetConsumption(@Query() query: WidgetConsumptionQueryDto): Promise<WidgetConsumptionResponseDto> {
        return this.creditService.getWidgetConsumption(query)
    }

    @Post("/admin/statements/:id/reverse")
    @ApiTags("Credit")
    @ApiOperation({
        summary: "Reverse a top-up statement",
        description:
            "Appends a top_up statement with the amount negated, linked to the original through reversal_of / " +
            "reversed_by, takes the credit off the user's balance (which may go negative), and cancels the top-up " +
            "order. Nothing is deleted. Only top_up statements, once each. Admin only.",
        tags: ["Credit"],
    })
    @UseGuards(IsAdminGuard)
    @ApiBody({ type: AdminReverseStatementDto })
    @ApiResponse({ type: AdminReverseStatementResponseDto })
    async adminReverseStatement(
        @Param("id") id: string,
        @Body() body: AdminReverseStatementDto,
        @Req() req: Request,
    ): Promise<AdminReverseStatementResponseDto> {
        const statementId = Number(id)
        if (!Number.isInteger(statementId) || statementId <= 0) {
            throw new BadRequestException("Invalid statement id")
        }
        return this.creditService.adminReverseStatement(statementId, body, req.user as UserJwtExtractDto)
    }

    @Post("/update-widget-subscriptions")
    @ApiOperation({
        summary: "Issue subscription credit",
        description: "Issue subscription credit to a user, you must be use widget jwt to call this api",
        tags: ["Credit"],
    })
    @UseGuards(IsWidgetGuard)
    @ApiResponse({
        type: UserCreditBalanceDto,
    })
    @ApiBody({
        type: UpdateWidgetSubscriptionsDto,
    })
    async updateWidgetSubscriptions(@Body() body: UpdateWidgetSubscriptionsDto, @Req() req: Request) {
        return this.creditService.updateWidgetSubscriptions(body, req.user as UserJwtExtractDto)
    }

    @Post("/cancel-widget-subscription")
    @ApiOperation({
        summary: "Cancel widget subscription",
        description:
            "Cancel a user's widget subscription. Removes the subscription and all unissued credits. Issued credits will expire naturally.",
        tags: ["Credit"],
    })
    @UseGuards(IsWidgetGuard)
    @ApiBody({
        type: CancelWidgetSubscriptionDto,
    })
    async cancelWidgetSubscription(@Body() body: CancelWidgetSubscriptionDto, @Req() req: Request) {
        return this.creditService.cancelWidgetSubscription(body.user_id, req.user as UserJwtExtractDto)
    }
}
