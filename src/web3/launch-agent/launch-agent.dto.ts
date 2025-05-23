import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsString } from "class-validator"

export class CreateLaunchAgentResponseDto {
    agent_id: string
}

export class ParseLaunchLaunchPlanRequestDto {
    @IsString()
    @IsNotEmpty()
    agent_id: string

    @ApiProperty({
        description: "instruction of the launch agent",
    })
    instruction: string
}

export class ParseLaunchLaunchPlanResponseDto {
    agent_id: string
    status: string
    parsed_strategy: {
        total_token_amount: number
        bonding_curve_percent: number
        bonding_curve_start_percent: number
        raydium_percent: number
        random_wallet_cap_percent: number
        num_wallets: number
        recycle_wallet: string
        estimated_bonding_curve_sol: number
        estimated_raydium_sol: number
        total_estimated_sol: number
        note: string
    }
    ai_instruction_summary: string
    estimated_cost: {
        total_estimated_sol: number
        usdc_equivalent: number
    }
}

export class StartLaunchAgentRequestDto {
    ip_id: number
    token_mint: string
    user_email: string
}
