import { Controller, Get, Param, UseGuards } from "@nestjs/common"
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"

import { PriceService } from "./price.service"
import { GiggleTokenPriceDTO, PercentageToCreditsDTO } from "./price.dto"

@ApiTags("IP Tokens")
@Controller("/api/v1/web3/price")
export class PriceController {
    constructor(private readonly priceService: PriceService) {}

    @ApiExcludeEndpoint()
    @Get("/giggle-tokens/:credits")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Credits to giggle tokens",
        description: "Convert credit numbers to solana and giggle token numbers",
    })
    @ApiResponse({
        status: 200,
        description: "The giggle token price",
        type: GiggleTokenPriceDTO,
    })
    async getGiggleTokens(@Param("credits") credits: number) {
        return await this.priceService.getGiggleTokenPrice(credits)
    }

    @Get("/percentage-to-credits/:percentage")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Percentage to price",
        description:
            "Convert a percentage to the price of the ip token when create ip token, percentage must be between 1 and 98",
    })
    @ApiResponse({
        status: 200,
        description: "The price of the ip token when create ip token",
        type: PercentageToCreditsDTO,
    })
    async getPercentageToCredits(@Param("percentage") percentage: number) {
        return await this.priceService.getPercentageToCredits(percentage)
    }
}
