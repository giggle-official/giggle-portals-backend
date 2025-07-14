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
    token_strategy: {
        type: string
        supply: number
        target: number
    }
    audience_fit: {
        current_reach: string
        ip_category: string
        growth_potential: string
    }
    recommended_widgets: string[]
    launch_timeline: string
    setup_cost: number
    email_sent: boolean
}
