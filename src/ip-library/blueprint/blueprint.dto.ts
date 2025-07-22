import { IsNotEmpty, IsOptional, IsString } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class GenerateBlueprintDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: "Natural language description of the ip blueprint",
    })
    prompt: string

    @IsOptional()
    @ApiProperty({
        description: "Email of the user, sending the blueprint to the user",
    })
    email?: string
}

export class DifyResponseDto {
    data: {
        status: string
        outputs: {
            text: string
        }
    }
}

export class BlueprintResponseDto {
    status: "ok"
    email_sent: boolean
}
