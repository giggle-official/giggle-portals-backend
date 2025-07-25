import { ApiHideProperty, ApiProperty } from "@nestjs/swagger"

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
        description: "usdt to be consumed",
        example: 100,
    })
    usdc: number

    @ApiProperty({
        description: "giggle tokens",
        example: 100000,
    })
    giggle_tokens: number
}
