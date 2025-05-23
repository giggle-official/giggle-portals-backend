import { HttpService } from "@nestjs/axios"
import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { AxiosRequestConfig } from "axios"
import { HttpsProxyAgent } from "https-proxy-agent"
import { async, lastValueFrom } from "rxjs"
import { GiggleTokenPriceDTO, PercentageToCreditsDTO } from "./price.dto"

@Injectable()
export class PriceService {
    private readonly logger = new Logger(PriceService.name)
    public static readonly CREDIT2USD_PRICE = 0.008
    public static readonly DEFAULT_GIGGLE_TOKENS = 1078000000
    public static readonly DEFAULT_GIGGLE_CAN_PURCHASE_TOKENS = 1000000000
    public static readonly DEFAULT_GIGGLE_ADJUSTMENT = 5390000000
    public static readonly DEFAULT_GIGGLE_ADJUSTMENT_DIVISOR = 5
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

    async getGiggleTokenPrice(credits: number): Promise<GiggleTokenPriceDTO> {
        try {
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
            const solanaPrice = data.data.solana.usd

            const sols = (PriceService.CREDIT2USD_PRICE * credits) / solanaPrice

            return {
                sol: sols,
                tokens:
                    PriceService.DEFAULT_GIGGLE_TOKENS -
                    PriceService.DEFAULT_GIGGLE_ADJUSTMENT / (PriceService.DEFAULT_GIGGLE_ADJUSTMENT_DIVISOR + sols),
            }
        } catch (error) {
            this.logger.error(error)
            throw new Error("Failed to get giggle token price")
        }
    }

    async getPercentageToCredits(percentage: number): Promise<PercentageToCreditsDTO> {
        if (percentage === 0) {
            return {
                credits: 0,
                sols: 0,
                giggle_tokens: 0,
                usdc: 0,
            }
        }
        if (percentage < 0 || percentage > 98) {
            throw new BadRequestException("Percentage must be between 1 and 98")
        }

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
        const solanaPrice = data.data.solana.usd

        const giggleTokens = Math.floor((percentage * PriceService.DEFAULT_GIGGLE_CAN_PURCHASE_TOKENS) / 100)
        const neededSols =
            PriceService.DEFAULT_GIGGLE_ADJUSTMENT / (PriceService.DEFAULT_GIGGLE_TOKENS - giggleTokens) -
            PriceService.DEFAULT_GIGGLE_ADJUSTMENT_DIVISOR
        const neededUsdt = neededSols * solanaPrice

        return {
            sols: neededSols,
            credits: Math.floor((neededSols * solanaPrice) / PriceService.CREDIT2USD_PRICE),
            giggle_tokens: giggleTokens,
            usdc: neededUsdt,
        }
    }
}
