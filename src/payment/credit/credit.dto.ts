import { IsEmail, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { credit_statement_type, credit_statements } from "@prisma/client"
import { ApiProperty, OmitType } from "@nestjs/swagger"

export class TopUpDto {
    @ApiProperty({
        description: "The amount of the top up, every 1 credit is 0.01 USDC, minimum 500 credits and must be integer",
    })
    @IsNotEmpty()
    @IsNumber()
    @IsInt()
    @Min(500)
    amount: number

    @ApiProperty({
        description: "The callback url when status changed of top up order",
        required: false,
    })
    @IsString()
    @IsOptional()
    callback_url?: string
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

export class IssueFreeCreditResponseDto {
    @ApiProperty({
        description: "The credit balance of the user",
    })
    credit_balance: number
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
        description: "The email to issue the free credit",
    })
    @IsEmail()
    @IsNotEmpty()
    email: string

    @ApiProperty({
        description: "credit description",
        required: false,
    })
    @IsString()
    @IsOptional()
    description?: string
}

export class CreditStatementDetailDto extends OmitType(CreditStatementDto, ["user", "id"]) {
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
