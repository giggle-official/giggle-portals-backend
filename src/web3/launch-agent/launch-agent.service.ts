import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    ParseLaunchLaunchPlanRequestDto,
    CreateLaunchAgentResponseDto,
    ParseLaunchLaunchPlanResponseDto,
    StartLaunchAgentRequestDto,
} from "./launch-agent.dto"
import { HttpService } from "@nestjs/axios"
import { lastValueFrom } from "rxjs"
import { AxiosResponse } from "axios"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { PriceService } from "src/web3/price/price.service"
import { Cron } from "@nestjs/schedule"
import { CronExpression } from "@nestjs/schedule"

@Injectable()
export class LaunchAgentService {
    private readonly logger = new Logger(LaunchAgentService.name)
    private readonly launchAgentUrl: string
    private readonly launchAgentDebug: boolean
    private readonly launchAgentWallet: string
    private readonly usdcMint: string

    constructor(
        private readonly prisma: PrismaService,
        private readonly httpService: HttpService,
        private readonly giggleService: GiggleService,
        private readonly priceService: PriceService,
    ) {
        this.launchAgentUrl = process.env.LAUNCH_AGENT_ENDPOINT
        this.launchAgentWallet = process.env.LAUNCH_AGENT_WALLET
        this.usdcMint = process.env.GIGGLE_LEGAL_USDC
        if (!this.launchAgentUrl || !this.launchAgentWallet || !this.usdcMint) {
            this.logger.error("Launch agent config is not set")
            throw new Error("Launch agent config is not set")
        }
        this.launchAgentDebug = process.env.LAUNCH_AGENT_DEBUG === "true"
    }

    async createAgent(user: UserJwtExtractDto): Promise<{ agent_id: string }> {
        if (!this.getPermission(user)) {
            throw new BadRequestException("You are not allowed to use launch agent")
        }

        const createAgentRes: AxiosResponse<CreateLaunchAgentResponseDto> = await lastValueFrom(
            this.httpService.post(`${this.launchAgentUrl}/api/create-agent`, {}),
        )

        if (!createAgentRes?.data?.agent_id) {
            throw new BadRequestException("Failed to create agent")
        }

        await this.prisma.launch_agents.create({
            data: {
                agent_id: createAgentRes.data.agent_id,
                owner: user.usernameShorted,
                email: user.email,
            },
        })
        return { agent_id: createAgentRes.data.agent_id }
    }

