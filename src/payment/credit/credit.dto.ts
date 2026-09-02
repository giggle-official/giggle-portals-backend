import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsEmail,
    IsEnum,
    IsInt,
    IsJWT,
    IsNotEmpty,
    IsNumber,
    IsNumberString,
    IsObject,
    IsOptional,
    IsPositive,
    IsString,
    IsUUID,
    Max,
    Min,
    ValidateNested,
} from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { credit_statement_type, credit_statements, free_credit_issue_type } from "@prisma/client"
import { ApiProperty, OmitType } from "@nestjs/swagger"
import { Type } from "class-transformer"
import { PaymentMethod } from "../order/order.dto"

export class TopUpDto {
    @ApiProperty({
        description: "The amount of the top up, every 1 credit is 0.01 USDC, minimum 10 credits and must be integer",
    })
    @IsNotEmpty()
    @IsNumber()
    @IsInt()
    @Min(10)
    amount: number

    @ApiProperty({
        description: "The callback url when status changed of top up order",
        required: false,
    })
    @IsString()
    @IsOptional()
    callback_url?: string
}

export class PayTopUpOrderDto extends TopUpDto {
    @ApiProperty({
        description: "The order id of the top up order, must be a valid uuid, required for duplicate",
    })
    @IsUUID()
    @IsNotEmpty()
    order_id: string

    @ApiProperty({
        description: "The user jwt of the top up order",
    })
    @IsJWT()
    @IsNotEmpty()
    user_jwt: string

    @ApiProperty({
        description: "The email of the user to issue credit",
    })
    @IsEmail()
    @IsNotEmpty()
    email: string

    @ApiProperty({
        description: "The payment method of the top up order",
        enum: PaymentMethod,
        required: false,
    })
    @IsEnum(PaymentMethod)
    @IsOptional()
    payment_method?: PaymentMethod

    @ApiProperty({
        description: "The metadata of the top up order",
        required: false,
    })
    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>
}

export class GetStatementQueryDto extends PaginationDto {
    @ApiProperty({
        description:
            "Filter by statement type. Accepts a single enum value (e.g. `top_up`) or a comma-separated list of valid enum values (e.g. `top_up,consume,refund`). Unknown tokens are dropped server-side; an all-invalid string is treated as no filter.",
        enum: credit_statement_type,
        required: false,
        example: "consume,refund",
    })
    @IsString()
    @IsOptional()
    type: string

    @ApiProperty({
        description: "filter by widget tag of the order created by",
        required: false,
    })
    @IsString()
    @IsOptional()
    widget_tag: string

    @ApiProperty({
        description: "filter statements from this date (YYYY-MM-DD)",
        required: false,
        example: "2026-03-01",
    })
    @IsOptional()
    @IsString()
    start_time?: string

    @ApiProperty({
        description: "filter statements until this date (YYYY-MM-DD)",
        required: false,
        example: "2026-03-31",
    })
    @IsOptional()
    @IsString()
    end_time?: string
}

export class FreeCreditInvitedUserInfoDto {
    @ApiProperty({
        description: "The invited user id of the statement",
    })
    invited_user_id: string

    @ApiProperty({
        description: "The invited user email of the statement",
    })
    username: string

    @ApiProperty({
        description: "The invited user avatar of the statement",
    })
    avatar: string
}

/**
 * The precise columns stay outside the `implements` contract on purpose.
 *
 * Prisma types them as `Decimal`, and a `Decimal` must never reach the wire:
 * `JSON.stringify(new Decimal(6.5))` is `"6.5"`, a string where every other
 * money field is a number. Declaring them here as `number` means the compiler
 * rejects assigning the raw column and forces the conversion at each mapping
 * site, which is the whole reason they were omitted rather than ignored.
 */
export class CreditStatementDto implements Omit<credit_statements, "amount_precise" | "balance_precise"> {
    @ApiProperty({
        description: "The id of the statement",
    })
    id: number

    @ApiProperty({
        description: "The user of the statement",
    })
    user: string

    @ApiProperty({
        description: "The type of the statement",
        enum: credit_statement_type,
    })
    type: credit_statement_type
    @ApiProperty({
        description: "The is free credit of the statement",
    })
    is_free_credit: boolean

    @ApiProperty({
        description: "The free credit issue id of the statement",
    })
    free_credit_issue_id: number

    @ApiProperty({
        description: "The is subscription credit of the statement",
    })
    is_subscription_credit: boolean

    @ApiProperty({
        description: "The subscription credit issue id of the statement",
    })
    subscription_credit_issue_id: number

    @ApiProperty({
        description: "The amount of the statement",
    })
    amount: number

    @ApiProperty({
        description: "After balance of the statement",
    })
    balance: number

    @ApiProperty({
        description:
            "The amount of the statement, to 6 decimal places. Today it always equals `amount`; " +
            "once fractional credit is accepted this is the exact value and `amount` is its floor.",
    })
    amount_precise: number

