import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common"
import {
    CreateRewardsPoolDto,
    RewardAllocateRatio,
    Pool,
    PoolResponseDto,
    UpdateRewardsPoolDto,
    InjectTokensDto,
    PoolsQueryDto,
    PoolsResponseListDto,
    RewardSnapshotDto,
    RewardAllocateRoles,
    StatisticsSummaryDto,
    StatisticsQueryDto,
    StatisticsIncomesDto,
    StatementQueryDto,
    StatementResponseListDto,
    StatementType,
    RewardAllocateType,
    RequestAirdropDto,
    AirdropResponseDto,
    StatementResponseDto,
    AirdropQueryDto,
    AirdropResponseListDto,
    AirdropType,
    StatementStatus,
} from "./rewards-pool.dto"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import {
    orders,
    Prisma,
    reward_pool_limit_offer,
    reward_pool_on_chain_status,
    reward_pool_statement,
    reward_pool_type,
} from "@prisma/client"
import { OpenAppService } from "src/open-app/open-app.service"
import { Decimal } from "@prisma/client/runtime/library"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { OrderService } from "src/payment/order/order.service"
import { CreateIpTokenGiggleResponseDto } from "src/web3/giggle/giggle.dto"
import { CronExpression } from "@nestjs/schedule"
import { Cron } from "@nestjs/schedule"
import { RewardPoolOnChainService } from "src/web3/reward-pool-on-chain/reward-pool-on-chain.service"
import { TransactionDto } from "src/web3/reward-pool-on-chain/reward-pool-on-chain.dto"
import { lastValueFrom } from "rxjs"

@Injectable()
export class RewardsPoolService {
    private readonly logger = new Logger(RewardsPoolService.name)
    public readonly PLATFORM_REVENUE_RATIO = 10
    constructor(
        private readonly prisma: PrismaService,

        @Inject(forwardRef(() => OpenAppService))
        private readonly openAppService: OpenAppService,

        @Inject(forwardRef(() => GiggleService))
        private readonly giggleService: GiggleService,

        @Inject(forwardRef(() => OrderService))
        private readonly orderService: OrderService,

        @Inject(forwardRef(() => RewardPoolOnChainService))
        private readonly rewardPoolOnChainService: RewardPoolOnChainService,
    ) {}
    async createPool(body: CreateRewardsPoolDto, user: UserJwtExtractDto): Promise<PoolResponseDto> {
        const poolExists = await this.prisma.reward_pools.findFirst({
            where: {
                token: body.token,
            },
        })
        if (poolExists) {
            throw new BadRequestException("Pool already exists")
        }
        //find ip info
        const ipInfo = await this.prisma.ip_library.findFirst({
            where: {
                token_info: {
                    path: "$.mint",
                    equals: body.token,
                },
                owner: user.usernameShorted,
            },
        })
        if (!ipInfo) {
            throw new BadRequestException("You are not the owner of the ip")
        }
        this.checkRewardsRatio(body.revenue_ratio)
        //find price
        const price = (await this.prisma.ip_library.findFirst({
            where: {
                current_token_info: {
                    path: "$.mint",
                    equals: body.token,
                },
            },
            select: {
                current_token_info: true,
            },
        })) as any
        const unitPrice = price?.current_token_info?.price || 0
        //create pool
        return await this.prisma.$transaction(async (tx) => {
            await tx.reward_pools.create({
                data: {
                    token: body.token,
                    unit_price: new Prisma.Decimal(unitPrice),
                    owner: user.usernameShorted,
                    injected_amount: body.amount,
                    rewarded_amount: 0,
                    current_balance: body.amount,
                    ticker: ipInfo.ticker,
                    revenue_ratio: this.mapRewardsRatioToPercentage(body.revenue_ratio),
                },
            })
            await tx.reward_pool_statement.create({
                data: {
                    token: body.token,
                    amount: body.amount,
                    type: "injected",
                    current_balance: body.amount,
                },
            })
            if (body.limit_offers) {
                await tx.reward_pool_limit_offer.createMany({
                    data: body.limit_offers.map((limitOffer) => ({
                        token: body.token,
                        external_ratio: limitOffer.external_ratio,
                        end_date: limitOffer.end_date,
                        start_date: limitOffer.start_date,
                    })),
                })
            }
            return this.mapToPoolData(
                await tx.reward_pools.findUniqueOrThrow({
                    where: { token: body.token },
                    include: {
                        reward_pool_limit_offer: true,
                    },
                }),
            )
        })
    }

