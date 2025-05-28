import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    CreatePoolDto,
    CreatePoolResponseDto,
    InjectTokenDto,
    InjectTokenResponseDto,
    RetrieveResponseDto,
    RpcResponseDto,
    TransactionDto,
} from "./reward-pool-on-chain.dto"
import { HttpService } from "@nestjs/axios"
import axios, { AxiosResponse } from "axios"
import https from "https"
import { lastValueFrom } from "rxjs"
import { GiggleService } from "../giggle/giggle.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { reward_pool_on_chain_status } from "@prisma/client"
import { CronExpression } from "@nestjs/schedule"
import { Cron } from "@nestjs/schedule"

@Injectable()
export class RewardPoolOnChainService {
    private readonly logger = new Logger(RewardPoolOnChainService.name)
    private readonly gasPayer: string
    private readonly usdtPayer: string
    private readonly rpcUrl: string
    private readonly authToken: string
    private readonly rewardOnChainHttpService: HttpService

    constructor(
        private readonly prisma: PrismaService,
        private readonly giggleService: GiggleService,
    ) {
        this.gasPayer = process.env.GAS_PAYER_WALLET
        this.usdtPayer = process.env.USDT_PAYER_WALLET
        this.rpcUrl = process.env.REWARD_ON_CHAIN_ENDPOINT
        if (!this.gasPayer || !this.rpcUrl || !this.usdtPayer) {
            throw new Error("Gas payer or rpc url or usdt payer is not set")
        }

        this.authToken = process.env.REWARD_ON_CHAIN_TOKEN
        if (!this.authToken) {
            throw new Error("Auth token is not set")
        }

        this.rewardOnChainHttpService = new HttpService(
            axios.create({
                httpsAgent: new https.Agent({ keepAlive: false }),
                timeout: 180000, //180s
            }),
        )
    }

    async retrieve(token: string) {
        //retrieve first
        const retrieveFunc = "/CreateFiInfo"
        const requestParams = {
            createFiToken: token,
            __authToken: this.authToken,
        }
        const response: AxiosResponse<RpcResponseDto<RetrieveResponseDto>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + retrieveFunc, requestParams),
        )
        if (!response.data?.isSucc || !response.data?.res?.content) {
            this.logger.error(
                `Retrieve failed: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            return null
        }
        return response.data.res.content
    }

    async injectToken(dto: InjectTokenDto, user: UserJwtExtractDto): Promise<TransactionDto> {
        if (dto.amount <= 0) {
            throw new BadRequestException("Amount must be greater than 0")
        }

        const pool = await this.prisma.reward_pools.findUnique({
            where: {
                token: dto.token_mint,
                on_chain_status: reward_pool_on_chain_status.success,
            },
        })

        if (!pool) {
            throw new BadRequestException("Pool not found")
        }

        //check user's balance
        const userBalance = await this.giggleService.getUserWalletDetail(user, 1, 1, dto.token_mint)
        let balance = 0
        if (userBalance.list?.[0]?.mint === dto.token_mint) {
            balance = userBalance.list?.[0]?.holding_num
        }
        if (balance < dto.amount) {
            this.logger.error(
                `Insufficient balance for inject token to rewards, current balance: ${balance}, need: ${dto.amount}`,
            )
            throw new BadRequestException(
                `Insufficient balance when inject token to rewards, current balance: ${balance}, need: ${dto.amount}`,
            )
        }

        //inject token
        const requestParams = {
            user: dto.user_wallet,
            createFiToken: dto.token_mint,
            amount: (dto.amount * 10 ** 6).toString(), //currently our token is on decimals 6
            payer: this.gasPayer,
            __authToken: this.authToken,
        }
        const injectFunc = "/RefillCreateFi"
        const response: AxiosResponse<RpcResponseDto<InjectTokenResponseDto>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + injectFunc, requestParams),
        )
        if (!response.data?.isSucc || !response.data?.res?.tx) {
            this.logger.error(
                `Inject token failed: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            throw new BadRequestException("Inject token failed")
        }

        //sign tx
        const signers = [this.gasPayer]
        const signature = await this.giggleService.signTx(response.data.res.tx, signers, dto.email)
        if (!signature) {
            this.logger.error(
                `Sign tx failed: ${response.data.res.tx}, request params: ${JSON.stringify(requestParams)}`,
            )
            throw new BadRequestException("Sign tx failed")
        }

        return {
            tx: response.data.res.tx,
            signature: signature,
            request_params: requestParams,
        }
    }

    async create(dto: CreatePoolDto) {
        try {
            const rewardPool = await this.prisma.reward_pools.findUnique({
                where: {
                    token: dto.token_mint,
                    on_chain_status: reward_pool_on_chain_status.ready,
                },
            })

            if (!rewardPool) {
                throw new BadRequestException("Pool not found")
            }

            const content = await this.retrieve(dto.token_mint)
            if (content) {
                //update and return
                await this.prisma.reward_pools.update({
                    where: {
                        token: dto.token_mint,
                    },
                    data: {
                        on_chain_status: reward_pool_on_chain_status.success,
                        on_chain_detail: {
                            ...(rewardPool.on_chain_detail as any),
                            content: content,
                        },
                    },
                })
                return
            }

            const func = "/InitCreateFi"
            const requestParams = {
                creator: dto.user_wallet,
                createFiToken: dto.token_mint,
                payer: this.gasPayer,
                __authToken: this.authToken,
            }

            const response: AxiosResponse<RpcResponseDto<CreatePoolResponseDto>> = await lastValueFrom(
                this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
            )

            if (!response.data?.isSucc || !response.data?.res?.tx) {
                this.logger.error(
                    `Create pool failed: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
                )
                throw new BadRequestException("Create pool failed")
            }

            const tx = response.data.res.tx
            const signers = [this.gasPayer]
            const signature = await this.giggleService.signTx(tx, signers, dto.email)

            if (!signature) {
                this.logger.error(`Sign tx failed: ${tx}, request params: ${JSON.stringify(requestParams)}`)
                throw new BadRequestException("Sign tx failed")
            }

            const newContent = await this.retrieve(dto.token_mint)
            await this.prisma.reward_pools.update({
                where: {
                    token: dto.token_mint,
                },
                data: {
                    token: dto.token_mint,
                    on_chain_status: reward_pool_on_chain_status.success,
                    on_chain_detail: {
                        tx: tx,
                        signature: signature,
                        content: newContent,
                    },
                },
            })
        } catch (error) {
            this.logger.error(`Create pool failed: ${error}`)
            await this.prisma.reward_pools.update({
                where: {
                    token: dto.token_mint,
                },
                data: {
                    on_chain_status: reward_pool_on_chain_status.failed,
                    on_chain_error: JSON.stringify(error),
                },
            })
        }
    }

    //push current reward pool to chain
    @Cron(CronExpression.EVERY_MINUTE)
    async pushToChain() {
        if (process.env.TASK_SLOT != "1") return

        const rewardPools = await this.prisma.reward_pools.findMany({
            where: {
                on_chain_status: reward_pool_on_chain_status.ready,
            },
            include: {
                user_info: true,
            },
            orderBy: {
                id: "desc",
            },
            take: 1,
        })

        for (const rewardPool of rewardPools) {
            await this.create({
                token_mint: rewardPool.token,
                user_wallet: rewardPool.user_info.wallet_address,
                email: rewardPool.user_info.email,
            })
            this.logger.log(`Push to chain done: ${rewardPool.token}`)
        }
    }
}
