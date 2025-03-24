import { ApiProperty } from "@nestjs/swagger"
import { IsEmail, IsNotEmpty, IsNumber, IsString } from "class-validator"
import { UserInfoDTO } from "src/user/user.controller"

export class AdminLoginDto {
    @ApiProperty()
    @IsEmail()
    username: string
    @IsString()
    @IsNotEmpty()
    password: string
}

export class RoleSummaryDto {
    id: number
    name: string
}
export class AdminUserInfoDto extends UserInfoDTO {
    currentRole?: number
}

export class SwitchRoleDto {
    @IsNumber()
    @IsNotEmpty()
    role_id: number
}
