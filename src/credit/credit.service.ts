import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common"
import dayjs from "dayjs"
import { PrismaService } from "src/common/prisma.service"
import { IssueCreditDto, ProductType } from "./credit.dto"
import { PaymentService } from "src/payment/payment.service"
import { user_credit_consume, user_credit_issues } from "@prisma/client"
import { UserInfoDTO } from "src/user/user.controller"
import { SubscriptionPlanDto } from "src/payment/plans.config"

@Injectable()
export class CreditService {
    private readonly logger = new Logger(CreditService.name)

    constructor(
        private prisma: PrismaService,
        @Inject(forwardRef(() => PaymentService)) private paymentService: PaymentService,
    ) {}

    async getUserCredits(userId: string): Promise<number> {
        const credit = await this.prisma.user_credit_consume.findFirst({
            where: {
                credit_info: {
                    user: userId,
                },
            },
            orderBy: {
                id: "desc",
            },
        })
        if (credit) {
            return credit.balance_after
        }
        return 0
    }

    async issueFreeCredits(userId: string): Promise<user_credit_issues> {
        const existsCredit = await this.prisma.user_credit_issues.findFirst({
            where: { user: userId, type: "free" },
        })
        if (existsCredit) {
            throw new BadRequestException("User already has free credits")
        }

        const currentTime = new Date()
        const expiredDate = new Date("9999-12-31")

        const balanceBefore = await this.getUserCredits(userId)
        const balanceAfter = balanceBefore + 75
        return await this.prisma.$transaction(async (xPrisma) => {
            const credit = await xPrisma.user_credit_issues.create({
                data: {
                    user: userId,
                    credit: 75,
                    type: "free",
                    current_balance: 75,
                    effective_date: currentTime,
                    expire_date: expiredDate,
                },
            })
            await xPrisma.user_credit_consume.create({
                data: {
                    credit_id: credit.id,
                    amount: 75,
                    consume_type: "free credits",
                    consume_date: new Date(),
                    balance_before: balanceBefore,
                    balance_after: balanceAfter,
                    status: "completed",
                },
            })
            await xPrisma.users.update({
                where: { username_in_be: userId },
                data: {
                    current_credit_balance: balanceAfter,
                },
            })
            return credit
        })
    }

    async issueCredits(issueCredit: IssueCreditDto): Promise<user_credit_issues> {
        const credit = await this.prisma.$transaction(async (xPrisma) => {
            const balanceBefore = await this.getUserCredits(issueCredit.user)
            const balanceAfter = balanceBefore + issueCredit.credit
            const credit = await xPrisma.user_credit_issues.create({
                data: { ...issueCredit, current_balance: issueCredit.credit },
            })
            if (issueCredit.effective_date <= new Date()) {
                await xPrisma.user_credit_consume.create({
                    data: {
                        credit_id: credit.id,
                        amount: issueCredit.credit,
                        consume_type: issueCredit.type,
                        consume_date: new Date(),
                        balance_before: balanceBefore,
                        balance_after: balanceAfter,
                        status: "completed",
                    },
                })
                await xPrisma.users.update({
                    where: { username_in_be: issueCredit.user },
                    data: {
                        current_credit_balance: balanceAfter,
                    },
                })
            }
            return credit
        })
        await this.expireCredits(issueCredit.user)
        return credit
    }

    async expireCredits(userId: string): Promise<void> {
        const credits = await this.prisma.user_credit_issues.findMany({
            where: {
                user: userId,
                expire_date: { lt: new Date() },
                current_balance: { gt: 0 },
            },
        })
        for (const credit of credits) {
            const balanceBefore = await this.getUserCredits(userId)
            const balanceAfter = Math.max(balanceBefore - credit.current_balance, 0)
            await this.prisma.$transaction(async (xPrisma) => {
                await xPrisma.user_credit_consume.create({
                    data: {
                        credit_id: credit.id,
                        amount: -credit.current_balance,
                        consume_type: "expired",
                        consume_date: new Date(),
                        balance_before: balanceBefore,
                        balance_after: balanceAfter,
                        status: "completed",
                    },
                })
                await xPrisma.user_credit_issues.update({
                    where: { id: credit.id },
                    data: { current_balance: 0, expire_date: new Date() },
                })
                await xPrisma.users.update({
                    where: { username_in_be: userId },
                    data: {
                        current_credit_balance: balanceAfter,
                    },
                })
            })
        }
    }

    async removeAllPendingCredit(userId: string): Promise<void> {
        const currentTime = new Date()
        await this.prisma.user_credit_issues.deleteMany({
            where: { user: userId, effective_date: { gt: currentTime } },
        })
    }

    async isFreeCreditIssued(userId: string): Promise<boolean> {
        const freeCredits = await this.prisma.user_credit_issues.findMany({
            where: { user: userId, type: "free" },
        })
        return freeCredits.length > 0
    }

