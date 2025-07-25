import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsString } from "class-validator"

export class GetUserTokenDto {
    @ApiProperty({ description: "email" })
    @IsEmail()
    email: string

    @ApiProperty({ description: "email" })
    @IsString()
    app_id: string
}
