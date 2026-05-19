import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiBody, ApiExcludeEndpoint, ApiHeader, ApiOperation, ApiResponse } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { GiggleService } from "../giggle/giggle.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { ClawfarmServiceGuard } from "./clawfarm-service.guard"
import { ClawfarmSignAndSendTxDto, ClawfarmSignAndSendTxResponseDto } from "./clawfarm.dto"

@Controller("/api/v1/web3/sign")
export class ClawfarmController {
    private readonly logger = new Logger(ClawfarmController.name)

    constructor(private readonly giggleService: GiggleService) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"), ClawfarmServiceGuard)
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @ApiHeader({ name: "x-api-key", required: true })
    @ApiHeader({ name: "x-clawfarm-service-key", required: true })
    @ApiBody({ type: ClawfarmSignAndSendTxDto })
    @ApiOperation({ summary: "Sign and broadcast a transaction with the api-key user's wallet" })
    @ApiResponse({ type: ClawfarmSignAndSendTxResponseDto, status: 200 })
    async signAndSendTx(
        @Req() req: Request,
        @Body() body: ClawfarmSignAndSendTxDto,
    ): Promise<ClawfarmSignAndSendTxResponseDto> {
        const user = req.user as UserJwtExtractDto

        this.logger.log(
            `clawfarm sign request: user=${user.usernameShorted}, wallet=${body.wallet}, purpose=${body.purpose}, metadata=${JSON.stringify(body.metadata || {})}`,
        )

        const signature = await this.giggleService.signTxAndThrowError(
            body.transaction_base64,
            [body.wallet],
            user.email,
        )

        return { signature }
    }
}
