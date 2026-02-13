import { Controller, Get, Post, HttpCode, HttpStatus, Req, UseGuards, Body } from "@nestjs/common"
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from "@nestjs/swagger"
import { Request } from "express"
import { AuthGuard } from "@nestjs/passport"
import { ApiKeysService } from "./api-keys.service"
import { ApiKeyDTO, DisableApiKeyDTO } from "./api-keys.dto"
import { UserJwtExtractDto } from "../user.controller"

@Controller({ path: "api/v1/user/api-keys" })
@ApiTags("API Keys")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
export class ApiKeysController {
    constructor(private readonly apiKeysService: ApiKeysService) { }

    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: "List API keys",
        description: "List all active API keys for the authenticated user",
    })
    @ApiResponse({
        status: 200,
        type: [ApiKeyDTO],
        description: "List of API keys",
    })
    async getApiKeys(@Req() req: Request) {
        return this.apiKeysService.list(req.user as UserJwtExtractDto)
    }

    @Post("generate")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: "Generate a new API key",
        description: "Generate a new API key for the authenticated user. A user can have up to 10 active API keys.",
    })
    @ApiResponse({
        status: 200,
        type: [ApiKeyDTO],
        description: "Updated list of API keys after generation",
    })
    async generateApiKey(@Req() req: Request) {
        return await this.apiKeysService.generate(req.user as UserJwtExtractDto)
    }

    @Post("disable")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: "Disable an API key",
        description: "Disable an existing API key by its id",
    })
    @ApiBody({
        type: DisableApiKeyDTO,
    })
    @ApiResponse({
        status: 200,
        type: [ApiKeyDTO],
        description: "Updated list of API keys after disabling",
    })
    async disableApiKey(@Req() req: Request, @Body() apiKey: DisableApiKeyDTO) {
        return await this.apiKeysService.disable(req.user as UserJwtExtractDto, apiKey.id)
    }
}
