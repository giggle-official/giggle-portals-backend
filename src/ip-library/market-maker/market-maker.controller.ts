import { Controller, Get, UseGuards, Req, Post, Body, Query, Sse, HttpStatus, HttpCode } from "@nestjs/common"
import { MarketMakerService } from "./market-maker.service"
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request } from "express"
import { IsAdminGuard } from "src/auth/is_admin.guard"
import { CreateMarketMakerDto, IpDelegationQueryDto, LaunchIpTokenByMarketMakerDto } from "./market-maker.dto"
import { SSEMessage } from "src/web3/giggle/giggle.dto"
import { NologInterceptor } from "src/common/bypass-nolog.decorator"
import { ValidEventBody } from "src/common/rawbody.decorator"

@Controller("/api/v1/market-maker")
@ApiTags("Market Maker")
export class MarketMakerController {
    constructor(private readonly marketMakerService: MarketMakerService) {}

    @Get("/info")
    @ApiOperation({ summary: "Get market maker info" })
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async getInfo(@Req() req: Request) {
        return await this.marketMakerService.getInfo(req.user as UserJwtExtractDto)
    }

    @Get("/ip-delegation")
    @ApiOperation({ summary: "Get ip delegation list" })
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async getIpDelegation(@Req() req: Request, @Query() query: IpDelegationQueryDto) {
        return await this.marketMakerService.getIpDelegation(req.user as UserJwtExtractDto, query)
    }

    @Post("/create")
    @ApiOperation({ summary: "Create market maker" })
    @UseGuards(IsAdminGuard)
    @ApiBody({ type: CreateMarketMakerDto })
    @ApiBearerAuth()
    async apply(@Body() body: CreateMarketMakerDto) {
        return await this.marketMakerService.create(body)
    }

    @Post("/launch-ip-token")
    @Sse("/launch-ip-token")
    @ApiBody({ type: LaunchIpTokenByMarketMakerDto })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiOperation({
        summary: "Launch ip token",
        description: `
Returns SSE stream with progress updates and final result, same as /launch-ip-token
`,
    })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @NologInterceptor()
    launchIpToken(@Req() req: Request, @ValidEventBody() body: LaunchIpTokenByMarketMakerDto) {
        return this.marketMakerService.launchIpToken(req.user as UserJwtExtractDto, body)
    }
}
