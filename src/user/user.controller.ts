import {
    Controller,
    Get,
    Post,
    HttpCode,
    HttpStatus,
    Req,
    UseGuards,
    Body,
    BadRequestException,
    UseInterceptors,
    UploadedFile,
    ParseFilePipe,
    MaxFileSizeValidator,
    FileTypeValidator,
    Query,
    Headers,
} from "@nestjs/common"
import {
    ApiResponse,
    ApiProperty,
    ApiBody,
    PickType,
    IntersectionType,
    ApiTags,
    ApiExcludeEndpoint,
    ApiBearerAuth,
    ApiOperation,
} from "@nestjs/swagger"
import { Request } from "express"
import { UserService } from "./user.service"
import { AuthGuard } from "@nestjs/passport"
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"
import { EmailConfirmationDto } from "../auth/auth.dto"
import { FileInterceptor } from "@nestjs/platform-express"
import { Recaptcha } from "@nestlab/google-recaptcha"
import {
    ContactDTO,
    UserWalletDetailDto,
    UserFollowDto,
    UserUnFollowDto,
    LoginCodeReqDto,
    LoginCodeResponseDto,
    UserWalletDetailQueryDto,
} from "./user.dto"
import { ApiKeysService } from "./api-keys/api-keys.service"
import { DisableApiKeyDTO } from "./api-keys/api-keys.dto"
import { JwtPermissions } from "src/casl/casl-ability.factory/jwt-casl-ability.factory"
import { LinkSummaryDto } from "src/open-app/link/link.dto"
import { userInfo } from "os"

export class nouceDto {
    @ApiProperty()
    nouce: string
}

export class SignatureDTO {
    @ApiProperty()
    message: string
    @ApiProperty()
    signature: string
}

export class LoginDTO {
    address?: string
    username?: string
    password?: string
}

export class RegisterInfoDTO {
    @ApiProperty({
        description: "The type of the register info",
        enum: ["link", "direct", "app", "widget", "other"],
    })
    type: "link" | "direct" | "app" | "widget" | "other"

    @ApiProperty({
        description: "The source link summary of the register info",
        type: () => LinkSummaryDto,
    })
    source_link_summary?: LinkSummaryDto

    @ApiProperty({
        description: "The source link of the register info",
    })
    source_link?: string

    @ApiProperty({
        description: "The app id of the register info",
    })
    app_id?: string

    @ApiProperty({
        description: "The widget tag of the register info",
    })
    from_widget_tag?: string
}

export class UserInfoDTO extends LoginDTO {
    @ApiProperty()
    usernameShorted: string
    @ApiProperty()
    email?: string

    @ApiProperty()
    emailConfirmed?: boolean

    @ApiProperty()
    avatar?: string

    @ApiProperty()
    username?: string

    @ApiProperty()
    description?: string

    @ApiProperty()
    followers?: number

    @ApiProperty()
    following?: number

    @ApiProperty()
    app_id?: string

    @ApiProperty()
    can_create_ip?: boolean

    @ApiProperty()
    is_developer?: boolean

    @ApiProperty()
    permissions?: JwtPermissions[]

    @ApiProperty()
    device_id?: string

    @ApiProperty()
    widget_info?: {
        user_subscribed: boolean
        widget_tag: string
        app_id: string
    }

    @ApiProperty({
        type: () => RegisterInfoDTO,
    })
    register_info?: RegisterInfoDTO
}

export class EmailLoginDto extends PickType(UserInfoDTO, ["email", "password"]) {}
export class EmailUserCreateDto extends EmailLoginDto {
    @ApiProperty()
    @IsString()
    @IsOptional()
    invite_code?: string
} //todo: verify email

export class UserJwtExtractDto extends PickType(UserInfoDTO, [
    "email",
    "username",
    "usernameShorted",
    "device_id",
    "is_developer",
    "avatar",
]) {
    @ApiProperty()
    widget_session_id?: string

    is_admin?: boolean
}

export class CreateUserDto {
    username: string
    password: string
    email: string
    usernameShorted: string
    app_id: string
    from_source_link: string
    from_device_id: string
}

export class UserInfoExtraDTO {
    @ApiProperty()
    id: number
    @ApiProperty()
    email: string
    @ApiProperty()
    walletAddress: string
    @ApiProperty()
    usernameShorted: string
    @ApiProperty()
    firstName?: string
    @ApiProperty()
    lastName?: string
    @ApiProperty()
    address1?: string
    @ApiProperty()
    address2?: string
    @ApiProperty()
    country?: string
    @ApiProperty()
    companyName?: string
    @ApiProperty()
    companyId?: string
    @ApiProperty()
    taxId?: string
}

