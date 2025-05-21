import { Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { IncomeRankDto, MarketCapRankDto, MySummaryDto, StatisticByDayDto } from "./dashboard.dto"
import { UtilitiesService } from "src/common/utilities.service"
import { CronExpression } from "@nestjs/schedule"
import { Cron } from "@nestjs/schedule"
@Injectable()
export class DashboardService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly utilitiesService: UtilitiesService,
    ) {}

    async getMySummary(user: UserJwtExtractDto): Promise<MySummaryDto> {
        const userInfo = await this.prisma.users.findUnique({ where: { username_in_be: user.usernameShorted } })

        if (!userInfo) {
            throw new NotFoundException("User not found")
        }

        const totalIpCount = await this.prisma.ip_library.count({ where: { owner: userInfo.username_in_be } })
        const topLevelIpCount = await this.prisma.ip_library.count({
            where: { owner: userInfo.username_in_be, ip_levels: 1 },
        })
        const currentMarketValue = await this.prisma.view_ip_token_prices.aggregate({
            where: { ip_info: { owner: userInfo.username_in_be } },
            _sum: {
                market_cap: true,
            },
        })

        const boundWidget = await this.prisma.app_bind_widgets.count({
            where: {
                app_detail: { creator: userInfo.username_in_be },
                widget_tag: { not: "login_from_external" },
                enabled: true,
            },
        })

        return {
            total_ip_count: totalIpCount || 0,
            top_level_ip_count: topLevelIpCount || 0,
            current_market_value: currentMarketValue?._sum?.market_cap?.toNumber() || 0,
            bound_widget: boundWidget || 0,
        }
    }

    async marketRanks(user: UserJwtExtractDto): Promise<MarketCapRankDto[]> {
        const userInfo = await this.prisma.users.findUnique({ where: { username_in_be: user.usernameShorted } })

        if (!userInfo) {
            throw new NotFoundException("User not found")
        }

        const marketCapRank = await this.prisma.view_ip_token_prices.findMany({
            where: { ip_info: { owner: userInfo.username_in_be } },
            include: { ip_info: true },
            orderBy: { market_cap: "desc" },
            take: 10,
        })

        //yesterday market cap
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        //conver yesterday to date so we can use equal in database
        const yesterdayDate = yesterday.toISOString().split("T")[0]

        const yesterdayMarketCap = await this.prisma.ip_token_price_history.findMany({
            where: { ip_id: { in: marketCapRank.map((item) => item.id) }, date: new Date(yesterdayDate) },
            orderBy: { date: "desc" },
            take: 10,
        })

        const yesterdayMarketCapMap = new Map(
            yesterdayMarketCap.map((item) => [item.ip_id, item.market_cap.toNumber()]),
        )

        const s3Info = await this.utilitiesService.getIpLibraryS3Info()

        return await Promise.all(
            marketCapRank.map(async (item, index) => ({
                ip_id: item.id,
                ip_name: item.ip_info.name,
                cover_image: item.ip_info.cover_images?.[0]?.key
                    ? await this.utilitiesService.createS3SignedUrl(item.ip_info.cover_images[0].key, s3Info)
                    : "",
                market_cap: item.market_cap.toNumber(),
                change_24h: yesterdayMarketCapMap.get(item.id)
                    ? ((item.market_cap.toNumber() - yesterdayMarketCapMap.get(item.id)) /
                          yesterdayMarketCapMap.get(item.id)) *
                      100
                    : 0,
                rank: index + 1,
            })),
        )
    }

    async ipIncomes(user: UserJwtExtractDto): Promise<IncomeRankDto[]> {
        const userInfo = await this.prisma.users.findUnique({ where: { username_in_be: user.usernameShorted } })

        if (!userInfo) {
            throw new NotFoundException("User not found")
        }

        const ipIncomes = await this.prisma.view_ip_incomes.groupBy({
            by: ["ip_id"],
            where: { ip_info: { owner: userInfo.username_in_be } },
            _sum: {
                amount: true,
            },
            orderBy: {
                _sum: {
                    amount: "desc",
                },
            },
            take: 10,
        })

        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayDate = yesterday.toISOString().split("T")[0]

        const ipIncomesYesterday = await this.prisma.view_ip_incomes.groupBy({
            by: ["ip_id"],
            where: {
                ip_info: { owner: userInfo.username_in_be },
                date: { lte: new Date(yesterdayDate) },
                ip_id: { in: ipIncomes.map((item) => item.ip_id) },
            },
            _sum: {
                amount: true,
            },
        })

        const ipIncomesYesterdayMap = new Map(
            ipIncomesYesterday.map((item) => [item.ip_id, item._sum.amount.toNumber()]),
        )

        const ips = await this.prisma.ip_library.findMany({
            where: { owner: userInfo.username_in_be, id: { in: ipIncomes.map((item) => item.ip_id) } },
        })

        const ipNameMap = new Map(ips.map((item) => [item.id, item]))

        const s3Info = await this.utilitiesService.getIpLibraryS3Info()

        return await Promise.all(
            ipIncomes.map(async (item, index) => ({
                ip_id: item.ip_id,
                ip_name: ipNameMap.get(item.ip_id).name,
                cover_image: ipNameMap.get(item.ip_id).cover_images?.[0]?.key
                    ? await this.utilitiesService.createS3SignedUrl(
                          ipNameMap.get(item.ip_id).cover_images[0].key,
                          s3Info,
                      )
                    : "",
                income: item._sum.amount.toNumber(),
                increased_income_24h: ipIncomesYesterdayMap.get(item.ip_id)
                    ? item._sum.amount.toNumber() - ipIncomesYesterdayMap.get(item.ip_id)
                    : 0,
                rank: index + 1,
            })),
        )
    }

    async getStatisticByDay(user: UserJwtExtractDto): Promise<StatisticByDayDto[]> {
        const userInfo = await this.prisma.users.findUnique({ where: { username_in_be: user.usernameShorted } })

        if (!userInfo) {
            throw new NotFoundException("User not found")
        }

        //we need generate a date list first
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - 30)
        const dateList = []
        for (let i = 0; i < 30; i++) {
            const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
            if (dateList.includes(date)) {
                continue
            }
            dateList.push(new Date(date))
        }

        const marketCapByDay = await this.prisma.ip_token_price_history.groupBy({
            by: ["date"],
            where: { ip_info: { owner: userInfo.username_in_be }, date: { in: dateList } },
            _sum: {
                market_cap: true,
            },
            orderBy: { _sum: { market_cap: "desc" } },
        })

        const marketCapByDayMap = new Map(
            marketCapByDay.map((item) => [item.date.toISOString(), item._sum.market_cap.toNumber()]),
        )

        const incomeByDay = await this.prisma.view_ip_incomes.groupBy({
            by: ["date"],
            where: { ip_info: { owner: userInfo.username_in_be }, date: { in: dateList } },
            _sum: {
                amount: true,
            },
            orderBy: { _sum: { amount: "desc" } },
        })

        const incomeByDayMap = new Map(
            incomeByDay.map((item) => [item.date.toISOString(), item._sum.amount.toNumber()]),
        )

        return dateList.map((item) => ({
            date: item,
            market_cap: marketCapByDayMap.get(item.toISOString()) || 0,
            income: incomeByDayMap.get(item.toISOString()) || 0,
        }))
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleMarketCap() {
        //sleep a random time but less 1 minute
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000 * 60))
        let yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)

        const yesterdayDate = yesterday.toISOString().split("T")[0]

        await this.prisma.ip_token_price_history.deleteMany({
            where: {
                date: new Date(yesterdayDate),
            },
        })

        const data = await this.prisma.view_ip_token_prices.findMany({
            where: {
                market_cap: {
                    gt: 0,
                },
            },
        })

        await this.prisma.ip_token_price_history.createMany({
            data: data.map((item) => ({
                date: new Date(yesterdayDate),
                ip_id: item.id,
                current_token_info: item.current_token_info,
                price: item.price,
                bonding_curve_progress: item.bonding_curve_progress,
                change1h: item.change1h,
                change5m: item.change5m,
                change24h: item.change24h,
                market_cap: item.market_cap,
                total_supply: item.total_supply,
                trade_volume: item.trade_volume,
            })),
        })
    }
}
