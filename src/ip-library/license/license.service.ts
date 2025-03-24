import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserInfoDTO } from "src/user/user.controller"
import { LicenseOrderDetailDto, OrderCreateDto, LicenseIpListDto, LicenseIpListReqParams } from "./license.dto"
import { UserService } from "src/user/user.service"
import { IpLibraryService } from "../ip-library.service"
import { CreditService } from "src/credit/credit.service"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { Prisma } from "@prisma/client"
import { ConfirmStatus, SSEMessage } from "src/web3/giggle/giggle.dto"
import { Observable } from "rxjs"
@Injectable()
export class LicenseService {
    private readonly logger = new Logger(LicenseService.name)
    constructor(
        private readonly prismaService: PrismaService,
        private readonly userService: UserService,

        @Inject(forwardRef(() => IpLibraryService))
        private readonly ipLibraryService: IpLibraryService,

        private readonly giggleService: GiggleService,
    ) {}

    async purchase(user: UserInfoDTO, body: OrderCreateDto): Promise<LicenseOrderDetailDto> {
        const userProfile = await this.userService.getProfile(user)
        const amount = (await this.getLicensePrice(parseInt(body.ip_id.toString()))) * body.quantity

        const ip = await this.ipLibraryService.detail(body.ip_id.toString(), true)
        if (!ip.can_purchase) {
            throw new BadRequestException("this ip does not support purchase")
        }

        const usdcBalance = await this.giggleService.getUsdcBalance(userProfile)
        if (usdcBalance.balance < amount) {
            throw new BadRequestException("insufficient balance")
        }

        let paymented = false
        let paymentConfirmed = false

        const paymentResponse = await this.giggleService.payment({
            amount: amount,
            user: userProfile.usernameShorted,
        })

        if (!paymentResponse.sn) {
            throw new BadRequestException("purchase failed")
        }

        paymented = true

        try {
            const result = await this.prismaService.$transaction(async (tx) => {
                const order = await tx.ip_license_orders.create({
                    data: {
                        ip_id: body.ip_id,
                        quantity: body.quantity,
                        remain_quantity: body.quantity,
                        amount: amount,
                        owner: user.usernameShorted,
                        web3_order_sn: paymentResponse.sn,
                    },
                })

                //allocate income to ip owner
                const ratio = ip.authorization_settings.revenue_distribution.licensor
                const ip_info = await tx.ip_library.findUnique({ where: { id: body.ip_id } })
                const income = Math.floor((amount * ratio) / 100)
                await tx.ip_license_income.create({
                    data: {
                        ip_id: body.ip_id,
                        order_id: order.id,
                        order_amount: amount,
                        income: income,
                        balance: income,
                        ratio: ratio,
                        allocated_to: ip_info.owner,
                    },
                })
                //await this.creditService.pendingCredit(user, amount, this.generatePurchaseOrderRelatedId(order.id))
                //await this.creditService.completeCredit(this.generatePurchaseOrderRelatedId(order.id))
                return order
            })

            if (result) {
                await this.giggleService.paymentCallback({
                    sn: paymentResponse.sn,
                    status: ConfirmStatus.CONFIRMED,
                })
                paymentConfirmed = true
            }

            return await this.detail(user, result.id)
        } catch (error) {
            if (paymented && !paymentConfirmed) {
                await this.giggleService.paymentCallback({
                    sn: paymentResponse.sn,
                    status: ConfirmStatus.REFUNDED,
                })
            }
            this.logger.error(
                `purchase failed, refund ${amount} to user ${user.usernameShorted}, error: ${JSON.stringify(error)}`,
            )
            throw new BadRequestException("purchase failed")
        }
    }

    purchaseWithEvent(user: UserInfoDTO, body: OrderCreateDto): Observable<SSEMessage> {
        return new Observable((subscriber) => {
            this.processPurchaseLicense(user, body, subscriber).catch((error) => {
                subscriber.error(error)
            })
        })
    }