    @ApiProperty({
        description: "After balance of the statement, to 6 decimal places. See `amount_precise`.",
    })
    balance_precise: number

    @ApiProperty({
        description: "The created at of the statement",
    })
    created_at: Date

    @ApiProperty({
        description: "The updated at of the statement",
    })
    updated_at: Date

    @ApiProperty({
        description: "The order id of the statement",
    })
    order_id: string

    @ApiProperty({
        description: "If the statement is a free credit issue, the invited user info of the statement, otherwise null",
        type: () => FreeCreditInvitedUserInfoDto,
    })
    free_credit_invited_user_info: FreeCreditInvitedUserInfoDto

    @ApiProperty({
        description:
            "Human-readable note attached to a free credit issue (e.g. refund reason). Null for non-free-credit statements or when the issuer didn't supply one.",
        required: false,
        nullable: true,
    })
    description: string | null
}

export class UserCreditBalanceDto {
    @ApiProperty({
        description: "The total credit balance of the user",
    })
    total_credit_balance: number

    @ApiProperty({
        description: "The free credit balance of the user",
    })
    free_credit_balance: number

    @ApiProperty({
        description:
            "The total credit balance of the user, to 6 decimal places. Today it always equals " +
            "`total_credit_balance`; once fractional credit is accepted this is the exact value.",
    })
    total_credit_balance_precise: number

    @ApiProperty({
        description: "The free credit balance of the user, to 6 decimal places. See `total_credit_balance_precise`.",
    })
    free_credit_balance_precise: number
}

export class IssueFreeCreditDto {
    @ApiProperty({
        description: "The amount of the free credit, minimum 1 and maximum 10000",
    })
    @Min(1)
    @Max(10000)
    @IsInt()
    @IsNumber()
    amount: number

    @ApiProperty({
        description: "Email to receive the free credit",
    })
    @IsEmail()
    @IsNotEmpty()
    email: string

    @ApiProperty({
        description: `The issue type of the free credit , default is **${free_credit_issue_type.widget_direct_issue}**`,
        enum: free_credit_issue_type,
        required: false,
    })
    @IsEnum(free_credit_issue_type)
    @IsOptional()
    issue_type?: free_credit_issue_type

    @ApiProperty({
        description: "Free credit description",
        required: false,
    })
    @IsString()
    @IsOptional()
    description?: string
}

export class CreditStatementDetailDto extends OmitType(CreditStatementDto, ["user"]) {
    @ApiProperty({
        description: "The widget tag of the order created by",
    })
    @IsString()
    widget_tag: string

    @ApiProperty({
        description: "The ip id of the order created by",
    })
    @IsNumber()
    ip_id: number

    @ApiProperty({
        description: "The item of the order that produced this statement (application-supplied source label)",
        required: false,
        nullable: true,
    })
    @IsString()
    @IsOptional()
    order_item?: string | null
}

export class GetStatementsResponseDto {
    @ApiProperty({
        description: "The total number of statements",
    })
    count: number

    @ApiProperty({
        description: "The statements",
        type: () => CreditStatementDetailDto,
        isArray: true,
    })
    statements: CreditStatementDetailDto[]
}

export class SubscriptionCreditDto {
    @ApiProperty({
        description: "The subscription id of the subscription credit",
    })
    @IsNotEmpty()
    @IsNumber()
    @IsInt()
    @IsPositive()
    amount: number

    @ApiProperty({
        description: "The issue date of the subscription credit",
    })
    @IsDateString()
    @IsNotEmpty()
    issue_date: Date

    @ApiProperty({
        description:
            "The expire date of the subscription credit. Recorded and used to order which issue row is " +
            "consumed first, but subscription credit does not expire: nothing deducts the balance when this " +
            "date passes.",
    })
    @IsDateString()
    @IsNotEmpty()
    expire_date: Date
}

export class SubscriptionDetailDto {
    @ApiProperty({
        description: "The subscription product name of the subscription credit",
    })
    @IsString()
    @IsNotEmpty()
    product_name: string

    @ApiProperty({
        description: "The subscription period start date of the subscription credit",
    })
    @IsDateString()
    @IsNotEmpty()
    period_start: Date

    @ApiProperty({
        description: "The subscription period end date of the subscription credit",
    })
    @IsDateString()
    @IsNotEmpty()
    period_end: Date

    @ApiProperty({
        description: "The subscription cancel at period end of the subscription credit",
    })
    @IsBoolean()
    @IsNotEmpty()
    cancel_at_period_end: boolean

    @ApiProperty({
        description: "The subscription metadata of the subscription credit",
    })
    @IsObject()
    @IsNotEmpty()
    subscription_metadata: Record<string, any>
}

export class UpdateWidgetSubscriptionsDto {
    @ApiProperty({
        description: "The user id of the subscription credit",
    })
    @IsString()
    @IsNotEmpty()
    user_id: string

