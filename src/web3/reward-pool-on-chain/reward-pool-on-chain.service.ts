import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    CreatePoolDto,
    CreatePoolResponseDto,
    AllocateRevenueDto,
    InjectTokenDto,
    InjectTokenResponseDto,
    RetrieveResponseDto,
    RpcResponseDto,
    TransactionDto,
    RetrieveUserTokenBalanceResponseDto,
    AirdropStatementToChainDto,
    AirdropResponseDto,
    WithdrawTokenToWalletDto,
    WithdrawTokenToWalletResponseDto,
    BuybackRecordResponseDto,
    BuybackOrderStatusResponseDto,
} from "./reward-pool-on-chain.dto"
import { HttpService } from "@nestjs/axios"
import axios, { AxiosResponse } from "axios"
import https from "https"
import { lastValueFrom } from "rxjs"
import { GiggleService } from "../giggle/giggle.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Prisma, reward_pool_on_chain_status, reward_pool_type } from "@prisma/client"
import { CronExpression } from "@nestjs/schedule"
import { Cron } from "@nestjs/schedule"
import { OrderStatus } from "src/payment/order/order.dto"
import { Decimal } from "@prisma/client/runtime/library"
import { RewardAllocateRatio, RewardAllocateRoles, RewardSnapshotDto } from "src/payment/rewards-pool/rewards-pool.dto"
import { TASK_IDS, UtilitiesService } from "src/common/utilities.service"
import { SalesAgentService } from "src/payment/sales-agent/sales-agent.service"
import { OrderService } from "src/payment/order/order.service"
import { TaskService } from "src/task/task.service"

@Injectable()
export class RewardPoolOnChainService {
    private readonly logger = new Logger(RewardPoolOnChainService.name)
    private readonly settleWallet: string
    private readonly platformWallet: string
    private readonly rpcUrl: string
    private readonly authToken: string
    private readonly rewardOnChainHttpService: HttpService

    private readonly maxOnChainTryCount: number = 3
    private readonly onChainTaskTimeout: number = 1000 * 60 * 30 //30 minutes
    private readonly onChainTaskId: number = TASK_IDS.REWARD_POOL_ON_CHAIN_TASK

    constructor(
        private readonly prisma: PrismaService,
        private readonly giggleService: GiggleService,
        private readonly salesAgentService: SalesAgentService,
        private readonly orderService: OrderService,
    ) {
        this.settleWallet = process.env.SETTLEMENT_WALLET
        this.rpcUrl = process.env.REWARD_ON_CHAIN_ENDPOINT
        if (!this.settleWallet || !this.rpcUrl) {
            throw new Error("Settle wallet or rpc url is not set")
        }

        this.authToken = process.env.REWARD_ON_CHAIN_TOKEN
        if (!this.authToken) {
            throw new Error("Auth token is not set")
        }
        this.platformWallet = process.env.PLATFORM_WALLET
        if (!this.platformWallet) {
            throw new Error("Platform wallet is not set")
        }

        this.rewardOnChainHttpService = new HttpService(
            axios.create({
                httpsAgent: new https.Agent({ keepAlive: false }),
                timeout: 180000, //180s
            }),
        )
    }

    async retrieve(token: string): Promise<RetrieveResponseDto | null> {
        try {
            //retrieve first
            const retrieveFunc = "/CreateFiInfo"
            const requestParams = {
                createFiToken: token,
                __authToken: this.authToken,
            }
            const response: AxiosResponse<RpcResponseDto<{ content: string }>> = await lastValueFrom(
                this.rewardOnChainHttpService.post(this.rpcUrl + retrieveFunc, requestParams),
            )
            if (!response.data?.isSucc || !response.data?.res?.content) {
                this.logger.warn(
                    `Retrieve pool info failed: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
                )
                return null
            }

            try {
                return JSON.parse(response.data.res.content) as RetrieveResponseDto
            } catch (error) {
                this.logger.warn(
                    `Retrieve pool info failed: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
                )
                return null
            }
        } catch (error) {
            this.logger.error(`Retrieve pool info failed: ${error}`)
            return null
        }
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

        //check user's wallet balance
        const walletBalance = await this.giggleService.getWalletBalance(dto.user_wallet, dto.token_mint)
        let balance = new Decimal(0)
        if (walletBalance.length > 0) {
            balance = new Decimal(walletBalance[0].amount)
        }
        if (balance.lt(dto.amount)) {
            this.logger.error(
                `INJECT TOKEN ERROR: Insufficient balance for inject token to rewards, current balance: ${balance}, need: ${dto.amount}`,
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
            payer: this.settleWallet,
            __authToken: this.authToken,
        }
        const injectFunc = "/RefillCreateFi"
        const response: AxiosResponse<RpcResponseDto<InjectTokenResponseDto>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + injectFunc, requestParams),
        )
        if (!response.data?.isSucc || !response.data?.res?.tx) {
            this.logger.error(
                `INJECT TOKEN ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            throw new BadRequestException("Inject token failed")
        }

        //sign tx
        const signers = [this.settleWallet]
        const signature = await this.giggleService.signTx(response.data.res.tx, signers, dto.email)
        if (!signature) {
            this.logger.error(
                `INJECT TOKEN ERROR: Sign tx failed: ${response.data.res.tx}, request params: ${JSON.stringify(requestParams)}`,
            )
            throw new BadRequestException("Sign tx failed")
        }

        return {
            tx: response.data.res.tx,
            signature: signature,
            request_params: requestParams,
        }
    }

    async allocateRevenue(dto: AllocateRevenueDto): Promise<TransactionDto> {
        const rewardPool = await this.prisma.reward_pools.findUnique({
            where: {
                token: dto.token_mint,
                on_chain_status: reward_pool_on_chain_status.success,
            },
            include: {
                user_info: true,
            },
        })

        if (!rewardPool) {
            throw new BadRequestException("Pool not found")
        }

        const func = "/CreateFiConsume"
        const requestParams = {
            user: this.settleWallet,
            creator: rewardPool.user_info.wallet_address,
            consumeToken: process.env.GIGGLE_LEGAL_USDC,
            createFiToken: rewardPool.token,
            amountIn: Math.round(dto.revenue * 10 ** 6).toString(),
            revenueArr: dto.revenue_allocate_details.map((r) => ({
                acc: r.wallet_address,
                share: Math.round(r.share * 10 ** 6).toString(),
                token: r.token,
            })),
            orderTime: dto.paid_time,
            payer: this.settleWallet,
            __authToken: this.authToken,
        }

        const response: AxiosResponse<RpcResponseDto<CreatePoolResponseDto>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
        )

        if (!response.data?.isSucc || !response.data?.res?.tx) {
            this.logger.error(
                `ALLOCATE REVENUE ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            throw new BadRequestException("Allocate revenue failed")
        }

        //sign tx
        const signers = [this.settleWallet]
        const signature = await this.giggleService.signTx(response.data.res.tx, signers, rewardPool.user_info.email)
        if (!signature) {
            this.logger.error(
                `ALLOCATE REVENUE ERROR: Sign tx failed: ${response.data.res.tx}, request params: ${JSON.stringify(requestParams)}`,
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
                payer: this.settleWallet,
                __authToken: this.authToken,
            }

            const response: AxiosResponse<RpcResponseDto<CreatePoolResponseDto>> = await lastValueFrom(
                this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
            )

            if (!response.data?.isSucc || !response.data?.res?.tx) {
                this.logger.error(
                    `CREATE POOL ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
                )
                throw new BadRequestException("Create pool failed")
            }

            const tx = response.data.res.tx
            const signers = [this.settleWallet]
            const signature = await this.giggleService.signTx(tx, signers, dto.email)

            if (!signature) {
                this.logger.error(
                    `CREATE POOL ERROR: Sign tx failed: ${tx}, request params: ${JSON.stringify(requestParams)}`,
                )
                throw new BadRequestException("Sign tx failed")
            }

            const newContent = await this.retrieve(dto.token_mint)
            const buybackWallet = await this.retrieveBuybackWallet(dto.token_mint)

            await this.prisma.reward_pools.update({
                where: {
                    token: dto.token_mint,
                },
                data: {
                    token: dto.token_mint,
                    on_chain_status: reward_pool_on_chain_status.success,
                    buyback_address: buybackWallet,
                    on_chain_detail: {
                        tx: tx,
                        signature: signature,
                        content: newContent as any,
                    },
                },
            })
        } catch (error) {
            this.logger.error(`CREATE POOL ERROR: ${error}`)
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

    //retrieve buyback wallet
    async retrieveBuybackWallet(token: string) {
        try {
            const func = "/GetBuyback"
            const requestParams = {
                createFiToken: token,
                __authToken: this.authToken,
            }
            const response: AxiosResponse<RpcResponseDto<{ addr: string }>> = await lastValueFrom(
                this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
            )
            if (!response.data?.isSucc || !response.data?.res?.addr) {
                this.logger.error(
                    `RETRIEVE BUYBACK WALLET ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
                )
                return null
            }
            return response.data.res.addr
        } catch (error) {
            this.logger.error(`RETRIEVE BUYBACK WALLET ERROR: ${error}`)
            return null
        }
    }

