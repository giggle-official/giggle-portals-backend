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
import { RewardAllocateRoles } from "src/payment/rewards-pool/rewards-pool.dto"

@Injectable()
export class RewardPoolOnChainService {
    private readonly logger = new Logger(RewardPoolOnChainService.name)
    private readonly settleWallet: string
    private readonly platformWallet: string
    private readonly rpcUrl: string
    private readonly authToken: string
    private readonly rewardOnChainHttpService: HttpService

    private readonly maxOnChainTryCount: number = 3

    constructor(
        private readonly prisma: PrismaService,
        private readonly giggleService: GiggleService,
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

        //check user's balance
        const userBalance = await this.giggleService.getUserWalletDetail(user, 1, 1, dto.token_mint)
        let balance = 0
        if (userBalance.list?.[0]?.mint === dto.token_mint) {
            balance = userBalance.list?.[0]?.holding_num
        }
        if (balance < dto.amount) {
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

    //process withdraw token of history record
    //@Cron(CronExpression.EVERY_MINUTE)
    async processWithdrawToken() {
        if (process.env.TASK_SLOT != "1") return

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
                    status: withdrawToken.on_chain_try_count > this.maxOnChainTryCount ? "failed" : "pending",
                    transaction_error: JSON.stringify(error),
                },
            })
        }
    }

    //process inject token of history record
    //@Cron(CronExpression.EVERY_MINUTE)
    async processInjectToken() {
        if (process.env.TASK_SLOT != "1") return

        const injectToken = await this.prisma.reward_pool_statement.findFirst({
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
            take: 1,
        })

        if (!injectToken) {
            this.logger.log("No inject token need process")
            return
        }

        //append on_chain_try_count
        await this.prisma.reward_pool_statement.update({
            where: { id: injectToken.id },
            data: { on_chain_try_count: injectToken.on_chain_try_count + 1 },
        })

        //check user wallet token balance
        const userBalance = await this.giggleService.getWalletBalance(
            injectToken.reward_pools.user_info.wallet_address,
            injectToken.reward_pools.token,
        )
        if (userBalance.length === 0) {
            this.logger.error(
                `PROCESS INJECT TOKEN ERROR: No token balance for inject token: ${injectToken.token} $${injectToken.reward_pools.ticker}, wallet: ${injectToken.reward_pools.user_info.wallet_address}`,
            )
            return
        }
        const userBalanceAmount = new Decimal(userBalance[0].amount)
        if (userBalanceAmount.lt(injectToken.amount)) {
            this.logger.error(
                `PROCESS INJECT TOKEN ERROR: Insufficient token balance for inject token: ${injectToken.token} $${injectToken.reward_pools.ticker}, wallet: ${injectToken.reward_pools.user_info.wallet_address}`,
            )
            return
        }

        this.logger.log(
            `PROCESS INJECT TOKEN: ${injectToken.token} $${injectToken.reward_pools.ticker}, need tokens: ${injectToken.amount}`,
        )

        const injectResult = await this.injectToken(
            {
                token_mint: injectToken.reward_pools.token,
                amount: injectToken.amount.toNumber(),
                email: injectToken.reward_pools.user_info.email,
                user_wallet: injectToken.reward_pools.user_info.wallet_address,
            },
            {
                usernameShorted: injectToken.reward_pools.user_info.username_in_be,
            },
        )

        await this.prisma.reward_pool_statement.update({
            where: { id: injectToken.id },
            data: { chain_transaction: injectResult as any },
        })
    }

    //push current reward pool to chain
    @Cron(CronExpression.EVERY_MINUTE)
    async pushToChain() {
        if (process.env.TASK_SLOT != "1") return

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

    //settle air drop statement to chain
    //@Cron(CronExpression.EVERY_MINUTE)
    async settleAirDropStatement() {
        if (process.env.TASK_SLOT != "1") return
        const airdropStatement = await this.prisma.reward_pool_statement.findFirst({
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

        if (!airdropStatement) {
            this.logger.log("SETTLE AIRDROP: No airdrop statement need settle")
            return
        }

        //append on_chain_try_count
        await this.prisma.reward_pool_statement.update({
            where: { id: airdropStatement.id },
            data: { on_chain_try_count: airdropStatement.on_chain_try_count + 1 },
        })

        if (airdropStatement.user_rewards.length === 0) {
            this.logger.error(`SETTLE AIRDROP ERROR: No user reward for airdrop statement: ${airdropStatement.id}`)
            return
        }

        const userReward = new Decimal(airdropStatement.user_rewards[0].rewards)

        //check reward pool token balance
        const tokenBalance = await this.retrieve(airdropStatement.token)
        if (!tokenBalance) {
            this.logger.error(
                `SETTLE AIRDROP ERROR: No token balance for settle airdrop statement: ${airdropStatement.id}, wallet: ${this.settleWallet}`,
            )
            return
        }

        const tokenBalanceAmount = new Decimal(tokenBalance.totalAmount)
        if (tokenBalanceAmount.lt(userReward)) {
            this.logger.error(
                `SETTLE AIRDROP ERROR: Insufficient token balance when settle airdrop statement: ${airdropStatement.id}, pool: ${airdropStatement.token}, token balance: ${tokenBalanceAmount.toNumber()}, need tokens: ${userReward.toNumber()}`,
            )
            return
        }

        //start settle
        this.logger.log(
            `SETTLE AIRDROP: ${airdropStatement.id}, need tokens: ${userReward.toNumber()}, token balance: ${tokenBalanceAmount.toNumber()}`,
        )

        const reqParam = {
            user_wallet: airdropStatement.user_rewards[0].user_info.wallet_address,
            owner_wallet: airdropStatement.reward_pools.user_info.wallet_address,
            token: airdropStatement.token,
            amount: userReward.toNumber(),
            timestamp: airdropStatement.created_at.getTime() / 1000,
        }

        const transaction = await this.airdropStatementToChain(reqParam, airdropStatement.reward_pools.user_info.email)
        await this.prisma.reward_pool_statement.update({
            where: { id: airdropStatement.id },
            data: { chain_transaction: transaction as any },
        })
        this.logger.log(`SETTLE AIRDROP: ${airdropStatement.id} done`)
    }

    //settle order statement to chain
    //@Cron(CronExpression.EVERY_MINUTE)
    async settleStatement() {
        if (process.env.TASK_SLOT != "1") return
        const statement = await this.prisma.reward_pool_statement.findFirst({
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

        if (!statement) {
            this.logger.log("No statement need settle")
            return
        }

        if (!statement.reward_pools.buyback_address) {
            this.logger.warn(
                `SETTLE ORDER REWARD ERROR: No buyback address for settle statement: ${statement.id}, pool: ${statement.token}`,
            )
            return
        }

        //append on_chain_try_count
        await this.prisma.reward_pool_statement.update({
            where: { id: statement.id },
            data: { on_chain_try_count: statement.on_chain_try_count + 1 },
        })

        //check balance
        const usdcBalance = await this.giggleService.getWalletBalance(this.settleWallet, process.env.GIGGLE_LEGAL_USDC)
        if (usdcBalance.length === 0) {
            this.logger.error(
                `SETTLE ORDER REWARD ERROR: No usdc balance for settle statement: ${statement.id}, wallet: ${this.settleWallet}`,
            )
            return
        }
        const usdcBalanceAmount = new Decimal(usdcBalance[0].amount)
        if (usdcBalanceAmount.lt(statement.usd_revenue.toNumber())) {
            this.logger.error(
                `SETTLE ORDER REWARD ERROR: Insufficient usdc balance: ${usdcBalanceAmount.toNumber()} < ${statement.usd_revenue.toNumber()} for settle statement: ${statement.id}, wallet: ${this.settleWallet}`,
            )
            return
        }

        //check reward pool token balance
        const tokenBalance = await this.retrieve(statement.token)
        if (!tokenBalance) {
            this.logger.error(
                `SETTLE ORDER REWARD ERROR: No token balance for settle statement: ${statement.id}, wallet: ${this.settleWallet}`,
            )
            return
        }
        const tokenBalanceAmount = new Decimal(tokenBalance.totalAmount)
        if (tokenBalanceAmount.lt(statement.amount.mul(-1).toNumber())) {
            this.logger.error(
                `SETTLE ORDER REWARD ERROR: Insufficient token balance when settle statement: ${statement.id}, pool: ${statement.token}, token balance: ${tokenBalanceAmount.toNumber()}, need tokens: ${statement.amount.mul(-1).toNumber()}`,
            )
            return
        }

        const arr = []
        let amountIn = new Decimal(0)
        let needTokens = new Decimal(0)
        for (const userReward of statement.user_rewards) {
            //determine wallet address
            let walletAddress = ""
            if (userReward.role === RewardAllocateRoles.BUYBACK) {
                //get buyback wallet from reward pool
                walletAddress = statement.reward_pools.buyback_address
            } else if (userReward.role === RewardAllocateRoles.PLATFORM) {
                walletAddress = this.settleWallet
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
            needTokens = needTokens.plus(userReward.token === process.env.GIGGLE_LEGAL_USDC ? 0 : userReward.rewards)
        }

        if (arr.length === 0) {
            this.logger.error(
                `SETTLE ORDER REWARD ERROR: No user reward to settle statement: ${JSON.stringify(statement)}`,
            )
            return
        }

        this.logger.log(
            `SETTLE ORDER REWARD: ${statement.id}, amountIn: ${amountIn.toNumber()}, settle wallet: ${this.settleWallet},  settle wallet usdc balance: ${usdcBalanceAmount.toNumber()}`,
        )

        this.logger.log(
            `SETTLE ORDER REWARD: ${statement.id}, need tokens: ${needTokens.toNumber()}, token balance: ${tokenBalanceAmount.toNumber()}`,
        )

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
    }

    //settle with chain
    @Cron(CronExpression.EVERY_DAY_AT_1AM)
    //@Cron(CronExpression.EVERY_5_MINUTES)
    async settleWithChain() {
        if (process.env.TASK_SLOT != "1") return
        if (process.env.ENV != "product") return
        const notifyHook = process.env.STATEMENT_NOTIFY_ADDRESS
        if (!notifyHook) {
            this.logger.error("No notify hook for statement")
            return
        }

        //get off chain data:
        const offChainData = await this.prisma.view_user_rewards_summary.findMany({
            include: {
                user_info: true,
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
            //get on chain data
            if (!data.user || !data.user_info?.wallet_address) {
                this.logger.warn(`User: ${data.user_info?.email || data.user} has no wallet address.`)
                continue
            }
            const onChainData = await this.retrieveUserTokenBalance(data.token, data.user_info.wallet_address)
            const offChainAvailable = data.released.minus(data.withdrawn)
            if (!onChainData) continue
            const onChainDataMapped: any = {
                totalAmount: new Decimal(onChainData.totalAmount).div(10 ** 6),
                lockedAmount: new Decimal(onChainData.lockedAmount).div(10 ** 6),
                availableAmount: new Decimal(onChainData.availableAmount).div(10 ** 6),
            }
            onChainDataMapped.withdrawn = new Decimal(onChainData.totalAmount).minus(onChainData.availableAmount)
            const availableDiff = offChainAvailable.minus(onChainDataMapped.availableAmount)
            tableContent +=
                "|" +
                [
                    data.user_info.email,
                    data.user_info.wallet_address,
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
                    availableDiff.gt(0) || availableDiff.abs().gt(0.1)
                        ? "** 🔴" + availableDiff.toString() + "🔴 **"
                        : availableDiff.toString(),
                ].join("|") +
                "\n"
        }
        tableContent = "#### Reward Pool Balance Diff of " + new Date().toLocaleString() + "\n\n" + tableContent
        await lastValueFrom(this.rewardOnChainHttpService.post(notifyHook, { text: tableContent }))
        this.logger.log("SETTLE WITH CHAIN: Notify done")
    }

    /*
    //update buyback wallet
    //@Cron(CronExpression.EVERY_5_MINUTES)
    //despeciated
    /*
    async updateBuybackWallet() {
        if (process.env.TASK_SLOT != "1") return

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
    }
    */
}
