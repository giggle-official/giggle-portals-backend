import { BadRequestException, Injectable } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { ListParams, ListResDto } from "../request.dto"
import { Prisma } from "@prisma/client"
import { CreditService } from "src/credit/credit.service"
import { IssueCreditDto } from "src/credit/credit.dto"

@Injectable()
export class CreditsService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly creditService: CreditService,
    ) {}

    async list(query: ListParams): Promise<ListResDto<any[]>> {
        const orderBy: Prisma.user_credit_issuesOrderByWithRelationInput = {
            [query.sort.field]: query.sort.order.toLowerCase() as "asc" | "desc",
        }

        const where: Prisma.user_credit_issuesWhereInput = {}

        if (query?.target && query?.id) {
            where.user = query.id
        }
        const [list, count] = await this.prismaService.$transaction([
            this.prismaService.user_credit_issues.findMany({
                skip: (parseInt(query.pagination.page) - 1) * parseInt(query.pagination.perPage),
                take: parseInt(query.pagination.perPage),
                include: {
                    user_credit_consume: true,
                },
                orderBy: orderBy,
                where: where,
            }),
            this.prismaService.user_credit_issues.count({
                where: where,
            }),
        ])
        return {
            list: list,
            count: count,
        }
    }

    async issueCredit(body: IssueCreditDto) {
        if (!body.credit) {
            throw new BadRequestException("Credit is required")
        }

        const credit = parseInt(body.credit.toString())
        if (credit <= 0) {
            throw new BadRequestException("Credit must be greater than 0")
        }

        if (!body.user) {
            throw new BadRequestException("User is required")
        }

        const user = await this.prismaService.users.findUnique({
            where: {
                username_in_be: body.user,
            },
        })

        if (!user) {
            throw new BadRequestException("User not found")
        }

        if (!body.effective_date) {
            throw new BadRequestException("Effective date is required")
        }

        if (body.never_expire) {
            body.expire_date = new Date("9999-12-31")
        }

        if (!body.expire_date && !body.never_expire) {
            throw new BadRequestException("Expire date is required while never_expire is not set")
        }

        const issueParams: IssueCreditDto = {
            user: user.username_in_be,
            credit: credit,
            type: "free",
            effective_date: new Date(body.effective_date),
            expire_date: new Date(body.expire_date),
            subscription_id: "",
            invoice_id: "",
        }
        return await this.prismaService.$transaction(async (xPrisma) => {
            const result = await this.creditService.issueCredits(issueParams)
            await xPrisma.admin_logs.create({
                data: {
                    user: body.user,
                    action: "issue_credit",
                    data: JSON.stringify({ issue_params: issueParams, result: result }),
                },
            })
            return result
        })
    }
}
