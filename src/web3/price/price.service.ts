import { HttpService } from "@nestjs/axios"
import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { AxiosRequestConfig } from "axios"
import { HttpsProxyAgent } from "https-proxy-agent"
import { lastValueFrom } from "rxjs"
import { PercentageToCreditsDTO } from "./price.dto"

@Injectable()
export class PriceService {
    private readonly logger = new Logger(PriceService.name)
    public static readonly DEFAULT_GIGGLE_TOKENS = 1100000000
    public static readonly DEFAULT_GIGGLE_CAN_PURCHASE_TOKENS = 1000020000
    public static readonly DEFAULT_GIGGLE_ADJUSTMENT = 628100000000
    public static readonly DEFAULT_GIGGLE_INITIAL_AMOUNT_IN_POOL = 571
    private readonly apiUrl = "https://api.coingecko.com/api/v3/simple/price"
    private readonly proxy = process.env.HTTP_PROXY
    private readonly apiKey: string = process.env.COINGECKO_API_KEY
    private readonly priceRequestHeaders: AxiosRequestConfig = {
        headers: {
            "x-cg-demo-api-key": this.apiKey,
            "Content-Type": "application/json",
        },
    }

    constructor(private readonly httpService: HttpService) {
        if (!this.apiKey) {
            throw new Error("COINGECKO_API_KEY is not set")
        }
    }

    async getSolPrice(): Promise<number> {
        const request: AxiosRequestConfig = {
            params: {
                ids: "solana",
                vs_currencies: "usd",
            },
            ...this.priceRequestHeaders,
        }

        if (this.proxy) {
            request.httpsAgent = new HttpsProxyAgent(this.proxy)
        }

        const response = this.httpService.get(this.apiUrl, request)
        const data = await lastValueFrom(response)
        return data.data.solana.usd
    }

    async getPercentageToCredits(percentage: number): Promise<PercentageToCreditsDTO> {
        if (percentage === 0) {
            return {
                giggle_tokens: 0,
                usdc: 0,
            }
        }
        if (percentage < 0 || percentage > 98) {
            throw new BadRequestException("Percentage must be between 1 and 98")
        }

        const maxGiggleTokens = PriceService.DEFAULT_GIGGLE_CAN_PURCHASE_TOKENS * 0.98
        const expectedGiggleTokens = Math.min(
            Math.floor((percentage * PriceService.DEFAULT_GIGGLE_CAN_PURCHASE_TOKENS) / 100),
            maxGiggleTokens,
        )

        const neededUsdcs =
            PriceService.DEFAULT_GIGGLE_ADJUSTMENT / (PriceService.DEFAULT_GIGGLE_TOKENS - expectedGiggleTokens) -
            PriceService.DEFAULT_GIGGLE_INITIAL_AMOUNT_IN_POOL

        return {
            giggle_tokens: expectedGiggleTokens,
            usdc: neededUsdcs,
        }
    }
}
