import { ApiProperty } from "@nestjs/swagger"
import { credit_line_statement_type, credit_line_status } from "@prisma/client"
import { IsEmail, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator"
import { PaginationDto } from "src/common/common.dto"

export class GrantCreditLineDto {
    @ApiProperty({
        description: "Email of the user to grant the credit line to",
    })
    @IsEmail()
    @IsNotEmpty()
    email: string

    @ApiProperty({
        description:
            "The absolute credit limit to set, not a delta. Capped by CREDIT_LINE_WIDGET_GRANT_MAX. " +
            "Set it to 0 to stop the user from borrowing any further; an outstanding debt is unaffected.",
    })
    @IsNumber()
    @IsInt()
    @Min(0)
    credit_limit: number

    @ApiProperty({
        description: "Free-form note kept on the credit line",
        required: false,
    })
    @IsString()
    @IsOptional()
    note?: string
}

export class RepayCreditLineDto {
    @ApiProperty({
        description:
            "The widget whose credit line to repay. Required when calling with a user JWT; ignored when " +
            "calling with a widget JWT, which always repays its own credit line.",
        required: false,
    })
    @IsString()
    @IsOptional()
    widget_tag?: string

    @ApiProperty({
        description:
            "The user repaying. Required when calling with a widget JWT, ignored otherwise — a widget may " +
            "repay on a user's behalf.",
        required: false,
    })
    @IsEmail()
    @IsOptional()
    email?: string

    @ApiProperty({
        description:
            "How much to repay. Omit to repay as much as the debt and the usable balance allow. " +
            "The amount is always capped by both.",
        required: false,
    })
    @IsNumber()
    @IsInt()
    @Min(1)
    @IsOptional()
    amount?: number

    @ApiProperty({
        description:
            "Idempotency key. Omit and one is generated server-side, in which case retrying really does repay " +
            "twice. Supply one and a repeat is rejected rather than charged again. Deduplicated per user and " +
            "widget, so it need not be globally unique. The key is only recorded when a repayment actually " +
            "happens: a call that repaid nothing does not consume it, so the same key still works if the debt " +
            "shows up later.",
        required: false,
    })
    @IsString()
    @IsOptional()
    request_id?: string
}

export class CreditLineDto {
    @ApiProperty({
        description: "The widget that granted this credit line",
    })
    widget_tag: string

    @ApiProperty({
        description: "The granted limit",
    })
    credit_limit: number

    @ApiProperty({
        description: "Outstanding debt. Negative when a refund landed after the debt was already repaid.",
    })
    used: number

    @ApiProperty({
        description:
            "How much can still be spent: max(0, credit_limit - used), and always 0 while the line is frozen. " +
            "A user without a credit line on this widget reads as limit 0 / used 0 / available 0.",
    })
    available: number

    @ApiProperty({
        description: "Frozen lines cannot be spent, but can still be repaid and refunded",
        enum: credit_line_status,
    })
    status: credit_line_status
}

export class WidgetCreditLineDto extends CreditLineDto {
    @ApiProperty({
        description:
            "The user's balance that is usable for repayment, i.e. their total balance minus free credit. " +
            "Returned so that a single call is enough to decide whether to make the user repay first.",
    })
    credit_balance: number
}

export class RepayCreditLineResponseDto {
    @ApiProperty({
        description: "How much was actually repaid, which is 0 when there was nothing owed or nothing to pay with",
    })
    repaid: number

    @ApiProperty({
        description: "The debt remaining on this credit line",
    })
    credit_line_used: number

    @ApiProperty({
        description: "What can still be spent on this credit line",
    })
    credit_line_available: number

    @ApiProperty({
        description: "The user's real spendable balance after the repayment",
    })
    credit_balance: number
}

export class GetCreditLinesResponseDto {
    @ApiProperty({
        description: "One entry per widget that has granted this user a credit line",
        type: () => CreditLineDto,
        isArray: true,
    })
    credit_lines: CreditLineDto[]
}

export class GetCreditLineStatementQueryDto extends PaginationDto {
    @ApiProperty({
        description: "The widget whose credit line statement to read. Required when calling with a user JWT.",
        required: false,
    })
    @IsString()
    @IsOptional()
    widget_tag?: string

    @ApiProperty({
        description:
            "The user whose statement to read. Required when calling with a widget JWT, ignored otherwise. " +
            "A widget always reads its own credit line, never another widget's.",
        required: false,
    })
    @IsEmail()
    @IsOptional()
    email?: string
}

export class CreditLineStatementDto {
    @ApiProperty()
    id: number

    @ApiProperty()
    widget_tag: string

    @ApiProperty({
        description: "consume: spent the line. repay: paid debt off with real credit. refund: money came back.",
        enum: credit_line_statement_type,
    })
    type: credit_line_statement_type

    @ApiProperty({
        description:
            "Signed by direction of money for the user: negative when they spend (consume, repay), " +
            "positive when money comes back (refund). The type, not the sign, says which way the debt moved.",
    })
    amount: number

    @ApiProperty({
        description: "The outstanding debt right after this entry",
    })
    used_after: number

    @ApiProperty({
        description: "The order this entry belongs to, for consume and refund",
        required: false,
        nullable: true,
    })
    order_id: string | null

    @ApiProperty({
        description:
            "The idempotency key of a repayment. Returned so a caller that lost the response to a repay " +
            "can tell whether it landed.",
        required: false,
        nullable: true,
    })
    request_id: string | null

    @ApiProperty({
        required: false,
        nullable: true,
    })
    created_at: Date | null
}

export class GetCreditLineStatementsResponseDto {
    @ApiProperty({
        description: "The total number of statements",
    })
    count: number

    @ApiProperty({
        type: () => CreditLineStatementDto,
        isArray: true,
    })
    statements: CreditLineStatementDto[]
}
