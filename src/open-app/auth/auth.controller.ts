import { Body, Controller, Post, Headers, HttpCode, HttpStatus, Req } from "@nestjs/common"
import { AuthService } from "./auth.service"
import {
    CheckTokenDto,
    CheckTokenResponseDto,
    GetBindCodeDto,
    GetBindCodeResponseDto,
    LoginDto,
    LoginResponseDto,
    ConfirmBindDto,
    ConfirmBindResponseDto,
} from "./auto.dto"
import { ApiResponse, ApiTags, ApiOperation, ApiBody } from "@nestjs/swagger"
@Controller("/api/v1/app/auth")
@ApiTags("Auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post("/login")
    @ApiOperation({ summary: "request login app", description: "this api is used to request login app" })
    @ApiBody({ type: LoginDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: LoginResponseDto })
    async login(@Body() body: LoginDto, @Headers("origin") origin: string) {
        return this.authService.login(body, origin)
    }

    @Post("/check-login-token")
    @ApiOperation({ summary: "check login token", description: "this api is used to check login token" })
    @ApiBody({ type: CheckTokenDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: CheckTokenResponseDto })
    async checkToken(@Body() body: CheckTokenDto) {
        return this.authService.checkToken(body)
    }

    @Post("/get-bind-code")
    @ApiOperation({ summary: "get bind code", description: "this api is used to get bind code" })
    @ApiBody({ type: GetBindCodeDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: GetBindCodeResponseDto })
    async getBindCode(@Body() body: GetBindCodeDto) {
        return this.authService.sendBindCode(body)
    }

    @Post("/confirm-bind-code")
    @ApiOperation({ summary: "confirm bind app", description: "this api is used to confirm binding an external app" })
    @ApiBody({ type: ConfirmBindDto })
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: ConfirmBindResponseDto })
    async confirmBindApp(@Body() body: ConfirmBindDto) {
        return this.authService.confirmBindApp(body)
    }
}
