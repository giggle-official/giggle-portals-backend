import { Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { SalesAgentIncomeQueryDto } from "./sales-agent.dto"
import { UserJwtExtractDto } from "src/user/user.controller"
import { RewardAllocateRoles } from "../rewards-pool/rewards-pool.dto"
import { Prisma } from "@prisma/client"
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
