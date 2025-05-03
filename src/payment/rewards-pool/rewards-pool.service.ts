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
} from "./rewards-pool.dto"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Prisma } from "@prisma/client"
import { OpenAppService } from "src/open-app/open-app.service"

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
        if (!this.checkRewardsRatio(body.revenue_ratio)) {
            throw new BadRequestException("The sum of the ratio must be 90")
        }
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

    checkRewardsRatio(ratio: RewardAllocateRatio[]): boolean {
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
        return totalRatio === 90
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
            unit_price: data.unit_price.toString(),
            revenue_ratio: data.revenue_ratio,
            address: data.address,
            injected_amount: data.injected_amount.toString(),
            rewarded_amount: data.rewarded_amount.toString(),
            current_balance: data.current_balance.toString(),
            created_at: data.created_at,
            updated_at: data.updated_at,
        }
    }
}
