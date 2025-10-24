import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsOptional, IsString } from "class-validator"

export class GetUserTokenDto {
    @ApiProperty({ description: "user id, user_id and email are mutually exclusive", required: false })
    @IsOptional()
    @IsString()
    user_id?: string

    @ApiProperty({ description: "email, user_id and email are mutually exclusive", required: false })
    @IsOptional()
    @IsEmail()
    email?: string

    @ApiProperty({ description: "app_id" })
    @IsString()
    app_id: string
}