export class OrderInfoDTO {
    @ApiProperty()
    orderName: string
    @ApiProperty()
    createdAt: Date
    @ApiProperty()
    runningTimes: string
    @ApiProperty()
    totalAmount: number
    @ApiProperty()
    status: number
}

export class ApiKeyDTO {
    @ApiProperty()
    apiKey: string
    @ApiProperty()
    prefix: string
    @ApiProperty()
    createdAt: Date
}

export class DeleteApiKeyReqParam {
    @ApiProperty()
    @IsString()
    prefix: string
}

export class CountryDto {
    @ApiProperty()
    name: string
    @ApiProperty()
    cca2: string
}

export class ReqImageDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty()
    description: string

    @ApiProperty()
    github_repo: string

    @IsBoolean()
    @ApiProperty()
    is_public: boolean

    @ApiProperty()
    logo: string

    @IsString()
    @IsNotEmpty()
    @ApiProperty()
    name: string

    @ApiProperty()
    readme: string

    @IsString()
    @IsNotEmpty()
    @ApiProperty()
    repository: string
}

export class ImageDto extends ReqImageDto {
    @ApiProperty()
    categories: string

    @ApiProperty()
    extra: any

    @ApiProperty()
    source: "community" | "official" | "custom"
}

export class RepositoryInfoDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    name: string

    @ApiProperty()
    @IsNumber()
    @IsNotEmpty()
    id: number
}

export class CreateRepositoryInfoDto extends PickType(RepositoryInfoDto, ["name"]) {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    username: string

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    password: string
}

export class UpdateRepositoryInfoDto extends IntersectionType(CreateRepositoryInfoDto, RepositoryInfoDto) {}
export class DeleteRepositoryInfoDto extends PickType(RepositoryInfoDto, ["id"]) {}
export class ResetPasswordDto extends PickType(UserInfoDTO, ["email"]) {}
export class UpdateProfileReqDto extends PickType(CreateRepositoryInfoDto, ["username"]) {
    @ApiProperty()
    @IsOptional()
    @IsString()
    description?: string
}
export class BindEmailReqDto extends ResetPasswordDto {}
export class CheckResetPasswordTokenDto extends EmailConfirmationDto {}
export class SubmitResetPasswordDto extends EmailConfirmationDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    password: string
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    repeatPassword: string
}

