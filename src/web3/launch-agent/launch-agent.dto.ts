import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsNumber, IsString } from "class-validator"

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

export class ParseLaunchLaunchPlanWsResponseDto {
    status: string
    message: string
}

export class ParseLaunchLaunchPlanResponseDto {
    agent_id: string
    status: string
    parsed_strategy: {
        total_token_amount: number
        main_wallet_allocations: { [wallet: string]: number }
        bonding_overbuy_allocation: { [wallet: string]: number }
        bonding_curve_percent: number
        bonding_curve_start_percent: number
        raydium_percent: number
        num_wallets: number
        num_bonding_wallets: number
        recycle_wallet: string
        desired_cost: number
        ai_instruction_summary: string
        estimated_bonding_curve_usdc: number
        estimated_raydium_usdc: number
        total_estimated_usdc: number
        note: string
        gas_buffer_in_usdc: number
    }
    ai_instruction_summary: string
    estimated_cost: {
        total_estimated_usdc: number
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
    is_market_maker: boolean
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

export class GenerateSolWalletsResponseDto {
    success: boolean
    message: string
    new_account_created: boolean
    account_id: number
    email: string
    wallets: {
        id: number
        address: string
        name: string
        is_default: boolean
        created_at: string
    }[]
}

export class SuggestBondingSegmentsRequestDto {
    @IsNumber()
    @IsNotEmpty()
    target_total_pct: number

    @IsNumber()
    @IsNotEmpty()
    desired_cost: number
}

export class SuggestBondingSegmentsResponseDto {
    success: boolean
    message: string
}
