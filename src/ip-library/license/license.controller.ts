import { Body, Controller, Get, HttpStatus, HttpCode, Param, Post, Query, Req, UseGuards, Sse } from "@nestjs/common"
import { ApiResponse, ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { UserInfoDTO } from "src/user/user.controller"
import { Request } from "express"
import { LicenseService } from "./license.service"
import { IpLibraryDetailDto } from "../ip-library.dto"
import { LicenseOrderDetailDto, OrderCreateDto, LicenseIpListDto, LicenseIpListReqParams } from "./license.dto"
import { NologInterceptor } from "src/common/bypass-nolog.decorator"
import { Observable } from "rxjs"
import { SSEMessage } from "src/web3/giggle/giggle.dto"

@Controller("/api/v1/ip/license")
@ApiTags("License")
export class LicenseController {
    constructor(private readonly licenseService: LicenseService) {}

    /*
    @Get("/")
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @ApiOperation({ summary: "Get user's ip license orders" })
    @ApiResponse({ type: LicenseListResDto, status: 200 })
    async list(@Req() req: Request, @Query() query: LicenseListReqParams): Promise<LicenseListResDto> {
        return await this.licenseService.list(req.user as UserInfoDTO, query)
    }
    */

    @Get("/ips")
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @ApiOperation({ summary: "Get user purchased ips" })
    @ApiResponse({ type: LicenseIpListDto, status: 200 })
    async ipList(@Req() req: Request, @Query() query: LicenseIpListReqParams): Promise<LicenseIpListDto> {
        return await this.licenseService.ipList(req.user as UserInfoDTO, query)
    }

    @Post("/purchase")
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Purchase ip license" })
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    async purchase(@Req() req: Request, @Body() body: OrderCreateDto): Promise<LicenseOrderDetailDto> {
        return await this.licenseService.purchase(req.user as UserInfoDTO, body)
    }

    @Post("/purchaseWithEvent")
    @Sse("/purchaseWithEvent")
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Purchase ip license" })
    @NologInterceptor()
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    purchaseWithEvent(@Req() req: Request, @Body() body: OrderCreateDto): Observable<SSEMessage> {
        return this.licenseService.purchaseWithEvent(req.user as UserInfoDTO, body)
    }
}