    async processPurchaseLicense(user: UserInfoDTO, body: OrderCreateDto, subscriber: any): Promise<void> {
        subscriber.next({
            event: "ip.data_validating",
            data: {
                message: "validating data",
            },
        })

        const userProfile = await this.userService.getProfile(user)
        const amount = (await this.getLicensePrice(parseInt(body.ip_id.toString()))) * body.quantity

        const ip = await this.ipLibraryService.detail(body.ip_id.toString(), true)
        if (!ip.can_purchase) {
            throw new BadRequestException("this ip does not support purchase")
        }

        const usdcBalance = await this.giggleService.getUsdcBalance(userProfile)
        if (usdcBalance.balance < amount) {
            throw new BadRequestException("insufficient balance")
        }

        let paymented = false
        let paymentConfirmed = false

        subscriber.next({
            event: "ip.payment_processing",
            data: {
                message: "processing payment",
            },
        })

        const paymentResponse = await this.giggleService.payment({
            amount: amount,
            user: userProfile.usernameShorted,
        })

        if (!paymentResponse.sn) {
            throw new BadRequestException("purchase failed")
        }

        paymented = true

        try {
            subscriber.next({
                event: "ip.order_processing",
                data: {
                    message: "processing order",
                },
            })

            const result = await this.prismaService.$transaction(async (tx) => {
                const order = await tx.ip_license_orders.create({
                    data: {
                        ip_id: body.ip_id,
                        quantity: body.quantity,
                        remain_quantity: body.quantity,
                        amount: amount,
                        owner: user.usernameShorted,
                        web3_order_sn: paymentResponse.sn,
                    },
                })

                //allocate income to ip owner
                const ratio = ip.authorization_settings.revenue_distribution.licensor
                const ip_info = await tx.ip_library.findUnique({ where: { id: body.ip_id } })
                const income = Math.floor((amount * ratio) / 100)
                await tx.ip_license_income.create({
                    data: {
                        ip_id: body.ip_id,
                        order_id: order.id,
                        order_amount: amount,
                        income: income,
                        balance: income,
                        ratio: ratio,
                        allocated_to: ip_info.owner,
                    },
                })
                //await this.creditService.pendingCredit(user, amount, this.generatePurchaseOrderRelatedId(order.id))
                //await this.creditService.completeCredit(this.generatePurchaseOrderRelatedId(order.id))
                return order
            })

            if (result) {
                subscriber.next({
                    event: "ip.payment_confirmed",
                    data: {
                        message: "payment confirmed",
                    },
                })
                await this.giggleService.paymentCallback({
                    sn: paymentResponse.sn,
                    status: ConfirmStatus.CONFIRMED,
                })
                paymentConfirmed = true
            }

            subscriber.next({
                event: "ip.order_completed",
                data: await this.detail(user, result.id),
            })
        } catch (error) {
            if (paymented && !paymentConfirmed) {
                subscriber.next({
                    event: "ip.payment_refunded",
                    data: {
                        message: "payment refunded",
                    },
                })
                await this.giggleService.paymentCallback({
                    sn: paymentResponse.sn,
                    status: ConfirmStatus.REFUNDED,
                })
            }
            this.logger.error(
                `purchase failed, refund ${amount} to user ${user.usernameShorted}, error: ${JSON.stringify(error)}`,
            )
            subscriber.error(error)
            subscriber.complete()
        }
    }

    async detail(user: UserInfoDTO, orderId: number): Promise<LicenseOrderDetailDto> {
        const order = await this.prismaService.ip_license_orders.findUnique({
            where: { id: orderId, owner: user.usernameShorted },
            select: {
                id: true,
                ip_id: true,
                quantity: true,
                remain_quantity: true,
                amount: true,
                created_at: true,
                updated_at: true,
                ip_license_consume_log: {
                    where: { refunded: false },
                },
            },
        })
        return order
    }

    /*
    async list(user: UserInfoDTO, query: LicenseListReqParams): Promise<LicenseListResDto> {
        const orders = await this.prismaService.ip_license_orders.findMany({
            where: { owner: user.usernameShorted },
            skip: (parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
            select: {
                id: true,
                ip_id: true,
                quantity: true,
                remain_quantity: true,
                amount: true,
                created_at: true,
                updated_at: true,
                ip_license_consume_log: {
                    where: { refunded: false },
                },
            },
        })

        const count = await this.prismaService.ip_license_orders.count({
            where: { owner: user.usernameShorted },
        })

        const ip_ids = orders.map((order) => order.ip_id)
        if (ip_ids.length === 0) {
            return {
                data: [],
                count: 0,
            }
        }

        return {
            data: orders.map((order) => ({
                ...order,
                amount: order.amount,
            })),
            count: count,
        }
    }
    */

