import { Controller, Get, Param, UseGuards } from "@nestjs/common"
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"

import { PriceService } from "./price.service"
import { PercentageToCreditsDTO } from "./price.dto"

@ApiTags("IP Tokens")
@Controller("/api/v1/web3/price")
export class PriceController {
    constructor(private readonly priceService: PriceService) {}

    @Get("/percentage-to-credits/:percentage")
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Percentage to price",
        description:
            "Convert a percentage to the need usdcs and expect purchased giggle tokens when launch ip token, percentage must be between 1 and 98",
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