@Controller({ path: "api/v1/user" })
export class UserController {
    constructor(
        private readonly userService: UserService,
        private readonly apiKeysService: ApiKeysService,
    ) {}
    @Get("/profile")
    @ApiTags("Profile")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        type: UserInfoDTO,
    })
    @ApiOperation({
        summary: "Get user profile",
    })
    async profile(@Req() req: Request) {
        try {
            return this.userService.getProfile(req.user as UserJwtExtractDto)
        } catch (error) {
            throw new BadRequestException(error)
        }
    }

    @Get("/web3-wallet")
    @ApiTags("User Wallet")
    @ApiOperation({
        summary: "Get user web3 wallet info",
        description:
            "Get user web3 wallet info, including total balance, ip total market cap, ip license incomes, etc...",
    })
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        type: UserWalletDetailDto,
    })
    async walletDetail(@Req() req: Request, @Query() query: UserWalletDetailQueryDto) {
        return this.userService.getUserWalletDetail(
            req.user as UserJwtExtractDto,
            parseInt(query.page),
            parseInt(query.page_size),
            query.mint,
        )
    }

    /*
    @Post("/create")
    @HttpCode(HttpStatus.OK)
    @ApiBody({
        type: EmailUserCreateDto,
    })
    @ApiExcludeEndpoint()
    async createUser(@Body() user: EmailUserCreateDto) {
        return await this.userService.newEmailUser(user)
    }
    */

    @Post("/resendConfirmationEmail")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiExcludeEndpoint()
    async resendConfirmationEmail(@Req() req: Request) {
        return await this.userService.sendEmailConfirmation(req.user as UserJwtExtractDto)
    }

    @Post("/resetPassword")
    @ApiBody({
        type: ResetPasswordDto,
    })
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    async resetPassword(@Body() email: ResetPasswordDto) {
        return this.userService.resetPassword(email)
    }

    @Post("/checkResetPasswordToken")
    @ApiBody({
        type: CheckResetPasswordTokenDto,
    })
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    async checkResetPasswordToken(@Body() tokenInfo: CheckResetPasswordTokenDto) {
        return this.userService.checkResetPasswordToken(tokenInfo)
    }

    @Post("submitResetPassword")
    @ApiBody({
        type: SubmitResetPasswordDto,
    })
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    async submitResetPassword(@Body() passwordInfo: SubmitResetPasswordDto) {
        return this.userService.submitResetPassword(passwordInfo)
    }

    @Post("bindEmail")
    @ApiBody({
        type: BindEmailReqDto,
    })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiExcludeEndpoint()
    async bindEmail(@Body() emailInfo: BindEmailReqDto, @Req() req: Request) {
        return this.userService.bindEmail(emailInfo, req.user as UserJwtExtractDto)
    }

    @Post("update")
    @ApiBody({
        type: UpdateProfileReqDto,
    })
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiTags("Profile")
    @ApiOperation({
        summary: "Update user profile",
        description: "update username and description",
    })
    async updateProfile(@Body() userInfo: UpdateProfileReqDto, @Req() req: Request) {
        return await this.userService.updateProfile(userInfo, req.user as UserJwtExtractDto)
    }

    @Post("follow")
    @HttpCode(HttpStatus.OK)
    @ApiBody({
        type: UserFollowDto,
    })
    @UseGuards(AuthGuard("jwt"))
    @ApiTags("Profile")
    @ApiOperation({
        summary: "Follow a user",
        description: "follow a user",
    })
    async follow(@Body() user: UserFollowDto, @Req() req: Request) {
        return this.userService.follow(req.user as UserJwtExtractDto, user.user)
    }

    @Post("unfollow")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiBody({
        type: UserUnFollowDto,
    })
    @ApiTags("Profile")
    @ApiOperation({
        summary: "Unfollow a user",
        description: "unfollow a user",
    })
    async unfollow(@Body() user: UserUnFollowDto, @Req() req: Request) {
        return this.userService.unfollow(req.user as UserJwtExtractDto, user.user)
    }

    @Post("uploadAvatar")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @UseInterceptors(FileInterceptor("avatar"))
    @ApiExcludeEndpoint()
    async updateAvatar(
        @Req() req: Request,
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: 1 * 1024 * 1024 }),
                    new FileTypeValidator({ fileType: "image/.[png|jpeg|jpg]" }),
                ],
                fileIsRequired: false,
            }),
        )
        avatar: Express.Multer.File,
    ) {
        return this.userService.updateAvatar(req.user as any, avatar)
    }

    @Post("requestContact")
    @HttpCode(HttpStatus.OK)
    @Recaptcha()
    @ApiBody({
        type: ContactDTO,
    })
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    async requestContact(@Body() contactInfo: ContactDTO) {
        return this.userService.requestContactUs(contactInfo)
    }

    //api-keys
    @Get("api-keys")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiExcludeEndpoint()
    async getApiKeys(@Req() req: Request) {
        return this.apiKeysService.list(req.user as UserJwtExtractDto)
    }

    @Post("api-keys/disable")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiExcludeEndpoint()
    async disableApiKey(@Req() req: Request, @Body() apiKey: DisableApiKeyDTO) {
        return await this.apiKeysService.disable(req.user as UserJwtExtractDto, apiKey.id)
    }

    @Post("api-keys/generate")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiExcludeEndpoint()
    async generateApiKey(@Req() req: Request) {
        return await this.apiKeysService.generate(req.user as UserJwtExtractDto)
    }

    @ApiOperation({
        summary: "Request a login code",
        description:
            "Request a login code to login with code, the code will be sent to the user's email, the code will be valid for 5 minutes",
    })
    @ApiBody({
        type: LoginCodeReqDto,
    })
    @Post("/sendLoginCode")
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        status: 200,
        type: LoginCodeResponseDto,
    })
    @ApiExcludeEndpoint()
    async sendLoginCode(
        @Body() loginCodeReqDto: LoginCodeReqDto,
        @Headers("app-id") appId: string,
        @Headers("X-Device-Id") deviceId: string,
    ): Promise<LoginCodeResponseDto> {
        return await this.userService.sendLoginCode(loginCodeReqDto, appId, deviceId)
    }
}
