import {
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    Req,
    Body,
    ParseFilePipe,
    MaxFileSizeValidator,
    FileTypeValidator,
    Get,
    Query,
    Sse,
    Param,
    ForbiddenException,
} from "@nestjs/common"
import { GiggleService } from "./giggle.service"
import { Request } from "express"
import {
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
    ApiExcludeEndpoint,
    ApiOperation,
    ApiResponse,
    ApiTags,
} from "@nestjs/swagger"
import { FileInterceptor } from "@nestjs/platform-express"
import { AuthGuard } from "@nestjs/passport"
import {
    CreateIpTokenDto,
    GetIpTokenListQueryDto,
    GetIpTokenListResponseDto,
    SendTokenDto,
    SendTokenResponseDto,
    SSEMessage,
    TradeDto,
    TradeResponseDto,
    UploadCoverImageResponseDto,
    UserMarketCapDto,
} from "./giggle.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { NologInterceptor } from "src/common/bypass-nolog.decorator"

@ApiTags("Web3 Giggle")
@Controller("/api/v1/web3/giggle")
export class GiggleController {
    constructor(private readonly giggleService: GiggleService) {}

    @Post("/cover-image/upload")
    @ApiOperation({ summary: "Upload cover image" })
    @ApiConsumes("multipart/form-data")
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: UploadCoverImageResponseDto, status: 200 })
    @UseInterceptors(FileInterceptor("file"))
    @ApiBody({
        schema: {
            type: "object",
            properties: {
                file: {
                    type: "string",
                    format: "binary",
                },
            },
        },
    })
    async uploadCoverImage(
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
                    new FileTypeValidator({ fileType: /(jpg|jpeg|png)$/ }),
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        return this.giggleService.uploadCoverImage(file)
    }

    @ApiExcludeEndpoint()
    @Post("/sign-test")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async signTest(@Body() body: Record<string, any>) {
        return this.giggleService.signTest(body)
    }

    @Get("/get-ip-token-list")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Get IP token list" })
    @ApiResponse({ type: GetIpTokenListResponseDto, status: 200 })
    async getIpTokenList(@Query() query: GetIpTokenListQueryDto) {
        return this.giggleService.getIpTokenList(query)
    }

    @Get("/user-market-cap/:user_id")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Get user market cap" })
    @ApiResponse({ type: UserMarketCapDto, status: 200 })
    async getUserMarketCap(@Param("user_id") user_id: string) {
        return this.giggleService.getUserMarketCap({ usernameShorted: user_id })
    }

    @Post("/trade")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @ApiBody({ type: TradeDto })
    @ApiOperation({ summary: "Trade ip token" })
    @ApiResponse({ type: TradeResponseDto, status: 200 })
    async trade(@Req() req: Request, @Body() body: TradeDto) {
        return this.giggleService.trade(req.user as UserInfoDTO, body)
    }

    @Post("/top-up")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @ApiOperation({ summary: "Top up" })
    @ApiResponse({ type: String, status: 200, description: "top up url" })
    async topUp(@Req() req: Request) {
        return await this.giggleService.topUp(req.user as UserInfoDTO)
    }

    @Post("/send")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @ApiBody({ type: SendTokenDto })
    @ApiOperation({ summary: "Send Tokens" })
    @ApiResponse({ type: SendTokenResponseDto, status: 200 })
    async send(@Req() req: Request, @Body() body: SendTokenDto) {
        return this.giggleService.sendToken(req.user as UserInfoDTO, body)
    }

    @Get("/get-stripe-pkey")
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    async getStripePkey() {
        return process.env.GIGGLE_STRIPE_PK
    }

    @Get("/create-onramp-session")
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async createOnrampSession(@Req() req: Request) {
        return this.giggleService.createOnrampSession(req.user as UserInfoDTO)
    }

    @Get("/usdc-balance")
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async usdcBalance(@Req() req: Request) {
        return this.giggleService.getUsdcBalance(req.user as UserInfoDTO)
    }
    /*
    @Post("/payment-callback")
    @HttpCode(HttpStatus.OK)
    @ApiBody({ type: PaymentCallbackDto })
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @ApiOperation({ summary: "Payment callback" })
    @ApiResponse({ type: PaymentResponseDto, status: 200 })
    //@ApiExcludeEndpoint()
    async paymentCallback(@Req() req: Request, @Body() body: PaymentCallbackDto) {
        return this.giggleService.paymentCallback(body)
    }
    */
}
