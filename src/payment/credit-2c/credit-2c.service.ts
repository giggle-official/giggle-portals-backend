import { HttpService } from "@nestjs/axios"
import { BadRequestException, HttpStatus, Injectable, Logger } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { lastValueFrom } from "rxjs"
import { AxiosResponse } from "axios"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Credit2cBalanceDto, Credit2cResponse } from "./credit-2c.dto"
import { orders } from "@prisma/client"

@Injectable()
export class Credit2cService {
    public readonly logger = new Logger(Credit2cService.name)
    private readonly credit2cApiUrl = process.env.C2_API_ENDPOINT
    private readonly credit2cApiKey = process.env.C2_API_KEY
    private readonly credit2cApiSecret = process.env.C2_API_SECRET
    private readonly credit2cHkUrl = process.env.C2_HK_URL

    constructor(
        private readonly jwtService: JwtService,
        private readonly httpService: HttpService,
    ) {
        if (!this.credit2cApiUrl || !this.credit2cApiKey || !this.credit2cApiSecret || !this.credit2cHkUrl) {
            throw new Error("C2_API_ENDPOINT or C2_API_KEY or C2_API_SECRET or C2_HK_URL is not set")
        }
    }

    getAuthorizedToken(email: string) {
        return this.jwtService.sign(
            {
                iss: this.credit2cApiKey,
                email: email,
            },
            {
                secret: this.credit2cApiSecret,
                expiresIn: "10m",
            },
        )
    }

    async getCredit2cBalance(user: UserJwtExtractDto): Promise<Credit2cBalanceDto> {
        const response: AxiosResponse<Credit2cResponse<Credit2cBalanceDto>> = await lastValueFrom(
            this.httpService.get(`${this.credit2cApiUrl}/api/v1/ipos/credit-balance`, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.getAuthorizedToken(user.email)}`,
                },
            }),
        )
        if (response.status !== 200) {
            this.logger.error("Failed to get credit2c balance: " + JSON.stringify(response.data))
            throw new BadRequestException("Failed to get credit2c balance")
        }
        return response.data.data
    }

    async getTopUpUrl(user: UserJwtExtractDto): Promise<{ url: string }> {
        const url = new URL(this.credit2cHkUrl + "/top-up")
        url.searchParams.set("access_token", this.getAuthorizedToken(user.email))
        url.searchParams.set("show-header", "false")
        url.searchParams.set("close_window_after_payment", "true")
        return { url: url.toString() }
    }

    async payWithCredit2c(user: UserJwtExtractDto, order: orders): Promise<void> {
        const balance = await this.getCredit2cBalance(user)
        if (balance.balance < order.amount) {
            throw new BadRequestException("Insufficient balance")
        }

        try {
            const response: AxiosResponse<Credit2cResponse<{ success: boolean }>> = await lastValueFrom(
                this.httpService.post(
                    `${this.credit2cApiUrl}/api/v1/ipos/pay-credit`,
                    {
                        amount: order.amount,
                        order_id: order.order_id,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${this.getAuthorizedToken(user.email)}`,
                        },
                    },
                ),
            )
            if (response.data.code !== HttpStatus.OK) {
                throw new Error(response.data.msg)
            }
        } catch (error) {
            this.logger.error(`Failed to pay order:${order.order_id} with credit2c: ${JSON.stringify(error)}`)
            throw new BadRequestException("Failed to process payment")
        }
    }
}