    async ipList(user: UserInfoDTO, query: LicenseIpListReqParams): Promise<LicenseIpListDto> {
        const where: Prisma.ip_license_ordersWhereInput = { owner: user.usernameShorted, remain_quantity: { gt: 0 } }
        if (query.search) {
            where.OR = [
                { ip_info: { name: { contains: query.search } } },
                { ip_info: { ticker: { contains: query.search } } },
            ]
        }

        if (query.ip_id) {
            where.ip_id = parseInt(query.ip_id.toString())
        }

        const ips = await this.prismaService.ip_license_orders.groupBy({
            where,
            by: ["ip_id"],
            _sum: {
                quantity: true,
                remain_quantity: true,
            },
            orderBy: {
                ip_id: "desc",
            },
            skip: (parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
        })

        const count = await this.prismaService.ip_license_orders.findMany({
            where,
            distinct: ["ip_id"],
            select: {
                ip_id: true,
            },
        })

        const ip_ids = ips.map((ip) => ip.ip_id)
        const ip_infos = await this.ipLibraryService.getList(
            { page: "1", page_size: ip_ids.length.toString() },
            null,
            undefined,
            ip_ids,
        )

        return {
            data: ips.map((ip) => ({
                ip_id: ip.ip_id,
                quantity: ip._sum.quantity,
                remain_quantity: ip._sum.remain_quantity,
                ...ip_infos.data.find((ip_info) => ip_info.id === ip.ip_id),
            })),
            count: count.length,
        }
    }

    async consume(user: UserInfoDTO, ip_id: number, amount: number, type: string, detail: any): Promise<number[]> {
        const orders = await this.prismaService.ip_license_orders.findMany({
            where: { owner: user.usernameShorted, ip_id: ip_id, remain_quantity: { gt: 0 } },
        })
        if (orders.length === 0) {
            this.logger.error(`user ${user.usernameShorted} does not have ip license ${ip_id}`)
            throw new BadRequestException("you don't have this ip license")
        }

        const total_quantity = orders.reduce((acc, order) => acc + order.remain_quantity, 0)
        if (total_quantity < amount) {
            this.logger.error(`user ${user.usernameShorted} does not have enough ip license ${ip_id}`)
            throw new BadRequestException("you don't have enough ip license")
        }

        let comsumeLogs: number[] = []
        await this.prismaService.$transaction(async (tx) => {
            let remainingAmount = amount
            for (const order of orders) {
                if (remainingAmount <= 0) break

                const consumeAmount = Math.min(order.remain_quantity, remainingAmount)
                await tx.ip_license_orders.update({
                    where: { id: order.id },
                    data: { remain_quantity: order.remain_quantity - consumeAmount },
                })

                const consumeLog = await tx.ip_license_consume_log.create({
                    data: {
                        order_id: order.id,
                        ip_id: ip_id,
                        consume_amount: consumeAmount,
                        consume_type: type,
                        consume_detail: detail,
                    },
                })
                remainingAmount -= consumeAmount
                comsumeLogs.push(consumeLog.id)
            }
        })
        this.logger.log(`user ${user.usernameShorted} consume ${amount} ip license ${ip_id}`)
        return comsumeLogs
    }

    async refund(consumeLogs: number[]): Promise<void> {
        await this.prismaService.$transaction(async (tx) => {
            for (const log of consumeLogs) {
                const consumeLog = await tx.ip_license_consume_log.findUnique({ where: { id: log } })
                if (!consumeLog) {
                    this.logger.warn(`consume log ${log} not found`)
                    continue
                }
                const order = await tx.ip_license_orders.findUnique({ where: { id: consumeLog.order_id } })
                if (!order) {
                    this.logger.warn(`order ${consumeLog.order_id} not found`)
                    continue
                }
                await tx.ip_license_orders.update({
                    where: { id: consumeLog.order_id },
                    data: { remain_quantity: order.remain_quantity + consumeLog.consume_amount },
                })
                await tx.ip_license_consume_log.update({
                    where: { id: log },
                    data: { refunded: true, refunded_date: new Date() },
                })
            }
        })
    }

    async getLicensePrice(ipId: number): Promise<number> {
        const ipInfo = await this.ipLibraryService.detail(ipId.toString(), null)
        return Number(ipInfo?.authorization_settings?.license_price) || 10
    }

    generatePurchaseOrderRelatedId(order_id: number): string {
        return `ip_license_order_${order_id}`
    }
}