    //retrieve user token balance
    async retrieveUserTokenBalance(
        token: string,
        user_wallet: string,
    ): Promise<RetrieveUserTokenBalanceResponseDto | null> {
        const func = "/CreateFiUserVestingInfo"
        const requestParams = {
            createFiToken: token,
            user: user_wallet,
            __authToken: this.authToken,
        }
        this.logger.log(`RETRIEVE USER TOKEN BALANCE: ${JSON.stringify(requestParams)}`)
        const response: AxiosResponse<RpcResponseDto<{ content: string }>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
        )
        if (!response.data?.isSucc || !response.data?.res?.content) {
            this.logger.error(
                `RETRIEVE USER TOKEN BALANCE ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            return null
        }
        try {
            return JSON.parse(response.data.res.content) as RetrieveUserTokenBalanceResponseDto
        } catch (error) {
            this.logger.error(
                `RETRIEVE USER TOKEN BALANCE ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            return null
        }
    }

    //withdraw token to wallet
    async withdrawTokenToWallet(dto: WithdrawTokenToWalletDto, user_email: string): Promise<TransactionDto> {
        const func = "/ClaimCreateFiVesting"
        const requestParams = {
            user: dto.user_wallet,
            createFiToken: dto.token,
            amount: Math.round(dto.amount * 10 ** 6).toString(),
            payer: this.settleWallet,
            __authToken: this.authToken,
        }
        const response: AxiosResponse<RpcResponseDto<WithdrawTokenToWalletResponseDto>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
        )
        if (!response.data?.isSucc || !response.data?.res?.tx) {
            throw new BadRequestException("Withdraw token to wallet failed")
        }

        //sign tx
        const signers = [this.settleWallet]
        const signature = await this.giggleService.signTx(response.data.res.tx, signers, user_email)
        if (!signature) {
            throw new BadRequestException("Sign tx failed")
        }

