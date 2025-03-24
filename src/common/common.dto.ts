import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString } from "class-validator"

export class PaginationDto {
    @ApiProperty({
        required: true,
        description: "page number",
    })
    @IsNotEmpty()
    @IsString()
    page: string

    @ApiProperty({
        required: true,
        description: "page size",
    })
    @IsNotEmpty()
    @IsString()
    page_size: string
}
