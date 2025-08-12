import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    ParseLaunchLaunchPlanRequestDto,
    CreateLaunchAgentResponseDto,
    ParseLaunchLaunchPlanResponseDto,
    StartLaunchAgentRequestDto,
    GenerateLaunchAgentWalletsRequestDto,
    GenerateLaunchAgentWalletsResponseDto,
    GenerateSourceWalletsResDto,
    CheckAgentWalletsStatusRequestDto,
    CheckAgentWalletsStatusResponseDto,
    GenerateSolWalletsResponseDto,
    SuggestBondingSegmentsRequestDto,
    SuggestBondingSegmentsResponseDto,
} from "./launch-agent.dto"
import { HttpService } from "@nestjs/axios"
import { lastValueFrom, Subscriber } from "rxjs"
import { AxiosResponse } from "axios"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { PriceService } from "src/web3/price/price.service"
import { Cron } from "@nestjs/schedule"
import { CronExpression } from "@nestjs/schedule"
import { SSEMessage } from "../giggle/giggle.dto"
import { IpEvents, IpEventsDetail } from "src/ip-library/ip-library.dto"

@Injectable()
export class LaunchAgentService {
    private readonly logger = new Logger(LaunchAgentService.name)
    private readonly launchAgentUrl: string
    private readonly launchAgentDebug: boolean
    private readonly launchAgentWallet: string
    private readonly getSolWalletUrl: string
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

