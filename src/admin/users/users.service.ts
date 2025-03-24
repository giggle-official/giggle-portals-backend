import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { ListParams, ListResDto } from "../request.dto"
import { Prisma } from "@prisma/client"
import { PaymentService } from "src/payment/payment.service"
import { UserPlanSettingsDto } from "src/user/user.dto"
import { freePlan, SubscriptionPlanName, SubscriptionPlanPeriod } from "src/payment/plans.config"

@Injectable()
export class UsersService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly paymentService: PaymentService,
    ) {}

    private readonly logger = new Logger("UsersService-Admin")

    async list(query: ListParams): Promise<ListResDto<any[]>> {
        const where: Prisma.usersWhereInput = {
            ...query.filter,
        }
        const orderBy: Prisma.user_credit_issuesOrderByWithRelationInput = {
            [query.sort.field]: query.sort.order.toLowerCase() as "asc" | "desc",
        }
        const [list, count] = await this.prismaService.$transaction([
            this.prismaService.users.findMany({
                skip: (parseInt(query.pagination.page) - 1) * parseInt(query.pagination.perPage),
                take: parseInt(query.pagination.perPage),
                where: where,
                orderBy: orderBy,
            }),
            this.prismaService.users.count({
                where: where,
            }),
        ])
        return {
            list: list,
            count: count,
        }
    }

    async detail(id: number) {
        const userDetail = await this.prismaService.users.findUnique({
            where: { id },
        })

        if (["none", "Free"].includes(userDetail.current_plan)) {
            userDetail.plan_settings = {
                video_convert_max_seconds: freePlan.video_convert_max_seconds,
                credit_consume_every_second: freePlan.credit_consume_every_second,
            }
        } else if (userDetail.current_plan !== "Custom") {
            const p = await this.paymentService.getPlan({
                name: userDetail.current_plan as SubscriptionPlanName,
                period: userDetail.current_pay_period as SubscriptionPlanPeriod,
            })
            userDetail.plan_settings = {
                video_convert_max_seconds: p.video_convert_max_seconds,
                credit_consume_every_second: p.credit_consume_every_second,
            }
        }

        return userDetail
    }

    async getPlan(id: number) {
        return await this.detail(id)
    }

    async updatePlan(body: UserPlanSettingsDto) {
        if (
            body.current_plan === "Custom" &&
            !(body.plan_settings.video_convert_max_seconds > 0 || body.plan_settings.credit_consume_every_second > 0)
        ) {
            throw new BadRequestException(
                "current_plan must be Custom and plan_settings must be empty when current_plan is Custom",
            )
        }

        if (body.current_plan !== "Custom") {
            body.plan_settings = null
        }

        const id = parseInt(body.id.toString())

        const user = await this.prismaService.users.findUnique({
            where: { id },
        })

        if (!user) {
            throw new BadRequestException("user not found")
        }

        return await this.prismaService.users.update({
            where: { id },
            data: {
                current_plan: body.current_plan,
                plan_settings: body.plan_settings,
            },
        })
    }
}