    @ApiProperty({
        description: "The subscription detail of the subscription credit",
    })
    @ValidateNested()
    @Type(() => SubscriptionDetailDto)
    subscription_detail: SubscriptionDetailDto

    @ApiProperty({
        description:
            "The paid amount in cents (100 = $1.00). If provided, an order will be created and settled for this subscription payment.",
        required: false,
    })
    @IsOptional()
    @IsNumber()
    @IsPositive()
    paid_amount?: number

    @ApiProperty({
        description: "The subscription credit of the subscription credit",
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SubscriptionCreditDto)
    subscription_credits: SubscriptionCreditDto[]
}

export class CancelWidgetSubscriptionDto {
    @ApiProperty({
        description: "The user id to cancel subscription for",
    })
    @IsString()
    @IsNotEmpty()
    user_id: string
}

export enum WidgetConsumptionSort {
    CONSUMED_DESC = "consumed_desc",
    CONSUMED_ASC = "consumed_asc",
    GRANTED_DESC = "granted_desc",
    GRANTED_ASC = "granted_asc",
    REMAINING_DESC = "remaining_desc",
}

export const WIDGET_CONSUMPTION_MAX_LIMIT = 1000

export class WidgetConsumptionQueryDto {
    @ApiProperty({
        description:
            "The widget to report on. Consumption counts only this widget's orders. Omit it to report every " +
            "widget together, where consumption is each user's total across all of them.",
        required: false,
    })
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    widget_tag?: string

    @ApiProperty({
        description: "Row order",
        enum: WidgetConsumptionSort,
        required: false,
        default: WidgetConsumptionSort.CONSUMED_DESC,
    })
    @IsEnum(WidgetConsumptionSort)
    @IsOptional()
    sort?: WidgetConsumptionSort

    /**
     * A string, like every other query parameter in this API. The global
     * `ValidationPipe` is constructed without `transform`, so `@Type(() => Number)`
     * would never run and an `@IsInt()` here would reject every request that sends
     * a limit at all. The range is enforced in the service, where the value is
     * parsed. See `PaginationDto` for the same shape.
     */
    @ApiProperty({
        description: `Maximum rows to return, at most ${WIDGET_CONSUMPTION_MAX_LIMIT}`,
        required: false,
        default: "100",
        example: "100",
    })
    @IsNumberString()
    @IsOptional()
    limit?: string
}

export class WidgetConsumptionUserDto {
    @ApiProperty({
        description: "The user's email, masked. The unmasked address is never returned.",
        example: "abc****@****.com",
    })
    email: string

    @ApiProperty({
        description:
            "Everything this user was ever granted, across every widget — the sum of the four buckets below. " +
            "Deliberately not scoped to `widget_tag`: scoping it would make a user who spent here on credit " +
            "granted elsewhere look like they consumed more than they had.",
    })
    granted: number

    @ApiProperty({ description: "Credit bought (top-up), all widgets" })
    granted_paid: number

    @ApiProperty({ description: "Free credit issued, all widgets" })
    granted_free: number

    @ApiProperty({ description: "Subscription credit issued, all widgets" })
    granted_subscription: number

    @ApiProperty({
        description:
            "Credit line granted. The limit, not what was drawn on it — a user with a 1,000,000 limit counts " +
            "1,000,000 whether or not they used any of it. Scoped to this widget, since a credit line belongs " +
            "to one; the all-widgets report sums them.",
    })
    granted_credit_line: number

    @ApiProperty({
        description: "Outstanding on the credit line, and part of `consumed`.",
    })
    credit_line_used: number

    @ApiProperty({
        description:
            "The credit account balance — what `GET /credit/balance` reports for this user. Global. " +
            "`remaining` is this plus the unused credit line, so the two differ whenever a line exists.",
    })
    balance: number

    @ApiProperty({
        description:
            "Spent on this widget: its orders paid from the credit balance, plus whatever is drawn on this " +
            "widget's credit line. A positive number.",
    })
    consumed: number

    @ApiProperty({
        description:
            "What the user can still spend: `granted_credit_line - credit_line_used` plus their credit " +
            "balance. With a credit line in play this deliberately differs from the account balance, which " +
            "is the credit half alone. It is also not `granted` minus `consumed` — free credit that expired " +
            "and credit spent repaying a line leave the balance without counting as consumption here.",
    })
    remaining: number
}

export class WidgetConsumptionResponseDto {
    @ApiProperty({
        description: "The widget the report is scoped to, or null when it covers every widget.",
        nullable: true,
    })
    widget_tag: string | null

    @ApiProperty({ description: "Rows returned, after `limit`" })
    count: number

    @ApiProperty({
        description:
            "When the snapshot behind these rows was built. It is rebuilt every ten minutes, so the figures " +
            "are up to that stale. Null when the report is empty.",
        nullable: true,
    })
    generated_at: Date | null

    @ApiProperty({ type: () => WidgetConsumptionUserDto, isArray: true })
    users: WidgetConsumptionUserDto[]
}