        this.getSolWalletUrl = process.env.LAUNCH_AGENT_GENERATE_WALLET_API
        if (!this.getSolWalletUrl) {
            this.logger.error("Get sol wallet url is not set")
            throw new Error("Get sol wallet url is not set")
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

    async generateAgentWallets(
        dto: GenerateLaunchAgentWalletsRequestDto,
        user: UserJwtExtractDto,
    ): Promise<GenerateLaunchAgentWalletsResponseDto> {
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

        const { parsed_strategy } = agent.strategy_response as any as ParseLaunchLaunchPlanResponseDto

        const requestParams = {
            parsed_strategy: parsed_strategy,
            num_source_wallets: dto.wallet_count || 1,
            user_email: user.email,
            debug: this.launchAgentDebug,
        }

        try {
            const response: AxiosResponse<GenerateSourceWalletsResDto> = await lastValueFrom(
                this.httpService.post(
                    `${this.launchAgentUrl}/api/agent/${dto.agent_id}/generate_multi_source_wallets`,
                    requestParams,
                    {
                        headers: {
                            "Content-Type": "application/json",
                        },
                    },
                ),
            )

            if (response.data.status !== "success") {
                throw new BadRequestException("Failed to generate source wallets")
            }

            const result = {
                total_estimated_sol: Object.values(response.data.required_sol).reduce((acc, curr) => acc + curr, 0),
                wallets: response.data.source_wallets.map((wallet) => ({
                    address: wallet,
                    required_sol: response.data.required_sol[wallet],
                    is_funded: false,
                })),
            }
            await this.prisma.launch_agents.update({
                where: { agent_id: dto.agent_id },
                data: {
                    //source_wallets: result,
                    source_wallets: { response: response.data, filtered_result: result } as any,
                },
            })
            return result
        } catch (error) {
            throw new BadRequestException("Failed to generate source wallets")
        }
    }

    async checkAgentWalletsStatus(
        dto: CheckAgentWalletsStatusRequestDto,
        user: UserJwtExtractDto,
    ): Promise<CheckAgentWalletsStatusResponseDto> {
        const agent = await this.prisma.launch_agents.findUnique({
            where: { agent_id: dto.agent_id, owner: user.usernameShorted },
        })

        if (!agent) {
            throw new BadRequestException("Agent not found")
        }

        const source_wallets = (agent.source_wallets as any)?.filtered_result as any
        let allocation = {}
        source_wallets.wallets.map((wallet) => {
            allocation[wallet.address] = wallet.required_sol
        })

        const response: AxiosResponse<CheckAgentWalletsStatusResponseDto> = await lastValueFrom(
            this.httpService.post(
                `${this.launchAgentUrl}/api/agent/${dto.agent_id}/funds_status`,
                {
                    allocation: allocation,
                    debug: this.launchAgentDebug,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            ),
        )
        return response.data
    }

    async start_multi_source_wallets(
        agentId: string,
        initParams: StartLaunchAgentRequestDto,
        user: UserJwtExtractDto,
        subscriber?: Subscriber<SSEMessage>,
    ) {
        const agent = await this.prisma.launch_agents.findUnique({
            where: { agent_id: agentId, owner: user.usernameShorted },
        })

        if (!agent) {
            throw new BadRequestException("Agent not found")
        }

        const { parsed_strategy } = agent.strategy_response as any as ParseLaunchLaunchPlanResponseDto

        //set params
        const params = {
            parsed_strategy: parsed_strategy,
            allocation: (agent.source_wallets as any)?.response?.allocation_plan,
            token_mint: initParams.token_mint,
            user_email: user.email,
            debug: this.launchAgentDebug,
        }

        const response: AxiosResponse<{ status: string; message: string }> = await lastValueFrom(
            this.httpService.post(
                `${this.launchAgentUrl}/api/agent/${agentId}/start_multi_source_launch_agent`,
                params,
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            ),
        )

        if (response.data.status !== "success") {
            throw new BadRequestException(response.data.message)
        }
        if (subscriber) {
            subscriber.next({
                event: IpEvents.IP_STRATEGY_AGENT_STARTED,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_STRATEGY_AGENT_STARTED),
            })
        }
        return response.data
    }

    async start(
        agentId: string,
        initParams: StartLaunchAgentRequestDto,
        user: UserJwtExtractDto,
        subscriber?: Subscriber<SSEMessage>,
    ) {
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
                event: IpEvents.IP_STRATEGY_CALCULATE_COST,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_STRATEGY_CALCULATE_COST),
                data: {
                    estimated_sol: estimated_cost?.total_estimated_usdc,
                },
            })
        }
        const estimatedUsdc = estimated_cost?.total_estimated_usdc || 0
        let recycleWallet = user.wallet_address
        let solWalletAddress = null

        if (estimatedUsdc > 0) {
            if (subscriber) {
                subscriber.next({
                    event: IpEvents.IP_STRATEGY_CHECK_BALANCE,
                    event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_STRATEGY_CHECK_BALANCE),
                    data: {
                        estimated_usdc: estimatedUsdc,
                    },
                })
            }
            const usdcBalance = await this.giggleService.getUsdcBalance(user)
            if (usdcBalance.balance < estimatedUsdc) {
                throw new BadRequestException("Insufficient balance")
            }

            const solWallet: AxiosResponse<GenerateSolWalletsResponseDto> = await lastValueFrom(
                this.httpService.post(this.getSolWalletUrl, {
                    secretPhrase: process.env.LAUNCH_AGENT_PHRASE,
                    email: userInfo.email,
                    count: 1,
                }),
            )

            if (!solWallet?.data.wallets.length) {
                throw new BadRequestException("Failed to generate sol wallet")
            }

            solWalletAddress = solWallet.data.wallets[0].address

            //swap usdc to sol
            if (subscriber) {
                subscriber.next({
                    event: IpEvents.IP_STRATEGY_SWAP_SOL,
                    event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_STRATEGY_SWAP_SOL),
                    data: {
                        usdc_amount: parsed_strategy.gas_buffer_in_usdc,
                        sol_wallet_address: solWalletAddress,
                    },
                })
            }

            const swapRes = await this.giggleService.swapUsdcToSol(user, parsed_strategy.gas_buffer_in_usdc)
            const sols = Number(swapRes.solChange)
            if (sols <= 0) {
                throw new BadRequestException(
                    `sol change is not enough for strategy:${agentId}, sol change: ${sols}, expected: ${parsed_strategy.gas_buffer_in_usdc}`,
                )
            }

            //transfer sol to sol wallet
            if (subscriber) {
                subscriber.next({
                    event: IpEvents.IP_STRATEGY_TRANSFER_SOL,
                    event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_STRATEGY_TRANSFER_SOL),
                    data: {
                        sol_amount: parsed_strategy.gas_buffer_in_usdc,
                        sol_wallet_address: solWalletAddress,
                    },
                })
            }

            const sendSolRes = await this.giggleService.sendToken(user, {
                amount: sols,
                receipt: solWalletAddress,
            })

            if (!sendSolRes.sig) {
                throw new BadRequestException("Failed to send sol to sol wallet")
            }

            //transfer remaining usdc to launch agent wallet
            const remainUsdc = estimatedUsdc - parsed_strategy.gas_buffer_in_usdc
            if (subscriber) {
                subscriber.next({
                    event: IpEvents.IP_STRATEGY_TRANSFER_USDC,
                    event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_STRATEGY_TRANSFER_USDC),
                    data: {
                        estimated_usdc: remainUsdc,
                    },
                })
            }
            const sendTokenRes = await this.giggleService.sendToken(user, {
                mint: this.usdcMint,
                amount: remainUsdc,
                receipt: solWalletAddress,
            })

            if (!sendTokenRes?.sig) {
                throw new BadRequestException("Failed to send usdc to sol wallet")
            }

            await this.prisma.launch_agents.update({
                where: { agent_id: agentId },
                data: {
                    current_status: "pending",
                    transfer_usdc_sig: sendTokenRes?.sig,
                    transfer_usdc_amount: remainUsdc,
                    transfer_sol_detail: {
                        receipt: solWalletAddress,
                        amount: sols,
                        res: sendSolRes as any,
                    },
                    swap_sol_detail: {
                        amount: parsed_strategy.gas_buffer_in_usdc,
                        res: swapRes as any,
                    },
                },
            })

            recycleWallet = usdcBalance.address
        }

        const launchParam: any = {
            parsed_strategy: { ...parsed_strategy, recycle_wallet: recycleWallet },
            token_mint: initParams.token_mint,
            user_email: userInfo.email,
            source_wallet: solWalletAddress,
        }

        if (this.launchAgentDebug) {
            launchParam.debug = true
        }

        if (subscriber) {
            subscriber.next({
                event: IpEvents.IP_STRATEGY_START_AGENT,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_STRATEGY_START_AGENT),
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
                event: IpEvents.IP_STRATEGY_AGENT_STARTED,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_STRATEGY_AGENT_STARTED),
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

    async suggestBondingSegments(dto: SuggestBondingSegmentsRequestDto, user: UserJwtExtractDto) {
        if (!this.getPermission(user)) {
            throw new BadRequestException("You are not allowed to use launch agent")
        }

        const response: AxiosResponse<SuggestBondingSegmentsResponseDto> = await lastValueFrom(
            this.httpService.post(`${this.launchAgentUrl}/api/agent/suggest_bonding_segments`, dto),
        )
        return response.data
    }

    //check agent status every 1 minute
    @Cron(CronExpression.EVERY_MINUTE)
    async checkAgentStatus() {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        try {
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
        } catch (error) {
            this.logger.error(error)
        }
    }
}
