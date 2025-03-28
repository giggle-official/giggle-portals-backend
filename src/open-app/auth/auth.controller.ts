import { Body, Controller, Post, Headers, HttpCode, HttpStatus } from "@nestjs/common"
import { AuthService } from "./auth.service"
import { LoginDto, LoginResponseDto } from "./auto.dto"
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
    async login(@Body() body: LoginDto, @Headers("host") host: string) {
        return this.authService.login(body, host)
    }
}