        return {
            tx: response.data.res.tx,
            signature: signature,
            request_params: requestParams,
        }
    }

    //backback record
    async getBuybackRecord(token: string, startId: number) {
        const func = "/BuybackHistory"
        const requestParams = {
            createFiToken: token,
            __authToken: this.authToken,
            startId: startId,
        }
        const response: AxiosResponse<RpcResponseDto<BuybackRecordResponseDto>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
        )
        if (!response.data?.isSucc || !response.data?.res?.arr) {
            throw new BadRequestException("Get buyback record failed")
        }
        return response.data.res.arr.filter((r) => r.status === 2)
    }

    //airdrop statement to chain
    async airdropStatementToChain(airdropDto: AirdropStatementToChainDto, creator_email: string) {
        const func = "/CreateFiAirdrop"
        const requestParams = {
            user: airdropDto.user_wallet,
            creator: airdropDto.owner_wallet,
            createFiToken: airdropDto.token,
            amount: Math.round(airdropDto.amount * 10 ** 6).toString(),
            orderTime: airdropDto.timestamp,
            payer: this.settleWallet,
            __authToken: this.authToken,
        }

        const response: AxiosResponse<RpcResponseDto<AirdropResponseDto>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
        )

        if (!response.data?.isSucc || !response.data?.res?.tx) {
            this.logger.error(
                `AIRDROP STATEMENT TO CHAIN ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            throw new BadRequestException("Airdrop statement to chain failed")
        }
        //sign tx
        const signers = [this.settleWallet]
        const signature = await this.giggleService.signTx(response.data.res.tx, signers, creator_email)
        if (!signature) {
            this.logger.error(
                `AIRDROP STATEMENT TO CHAIN ERROR: Sign tx failed: ${response.data.res.tx}, request params: ${JSON.stringify(requestParams)}`,
            )
            throw new BadRequestException("Sign tx failed")
        }

        return {
            tx: response.data.res.tx,
            signature: signature,
            request_params: requestParams,
        }
    }

    //get buyback burn ratio
    async getBuybackBurnRatio(token: string): Promise<number | null> {
        //return 0
        const func = "/GetBurnRate"
        const requestParams = {
            createFiToken: token,
            __authToken: this.authToken,
        }
        try {
            const response: AxiosResponse<RpcResponseDto<{ rate: number }>> = await lastValueFrom(
                this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
            )
            if (!response.data?.isSucc || response.data?.res?.rate === undefined) {
                this.logger.error(
                    `GET BUYBACK BURN RATIO ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
                )
                return 0
            }
            return Number(response.data.res.rate) / 100
        } catch (error) {
            this.logger.error(`GET BUYBACK BURN RATIO ERROR: ${error}`)
            return null
        }
    }

    //set buyback burn ratio
    async setBuybackBurnRatio(token: string, rate: number): Promise<boolean> {
        const func = "/SetBurnRate"
        const requestParams = {
            createFiToken: token,
            rate: Math.round(rate * 100),
            __authToken: this.authToken,
        }
        const response: AxiosResponse<RpcResponseDto<{}>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
        )
        if (!response.data?.isSucc) {
            this.logger.error(
                `SET BUYBACK BURN RATIO ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            return false
        }
        return true
    }

    //start buyback
    async startBuyback(token: string, amount: number): Promise<string | null> {
        const func = "/StartBuyback"
        const requestParams = {
            createFiToken: token,
            amount: Math.round(amount * 10 ** 6).toString(),
            __authToken: this.authToken,
        }
        const response: AxiosResponse<RpcResponseDto<{ orderId: string }>> = await lastValueFrom(
            this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
        )
        if (!response.data?.isSucc) {
            this.logger.error(
                `START BUYBACK ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
            )
            return null
        }
        return response.data.res.orderId
    }

    //get buyback
    async getBuybackResult(orderId: string): Promise<BuybackOrderStatusResponseDto> {
        try {
            const func = "/BuybackStatus"
            const requestParams = {
                orderId: orderId,
                __authToken: this.authToken,
            }
            const response: AxiosResponse<RpcResponseDto<BuybackOrderStatusResponseDto>> = await lastValueFrom(
                this.rewardOnChainHttpService.post(this.rpcUrl + func, requestParams),
            )
            if (!response.data?.isSucc) {
                throw new BadRequestException(
                    `GET BUYBACK ORDER STATUS ERROR: ${JSON.stringify(response.data)}, request params: ${JSON.stringify(requestParams)}`,
                )
            }
            return response.data.res
        } catch (error) {
            this.logger.error(JSON.stringify(error))
            return null
        }
    }

    //push current reward pool to chain
    @Cron(CronExpression.EVERY_MINUTE)
    async pushToChain() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return

        const rewardPools = await this.prisma.reward_pools.findFirst({
            where: {
                on_chain_status: {
                    in: [reward_pool_on_chain_status.ready, reward_pool_on_chain_status.failed],
                },
                on_chain_try_count: {
                    lte: this.maxOnChainTryCount,
                },
            },
            include: {
                user_info: true,
            },
            orderBy: {
                id: "desc",
            },
        })

        if (!rewardPools) {
            this.logger.log("No reward pool need push to chain")
            return
        }

        try {
            // add count
            await this.prisma.reward_pools.update({
                where: { id: rewardPools.id },
                data: {
                    on_chain_try_count: rewardPools.on_chain_try_count + 1,
                    on_chain_error: null,
                    on_chain_status: reward_pool_on_chain_status.ready,
                },
            })

            let walletAddress = rewardPools.user_info.wallet_address
            if (!rewardPools.user_info.wallet_address) {
                const userWallet = await this.giggleService.getUsdcBalance({
                    user_id: rewardPools.user_info.username_in_be,
                    usernameShorted: rewardPools.user_info.username_in_be,
                    email: rewardPools.user_info.email,
                })
                walletAddress = userWallet.address
                if (userWallet.address) {
                    await this.prisma.users.update({
                        where: { id: rewardPools.user_info.id },
                        data: { wallet_address: walletAddress },
                    })
                }
            }

            if (!walletAddress) {
                this.logger.error(
                    `CREATE POOL ERROR: No wallet address for settle statement: ${rewardPools.id}, pool: ${rewardPools.token}`,
                )
                return
            }

            // push to chain
            await this.create({
                token_mint: rewardPools.token,
                user_wallet: walletAddress,
                email: rewardPools.user_info.email,
            })
            this.logger.log(`CREATE POOL: ${rewardPools.token} done`)
        } catch (error) {
            this.logger.error(`CREATE POOL ERROR: ${error}`)
        }
    }

    //process withdraw token of history record
    @Cron(CronExpression.EVERY_MINUTE)
    async processWithdrawToken() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return

        const withdrawToken = await this.prisma.user_rewards_withdraw.findFirst({
            where: {
                chain_transaction: {
                    equals: Prisma.AnyNull,
                },
                on_chain_try_count: {
                    lte: this.maxOnChainTryCount,
                },
                status: {
                    in: ["pending"],
                },
            },
            include: {
                user_info: true,
            },
            orderBy: {
                id: "desc",
            },
        })

        if (!withdrawToken) {
            this.logger.log("No withdraw token need process")
            return
        }

        //append on_chain_try_count
        await this.prisma.user_rewards_withdraw.update({
            where: { id: withdrawToken.id },
            data: { on_chain_try_count: withdrawToken.on_chain_try_count + 1 },
        })

        const userBalance = await this.retrieveUserTokenBalance(
            withdrawToken.token,
            withdrawToken.user_info.wallet_address,
        )

        if (!userBalance) {
            this.logger.error(
                `PROCESS WITHDRAW TOKEN ERROR: No user balance for withdraw token: ${withdrawToken.token} $${withdrawToken.token}`,
            )
            return
        }

        const userBalanceAmount = new Decimal(userBalance.availableAmount).div(10 ** 6)
        if (userBalanceAmount.lt(withdrawToken.withdrawn)) {
            this.logger.error(
                `PROCESS WITHDRAW TOKEN ERROR: Insufficient token balance for withdraw token: ${withdrawToken.token} $${withdrawToken.token}`,
            )
            return
        }

        //start withdraw
        this.logger.log(
            `PROCESS WITHDRAW TOKEN: ${withdrawToken.id}, need tokens: ${withdrawToken.withdrawn.toNumber()}, token balance: ${userBalanceAmount.toNumber()}`,
        )

        try {
            const reqParam = {
                user_wallet: withdrawToken.user_info.wallet_address,
                amount: withdrawToken.withdrawn.toNumber(),
                token: withdrawToken.token,
            }
            const transaction = await this.withdrawTokenToWallet(reqParam, withdrawToken.user_info.email)
            await this.prisma.user_rewards_withdraw.update({
                where: { id: withdrawToken.id },
                data: { chain_transaction: transaction as any, status: "completed" },
            })
        } catch (error) {
            this.logger.error(`PROCESS WITHDRAW TOKEN ERROR: ${error}`)
            await this.prisma.user_rewards_withdraw.update({
                where: { id: withdrawToken.id },
                data: {
                    status: withdrawToken.on_chain_try_count >= this.maxOnChainTryCount ? "failed" : "pending",
                    transaction_error: JSON.stringify(error),
                },
            })
        }
    }

    //process inject token of history record
    async settleInjectToken() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return

        const injectToken = await this.prisma.reward_pool_statement.findMany({
            where: {
                chain_transaction: {
                    equals: Prisma.AnyNull,
                },
                on_chain_try_count: {
                    lte: this.maxOnChainTryCount,
                },
                type: reward_pool_type.injected,
                reward_pools: {
                    on_chain_status: reward_pool_on_chain_status.success,
                },
                amount: {
                    gt: 0,
                },
            },
            include: {
                reward_pools: {
                    include: {
                        user_info: true,
                    },
                },
            },
            orderBy: {
                id: "desc",
            },
        })

        if (injectToken.length === 0) {
            this.logger.log("No inject token need process")
            return
        }

        for (const inject of injectToken) {
            //check user wallet token balance
            const userBalance = await this.giggleService.getWalletBalance(
                inject.reward_pools.user_info.wallet_address,
                inject.reward_pools.token,
            )
            if (userBalance.length === 0) {
                this.logger.warn(
                    `PROCESS INJECT TOKEN WARNING: No token balance for inject token: ${inject.token} $${inject.reward_pools.ticker}, wallet: ${inject.reward_pools.user_info.wallet_address}`,
                )
                continue
            }
            const userBalanceAmount = new Decimal(userBalance[0].amount)
            if (userBalanceAmount.lt(inject.amount)) {
                this.logger.warn(
                    `PROCESS INJECT TOKEN WARNING: Insufficient token balance for inject token: ${inject.token} $${inject.reward_pools.ticker}, wallet: ${inject.reward_pools.user_info.wallet_address}`,
                )
                continue
            }

            this.logger.log(
                `PROCESS INJECT TOKEN: ${inject.token} $${inject.reward_pools.ticker}, need tokens: ${inject.amount}`,
            )

            //append on_chain_try_count
            await this.prisma.reward_pool_statement.update({
                where: { id: inject.id },
                data: { on_chain_try_count: inject.on_chain_try_count + 1 },
            })

            try {
                const injectResult = await this.injectToken(
                    {
                        token_mint: inject.reward_pools.token,
                        amount: inject.amount.toNumber(),
                        email: inject.reward_pools.user_info.email,
                        user_wallet: inject.reward_pools.user_info.wallet_address,
                    },
                    {
                        usernameShorted: inject.reward_pools.user_info.username_in_be,
                        user_id: inject.reward_pools.user_info.username_in_be,
                    },
                )

                await this.prisma.reward_pool_statement.update({
                    where: { id: inject.id },
                    data: { chain_transaction: injectResult as any },
                })
                //sleep 2 seconds
                await new Promise((resolve) => setTimeout(resolve, 2000))
            } catch (error) {
                this.logger.error(`PROCESS INJECT TOKEN ERROR: ${error}`)
                continue
            }
        }
    }

    //settle air drop statement to chain
    async settleAirDropStatement() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return
        const airdropStatement = await this.prisma.reward_pool_statement.findMany({
            where: {
                type: reward_pool_type.airdrop,
                chain_transaction: {
                    equals: Prisma.AnyNull,
                },
                on_chain_try_count: {
                    lte: this.maxOnChainTryCount,
                },
            },
            orderBy: {
                id: "desc",
            },
            include: {
                user_rewards: {
                    include: {
                        user_info: true,
                    },
                },
                reward_pools: {
                    include: {
                        user_info: true,
                    },
                },
            },
        })

        if (airdropStatement.length === 0) {
            this.logger.log("SETTLE AIRDROP: No airdrop statement need settle")
            return
        }

        for (const statement of airdropStatement) {
            //append on_chain_try_count
            await this.prisma.reward_pool_statement.update({
                where: { id: statement.id },
                data: { on_chain_try_count: statement.on_chain_try_count + 1 },
            })

            if (statement.user_rewards.length === 0) {
                this.logger.error(`SETTLE AIRDROP ERROR: No user reward for airdrop statement: ${statement.id}`)
                continue
            }

            const userReward = new Decimal(statement.user_rewards[0].rewards)

            //check reward pool token balance
            const tokenBalance = await this.retrieve(statement.token)
            if (!tokenBalance) {
                this.logger.error(
                    `SETTLE AIRDROP ERROR: No token balance for settle airdrop statement: ${statement.id}, wallet: ${this.settleWallet}`,
                )
                continue
            }

            const tokenBalanceAmount = new Decimal(tokenBalance.totalAmount)
            if (tokenBalanceAmount.lt(userReward)) {
                this.logger.error(
                    `SETTLE AIRDROP ERROR: Insufficient token balance when settle airdrop statement: ${statement.id}, pool: ${statement.token}, token balance: ${tokenBalanceAmount.toNumber()}, need tokens: ${userReward.toNumber()}`,
                )
                continue
            }

            try {
                //start settle
                this.logger.log(
                    `SETTLE AIRDROP: ${statement.id}, need tokens: ${userReward.toNumber()}, token balance: ${tokenBalanceAmount.toNumber()}`,
                )
                const reqParam = {
                    user_wallet: statement.user_rewards[0].user_info.wallet_address,
                    owner_wallet: statement.reward_pools.user_info.wallet_address,
                    token: statement.token,
                    amount: userReward.toNumber(),
                    timestamp: statement.created_at.getTime() / 1000,
                }

                const transaction = await this.airdropStatementToChain(reqParam, statement.reward_pools.user_info.email)
                await this.prisma.reward_pool_statement.update({
                    where: { id: statement.id },
                    data: { chain_transaction: transaction as any },
                })
                this.logger.log(`SETTLE AIRDROP: ${statement.id} done`)
                //sleep 2 seconds
                await new Promise((resolve) => setTimeout(resolve, 2000))
            } catch (error) {
                this.logger.error(`SETTLE AIRDROP ERROR: ${error}`)
                continue
            }
        }
    }

    //settle order statement to chain
    async settleStatement() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return
        const statementOrders = await this.prisma.reward_pool_statement.findMany({
            where: {
                order_info: {
                    current_status: OrderStatus.REWARDS_RELEASED,
                },
                type: reward_pool_type.released,
                chain_transaction: {
                    equals: Prisma.AnyNull,
                },
                on_chain_try_count: {
                    lte: this.maxOnChainTryCount,
                },
            },
            orderBy: {
                id: "desc",
            },
            include: {
                user_rewards: {
                    include: {
                        user_info: true,
                    },
                },
                order_info: true,
                reward_pools: true,
            },
        })

        if (statementOrders.length === 0) {
            this.logger.log("No statement need settle")
            return
        }

        for (const statement of statementOrders) {
            if (!statement.reward_pools.buyback_address) {
                this.logger.warn(
                    `SETTLE ORDER REWARD ERROR: No buyback address for settle statement: ${statement.id}, pool: ${statement.token}`,
                )
                continue
            }

            //check balance
            const usdcBalance = await this.giggleService.getWalletBalance(
                this.settleWallet,
                process.env.GIGGLE_LEGAL_USDC,
            )
            if (usdcBalance.length === 0) {
                this.logger.error(
                    `SETTLE ORDER REWARD ERROR: No usdc balance for settle statement: ${statement.id}, wallet: ${this.settleWallet}`,
                )
                continue
            }
            const usdcBalanceAmount = new Decimal(usdcBalance[0].amount)
            if (usdcBalanceAmount.lt(statement.usd_revenue.toNumber())) {
                this.logger.error(
                    `SETTLE ORDER REWARD ERROR: Insufficient usdc balance: ${usdcBalanceAmount.toString()} < ${statement.usd_revenue.toString()} for settle statement: ${statement.id}, wallet: ${this.settleWallet}`,
                )
                continue
            }

            //check reward pool token balance
            const tokenBalance = await this.retrieve(statement.token)
            if (!tokenBalance) {
                this.logger.error(
                    `SETTLE ORDER REWARD ERROR: No token balance for settle statement: ${statement.id}, wallet: ${this.settleWallet}, balance: ${tokenBalance.totalAmount}`,
                )
                continue
            }
            const tokenBalanceAmount = new Decimal(tokenBalance.totalAmount).div(10 ** 6)
            if (tokenBalanceAmount.lt(statement.amount.mul(-1).toNumber())) {
                this.logger.error(
                    `SETTLE ORDER REWARD ERROR: Insufficient token balance when settle statement: ${statement.id}, pool: ${statement.token}, token balance: ${tokenBalanceAmount.toString()}, need tokens: ${statement.amount.mul(-1).toString()}`,
                )
                continue
            }

            const arr = []
            let amountIn = new Decimal(0)
            let needTokens = new Decimal(0)
            for (const userReward of statement.user_rewards) {
                //continue if userReward.rewards is 0
                if (userReward.rewards.eq(0)) {
                    this.logger.warn(
                        `SETTLE ORDER REWARD WARNING: User reward is 0 for settle statement: ${statement.id}, user: ${userReward.user_info.email}`,
                    )
                    continue
                }

                //determine wallet address
                let walletAddress = ""
                if (userReward.role === RewardAllocateRoles.BUYBACK) {
                    //get buyback wallet from reward pool
                    walletAddress = statement.reward_pools.buyback_address
                } else if (userReward.role === RewardAllocateRoles.PLATFORM) {
                    walletAddress = this.platformWallet
                } else if (userReward.user_info) {
                    walletAddress = userReward.user_info.wallet_address
                } else if (userReward.wallet_address) {
                    walletAddress = userReward.wallet_address
                } else {
                    this.logger.warn(`User reward has no user info or user: ${JSON.stringify(userReward)}`)
                    continue
                }

                arr.push({
                    wallet_address: walletAddress,
                    share: userReward.rewards,
                    token: userReward.token === process.env.GIGGLE_LEGAL_USDC ? 0 : 1,
                })
                amountIn = amountIn.plus(userReward.token === process.env.GIGGLE_LEGAL_USDC ? userReward.rewards : 0)
                needTokens = needTokens.plus(
                    userReward.token === process.env.GIGGLE_LEGAL_USDC ? 0 : userReward.rewards,
                )
            }

            if (arr.length === 0) {
                this.logger.warn(
                    `SETTLE ORDER REWARD ERROR: No user reward to settle statement: ${JSON.stringify(statement)}`,
                )
                continue
            }

            //append on_chain_try_count
            await this.prisma.reward_pool_statement.update({
                where: { id: statement.id },
                data: { on_chain_try_count: statement.on_chain_try_count + 1 },
            })

            this.logger.log(
                `SETTLE ORDER REWARD: ${statement.id}, amountIn: ${amountIn.toString()}, settle wallet: ${this.settleWallet},  settle wallet usdc balance: ${usdcBalanceAmount.toString()}`,
            )

            this.logger.log(
                `SETTLE ORDER REWARD: ${statement.id}, need tokens: ${needTokens.toString()}, token balance: ${tokenBalanceAmount.toString()}`,
            )

            try {
                const allocateParams: AllocateRevenueDto = {
                    token_mint: statement.token,
                    revenue: amountIn.toNumber(),
                    paid_time: statement.order_info.paid_time.getTime() / 1000,
                    revenue_allocate_details: arr,
                }

                const transaction = await this.allocateRevenue(allocateParams)
                await this.prisma.reward_pool_statement.update({
                    where: {
                        id: statement.id,
                    },
                    data: { chain_transaction: transaction as any },
                })
                //settle sales agent revenue
                await this.salesAgentService.settleStatement(statement.id)
                this.logger.log(`SETTLE ORDER REWARD: ${statement.id} done`)
                //sleep 2 seconds
                await new Promise((resolve) => setTimeout(resolve, 2000))
            } catch (error) {
                this.logger.error(`SETTLE ORDER REWARD ERROR: ${error}`)
                continue
            }
        }
    }

    //check balance with chain
    @Cron(CronExpression.EVERY_DAY_AT_5AM)
    async settlePoolBalanceWithChain() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return
        if (process.env.ENV != "product") return
        const notifyHook = process.env.STATEMENT_NOTIFY_ADDRESS
        if (!notifyHook) {
            this.logger.error("No notify hook for statement")
            return
        }

        //get off chain data:
        const offChainData = await this.prisma.reward_pools.findMany({
            where: {
                on_chain_status: reward_pool_on_chain_status.success,
                statement: {
                    some: {
                        type: {
                            in: [reward_pool_type.injected, reward_pool_type.buyback],
                        },
                        chain_transaction: {
                            not: null,
                        },
                    },
                },
            },
        })

        const tableField = ["Token", "Ticker", "Balance(Off Chain)", "Balance(On Chain)", "Diff"]
        let tableContent = "|" + tableField.join("|") + "\n"
        tableContent += "|" + tableField.map(() => "--------------").join("|") + "\n"
        for (const pool of offChainData) {
            const onChainData = await this.retrieve(pool.token)
            if (!onChainData) continue
            const onChainBalance = new Decimal(onChainData.totalAmount).div(10 ** 6)
            const diff = onChainBalance.minus(pool.current_balance)
            tableContent +=
                "|" +
                [
                    pool.token,
                    pool.ticker,
                    pool.current_balance.toString(),
                    onChainBalance.toString(),
                    diff.abs().gt(0.1) ? "** 🔴" + diff.toString() + "🔴 **" : diff.toString(),
                ].join("|") +
                "\n"
        }
        tableContent = "#### Reward Pool Balance Diff of " + new Date().toLocaleString() + "\n\n" + tableContent
        await lastValueFrom(this.rewardOnChainHttpService.post(notifyHook, { text: tableContent }))
        this.logger.log("SETTLE WITH CHAIN: Notify done")
    }

    //settle with chain
    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    //@Cron(CronExpression.EVERY_MINUTE)
    async settleWithChain() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return
        if (process.env.ENV != "product") return
        const notifyHook = process.env.STATEMENT_NOTIFY_ADDRESS
        if (!notifyHook) {
            this.logger.error("No notify hook for statement")
            return
        }

        //get off chain data:
        const offChainData = await this.prisma.view_user_rewards_summary.findMany({
            where: {
                ticker: {
                    not: "usdc",
                },
            },
        })
        const tableField = [
            "User",
            "Wallet Address",
            "Token",
            "Ticker",
            "Rewards(Off Chain)",
            "Locked(Off Chain)",
            "Released(Off Chain)",
            "Withdrawn(Off Chain)",
            "Available(Off Chain)",
            "Rewards(On Chain)",
            "Locked(On Chain)",
            "Available(On Chain)",
            "Available Diff(Off Chain - On Chain)",
        ]
        let tableContent = "|" + tableField.join("|") + "\n"
        tableContent += "|" + tableField.map(() => "--------------").join("|") + "\n"
        for (const data of offChainData) {
            //find user
            const user_info = await this.prisma.users.findUnique({
                where: {
                    username_in_be: data.user,
                },
            })
            if (!user_info || !user_info.wallet_address) {
                this.logger.warn(`User: ${data.user} not found or has no wallet address.`)
                continue
            }
            const onChainData = await this.retrieveUserTokenBalance(data.token, user_info.wallet_address)
            const offChainAvailable = data.released.minus(data.withdrawn)
            if (!onChainData) continue
            const onChainDataMapped: any = {
                totalAmount: new Decimal(onChainData.totalAmount).div(10 ** 6),
                lockedAmount: new Decimal(onChainData.lockedAmount).div(10 ** 6),
                availableAmount: new Decimal(onChainData.availableAmount).div(10 ** 6),
            }
            onChainDataMapped.withdrawn = new Decimal(onChainData.totalAmount).minus(onChainData.availableAmount)
            const availableDiff = offChainAvailable.minus(onChainDataMapped.availableAmount)
            if (availableDiff.abs().gt(0.1) && data.rewards.toString() != onChainDataMapped.totalAmount.toString()) {
                tableContent +=
                    "|" +
                    [
                        user_info.email,
                        user_info.wallet_address,
                        data.token,
                        data.ticker,
                        data.rewards.toString(),
                        data.locked.toString(),
                        data.released.toString(),
                        data.withdrawn.toString(),
                        offChainAvailable.toString(),
                        onChainDataMapped.totalAmount.toString(),
                        onChainDataMapped.lockedAmount.toString(),
                        onChainDataMapped.availableAmount.toString(),
                        availableDiff.abs().gt(0.1)
                            ? "** 🔴" + availableDiff.toString() + "🔴 **"
                            : availableDiff.toString(),
                    ].join("|") +
                    "\n"
            }
        }
        tableContent = "#### User's rewards summary " + new Date().toLocaleString() + "\n\n" + tableContent
        await lastValueFrom(this.rewardOnChainHttpService.post(notifyHook, { text: tableContent }))
        this.logger.log("SETTLE WITH CHAIN: Notify done")
    }

    //get buyback record
    // deprecated !!!DO NOT USE!!! NEVER CALL THIS FUNCTION!!!
    //@Cron(CronExpression.EVERY_10_MINUTES)
    async processBuybackRecord() {
        return
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return
        if (process.env.ENV != "product") return
        const rewards_pools = await this.prisma.reward_pool_statement.groupBy({
            by: ["token"],
            _sum: {
                usd_revenue: true,
            },
            _max: {
                buyback_id: true,
            },
            where: {
                chain_transaction: {
                    not: null,
                },
            },
        })
        for (const reward_pool of rewards_pools) {
            try {
                if (new Decimal(reward_pool._sum.usd_revenue || 0).lt(10)) {
                    this.logger.log(`Buyback record is less than 10 usd, skip: ${reward_pool.token}`)
                    continue
                }
                const buybackRecord = await this.getBuybackRecord(reward_pool.token, reward_pool._max.buyback_id || 0)
                if (buybackRecord.length === 0) {
                    this.logger.log(`No buyback record found: ${reward_pool.token}`)
                    continue
                }
                //get current balance of pool
                const poolInfo = await this.prisma.reward_pools.findUnique({
                    where: {
                        token: reward_pool.token,
                    },
                })
                for (const record of buybackRecord) {
                    await this.prisma.$transaction(async (tx) => {
                        const buyAmount = new Decimal(record.number).div(10 ** 6)
                        const newPoolInfo = await tx.reward_pools.update({
                            where: {
                                token: reward_pool.token,
                            },
                            data: {
                                current_balance: {
                                    increment: buyAmount,
                                },
                            },
                        })

                        await tx.reward_pool_statement.create({
                            data: {
                                token: reward_pool.token,
                                type: reward_pool_type.buyback,
                                amount: buyAmount,
                                buyback_id: record.id,
                                chain_transaction: {
                                    signature: record.sig,
                                },
                                current_balance: newPoolInfo.current_balance,
                            },
                        })
                    })
                }
            } catch (error) {
                this.logger.error(`Get buyback record failed: ${error}`)
                continue
            }
        }
    }

    @Cron(CronExpression.EVERY_10_MINUTES)
    //@Cron(CronExpression.EVERY_5_MINUTES)
    async createBuyBackOrders() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return

        const MINIUM_ORDER_BUYBACK_AMOUNT = 3 //$3 minimum buyback amount
        //process order if buyback required
        const orders = await this.prisma.orders.findMany({
            where: {
                buyback_after_paid: true,
                buyback_order_id: null,
                current_status: OrderStatus.COMPLETED,
                rewards_model_snapshot: { not: Prisma.AnyNull },
            },
        })
        const adminUser = await this.prisma.users.findFirst({
            where: {
                is_admin: true,
            },
        })
        if (!adminUser) {
            this.logger.error(`[CreateBuyBackOrders]Admin user not found`)
            return
        }

        //create a map to calculate total need buyback
        const buybackMapping = new Map<
            string,
            {
                orders: string[]
                buybackAmount: Decimal
                needToTransfer: { order_id: string; transferAmount: Decimal }[]
                buybackWallet: string
            }
        >()
        for (const order of orders) {
            try {
                const rewardsSnapshot = order.rewards_model_snapshot as any as RewardSnapshotDto
                const poolInfo = await this.prisma.reward_pools.findUnique({
                    where: {
                        token: rewardsSnapshot.token,
                    },
                })
                if (!poolInfo) {
                    this.logger.error(`[CreateBuyBackOrders]Reward pool not found: ${rewardsSnapshot.token}`)
                    continue
                }

                if (!buybackMapping.has(poolInfo.token)) {
                    buybackMapping.set(poolInfo.token, {
                        orders: [],
                        buybackAmount: new Decimal(0),
                        needToTransfer: [],
                        buybackWallet: poolInfo.buyback_address,
                    })
                }

                const needBuybackRatio = rewardsSnapshot.revenue_ratio
                    .filter((item: RewardAllocateRatio) => item.role === RewardAllocateRoles.BUYBACK)
                    .reduce((acc: number, curr: RewardAllocateRatio) => acc + curr.ratio, 0)
                if (needBuybackRatio > 90 || needBuybackRatio < 0) {
                    this.logger.error(`[CreateBuyBackOrders]ratio is not valid: ${JSON.stringify(rewardsSnapshot)}`)
                    continue
                }

                const needBuybackAmount = new Decimal(order.amount).mul(needBuybackRatio).div(10000)

                buybackMapping.set(poolInfo.token, {
                    orders: [...buybackMapping.get(poolInfo.token).orders, order.order_id],
                    buybackAmount: buybackMapping.get(poolInfo.token).buybackAmount.plus(needBuybackAmount),
                    needToTransfer: [
                        ...buybackMapping.get(poolInfo.token).needToTransfer,
                        { order_id: order.order_id, transferAmount: needBuybackAmount },
                    ],
                    buybackWallet: poolInfo.buyback_address,
                })

                if (order.buyback_fee_transferred) {
                    //we need to minus the needToTransfer if the buyback fee is transferred
                    buybackMapping.set(poolInfo.token, {
                        orders: buybackMapping.get(poolInfo.token).orders,
                        buybackAmount: buybackMapping.get(poolInfo.token).buybackAmount,
                        needToTransfer: buybackMapping
                            .get(poolInfo.token)
                            .needToTransfer.filter((item) => item.order_id !== order.order_id),
                        buybackWallet: poolInfo.buyback_address,
                    })
                }
            } catch (error) {
                this.logger.error(`Mapping buyback amount failed: ${error}`)
                continue
            }
        }

        //loop through buyback mapping
        if (buybackMapping.size > 0) {
            buybackMapping.forEach(async (value, token) => {
                try {
                    if (value.buybackAmount.lt(MINIUM_ORDER_BUYBACK_AMOUNT)) {
                        this.logger.warn(
                            `[CreateBuyBackOrders]Buyback amount of token ${token} is less than ${MINIUM_ORDER_BUYBACK_AMOUNT}: ${JSON.stringify(value)}`,
                        )
                        return
                    }

                    if (value.needToTransfer.length > 0) {
                        //transfer if needed
                        const transferOrders = value.needToTransfer.map((item) => item.order_id)
                        const transferAmount = value.needToTransfer.reduce(
                            (acc, item) => acc.plus(item.transferAmount),
                            new Decimal(0),
                        )
                        this.logger.log(
                            `[CreateBuyBackOrders]Transfer buyback fee of token ${token}, amount: ${transferAmount.toNumber()} to buyback wallet: ${value.buybackWallet}`,
                        )
                        const result = await this.giggleService.sendToken(
                            {
                                email: adminUser.email,
                                user_id: adminUser.username_in_be,
                                usernameShorted: adminUser.username_in_be,
                            },
                            {
                                amount: transferAmount.toNumber(),
                                mint: process.env.GIGGLE_LEGAL_USDC,
                                receipt: value.buybackWallet,
                            },
                            this.settleWallet,
                        )
                        if (!result.sig) {
                            this.logger.error(`[CreateBuyBackOrders]Transfer failed: ${JSON.stringify(result)}`)
                            return
                        }

                        await this.prisma.orders.updateMany({
                            where: {
                                order_id: {
                                    in: transferOrders,
                                },
                            },
                            data: { buyback_fee_transferred: true },
                        })
                    }

                    //create buyback order
                    const orderId = await this.startBuyback(token, value.buybackAmount.toNumber())
                    if (!orderId) {
                        this.logger.error(`[CreateBuyBackOrders]Start buyback failed: ${token}`)
                        return
                    }
                    await this.prisma.$transaction(async (tx) => {
                        await tx.orders.updateMany({
                            where: {
                                order_id: {
                                    in: value.orders,
                                },
                            },
                            data: {
                                buyback_order_id: orderId,
                            },
                        })
                        await tx.reward_pool_buybacks.create({
                            data: {
                                token: token,
                                order_id: orderId,
                                request: {
                                    amount: value.buybackAmount.toNumber(),
                                    token: token,
                                },
                            },
                        })
                    })
                    this.logger.log(`[CreateBuyBackOrders]Create buyback order: ${orderId}`)
                } catch {
                    this.logger.error(`[CreateBuyBackOrders]Create buyback order failed: ${token}`)
                    return
                }
            })
        }

        //sleep 30 seconds to avoid duplicate buyback
        await new Promise((resolve) => setTimeout(resolve, 30000))

        const rewards_pools = await this.prisma.reward_pool_statement.groupBy({
            by: ["token"],
            _sum: {
                usd_revenue: true,
            },
            _max: {
                buyback_id: true,
            },
            where: {
                chain_transaction: {
                    not: null,
                },
            },
        })
        for (const reward_pool of rewards_pools) {
            try {
                if (new Decimal(reward_pool._sum.usd_revenue || 0).lt(10)) {
                    this.logger.log(`Buyback record is less than 10 usd, skip: ${reward_pool.token}`)
                    continue
                }

                const poolInfo = await this.prisma.reward_pools.findUnique({
                    where: {
                        token: reward_pool.token,
                    },
                })
                //check buyback balance
                const buybackBalance = await this.giggleService.getWalletBalance(
                    poolInfo.buyback_address,
                    process.env.GIGGLE_LEGAL_USDC,
                )

                //we need to minus the order buyback amount
                const orderBuybackAmount = buybackMapping.get(reward_pool.token).buybackAmount.toNumber()

                const buybackUsdcAmount = (Number(buybackBalance?.[0]?.amount) || 0) - orderBuybackAmount

                if (buybackUsdcAmount < 10) {
                    this.logger.log(
                        `Buyback balance is less than 10 usdc, wallet balance: ${buybackBalance?.[0]?.amount}, pending order buyback amount: ${orderBuybackAmount}, buyback usdc amount: ${buybackUsdcAmount}, skip: ${reward_pool.token}`,
                    )
                    continue
                }

                //create buyback order
                const orderId = await this.startBuyback(reward_pool.token, buybackUsdcAmount)
                if (!orderId) {
                    this.logger.error(`Start buyback failed: ${reward_pool.token}`)
                    continue
                }
                //update buyback order id
                await this.prisma.reward_pool_buybacks.create({
                    data: {
                        token: reward_pool.token,
                        order_id: orderId,
                        request: {
                            amount: buybackUsdcAmount,
                            token: reward_pool.token,
                        },
                    },
                })
            } catch (error) {
                this.logger.error(`Get buyback record failed: ${error}`)
                continue
            }
        }
    }

    //check buyback result
    @Cron(CronExpression.EVERY_5_MINUTES)
    async checkBuybackResult() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return
        if (await UtilitiesService.checkTaskRunning(this.onChainTaskId, TASK_IDS.CHECK_BUYBACK_RESULT)) {
            this.logger.log("check buyback result task is running, skip")
            return
        }
        //check jobid is running
        await UtilitiesService.startTask(TASK_IDS.CHECK_BUYBACK_RESULT)
        const buybacks = await this.prisma.reward_pool_buybacks.findMany({
            where: {
                OR: [
                    {
                        status: {
                            not: "4",
                        },
                    },
                    {
                        status: null,
                    },
                ],
            },
        })
        for (const buyback of buybacks) {
            //continue if status large then 4(means error)
            if (parseInt(buyback.status) >= 4) continue
            const result = await this.getBuybackResult(buyback.order_id)
            if (!result) {
                this.logger.warn(`Get buyback result failed: ${buyback.order_id}`)
                continue
            }
            try {
                //update
                await this.prisma.reward_pool_buybacks.update({
                    where: {
                        id: buyback.id,
                    },
                    data: {
                        status: result.status.toString(),
                        response: result as any,
                    },
                })

                if (result.status !== 4) continue
                //update reward pool and orders when buyback success
                for (const record of result.arr) {
                    if (record.status === 1) {
                        //ignore burn record
                        continue
                    }
                    const buyAmount = new Decimal(record.number).div(10 ** 6)

                    //check signature is exists
                    const signatureExists = await this.prisma.reward_pool_statement.findFirst({
                        where: {
                            chain_transaction: {
                                path: "$.signature",
                                equals: record.sig,
                            },
                        },
                    })

                    if (signatureExists) {
                        this.logger.error(`Signature already exists of buyback record: ${record.sig}, skip`)
                        continue
                    }
                    await this.prisma.$transaction(async (tx) => {
                        const newPoolInfo = await tx.reward_pools.update({
                            where: {
                                token: buyback.token,
                            },
                            data: {
                                current_balance: {
                                    increment: buyAmount,
                                },
                            },
                        })

                        await tx.reward_pool_statement.create({
                            data: {
                                token: buyback.token,
                                type: reward_pool_type.buyback,
                                amount: buyAmount,
                                buyback_id: record.id,
                                chain_transaction: {
                                    signature: record.sig,
                                },
                                current_balance: newPoolInfo.current_balance,
                            },
                        })
                    })
                }
                //check if this is an order triggered buyback
                const orders = await this.prisma.orders.findMany({
                    where: {
                        buyback_order_id: buyback.order_id,
                    },
                })
                if (orders.length > 0) {
                    //update order status
                    await this.prisma.orders.updateMany({
                        where: {
                            order_id: {
                                in: orders.map((item) => item.order_id),
                            },
                        },
                        data: {
                            buyback_result: result as any,
                        },
                    })
                    //release rewards
                    for (const order of orders) {
                        if (order.release_rewards_after_paid && order.current_status === OrderStatus.COMPLETED) {
                            await this.orderService.releaseRewards(order, null)
                        }
                    }
                }
            } catch (error) {
                this.logger.error(`Check buyback result failed: ${error}`)
                continue
            }
        }
        //stop task
        await UtilitiesService.stopTask(TASK_IDS.CHECK_BUYBACK_RESULT)
    }

    //check reward pool balance every 10 minutes
    @Cron(CronExpression.EVERY_10_MINUTES)
    async checkRewardPoolBalance() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") {
            return
        }
        const notifyWebhook = process.env.STATEMENT_NOTIFY_ADDRESS
        if (!notifyWebhook) {
            this.logger.error("STATEMENT_NOTIFY_ADDRESS is not set")
            return
        }
        const result = await this.prisma.$queryRaw<
            {
                token: string
                balance: Decimal
                current_balance: Decimal
            }[]
        >`
    with t1 as (select token,sum(amount) as balance
            from reward_pool_statement
            group by token),
     t2 as (select token, current_balance from reward_pools)
    select a.*,b.current_balance
    from t1 a
         left join t2 b on a.token = b.token
    where abs(a.balance - b.current_balance) > 0.1;
        `
        if (result && result.length > 0) {
            for (const item of result) {
                this.logger.error(
                    `Reward pool balance error: ${item.token}, in statement: ${item.balance.toString()}, in pool summary: ${item.current_balance.toString()}`,
                )
            }
        }
    }

    //settle statement
    @Cron(CronExpression.EVERY_5_MINUTES)
    async rewardToChain() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return

        if (await UtilitiesService.checkTaskRunning(this.onChainTaskId, this.onChainTaskTimeout)) {
            this.logger.log("Reward to chain task is running, skip")
            return
        }

        await UtilitiesService.startTask(this.onChainTaskId)

        //settle inject
        await this.settleInjectToken()

        //settle statement
        await this.settleStatement()

        //settle airdrop
        await this.settleAirDropStatement()

        //stop task
        await UtilitiesService.stopTask(this.onChainTaskId)
    }

    //update buyback wallet
    @Cron(CronExpression.EVERY_5_MINUTES)
    async updateBuybackWallet() {
        if (process.env.TASK_SLOT != "1" || process.env.SC_UPDATING == "true") return
        const taskId = TASK_IDS.UPDATE_BUYBACK_WALLET

        if (await UtilitiesService.checkTaskRunning(taskId, this.onChainTaskTimeout)) {
            this.logger.log("Update buyback wallet task is running, skip")
            return
        }
        await UtilitiesService.startTask(taskId)

        const rewardPools = await this.prisma.reward_pools.findMany({
            where: {
                on_chain_status: reward_pool_on_chain_status.success,
                buyback_address: null,
            },
            orderBy: {
                id: "desc",
            },
        })

        //check if there is any reward pool
        if (rewardPools.length === 0) {
            this.logger.log("No reward pool to update buyback wallet")
            return
        }

        this.logger.log(`Update buyback wallet start: ${rewardPools.length} reward pools`)
        for (const rewardPool of rewardPools) {
            try {
                const buybackWallet = await this.retrieveBuybackWallet(rewardPool.token)
                if (!buybackWallet) {
                    this.logger.error(`Buyback wallet not found: ${rewardPool.token}`)
                    return
                }
                await this.prisma.reward_pools.update({
                    where: {
                        token: rewardPool.token,
                    },
                    data: {
                        buyback_address: buybackWallet,
                    },
                })
                await new Promise((resolve) => setTimeout(resolve, 10000))
                this.logger.log(`Update buyback wallet done: ${rewardPool.token}`)
            } catch (error) {
                this.logger.error(`Update buyback wallet failed: ${error}`)
                continue
            }
        }
        await UtilitiesService.stopTask(taskId)
    }
}
