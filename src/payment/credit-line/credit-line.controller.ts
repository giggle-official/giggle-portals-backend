import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { Request } from "express"
import { IsWidgetGuard } from "src/auth/is_widget.guard"
import { WIDGET_PERMISSIONS_LIST } from "src/casl/casl-ability.factory/widget-casl-ability.factory"
import { CheckWidgetPolicies, WidgetPoliciesGuard } from "src/guards/widget-policies.guard"
import { UserJwtExtractDto } from "src/user/user.controller"
import {
    CreditLineDto,
    GetCreditLinesResponseDto,
    GetCreditLineStatementQueryDto,
    GetCreditLineStatementsResponseDto,
    GrantCreditLineDto,
    WidgetCreditLineDto,
} from "./credit-line.dto"
import { CreditLineService } from "./credit-line.service"

/**
 * Mounted on its own prefix and documented under its own tag rather than under
 * "Credit": the credit line is a separate account from the credit balance, and
 * folding the two together is exactly the confusion the split is meant to avoid.
 * Nothing here reads or writes `users.current_credit_balance`.
 */
@ApiTags("Credit Line")
@Controller("/api/v1/credit-line")
export class CreditLineController {
    constructor(private readonly creditLineService: CreditLineService) {}

    @Post("/grant")
    @ApiOperation({
        summary: "Grant a credit line",
        description:
            "Set a user's credit limit on your widget. The limit is absolute, not a delta, so retrying is safe. " +
            "The line can only be spent on this widget's orders and only repaid against this widget. " +
            "You must use a widget jwt to call this api.",
        tags: ["Credit Line"],
    })
    @ApiBody({ type: GrantCreditLineDto })
    @ApiResponse({ type: CreditLineDto })
    @UseGuards(IsWidgetGuard, WidgetPoliciesGuard)
    @CheckWidgetPolicies((abilities) => abilities.can(WIDGET_PERMISSIONS_LIST.CAN_GRANT_CREDIT_LINE))
    async grantCreditLine(@Body() body: GrantCreditLineDto, @Req() req: Request): Promise<CreditLineDto> {
        return this.creditLineService.grantCreditLine(body, req.user as UserJwtExtractDto)
    }

    @Get("/list")
    @ApiOperation({ summary: "Get the credit lines granted to the current user", tags: ["Credit Line"] })
    @ApiResponse({ type: GetCreditLinesResponseDto })
    @UseGuards(AuthGuard("jwt"))
    async getCreditLines(@Req() req: Request): Promise<GetCreditLinesResponseDto> {
        return this.creditLineService.getUserCreditLines(req.user as UserJwtExtractDto)
    }

    @Get("/widget")
    @ApiOperation({
        summary: "Get one user's credit line on your widget",
        description:
            "Returns the limit, debt and available amount of the credit line your widget granted this user, " +
            "along with the balance they could repay it with. A user without a credit line, and an email that " +
            "is not registered, both read as zero. You must use a widget jwt to call this api.",
        tags: ["Credit Line"],
    })
    @ApiResponse({ type: WidgetCreditLineDto })
    @UseGuards(IsWidgetGuard, WidgetPoliciesGuard)
    @CheckWidgetPolicies((abilities) => abilities.can(WIDGET_PERMISSIONS_LIST.CAN_GRANT_CREDIT_LINE))
    async getWidgetCreditLine(@Query("email") email: string, @Req() req: Request): Promise<WidgetCreditLineDto> {
        return this.creditLineService.getWidgetCreditLine(email, req.user as UserJwtExtractDto)
    }

    @Get("/statement")
    @ApiOperation({
        summary: "Get credit line statements",
        description:
            "The credit line account's own ledger, which is separate from `/credit/statement`: credit line " +
            "spending and refunds never appear there, because they do not move the credit balance. " +
            "Callable with a user jwt, or with a widget jwt holding `can_grant_credit_line`, in which case " +
            "`email` is required and the widget always reads its own credit line.",
        tags: ["Credit Line"],
    })
    @ApiResponse({ type: GetCreditLineStatementsResponseDto })
    @UseGuards(AuthGuard("jwt"))
    async getCreditLineStatements(
        @Query() query: GetCreditLineStatementQueryDto,
        @Req() req: Request,
    ): Promise<GetCreditLineStatementsResponseDto> {
        return this.creditLineService.getStatements(query, req.user as UserJwtExtractDto)
    }
}
