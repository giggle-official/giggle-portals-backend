import { ApiProperty } from "@nestjs/swagger"
import { ip_token_delegation_status } from "@prisma/client"
import { IsArray, IsEmail, IsNotEmpty, IsNumber, IsString } from "class-validator"
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

export class IpDelegationDto {
    id: number
    ip_name: string
    ip_ticker: string
    ip_id: number
    owner: string
    status: ip_token_delegation_status
    created_at: Date
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