    async updatePool(body: UpdateRewardsPoolDto, user: UserJwtExtractDto): Promise<PoolResponseDto> {
        const poolExists = await this.prisma.reward_pools.findFirst({
            where: {
                token: body.token,
            },
        })
        if (!poolExists) {
            throw new BadRequestException("Pool does not exist")
        }
        if (poolExists.owner !== user.usernameShorted) {
            throw new BadRequestException("You are not the owner of the pool")
        }

        this.checkRewardsRatio(body.revenue_ratio)

        return await this.prisma.$transaction(async (tx) => {
            const poolUpdated = await tx.reward_pools.update({
                where: { token: body.token },
                data: {
                    revenue_ratio: this.mapRewardsRatioToPercentage(body.revenue_ratio),
                    reward_pool_limit_offer: {
                        deleteMany: {},
                        createMany: {
                            data: body.limit_offers.map((limitOffer) => ({
                                external_ratio: limitOffer.external_ratio,
                                end_date: limitOffer.end_date,
                                start_date: limitOffer.start_date,
                            })),
                        },
                    },
                },
                include: {
                    reward_pool_limit_offer: true,
                },
            })
            return this.mapToPoolData(poolUpdated)
        })
    }

    async injectTokens(body: InjectTokensDto, user: UserJwtExtractDto): Promise<PoolResponseDto> {
        const poolExists = await this.prisma.reward_pools.findFirst({
            where: { token: body.token, owner: user.usernameShorted },
        })
        if (!poolExists) {
            throw new BadRequestException("Pool does not exist or you are not the owner of the pool")
        }

        if (poolExists.on_chain_status !== reward_pool_on_chain_status.success) {
            throw new BadRequestException("Pool is not on chain")
        }

        const transaction = await this.rewardPoolOnChainService.injectToken(
            {
                token_mint: poolExists.token,
                amount: body.append_amount,
                user_wallet: user.wallet_address,
                email: user.email,
            },
            user,
        )

        const newBalance = poolExists.current_balance.plus(body.append_amount)
        const newInjectedAmount = poolExists.injected_amount.plus(body.append_amount)
        return await this.prisma.$transaction(async (tx) => {
            const poolUpdated = await tx.reward_pools.update({
                where: { token: body.token },
                data: {
                    injected_amount: newInjectedAmount,
                    current_balance: newBalance,
                },
                include: {
                    reward_pool_limit_offer: true,
                },
            })
            await tx.reward_pool_statement.create({
                data: {
                    token: body.token,
                    amount: body.append_amount,
                    type: "injected",
                    current_balance: newBalance,
                    chain_transaction: transaction as any,
                },
            })
            return this.mapToPoolData(poolUpdated)
        })
    }

    async getPools(query: PoolsQueryDto): Promise<PoolsResponseListDto> {
        const where: Prisma.reward_poolsWhereInput = {
            on_chain_status: reward_pool_on_chain_status.success,
            buyback_address: {
                not: null,
            },
        }

        if (query.token) {
            where.token = query.token
        }
        if (query.owner) {
            where.owner = query.owner
        }

        if (query.app_id) {
            //find app info
            try {
                const appInfo = await this.openAppService.getAppDetail(query.app_id, "")
                if (appInfo?.ip_info?.token_info?.mint) {
                    where.token = appInfo.ip_info.token_info.mint
                }
            } catch (error) {
                return {
                    pools: [],
                    total: 0,
                }
            }
        }
        const pools = await this.prisma.reward_pools.findMany({
            where,
            include: {
                reward_pool_limit_offer: true,
            },
            orderBy: {
                created_at: "desc",
            },
            skip: Math.max(parseInt(query.page) - 1, 0) * parseInt(query.page_size),
            take: parseInt(query.page_size),
        })
        return {
            pools: await Promise.all(pools.map((pool) => this.mapToPoolData(pool))),
            total: pools.length,
        }
    }

    async getRewardSnapshot(token: string): Promise<RewardSnapshotDto> {
        const pool = await this.prisma.reward_pools.findFirst({
            where: {
                token,
            },
            include: {
                reward_pool_limit_offer: {
                    where: {
                        start_date: {
                            lte: new Date(),
                        },
                        end_date: {
                            gte: new Date(),
                        },
                    },
                },
            },
        })
        if (!pool) {
            return null
        }
        return {
            token: pool.token,
            ticker: pool.ticker,
            unit_price: pool.unit_price.toString(),
            revenue_ratio: pool.revenue_ratio as unknown as RewardAllocateRatio[],
            updated_at: pool.updated_at,
            created_at: pool.created_at,
            snapshot_date: new Date(),
            limit_offer: pool.reward_pool_limit_offer.length > 0 ? pool.reward_pool_limit_offer[0] : null,
        }
    }

