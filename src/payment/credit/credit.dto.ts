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
        description: "The amount of the top up, every 1 credit is 0.01 USDC, minimum 100 credits and must be integer",
    })
    @IsNotEmpty()
    @IsNumber()
    @IsInt()
    @Min(100)
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
        description: "filter by type",
        enum: credit_statement_type,
        required: false,
    })
    @IsEnum(credit_statement_type)
    @IsOptional()
    type: credit_statement_type

    @ApiProperty({
        description: "filter by widget tag of the order created by",
        required: false,
    })
    @IsString()
    @IsOptional()
    widget_tag: string
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

export class CreditStatementDto implements credit_statements {
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
        description: "The expire date of the subscription credit",
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
