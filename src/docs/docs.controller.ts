import { Controller, Get, UseGuards, Req } from "@nestjs/common"
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiExcludeController } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { DocsService } from "./docs.service"
import { UserJwtExtractDto } from "../user/user.controller"
@ApiExcludeController()
@Controller("/api/v1/docs")
export class DocsController {
    constructor(private readonly docsService: DocsService) {}

    @Get("/content")
    @UseGuards(AuthGuard("jwt"))
    getContent(@Req() req: Request) {
        const user = req.user as UserJwtExtractDto
        return this.docsService.getContent(user)
    }
}
