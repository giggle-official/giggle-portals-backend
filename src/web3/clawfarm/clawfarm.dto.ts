import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator"

export class ClawfarmSignAndSendTxDto {
    @ApiProperty({
        description: "wallet address that should sign the transaction (must belong to the api-key user)",
    })
    @IsString()
    @IsNotEmpty()
    wallet: string

    @ApiProperty({
        description: "transaction version, e.g. 'legacy' or 'v0'",
    })
    @IsString()
    @IsNotEmpty()
    transaction_version: string

    @ApiProperty({
        description: "base64-encoded unsigned transaction",
    })
    @IsString()
    @IsNotEmpty()
    transaction_base64: string

    @ApiProperty({
        description: "purpose tag, recorded for auditing only",
    })
    @IsString()
    @IsNotEmpty()
    purpose: string

    @ApiProperty({
        description: "arbitrary metadata, recorded for auditing only",
        required: false,
    })
    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>
}

export class ClawfarmSignAndSendTxResponseDto {
    @ApiProperty({
        description: "on-chain transaction signature",
    })
    signature: string
}