    checkRewardsRatio(ratio: RewardAllocateRatio[]): void {
        //user can only use customized, buyback, developer, inviter role
        ratio.map((r) => {
            if (
                ![
                    RewardAllocateRoles.CUSTOMIZED,
                    RewardAllocateRoles.BUYBACK,
                    //RewardAllocateRoles.DEVELOPER,
                    //RewardAllocateRoles.INVITER,
                    RewardAllocateRoles.IPHOLDER,
                ].includes(r.role)
            ) {
                throw new BadRequestException("unknown role")
            }
        })
        const totalRatio = ratio.reduce((acc, curr) => acc + curr.ratio, 0)
        if (totalRatio !== 90) {
            throw new BadRequestException("The sum of the ratio must be 90")
        }

        for (const r of ratio) {
            let allocateType = r.allocate_type as unknown as RewardAllocateType
            if (allocateType !== RewardAllocateType.USDC) {
                throw new BadRequestException("The allocate type must be usdc")
            }
            /*
            switch (r.role) {
                case RewardAllocateRoles.BUYBACK:
                    if () {
                        throw new BadRequestException("The allocate type of buyback must be usdc")
                    }
                    break
                case RewardAllocateRoles.IPHOLDER:
                    if (allocateType !== RewardAllocateType.USDC) {
                        throw new BadRequestException("The allocate type of ipholder must be usdc")
                    }
                    break
                default:
                    break
            }*/
        }
    }

    async getStatisticsSummary(query: StatisticsQueryDto): Promise<StatisticsSummaryDto> {
        const pool = await this.prisma.reward_pools.findUniqueOrThrow({
            where: { token: query.token },
            include: {
                statement: {
                    where: {
                        type: "released",
                    },
                },
            },
        })

        const roleIncomes = await this.prisma.user_rewards.groupBy({
            by: ["role"],
            _sum: {
                rewards: true,
            },
            where: {
                ticker: "usdc",
                role: {
                    not: { in: ["platform", "order_creator"] },
                },
                order_id: {
                    in: pool.statement.map((s) => s.related_order_id),
                },
            },
        })

        //total income expect platform
        const totalIncomeWithoutPlatform = await this.prisma.user_rewards.aggregate({
            _sum: {
                rewards: true,
            },
            where: {
                ticker: "usdc",
                role: {
                    not: { in: ["platform", "order_creator"] },
                },
                order_id: {
                    in: pool.statement.map((s) => s.related_order_id),
                },
            },
        })

        //buyback amount
        const buybackAmount = await this.prisma.reward_pool_statement.aggregate({
            _sum: {
                amount: true,
            },
            where: {
                token: query.token,
                type: reward_pool_type.buyback,
            },
        })

        //tokenInfo
        const tokenInfo = await this.prisma.view_ip_token_prices.findFirst({
            where: {
                current_token_info: {
                    path: "$.mint",
                    equals: query.token,
                },
            },
        })

        return {
            incomes: totalIncomeWithoutPlatform._sum.rewards?.toNumber() || 0,
            incomes_total: pool.statement.reduce((acc, curr) => acc.plus(curr.usd_revenue), new Decimal(0)).toNumber(),
            orders: pool.statement.length,
            unit_price: pool.unit_price.toNumber(),
            price_change_24h: tokenInfo?.change24h.toNumber() || 0,
            market_cap: tokenInfo?.market_cap.toNumber() || 0,
            trade_volume: tokenInfo?.trade_volume.toNumber() || 0,
            current_balance: pool.current_balance.toNumber(),
            injected_amount: pool.injected_amount.toNumber(),
            rewarded_amount: pool.rewarded_amount.toNumber(),
            buyback_amount: buybackAmount._sum.amount?.toNumber() || 0,
            roles_income: roleIncomes.map((r) => ({
                role: r.role as RewardAllocateRoles,
                income: r._sum.rewards.toNumber(),
            })),
        }
    }

