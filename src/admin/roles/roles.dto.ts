import { OmitType, PickType } from "@nestjs/swagger"
import { ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsString } from "class-validator"
import { PERMISSIONS_LIST, RoleProperties } from "src/casl/casl-ability.factory/casl-ability.factory"

export class UpdateRoleDto {
    @IsNotEmpty()
    id: string

    @IsEnum(["all", ...PERMISSIONS_LIST.map((p) => p.role)], { each: true })
    @IsArray()
    @ArrayMinSize(1)
    permissions: ["all", ...RoleProperties[]][]

    @IsString()
    @IsNotEmpty()
    name: string

    @IsArray()
    users: string[]
}

export class CreateRoleDto extends OmitType(UpdateRoleDto, ["id"]) {}
export class DeleteRoleDto extends PickType(UpdateRoleDto, ["id"]) {}
