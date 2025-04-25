import { Controller, HttpCode, HttpStatus, Post, Req, Body, UseGuards, Headers, Get, Param } from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
import { UserInfoDTO } from "src/user/user.controller"
import { CreateIpOrderDto } from "../ip-library.dto"
import { ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { IpOrderService } from "./ip-order.service"
import { OrderDetailDto } from "src/payment/order/order.dto"
import { Request } from "express"
import { CheckIpOrderDto, CheckIpOrderListDto } from "./ip-order.dto"

@ApiTags("IP Order")
@Controller("/api/v1/ip/order")
export class IpOrderController {
    constructor(private readonly ipOrderService: IpOrderService) {}

    @Post("/create-ip-order")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBody({ type: CreateIpOrderDto })
    @ApiResponse({ type: OrderDetailDto })
    @ApiOperation({
        summary: "Create an ip order",
    })
    async createIpOrder(@Req() req: Request, @Body() body: CreateIpOrderDto, @Headers("app-id") app_id?: string) {
        return await this.ipOrderService.createIpOrder(req.user as UserInfoDTO, body, app_id)
    }

    @Post("/callback")
    @ApiExcludeEndpoint()
    @HttpCode(HttpStatus.OK)
    async orderCallback(@Body() body: OrderDetailDto) {
        return await this.ipOrderService.orderCallback(body)
    }

    @Get("/")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Get ip order list",
    })
    @ApiResponse({ type: CheckIpOrderListDto })
    async getIpOrderList(@Req() req: Request, @Headers("app-id") app_id: string) {
        return await this.ipOrderService.getIpOrderList(req.user as UserInfoDTO, app_id)
    }

    @Get("/:order_id")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({
        summary: "Check ip order",
    })
    @ApiResponse({ type: CheckIpOrderDto })
    async checkIpOrder(@Param("order_id") order_id: string, @Req() req: Request) {
        return await this.ipOrderService.ipOrderDetail(order_id, req.user as UserInfoDTO)
    }
}
