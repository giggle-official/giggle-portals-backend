import { ApiProperty } from "@nestjs/swagger"

export class GiggleTokenPriceDTO {
    @ApiProperty({
        description: "credit to solana number",
        example: 0.0008,
    })
    sol: number
    @ApiProperty({
        description: "credit to giggle token number",
        example: 100,
    })
    tokens: number
}

export class PercentageToCreditsDTO {
    @ApiProperty({
        description: "credits to be consumed",
        example: 100,
    })
    credits: number

    @ApiProperty({
        description: "usdt to be consumed",
        example: 100,
    })
    usdc: number

    @ApiProperty({
        description: "required solana number when buy this percentage",
        example: 0.008,
    })
    sols: number

    @ApiProperty({
        description: "giggle tokens",
        example: 100000,
    })
    giggle_tokens: number
}
