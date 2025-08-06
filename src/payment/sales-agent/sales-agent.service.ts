import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { AgentQueryDto, CreateSalesAgentDto, SalesAgentDetailDto, SalesAgentIncomeQueryDto } from "./sales-agent.dto"
import { UserJwtExtractDto } from "src/user/user.controller"
import { RewardAllocateRoles } from "../rewards-pool/rewards-pool.dto"
import { Prisma, sales_agent, users } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import { Cron, CronExpression } from "@nestjs/schedule"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { TASK_IDS, UtilitiesService } from "src/common/utilities.service"

@Injectable()
export class SalesAgentService {
    private readonly logger = new Logger(SalesAgentService.name)

    protected readonly ORDER_RATIO_LEVEL_1 = { LEVEL_1: new Decimal(0.4), LEVEL_2: new Decimal(0.0) }
    protected readonly ORDER_RATIO_LEVEL_2 = { LEVEL_1: new Decimal(0.1), LEVEL_2: new Decimal(0.3) }

    constructor(
        private readonly prisma: PrismaService,
        private readonly giggleService: GiggleService,
    ) {}

    async getSalesAgentIncomes(user: UserJwtExtractDto, query: SalesAgentIncomeQueryDto) {
        const salesAgentIncomes = await this.prisma.sales_agent_revenue.findMany({
            skip: Math.max(0, parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
        })
        return {}
    }

    async addSalesAgent(body: CreateSalesAgentDto) {
        const userExists = await this.prisma.users.findUnique({
            where: {
                email: body.email,
            },
        })
        if (!userExists) {
            throw new BadRequestException(`User ${body.email} not found`)
        }

        const agentExists = await this.prisma.sales_agent.findUnique({
            where: {
                user: userExists.username_in_be,
            },
        })
        if (agentExists) {
            throw new BadRequestException(`User ${body.email} already has a sales agent`)
        }

        let sales_level: number = 1
        let parent_sale: string | null = null

        //check if parent agent exists
        if (body.parent_agent) {
            const parentAgentUserExists = await this.prisma.users.findUnique({
                where: {
                    email: body.parent_agent,
                },
            })
            if (!parentAgentUserExists) {
                throw new BadRequestException(`Parent agent ${body.parent_agent} not found`)
            }
            const parentAgent = await this.prisma.sales_agent.findUnique({
                where: {
                    user: parentAgentUserExists.username_in_be,
                },
            })
            if (!parentAgent) {
                throw new BadRequestException(
                    `Parent agent ${body.parent_agent} not found, please add parent agent first`,
                )
            }
            sales_level = 2
            parent_sale = parentAgentUserExists.username_in_be
        }

        const salesAgent = await this.prisma.sales_agent.create({
            data: {
                user: userExists.username_in_be,
                sales_level: sales_level,
                parent_sale: parent_sale,
            },
        })
        return await this.mapSalesAgentDetail({
            ...salesAgent,
            user_info: userExists,
        })
    }

    async getSalesAgentDetail(query: AgentQueryDto) {
        const where: Prisma.sales_agentWhereInput = {
            user: { not: null },
        }
        if (query.user) {
            where.user = query.user
        }

        const total = await this.prisma.sales_agent.count({
            where: where,
        })

        const salesAgent = await this.prisma.sales_agent.findMany({
            where: where,
            include: {
                user_info: true,
            },
            take: parseInt(query.page_size),
            skip: Math.max(0, parseInt(query.page) - 1) * parseInt(query.page_size),
        })

        return {
            total: total,
            agents: await Promise.all(salesAgent.map((agent) => this.mapSalesAgentDetail(agent))),
        }
    }

    async mapSalesAgentDetail(salesAgent: sales_agent & { user_info: users }): Promise<SalesAgentDetailDto> {
        // Level 1: has children, no parent
        if (salesAgent.sales_level === 1) {
            const childSalesAgents = await this.prisma.sales_agent.findMany({
                where: {
                    parent_sale: salesAgent.user,
                },
                include: {
                    user_info: true,
                },
            })

            const children_agents = childSalesAgents.map((child) => ({
                id: child.id,
                user: child.user,
                email: child.user_info.email,
                sales_level: child.sales_level,
                parent_agent: null, // Don't include parent to avoid circular reference
                children_agents: [], // Level 2 has no children
                created_at: child.created_at,
                updated_at: child.updated_at,
            }))

            return {
                id: salesAgent.id,
                user: salesAgent.user,
                email: salesAgent.user_info.email,
                sales_level: salesAgent.sales_level,
                parent_agent: null,
                children_agents,
                created_at: salesAgent.created_at,
                updated_at: salesAgent.updated_at,
            }
        }

        // Level 2: has parent, no children
        let parent_agent = null
        if (salesAgent.parent_sale) {
            const parentSalesAgent = await this.prisma.sales_agent.findUnique({
                where: {
                    user: salesAgent.parent_sale,
                },
                include: {
                    user_info: true,
                },
            })

            if (parentSalesAgent) {
                parent_agent = {
                    id: parentSalesAgent.id,
                    user: parentSalesAgent.user,
                    email: parentSalesAgent.user_info.email,
                    sales_level: parentSalesAgent.sales_level,
                    parent_agent: null, // Don't go further up
                    children_agents: [], // Don't include children to avoid circular reference
                    created_at: parentSalesAgent.created_at,
                    updated_at: parentSalesAgent.updated_at,
                }
            }
        }

        return {
            id: salesAgent.id,
            user: salesAgent.user,
            email: salesAgent.user_info.email,
            sales_level: salesAgent.sales_level,
            parent_agent,
            children_agents: [],
            created_at: salesAgent.created_at,
            updated_at: salesAgent.updated_at,
        }
    }

    async settleStatement(statementId: number) {
        const statement = await this.prisma.reward_pool_statement.findUnique({
            where: {
                id: statementId,
                chain_transaction: { not: null },
            },
        })
        if (!statement || !statement.related_order_id) {
            this.logger.warn(`Statement ${statementId} not found or not settled`)
            return
        }

        const order = await this.prisma.orders.findUnique({
            where: {
                order_id: statement.related_order_id,
            },
        })

        if (!order || !order.sales_agent) {
            this.logger.warn(
                `Order ${statement.related_order_id} not found or no sales agent for statement ${statementId}`,
            )
            return
        }
        //check if order alreay settled
        const isSettled = await this.prisma.sales_agent_revenue.findFirst({
            where: {
                order_id: order.order_id,
            },
        })
        if (isSettled) {
            this.logger.warn(`Order ${statement.related_order_id} already settled`)
            return
        }

        const agent = await this.prisma.sales_agent.findFirst({
            where: {
                user: order.sales_agent,
            },
        })
        if (!agent) {
            this.logger.warn(`Sales agent ${order.sales_agent} for order ${statement.related_order_id} not found`)
            return
        }

        //find platform incomes
        const rewards = await this.prisma.user_rewards.aggregate({
            where: {
                statement_id: statementId,
                role: RewardAllocateRoles.PLATFORM,
                token: process.env.GIGGLE_LEGAL_USDC,
            },
            _sum: {
                rewards: true,
            },
        })

        if (!rewards._sum.rewards) {
            this.logger.warn(`No platform incomes found for order ${statement.related_order_id}`)
            return
        }
        const incomes = rewards._sum.rewards
        let salesRevenue: Prisma.sales_agent_revenueCreateManyInput[] = []

        if (!agent.parent_sale) {
            salesRevenue.push({
                user: agent.user,
                order_id: statement.related_order_id,
                revenue: incomes.mul(this.ORDER_RATIO_LEVEL_1.LEVEL_1),
            })
        } else {
            salesRevenue.push({
                user: agent.parent_sale,
                order_id: statement.related_order_id,
                revenue: incomes.mul(this.ORDER_RATIO_LEVEL_2.LEVEL_1),
            })
            salesRevenue.push({
                user: agent.user,
                order_id: statement.related_order_id,
                revenue: incomes.mul(this.ORDER_RATIO_LEVEL_2.LEVEL_2),
            })
        }

        await this.prisma.sales_agent_revenue.createMany({
            data: salesRevenue,
        })
    }

    //withdraw sales agent revenue
    @Cron(CronExpression.EVERY_HOUR)
    async withdrawSalesAgentRevenue() {
        if (process.env.TASK_SLOT != "1") return
        if (!process.env.PLATFORM_WALLET) {
            this.logger.error("PLATFORM_WALLET is not set")
            return
        }

        const isRunning = await UtilitiesService.checkTaskRunning(TASK_IDS.WITHDRAW_SALES_AGENT_REVENUE)
        if (isRunning) {
            this.logger.warn("Withdraw sales agent revenue is already running, skip")
            return
        }

        const salesAgentRevenue = await this.prisma.sales_agent_revenue.findMany({
            where: {
                revenue: {
                    gt: new Decimal(0),
                },
                transaction: {
                    equals: Prisma.AnyNull,
                },
            },
        })
        await UtilitiesService.startTask(TASK_IDS.WITHDRAW_SALES_AGENT_REVENUE)
        for (const revenue of salesAgentRevenue) {
            try {
                const user = await this.prisma.users.findUnique({
                    where: {
                        username_in_be: revenue.user,
                    },
                })
                if (!user) {
                    this.logger.warn(`User ${revenue.user} not found`)
                    continue
                }
                const wallet = user.wallet_address
                if (!wallet) {
                    this.logger.warn(`User ${revenue.user} has no wallet address`)
                    continue
                }

                const res = await this.giggleService.sendToken(
                    { usernameShorted: user.username_in_be, user_id: user.username_in_be },
                    {
                        mint: process.env.GIGGLE_LEGAL_USDC,
                        amount: revenue.revenue.toNumber(),
                        receipt: wallet,
                    },
                    process.env.PLATFORM_WALLET,
                )
                if (res.sig) {
                    await this.prisma.sales_agent_revenue.update({
                        where: { id: revenue.id },
                        data: { transaction: res as any },
                    })
                } else {
                    this.logger.error(
                        `Failed to withdraw sales agent revenue for user ${revenue.user}, sig: ${res.sig}`,
                    )
                    continue
                }
                await new Promise((resolve) => setTimeout(resolve, 2000))
            } catch (error) {
                this.logger.error(`Error withdrawing sales agent revenue for user ${revenue.user}`, error)
                continue
            }
        }

        await UtilitiesService.stopTask(TASK_IDS.WITHDRAW_SALES_AGENT_REVENUE)
    }
}
