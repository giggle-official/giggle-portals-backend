import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsString } from "class-validator"

export class GetUserTokenDto {
    @ApiProperty({ description: "user id, user_id and email are mutually exclusive", required: false })
    @IsString()
    user_id?: string

    @ApiProperty({ description: "email, user_id and email are mutually exclusive", required: false })
    @IsEmail()
    email?: string

    @ApiProperty({ description: "email" })
    @IsString()
    app_id: string
}