    async generateStrategy(
        dto: ParseLaunchLaunchPlanRequestDto,
        user: UserJwtExtractDto,
    ): Promise<CreateLaunchAgentResponseDto> {
        if (!this.getPermission(user)) {
            throw new BadRequestException("You are not allowed to use launch agent")
        }

        if (!dto.agent_id) {
            throw new BadRequestException("Agent ID is required")
        }

        const agent = await this.prisma.launch_agents.findUnique({
            where: {
                agent_id: dto.agent_id,
            },
        })

        if (!agent) {
            throw new BadRequestException("Agent not found")
        }

        const response: AxiosResponse<ParseLaunchLaunchPlanResponseDto> = await lastValueFrom(
            this.httpService.post(
                `${this.launchAgentUrl}/api/agent/${dto.agent_id}/parse_launch_plan`,
                {
                    instruction: dto.instruction,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            ),
        )

        if (response.data.status !== "success") {
            throw new BadRequestException("Failed to parse launch plan")
        }

        //save
        await this.prisma.launch_agents.update({
            where: {
                agent_id: dto.agent_id,
            },
            data: {
                instruction: dto.instruction,
                strategy_response: response.data as any,
                current_status: "pending",
            },
        })

        return {
            agent_id: dto.agent_id,
            ...response.data,
        }
    }

    async getStrategyEstimatedUsdc(sol: number): Promise<number> {
        const solPrice = await this.priceService.getSolPrice()
        const estimatedUsdc = sol * solPrice * 1.01 // to ensure strategy can be executed successfully
        return estimatedUsdc
    }

    async start(agentId: string, initParams: StartLaunchAgentRequestDto, user: UserJwtExtractDto, subscriber: any) {
        const userInfo = await this.prisma.users.findUnique({
            where: {
                username_in_be: user.usernameShorted,
            },
        })
        if (!userInfo) {
            throw new BadRequestException("User not found")
        }

        const agent = await this.prisma.launch_agents.findUnique({
            where: {
                agent_id: agentId,
            },
        })

        if (!agent) {
            throw new BadRequestException("Agent not found")
        }

        const { parsed_strategy, estimated_cost } = agent.strategy_response as any as ParseLaunchLaunchPlanResponseDto

        if (subscriber) {
            subscriber.next({
                event: "ip.start_launch_agent.calculate_cost",
                data: {
                    estimated_sol: estimated_cost?.total_estimated_sol,
                },
            })
        }
        const estimatedSol = estimated_cost?.total_estimated_sol || 0
        const estimatedUsdc = await this.getStrategyEstimatedUsdc(estimatedSol)

        if (estimatedUsdc > 0 && !this.launchAgentDebug) {
            if (subscriber) {
                subscriber.next({
                    event: "ip.start_launch_agent.check_balance",
                    data: {
                        estimated_usdc: estimatedUsdc,
                    },
                })
            }
            const usdcBalance = await this.giggleService.getUsdcBalance(user)
            if (usdcBalance.balance < estimatedUsdc) {
                throw new BadRequestException("Insufficient balance")
            }

            //transfer to launch agent wallet
            if (subscriber) {
                subscriber.next({
                    event: "ip.start_launch_agent.transfer_usdc",
                    data: {
                        estimated_usdc: estimatedUsdc,
                    },
                })
            }
            const sendTokenRes = await this.giggleService.sendToken(user, {
                mint: this.usdcMint,
                amount: estimatedUsdc,
                receipt: this.launchAgentWallet,
            })

            if (sendTokenRes.sig) {
                await this.prisma.launch_agents.update({
                    where: { agent_id: agentId },
                    data: {
                        current_status: "pending",
                        transfer_usdc_sig: sendTokenRes.sig,
                        transfer_usdc_amount: estimatedUsdc,
                    },
                })
            }
        }

        const launchParam: any = {
            parsed_strategy: parsed_strategy,
            token_mint: initParams.token_mint,
            user_email: userInfo.email,
        }

        if (this.launchAgentDebug) {
            launchParam.debug = true
        }

        if (subscriber) {
            subscriber.next({
                event: "ip.start_launch_agent.start_agent",
                data: {
                    message: "Start launch agent",
                },
            })
        }

        const response: AxiosResponse<ParseLaunchLaunchPlanResponseDto> = await lastValueFrom(
            this.httpService.post(`${this.launchAgentUrl}/api/agent/${agentId}/start_launch_agent`, launchParam, {
                headers: {
                    "Content-Type": "application/json",
                },
            }),
        )

        if (response.data.status !== "success") {
            throw new BadRequestException("Failed to start agent")
        }

        await this.prisma.launch_agents.update({
            where: { agent_id: agentId },
            data: { current_status: "started", result: response.data as any, ip_id: initParams.ip_id },
        })

        await this.prisma.ip_library.update({
            where: { id: initParams.ip_id },
            data: {
                launch_agent_id: agentId,
            },
        })

        if (subscriber) {
            subscriber.next({
                event: "ip.start_launch_agent.agent_started",
                data: {
                    message: "Agent started",
                },
            })
        }

        return response.data
    }

    async checkAgentStatusByIpId(user: UserJwtExtractDto, ip_id: number) {
        const ip = await this.prisma.ip_library.findUnique({
            where: { id: ip_id, owner: user.usernameShorted },
        })

        if (!ip) {
            throw new BadRequestException("IP not found or you are not the owner of this IP")
        }

        const agent = await this.prisma.launch_agents.findFirst({
            where: { ip_id },
        })

        if (!agent) {
            return {
                status: "no_agent",
                result: null,
            }
        }
        return agent.result as any
    }

    async getPermission(user: UserJwtExtractDto) {
        const allowedList = process.env.LAUNCH_AGENT_ALLOW_USERS?.toLowerCase().split(",")
        return { allowed: allowedList?.includes(user.email.toLowerCase()) }
    }

    //check agent status every 1 minute
    @Cron(CronExpression.EVERY_MINUTE)
    async checkAgentStatus() {
        const agents = await this.prisma.launch_agents.findMany({
            where: { current_status: "started" },
        })

        if (agents.length > 0) {
            this.logger.log(`Checking ${agents.length} agents status`)
        }

        for (const agent of agents) {
            const response: AxiosResponse<any> = await lastValueFrom(
                this.httpService.get(`${this.launchAgentUrl}/api/agent/${agent.agent_id}/status`),
            )

            await this.prisma.launch_agents.update({
                where: { agent_id: agent.agent_id },
                data: {
                    current_status: response.data?.status === "idle" ? "idle" : "started",
                    result: response.data as any,
                },
            })
        }
    }
}
