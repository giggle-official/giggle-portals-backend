import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsString, IsNotEmpty, IsNumber, IsOptional } from "class-validator"

export class EmailConfirmationDto {
    @ApiProperty()
    @IsEmail()
    email: string

    @IsNotEmpty({ message: "Token is required" })
    @IsString({ message: "Token must be string" })
    @ApiProperty()
    token: string
}

export class AppTokenDto {
    @ApiProperty({
        description: "email address of user",
    })
    @IsEmail()
    email: string

    @ApiProperty({
        description: "app id, to get app id and app secret, please contact us",
    })
    @IsString()
    app_id: string

    @ApiProperty({
        description: "timestamp, `unix timestamp`, must be in the past 5 minutes",
    })
    @IsNumber()
    timestamp: number

    @ApiProperty({
        description:
            "expire in seconds, default is 86400 (1 day), if you want to use it, please set it to greater than 60",
        required: false,
    })
    @IsNumber()
    @IsOptional()
    expire_in?: number

    @ApiProperty({
        description: "generated signature, `md5(email + app_id + timestamp + app_secret)`",
    })
    @IsString()
    signature: string
}

export class LoginResponseDTO {
    @ApiProperty()
    access_token: string
}

export class LoginWithCodeReqDto {
    @ApiProperty()
    @IsEmail()
    email: string

    @ApiProperty()
    @IsString()
    code: string
}

export class GoogleLoginConfigDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    code: string
}
