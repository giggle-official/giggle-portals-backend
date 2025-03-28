import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsNotEmpty, IsNumber, IsString } from "class-validator"
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