    async getStatisticsIncomes(query: StatisticsQueryDto): Promise<StatisticsIncomesDto[]> {
        const pool = await this.prisma.reward_pools.findUniqueOrThrow({
            where: { token: query.token },
        })

        const oneMonthIncomes = await this.prisma.$queryRaw<
            {
                date: Date
                order_amount: Decimal
                orders: number
            }[]
        >`
WITH RECURSIVE date_range AS (
  SELECT DATE(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) AS date
  UNION ALL
  SELECT DATE_ADD(date, INTERVAL 1 DAY)
  FROM date_range
  WHERE date < CURRENT_DATE()
)
SELECT
  d.date,
  IFNULL(COUNT(DISTINCT ur.order_id), 0) AS orders,
  IFNULL(SUM(ur.rewards), 0) AS order_amount
FROM date_range d
LEFT JOIN orders o ON DATE(o.paid_time) = d.date and o.related_reward_id=${pool.id}
LEFT JOIN user_rewards ur ON o.order_id = ur.order_id
  AND ur.ticker = 'usdc'
  AND ur.role NOT IN ('platform', 'order_creator')
GROUP BY d.date
ORDER BY d.date;
`

        const oneMonthRolesIncomes = await this.prisma.$queryRaw<
            {
                date: Date
                role: string
                income: Decimal
            }[]
        >`WITH RECURSIVE date_range AS (
  SELECT DATE(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)) AS date
  UNION ALL
  SELECT DATE_ADD(date, INTERVAL 1 DAY)
  FROM date_range
  WHERE date < CURRENT_DATE()
),
roles AS (
  SELECT 'buyback' AS role UNION ALL
  SELECT 'developer' UNION ALL
  SELECT 'inviter' UNION ALL
  SELECT 'ip-holder' UNION ALL
  SELECT 'customized'
)
SELECT
  d.date,
  r.role,
  IFNULL(SUM(ur.rewards), 0) AS income
FROM date_range d
CROSS JOIN roles r
LEFT JOIN orders o ON DATE(o.paid_time) = d.date and o.related_reward_id=${pool.id}
LEFT JOIN user_rewards ur ON o.order_id = ur.order_id
  AND ur.role = r.role
  AND ur.ticker = 'usdc'
GROUP BY d.date, r.role
ORDER BY d.date;`
        return oneMonthIncomes.map((r) => ({
            date: r.date,
            orders: Number(r.orders),
            order_amount: Number(r.order_amount),
            role_detail: oneMonthRolesIncomes
                .filter((x) => {
                    return r.date.toISOString() == x.date.toISOString()
                })
                .map((x) => ({
                    role: x.role as RewardAllocateRoles,
                    income: Number(x.income),
                })),
        }))
    }

    async getStatement(query: StatementQueryDto): Promise<StatementResponseListDto> {
        if (!query.token) {
            throw new BadRequestException("Token is required")
        }
        const pool = await this.prisma.reward_pools.findUniqueOrThrow({
            where: { token: query.token },
        })
        const statement = await this.prisma.reward_pool_statement.findMany({
            where: { token: query.token },
            include: {
                order_info: true,
            },
            orderBy: {
                id: "desc",
            },
            skip: Math.max(parseInt(query.page) - 1, 0) * parseInt(query.page_size),
            take: parseInt(query.page_size),
        })

        const count = await this.prisma.reward_pool_statement.count({
            where: {
                token: query.token,
            },
        })

        return {
            statements: statement.map((s) => this.mapStatementDetail(s)),
            total: count,
        }
    }

