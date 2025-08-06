import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { AgentQueryDto, CreateSalesAgentDto, SalesAgentDetailDto, SalesAgentIncomeQueryDto } from "./sales-agent.dto"
import { UserJwtExtractDto } from "src/user/user.controller"
import { RewardAllocateRoles } from "../rewards-pool/rewards-pool.dto"
import { Prisma, sales_agent } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"

@Injectable()
export class SalesAgentService {
    private readonly logger = new Logger(SalesAgentService.name)

    protected readonly ORDER_RATIO_LEVEL_1 = { LEVEL_1: new Decimal(0.4), LEVEL_2: new Decimal(0.0) }
    protected readonly ORDER_RATIO_LEVEL_2 = { LEVEL_1: new Decimal(0.1), LEVEL_2: new Decimal(0.3) }

    constructor(private readonly prisma: PrismaService) {}

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
        return this.mapSalesAgentDetail(salesAgent)
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
            take: parseInt(query.page_size),
            skip: Math.max(0, parseInt(query.page) - 1) * parseInt(query.page_size),
        })

        return {
            total: total,
            agents: salesAgent.map((agent) => this.mapSalesAgentDetail(agent)),
        }
    }

    async mapSalesAgentDetail(salesAgent: sales_agent): Promise<SalesAgentDetailDto> {
        return {
            id: salesAgent.id,
            user: salesAgent.user,
            sales_level: salesAgent.sales_level,
            parent_agent:
                salesAgent.sales_level === 1
                    ? null
                    : await this.mapSalesAgentDetail(
                          await this.prisma.sales_agent.findUnique({
                              where: {
                                  user: salesAgent.parent_sale,
                              },
                          }),
                      ),
            children_agents:
                salesAgent.sales_level === 1
                    ? []
                    : await Promise.all(
                          (
                              await this.prisma.sales_agent.findMany({
                                  where: {
                                      parent_sale: salesAgent.user,
                                  },
                              })
                          ).map((child) => this.mapSalesAgentDetail(child)),
                      ),
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
}
