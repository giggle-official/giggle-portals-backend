import { BadRequestException, forwardRef, Inject, Injectable } from "@nestjs/common"
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
    StatisticsRolesDto,
    StatisticsIncomesDto,
    StatementQueryDto,
    StatementResponseListDto,
    StatementType,
    RewardAllocateType,
} from "./rewards-pool.dto"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Prisma } from "@prisma/client"
import { OpenAppService } from "src/open-app/open-app.service"
import { Decimal } from "@prisma/client/runtime/library"

@Injectable()
export class RewardsPoolService {
    public readonly PLATFORM_REVENUE_RATIO = 10
    constructor(
        private readonly prisma: PrismaService,

        @Inject(forwardRef(() => OpenAppService))
        private readonly openAppService: OpenAppService,
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
        //create pool
        return await this.prisma.$transaction(async (tx) => {
            const poolCreated = await tx.reward_pools.create({
                data: {
                    token: body.token,
                    owner: user.usernameShorted,
                    unit_price: body.unit_price,
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
                    unit_price: body.unit_price,
                    type: "injected",
                    current_balance: body.amount,
                },
            })
            return this.mapToPoolData(poolCreated)
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
                    unit_price: body.unit_price,
                    revenue_ratio: this.mapRewardsRatioToPercentage(body.revenue_ratio),
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

        const newBalance = poolExists.current_balance.plus(body.append_amount)
        const newInjectedAmount = poolExists.injected_amount.plus(body.append_amount)
        return await this.prisma.$transaction(async (tx) => {
            const poolUpdated = await tx.reward_pools.update({
                where: { token: body.token },
                data: {
                    injected_amount: newInjectedAmount,
                    current_balance: newBalance,
                },
            })
            await tx.reward_pool_statement.create({
                data: {
                    token: body.token,
                    amount: body.append_amount,
                    unit_price: poolExists.unit_price,
                    type: "injected",
                    current_balance: newBalance,
                },
            })
            return this.mapToPoolData(poolUpdated)
        })
    }

    async getPools(query: PoolsQueryDto): Promise<PoolsResponseListDto> {
        const where: Prisma.reward_poolsWhereInput = {}
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
            orderBy: {
                created_at: "desc",
            },
            skip: Math.max(parseInt(query.page) - 1, 0) * parseInt(query.page_size),
            take: parseInt(query.page_size),
        })
        return {
            pools: pools.map((pool) => this.mapToPoolData(pool)),
            total: pools.length,
        }
    }

    async getRewardSnapshot(token: string): Promise<RewardSnapshotDto> {
        const pool = await this.prisma.reward_pools.findFirst({
            where: { token },
        })
        if (!pool) {
            throw new BadRequestException("Pool does not exist")
        }
        return {
            token: pool.token,
            ticker: pool.ticker,
            unit_price: pool.unit_price.toString(),
            revenue_ratio: pool.revenue_ratio as unknown as RewardAllocateRatio[],
            updated_at: pool.updated_at,
            created_at: pool.created_at,
            snapshot_date: new Date(),
        }
    }

    checkRewardsRatio(ratio: RewardAllocateRatio[]): void {
        //user can only use customized, buyback, developer, inviter role
        ratio.map((r) => {
            if (
                ![
                    RewardAllocateRoles.CUSTOMIZED,
                    RewardAllocateRoles.BUYBACK,
                    RewardAllocateRoles.DEVELOPER,
                    RewardAllocateRoles.INVITER,
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
            switch (r.role) {
                case RewardAllocateRoles.BUYBACK:
                    if (allocateType !== RewardAllocateType.USDC) {
                        throw new BadRequestException("The allocate type of buyback must be usdc")
                    }
                    break
                case RewardAllocateRoles.DEVELOPER:
                    if (allocateType !== RewardAllocateType.USDC) {
                        throw new BadRequestException("The allocate type of developer must be usdc")
                    }
                    break
                default:
                    break
            }
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

        return {
            incomes: totalIncomeWithoutPlatform._sum.rewards?.toNumber() || 0,
            incomes_total: pool.statement.reduce((acc, curr) => acc.plus(curr.usd_revenue), new Decimal(0)).toNumber(),
            orders: pool.statement.length,
            unit_price: pool.unit_price.toNumber(),
            current_balance: pool.current_balance.toNumber(),
            injected_amount: pool.injected_amount.toNumber(),
            rewarded_amount: pool.rewarded_amount.toNumber(),
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
            statements: statement.map((s) => ({
                date: s.created_at,
                order_id: s.related_order_id,
                widget_tag: s.order_info?.widget_tag,
                usd_revenue: s.usd_revenue,
                rewarded_amount: s.amount,
                balance: s.current_balance,
                type: s.type as StatementType,
            })),
            total: count,
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

    mapToPoolData(data: Pool): PoolResponseDto {
        return {
            id: data.id,
            token: data.token,
            ticker: data.ticker,
            owner: data.owner,
            address: data.address,
            unit_price: data.unit_price.toString(),
            revenue_ratio: data.revenue_ratio.filter((r: RewardAllocateRatio) => r.role !== "platform"),
            injected_amount: data.injected_amount.toString(),
            rewarded_amount: data.rewarded_amount.toString(),
            current_balance: data.current_balance.toString(),
            created_at: data.created_at,
            updated_at: data.updated_at,
        }
    }
}
