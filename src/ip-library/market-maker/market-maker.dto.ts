import { ApiProperty, OmitType } from "@nestjs/swagger"
import { ip_token_delegation_status } from "@prisma/client"
import { IsArray, IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { LaunchIpTokenDto } from "../ip-library.dto"

export class CreateMarketMakerDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsEmail()
    email: string

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    nickname: string
}

export class CreateMarketMakerResponseDto {
    @IsNotEmpty()
    @ApiProperty()
    @IsString()
    message: string
}

export class DeleteMarketMakerDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsEmail()
    email: string
}

export class DeleteMarketMakerResponseDto {
    @IsNotEmpty()
    @ApiProperty()
    @IsString()
    message: string
}

export class ListMarketMakerResponseByAdminDto {
    @IsNotEmpty()
    @ApiProperty()
    @IsNumber()
    id: number

    @IsNotEmpty()
    @ApiProperty()
    @IsString()
    nickname: string

    @IsNotEmpty()
    @ApiProperty()
    @IsEmail()
    email: string
}

export class ListMarketMakerResponseDto {
    @IsNotEmpty()
    @ApiProperty()
    @IsNumber()
    id: number

    @IsNotEmpty()
    @ApiProperty()
    @IsString()
    nickname: string
}

export class CancelIpDelegationDto {
    @IsNotEmpty()
    @ApiProperty()
    @IsNumber()
    delegation_id: number
}

export class MarketMakerDto extends OmitType(ListMarketMakerResponseByAdminDto, ["email"]) {}

export class IpDelegationDto {
    @ApiProperty({
        description: "id of the delegation",
    })
    id: number
    @ApiProperty({
        description: "name of the ip",
    })
    ip_name: string
    @ApiProperty({
        description: "ticker of the ip",
    })
    ip_ticker: string

    @ApiProperty({
        description: "id of the ip",
    })
    ip_id: number

    @ApiProperty({
        description: "owner of the ip",
    })
    owner: string

    @ApiProperty({
        description: "status of the delegation",
        enum: ip_token_delegation_status,
    })
    status: ip_token_delegation_status

    @ApiProperty({
        description: "Market maker info",
        type: MarketMakerDto,
    })
    market_maker_info: MarketMakerDto
    @ApiProperty({
        description: "Created at",
    })
    created_at: Date
    @ApiProperty({
        description: "Updated at",
    })
    updated_at: Date
}

export class IpDelegationResponseDto {
    @IsNotEmpty()
    @IsArray()
    @ApiProperty({ type: [IpDelegationDto], description: "List of ip delegations" })
    data: IpDelegationDto[]

    @ApiProperty({ description: "Total number of ip delegations" })
    total: number
}

export class LaunchIpTokenByMarketMakerDto extends LaunchIpTokenDto {
    @IsNumber()
    @ApiProperty({ description: "id of the delegation" })
    delegation_id: number
}

export class IpDelegationQueryDto extends PaginationDto {}

export class AllocateDelegationToMarketMakerDto {
    @IsNotEmpty()
    @ApiProperty({ description: "id of the delegation" })
    delegation_id: number

    @IsNotEmpty()
    @ApiProperty({ description: "id of the market maker" })
    market_maker_id: number
}

export class AllIpDelegationsQueryDto extends PaginationDto {
    @IsOptional()
    @ApiProperty({
        description: "filter by status of the delegation",
        required: false,
        enum: ip_token_delegation_status,
    })
    @IsEnum(ip_token_delegation_status)
    status?: ip_token_delegation_status

    @IsOptional()
    @ApiProperty({ description: "filter by market maker of the delegation", required: false })
    @IsString()
    market_maker?: string
}