    async pendingCredit(userInfo: UserInfoDTO, amount: number, relatedId: string): Promise<void> {
        if (amount <= 0) {
            return
        }
        let balanceBefore = await this.getUserCredits(userInfo.usernameShorted)
        if (balanceBefore < amount) {
            throw new BadRequestException("Insufficient balance")
        }
        const currentTime = new Date()
        const credits = await this.prisma.user_credit_issues.findMany({
            where: {
                user: userInfo.usernameShorted,
                current_balance: { gt: 0 },
                effective_date: { lte: currentTime },
                expire_date: { gt: currentTime },
            },
            orderBy: { expire_date: "asc" },
        })
        let totalConsumed = 0
        await this.prisma.$transaction(async (xPrisma) => {
            for (const credit of credits) {
                const consumeThisTime = Math.min(amount - totalConsumed, credit.current_balance)
                const balanceAfter = balanceBefore - consumeThisTime
                await xPrisma.user_credit_consume.create({
                    data: {
                        credit_id: credit.id,
                        amount: -consumeThisTime,
                        consume_type: relatedId,
                        consume_date: new Date(),
                        balance_before: balanceBefore,
                        balance_after: balanceAfter,
                        status: "pending",
                        related_id: relatedId,
                    },
                })

                await xPrisma.users.update({
                    where: { username_in_be: userInfo.usernameShorted },
                    data: {
                        current_credit_balance: balanceAfter,
                    },
                })

                await this.prisma.user_credit_issues.update({
                    where: { id: credit.id },
                    data: { current_balance: credit.current_balance - consumeThisTime },
                })
                balanceBefore = balanceAfter
                totalConsumed += consumeThisTime
                if (totalConsumed >= amount) {
                    break
                }
            }
            if (totalConsumed < amount) {
                throw new BadRequestException("Insufficient balance")
            }
        })
    }

    async completeCredit(relatedId: string): Promise<void> {
        await this.prisma.user_credit_consume.updateMany({
            where: { related_id: relatedId, status: "pending" },
            data: { status: "completed" },
        })
    }

    async refundCredit(relatedId: string): Promise<void> {
        const credits = await this.prisma.user_credit_consume.findMany({
            where: { related_id: relatedId, status: "pending" },
            include: { credit_info: true },
        })
        if (credits.length === 0) {
            return
        }
        await this.prisma.$transaction(async (xPrisma) => {
            let balanceBefore = await this.getUserCredits(credits[0].credit_info.user)
            for (const credit of credits) {
                const balanceAfter = balanceBefore + -credit.amount
                await xPrisma.user_credit_consume.update({
                    where: { id: credit.id },
                    data: { status: "refunded" },
                })
                await xPrisma.user_credit_consume.create({
                    data: {
                        credit_id: credit.credit_info.id,
                        status: "completed",
                        amount: -credit.amount,
                        consume_type: `${relatedId} refunded`,
                        consume_date: new Date(),
                        balance_before: balanceBefore,
                        balance_after: balanceAfter,
                        related_id: relatedId,
                    },
                })
                await xPrisma.user_credit_issues.update({
                    where: { id: credit.credit_info.id },
                    data: { current_balance: credit.credit_info.current_balance + -credit.amount },
                })
                await xPrisma.users.update({
                    where: { username_in_be: credit.credit_info.user },
                    data: {
                        current_credit_balance: balanceAfter,
                    },
                })
                balanceBefore = balanceAfter
            }
        })
        await this.expireCredits(credits[0].credit_info.user)
    }

    async getCreditConsumeHistory(
        userInfo: UserInfoDTO,
        take: number = 10,
        skip: number = 0,
        lastDays: number = 30,
    ): Promise<{ data: user_credit_consume[]; total: number }> {
        const data = await this.prisma.user_credit_consume.findMany({
            where: {
                credit_info: { user: userInfo.usernameShorted },
                consume_date: { gte: dayjs().subtract(lastDays, "day").toDate() },
            },
            include: { credit_info: { select: { type: true } } },
            orderBy: { id: "desc" },
            take: take,
            skip: skip,
        })
        const total = await this.prisma.user_credit_consume.count({
            where: { credit_info: { user: userInfo.usernameShorted } },
        })
        return {
            data: data.map((item) => ({
                ...item,
                credit_info: {
                    type: item.consume_type.includes("refunded") ? "Credit Reversal" : item.credit_info.type,
                },
            })),
            total,
        }
    }

