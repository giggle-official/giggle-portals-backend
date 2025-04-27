import { Controller, Get, Post, HttpCode, HttpStatus, UseGuards, Req, Res, Body } from "@nestjs/common"
import { ApiResponse, ApiBody, ApiOperation, ApiTags, ApiExcludeEndpoint } from "@nestjs/swagger"
import { LoginDTO, EmailLoginDto, UserInfoDTO, UserJwtExtractDto } from "src/user/user.controller"
import { AuthService } from "./auth.service"
import { AuthGuard } from "@nestjs/passport"
import { Request, Response } from "express"
import { AppTokenDto, EmailConfirmationDto, LoginResponseDTO, LoginWithCodeReqDto } from "./auth.dto"
import { BypassInterceptor } from "src/common/bypass-interceptor.decorator"

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
    @Get("google/login")
    @BypassInterceptor()
    async googleLogin(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        res.cookie("redirectUrl", req.query.redirect_to || "/")
        return res.redirect(process.env.FRONTEND_URL + "/api/v1/auth/google")
    }

    @ApiExcludeEndpoint()
    @Get("google")
    @UseGuards(AuthGuard("google"))
    async googleAuth(@Req() req: Request) {}

    @ApiExcludeEndpoint()
    @Get("google/callback")
    @UseGuards(AuthGuard("google"))
    @BypassInterceptor()
    async googleAuthRedirect(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const loginResponse = await this.authService.login(req.user as UserJwtExtractDto)
        let to = process.env.FRONTEND_URL + "/user/login?token=" + loginResponse.access_token
        if (req.cookies.redirectUrl && req.cookies.redirectUrl !== "null") {
            const redirectUrl = req.cookies.redirectUrl
            res.clearCookie("redirectUrl")
            to += "&redirect_to=" + redirectUrl
        }
        return res.redirect(to)
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
