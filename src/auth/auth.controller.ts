import { Controller, Get, Post, HttpCode, HttpStatus, UseGuards, Req, Body, Headers } from "@nestjs/common"
import { ApiResponse, ApiBody, ApiOperation, ApiTags, ApiExcludeEndpoint } from "@nestjs/swagger"
import { LoginDTO, EmailLoginDto, UserJwtExtractDto } from "src/user/user.controller"
import { AuthService } from "./auth.service"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { EmailConfirmationDto, GoogleLoginConfigDto, LoginResponseDTO, LoginWithCodeReqDto } from "./auth.dto"

@ApiTags("Auth")
@Controller({ path: "api/v1/auth" })
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("local"))
    @Post("/login")
    @ApiBody({
        type: EmailLoginDto,
    })
    @ApiResponse({
        status: 200,
        type: LoginDTO,
    })
    @HttpCode(HttpStatus.OK)
    async loginWithEmail(@Req() req: Request) {
        return await this.authService.login(req.user as UserJwtExtractDto)
    }

    /*
    @ApiExcludeEndpoint()
    @Post("/app-token")
    @ApiBody({
        type: AppTokenDto,
    })
    @ApiResponse({
        status: 200,
        type: LoginDTO,
    })
    @ApiOperation({
        summary: "Get a token for app user",
        deprecated: true,
        description: `
        This api only use for app user, to get app id and app secret, please [contact us](https://3bodylabs.ai/contact-us).
        
        `,
    })
    @UseGuards(AuthGuard("app"))
    @HttpCode(HttpStatus.OK)
    async loginWithAppToken(@Req() req: Request) {
        return {}
    }
    */

    @ApiExcludeEndpoint()
    @Get("/google/get-config")
    async googleLogin() {
        return {
            client_id: process.env.GOOGLE_CLIENT_ID,
            redirect_uri: process.env.GOOGLE_CALLBACK_URL,
        }
    }

    @ApiExcludeEndpoint()
    @Post("/google/exchange-code")
    async googleAuth(
        @Body() body: GoogleLoginConfigDto,
        @Headers("app-id") app_id: string,
        @Headers("x-device-id") device_id: string,
    ) {
        return await this.authService.exchangeCode(body.code, app_id, device_id)
    }

    @ApiExcludeEndpoint()
    @Post("/emailConfirmation")
    @ApiBody({
        type: EmailConfirmationDto,
    })
    @HttpCode(HttpStatus.OK)
    async confirm(@Body() confirmInfo: EmailConfirmationDto) {
        return this.authService.confirmEmail(confirmInfo)
    }

    @Post("/loginWithCode")
    @ApiBody({
        type: LoginWithCodeReqDto,
    })
    @ApiResponse({
        status: 200,
        type: LoginResponseDTO,
    })
    @ApiOperation({
        summary: "Login with code",
    })
    @UseGuards(AuthGuard("code"))
    @HttpCode(HttpStatus.OK)
    async loginWithCode(@Req() req: Request) {
        return this.authService.login(req.user as UserJwtExtractDto)
    }
}
