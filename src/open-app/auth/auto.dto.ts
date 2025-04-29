import { ApiProperty, PickType } from "@nestjs/swagger"
import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"

export class LoginDto {
    @ApiProperty({
        description: "Email",
        required: true,
    })
    @IsEmail()
    @IsNotEmpty()
    email: string

    @ApiProperty({
        description: "Timestamp",
        required: true,
    })
    @IsNumber()
    @IsNotEmpty()
    timestamp: number

    @ApiProperty({
        description: "App id",
        required: true,
    })
    @IsString()
    @IsNotEmpty()
    app_id: string

    @ApiProperty({
        description: "Signature",
        required: true,
    })
    @IsString()
    @IsNotEmpty()
    sign: string
}

export class LoginResponseDto {
    @ApiProperty({
        description: "Token",
        required: true,
    })
    token: string
}

export class CheckTokenDto {
    @ApiProperty({
        description: "Token",
        required: true,
    })
    token: string

    @ApiProperty({
        description: "Device id",
    })
    device_id: string
}

export class CheckTokenResponseDto {
    @ApiProperty({
        description: "Is bind app",
        required: true,
    })
    is_bind: boolean

    @ApiProperty({
        description: "Access token",
        required: true,
    })
    access_token: string

    @ApiProperty({
        description: "Host",
        required: true,
    })
    host: string

    @ApiProperty({
        description: "Email",
        required: true,
    })
    email: string
}

export class GetBindCodeDto extends PickType(CheckTokenResponseDto, ["host", "email"]) {
    @ApiProperty({
        description: "App id",
        required: true,
    })
    @IsNotEmpty()
    @IsString()
    app_id: string
}

export class GetBindCodeResponseDto {
    @ApiProperty({
        description: "Success",
        required: true,
    })
    success: boolean

    @ApiProperty({
        description: "Message",
        required: true,
    })
    message: string
}

export class ConfirmBindDto {
    @ApiProperty({
        description: "Email",
        required: true,
    })
    @IsNotEmpty()
    @IsString()
    email: string

    @ApiProperty({
        description: "Code",
        required: true,
    })
    @IsNotEmpty()
    @IsString()
    code: string

    @ApiProperty({
        description: "App id",
        required: true,
    })
    @IsNotEmpty()
    @IsString()
    app_id: string

    @ApiProperty({
        description: "Host",
        required: true,
    })
    @IsNotEmpty()
    @IsString()
    host: string

    @ApiProperty({
        description: "Device id",
    })
    @IsString()
    device_id: string
}

export class ConfirmBindResponseDto {
    @ApiProperty({
        description: "Success",
        required: true,
    })
    success: boolean

    @ApiProperty({
        description: "Access token",
        required: true,
    })
    access_token: string
}

export class WidgetAuthDto {
    public: {
        allowed_domains: string[]
    }
    private: {
        secret_key: string
    }
}
