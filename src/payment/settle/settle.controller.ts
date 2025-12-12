import { IsAdminGuard } from "src/auth/is_admin.guard"
import { SettleService } from "./settle.service"
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common"
import { ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger"
import { CreateSettleOrderDto, CreateSettleUserDto } from "./settle.dto"

@Controller("/api/v1/node-admin")
export class SettleController {
    constructor(private readonly settleService: SettleService) {}

    @Post("post-user-to-settle")
    @ApiTags("Developer Utility")
    @HttpCode(HttpStatus.OK)
    @ApiBody({ type: CreateSettleUserDto })
    @ApiOperation({ summary: "Post user to settle" })
    @UseGuards(IsAdminGuard)
    async postUserToSettle(@Body() body: CreateSettleUserDto) {
        return this.settleService.postUserToSettle(body.user_email)
    }

    @Post("post-order-to-settle")
    @ApiTags("Developer Utility")
    @HttpCode(HttpStatus.OK)
    @ApiBody({ type: CreateSettleOrderDto })
    @ApiOperation({ summary: "Post order to settle" })
    @UseGuards(IsAdminGuard)
    async postOrderToSettle(@Body() body: CreateSettleOrderDto) {
        return this.settleService.PostOrderToSettleByOrderId(body.order_id)
    }
}