    async airdrop(body: RequestAirdropDto, user: UserJwtExtractDto): Promise<AirdropResponseDto> {
        if (body.usd_amount == 0 && body.token_amount == 0) {
            throw new BadRequestException(
                "The amount of airdrop must be greater than 0 or token_amount must be greater than 0",
            )
        }

        if (body.usd_amount > 0 && body.token_amount > 0) {
            throw new BadRequestException("You can only provide usd_amount or token_amount, not both")
        }

        const rewardsPools = await this.prisma.reward_pools.findFirst({
            where: {
                token: body.token,
            },
        })
        if (!rewardsPools) {
            throw new BadRequestException("Pool does not exist")
        }

        //user exists
        const userExists = await this.prisma.users.findFirst({
            where: {
                email: body.email,
            },
        })
        if (!userExists) {
            throw new BadRequestException("User does not exist")
        }

        //if user subscribed this widget
        const widget = await this.prisma.user_subscribed_widgets.findFirst({
            where: {
                widget_tag: user.developer_info.tag,
                user: rewardsPools.owner,
            },
        })

        if (!widget) {
            throw new BadRequestException("Rewards pool is not subscribed to this widget")
        }

        let amount = new Decimal(0)
        if (body.usd_amount > 0) {
            const tokenInfo = await this.giggleService.getIpTokenList({
                mint: body.token,
                page: "1",
                page_size: "1",
                site: "3body",
            })
            if (!tokenInfo || !tokenInfo.data || !tokenInfo.data.length) {
                throw new BadRequestException("Token not found")
            }

            const unitPrice = tokenInfo.data?.[0]?.price
            if (!unitPrice) {
                throw new BadRequestException("Token price not found")
            }

            amount = new Decimal(body.usd_amount).div(unitPrice)
        } else {
            if (body.token_amount < 1) {
                throw new BadRequestException("The minimum amount of airdrop is 1")
            }
            amount = new Decimal(body.token_amount)
        }

        if (rewardsPools.current_balance.lt(amount)) {
            this.logger.error(
                `Insufficient balance for airdrop: ${body.token}, expected: ${amount}, current: ${rewardsPools.current_balance}, request widget: ${user.developer_info.tag}`,
            )
            throw new BadRequestException("Insufficient balance")
        }

        const newBalance = rewardsPools.current_balance.minus(amount)
        const releasePerDay = amount.div(180)
        const currentDate = new Date(Date.now())
        const releaseEndTime = new Date(currentDate.getTime() + 180 * 24 * 60 * 60 * 1000) //180 days

        const { statement, userRewards } = await this.prisma.$transaction(async (tx) => {
            await tx.reward_pools.update({
                where: { token: body.token },
                data: { current_balance: newBalance },
            })
            const statement = await tx.reward_pool_statement.create({
                data: {
                    token: body.token,
                    amount: amount.mul(-1),
                    type: "airdrop",
                    widget_tag: user.developer_info.tag,
                    airdrop_type: body.type,
                    current_balance: newBalance,
                },
                include: {
                    order_info: true,
                },
            })

            const userRewards = await tx.user_rewards.create({
                data: {
                    statement_id: statement.id,
                    rewards_type: "airdrop",
                    user: userExists.username_in_be,
                    rewards: amount,
                    token: body.token,
                    ticker: rewardsPools.ticker,
                    released_per_day: releasePerDay,
                    start_allocate: currentDate,
                    end_allocate: releaseEndTime,
                    released_rewards: 0,
                    locked_rewards: amount,
                    withdraw_rewards: 0,
                },
                include: {
                    user_info: true,
                },
            })
            return { statement, userRewards }
        })

        return {
            ...this.mapStatementDetail(statement),
            rewards_detail: this.orderService.mapRewardsDetail([userRewards])[0],
        }
    }

    async getAirdrops(query: AirdropQueryDto): Promise<AirdropResponseListDto> {
        const where: Prisma.reward_pool_statementWhereInput = {
            type: "airdrop",
        }
        if (query.token) {
            where.token = query.token
        }
        if (query.email) {
            const user = await this.prisma.users.findFirst({
                where: {
                    email: query.email,
                    is_blocked: false,
                },
            })
            if (!user) {
                return {
                    airdrops: [],
                    total: 0,
                }
            }
            where.user_rewards = {
                some: {
                    user: user.username_in_be,
                },
            }
        }

        if (query.type) {
            where.airdrop_type = query.type
        }

        const airdrops = await this.prisma.reward_pool_statement.findMany({
            where: where,
            include: {
                user_rewards: {
                    include: {
                        user_info: true,
                    },
                },
                order_info: true,
            },
            orderBy: {
                created_at: "desc",
            },
            skip: Math.max(parseInt(query.page) - 1, 0) * parseInt(query.page_size),
            take: parseInt(query.page_size),
        })

        return {
            airdrops: airdrops.map((r) => ({
                ...this.mapStatementDetail(r),
                rewards_detail: this.orderService.mapRewardsDetail(r.user_rewards)?.[0],
            })),
            total: airdrops.length,
        }
    }

