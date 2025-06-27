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

export class GenerateSourceWalletsResDto {
    status: string
    agent_id: string
    source_wallets: string[]
    allocation_plan: {
        [source_wallet: string]: {
            wallet: string
            allocation_sol: number
        }[]
    }
    required_sol: {
        [source_wallet: string]: number
    }
}

export class StartLaunchAgentRequestDto {
    ip_id: number
    token_mint: string
    user_email: string
}

export class GenerateLaunchAgentWalletsRequestDto {
    @IsString()
    @IsNotEmpty()
    agent_id: string
    wallet_count: number
}

export class CheckAgentWalletsStatusRequestDto {
    @IsString()
    @IsNotEmpty()
    agent_id: string
}

export class CheckAgentWalletsStatusResponseDto {
    status: string
    sufficient_funds: boolean
}

export class AgentWalletsDto {
    address: string
    required_sol: number
    is_funded: boolean
}

export class GenerateLaunchAgentWalletsResponseDto {
    total_estimated_sol: number
    wallets: AgentWalletsDto[]
}