    /**
     * this job should be run in taskService to avoid concurrent requests
     */
    async processCredits() {
        this.logger.log("Checking expired credits")
        const currentTime = new Date()
        const expiredCredits = await this.prisma.user_credit_issues.findMany({
            where: { expire_date: { lt: currentTime }, current_balance: { gt: 0 } },
        })
        for (const credit of expiredCredits) {
            this.logger.log(
                `Processing expired credit: ${credit.id} for user: ${credit.user}, credit: ${credit.current_balance}`,
            )
            await this.prisma.$transaction(async (xPrisma) => {
                const balanceBefore = await this.getUserCredits(credit.user)
                const balanceAfter = Math.max(balanceBefore - credit.current_balance, 0)
                await xPrisma.user_credit_consume.create({
                    data: {
                        credit_id: credit.id,
                        amount: -credit.current_balance,
                        consume_type: "expired",
                        consume_date: new Date(),
                        balance_before: balanceBefore,
                        balance_after: balanceAfter,
                        status: "completed",
                    },
                })
                await xPrisma.user_credit_issues.update({
                    where: { id: credit.id },
                    data: { current_balance: 0 },
                })
                await xPrisma.users.update({
                    where: { username_in_be: credit.user },
                    data: {
                        current_credit_balance: balanceAfter,
                    },
                })
            })
        }

        //issue new credits
        this.logger.log("Issuing new credits")
        const newCredits = await this.prisma.user_credit_issues.findMany({
            where: { effective_date: currentTime, current_balance: { gt: 0 } },
        })
        if (newCredits.length === 0) {
            return
        }
        for (const credit of newCredits) {
            this.logger.log(
                `Processing new credit: ${credit.id} for user: ${credit.user}, credit: ${credit.current_balance}`,
            )
            const existsCredit = await this.prisma.user_credit_consume.findFirst({
                where: { credit_id: credit.id },
            })
            if (existsCredit) {
                this.logger.warn(`User ${credit.user} already has credit: ${credit.id} for this period`)
                continue
            }

            await this.prisma.$transaction(async (xPrisma) => {
                const balanceBefore = await this.getUserCredits(credit.user)
                const balanceAfter = balanceBefore + credit.current_balance

                await xPrisma.user_credit_consume.create({
                    data: {
                        credit_id: credit.id,
                        amount: credit.current_balance,
                        consume_type: credit.type,
                        consume_date: new Date(),
                        balance_before: balanceBefore,
                        balance_after: balanceAfter,
                        status: "completed",
                    },
                })
                await xPrisma.users.update({
                    where: { username_in_be: credit.user },
                    data: {
                        current_credit_balance: balanceAfter,
                    },
                })
            })
        }

        /** may be should be use later 
        this.logger.log("Issuing new credits for free users")
        //issue new credits for free users
        const freeUsers = await this.prisma.users.findMany({
            where: { is_blocked: false },
        })
        for (const user of freeUsers) {
            const currentPeriod = await this.getCurrentPeriod(dayjs(user.created_at))

            const record = await this.prisma.user_credit_issues.findFirst({
                where: {
                    user: user.username_in_be,
                    effective_date: currentPeriod.start.toDate(),
                    expire_date: currentPeriod.end.toDate(),
                },
            })
            if (record) {
                this.logger.log(
                    `User ${user.username_in_be} already has credits for this period: ${currentPeriod.start.toDate()} - ${currentPeriod.end.toDate()}`,
                )
                continue
            }

            if (user.stripe_customer_id) {
                const subscriptions = await this.paymentService.getSubscription({
                    usernameShorted: user.username_in_be,
                })
                if (subscriptions.name !== "Free") {
                    continue
                }
            }

            const currentBalance = await this.getUserCredits(user.username_in_be)

            await this.prisma.$transaction(async (xPrisma) => {
                const credit = await xPrisma.user_credit_issues.create({
                    data: {
                        user: user.username_in_be,
                        credit: 75,
                        type: "free",
                        current_balance: 75,
                        effective_date: currentPeriod.start.toDate(),
                        expire_date: currentPeriod.end.toDate(),
                    },
                })
                await xPrisma.user_credit_consume.create({
                    data: {
                        credit_id: credit.id,
                        amount: 75,
                        consume_type: "free credits",
                        consume_date: new Date(),
                        balance_before: currentBalance,
                        balance_after: currentBalance + 75,
                        status: "completed",
                    },
                })
                await xPrisma.users.update({
                    where: { username_in_be: user.username_in_be },
                    data: {
                        current_credit_balance: currentBalance + 75,
                    },
                })
            })
        }
        */

        this.logger.log("Finished processing credits")
    }

    async getCurrentPeriod(registeredDate: dayjs.Dayjs): Promise<{ start: dayjs.Dayjs; end: dayjs.Dayjs }> {
        const registeredDay = dayjs(registeredDate).date()
        const currentMonth = dayjs().month()
        const startedDate = dayjs().month(currentMonth).date(registeredDay).startOf("day")
        const endedDate = startedDate.add(1, "month").subtract(1, "day")

        return {
            start: startedDate,
            end: endedDate,
        }
    }

    generateRelatedId(uniqueString: number, type: ProductType) {
        return `${type}-${uniqueString}`
    }

    computeGenerateCredit(subscription: SubscriptionPlanDto, count: number, type: ProductType) {
        switch (type) {
            case "video2video":
                return Math.max(0, Math.floor(count * subscription.credit_consume_every_second))
            case "face_swap":
                return Math.max(0, Math.floor(count * subscription.face_swap_consume_every_second))
            case "generate_video":
                return Math.max(0, Math.floor(count * subscription.generate_video_consume_every_second))
            case "generate_image":
                return Math.max(0, Math.floor(count * subscription.generate_image_consume_per_image))
            default:
                throw new BadRequestException("Invalid product type")
        }
    }

    getAllowedGenerateSeconds(subscription: SubscriptionPlanDto) {
        return Math.max(0, subscription.video_convert_max_seconds)
    }
}