    mapStatementDetail(statement: reward_pool_statement & { order_info: orders }): StatementResponseDto {
        const tx = statement?.chain_transaction as unknown as TransactionDto
        const chainTxLink =
            tx?.signature && process.env.SOLANA_EXPLORER && process.env.SOLANA_CLUSTER
                ? process.env.SOLANA_EXPLORER + "/tx/" + tx.signature + "?cluster=" + process.env.SOLANA_CLUSTER
                : null
        return {
            id: statement.id,
            date: statement.created_at,
            order_id: statement.related_order_id,
            widget_tag: statement.widget_tag || statement.order_info?.widget_tag,
            usd_revenue: statement.usd_revenue,
            rewarded_amount: statement.amount,
            balance: statement.current_balance,
            type: statement.type as StatementType,
            airdrop_type: statement.airdrop_type as AirdropType,
            status: tx ? StatementStatus.SETTLED : StatementStatus.CREATED,
            chain_tx_link: chainTxLink,
        }
    }

    mapRewardsRatioToPercentage(ratio: RewardAllocateRatio[]): any[] {
        return [
            ...ratio,
            {
                address: "",
                ratio: this.PLATFORM_REVENUE_RATIO,
                role: "platform",
                allocate_type: "usdc",
            },
        ]
    }

    async mapToPoolData(data: Pool & { reward_pool_limit_offer: reward_pool_limit_offer[] }): Promise<PoolResponseDto> {
        return {
            id: data.id,
            token: data.token,
            ticker: data.ticker,
            owner: data.owner,
            address: data.address,
            buyback_address: data.buyback_address,
            unit_price: data.unit_price.toString(),
            revenue_ratio: data.revenue_ratio.filter((r: RewardAllocateRatio) => r.role !== "platform"),
            injected_amount: data.injected_amount.toString(),
            rewarded_amount: data.rewarded_amount.toString(),
            current_balance: data.current_balance.toString(),
            created_at: data.created_at,
            updated_at: data.updated_at,
            limit_offers: data.reward_pool_limit_offer.map((r) => ({
                external_ratio: r.external_ratio,
                start_date: r.start_date,
                end_date: r.end_date,
            })),
            owed_amount: await this.getOwedAmount(data),
        }
    }

    //get owed amount of the pool
    async getOwedAmount(pool: Pool): Promise<number> {
        const userWallet = await this.prisma.reward_pool_statement.aggregate({
            where: { token: pool.token, type: "injected", chain_transaction: { equals: Prisma.AnyNull } },
            _sum: {
                amount: true,
            },
        })
        return userWallet._sum.amount?.toNumber() || 0
    }

    /*
    //create pool
    //@Cron(CronExpression.EVERY_10_MINUTES)
    //despeciated
    async createPools() {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        const ips = await this.prisma.ip_library.findMany({
            where: {
                token_mint: {
                    not: null,
                },
            },
        })
        for (const ip of ips) {
            await this.createRewardsPool(ip.id)
        }
    }
    */

    //create rewards pool if not exists
    async createRewardsPool(ip_id: number, user_wallet: string, email: string, subscriber?: any): Promise<void> {
        if (subscriber) {
            subscriber.next({
                event: "ip.create_rewards_pool",
                data: {
                    message: "Creating rewards pool",
                },
            })
        }
        const ip = await this.prisma.ip_library.findUnique({
            where: {
                token_info: {
                    not: null,
                },
                id: ip_id,
            },
        })
        if (!ip) return
        const ratioDefault = [
            { role: "buyback", ratio: 50, address: "", allocate_type: "usdc" },
            { role: "ip-holder", ratio: 40, address: "", allocate_type: "usdc" },
            { role: "platform", ratio: 10, address: "", allocate_type: "usdc" },
        ]
        const tokenInfo = ip.token_info as any as CreateIpTokenGiggleResponseDto
        if (!tokenInfo?.mint) return
        const pool = await this.prisma.reward_pools.findUnique({
            where: {
                token: tokenInfo.mint,
            },
        })
        if (pool) {
            return
        }
        await this.prisma.reward_pools.create({
            data: {
                token: tokenInfo.mint,
                owner: ip.owner,
                ticker: ip.ticker,
                unit_price: (ip.current_token_info as any)?.price || (ip.token_info as any)?.price,
                revenue_ratio: ratioDefault,
                rewarded_amount: 0,
                injected_amount: 0,
                current_balance: 0,
                on_chain_status: reward_pool_on_chain_status.ready,
            },
        })

        if (subscriber) {
            subscriber.next({
                event: "ip.create_rewards_pool_on_chain",
                data: {
                    message: "Creating rewards pool on chain",
                },
            })
        }

        //this should compelete automatically, no need this
        //await this.rewardPoolOnChainService.create({
        //    token_mint: tokenInfo.mint,
        //    user_wallet: user_wallet,
        //    email: email,
        //})
    }
}
