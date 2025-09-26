import { Injectable, Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { AppendAccessLogDto, RevenueStatsDto, TotalRegisterdUserDto, TotalRevenueByIpDto } from "./stats.dto"
import { Cron, CronExpression } from "@nestjs/schedule"
import { NotificationService } from "src/notification/notification.service"

@Injectable()
export class StatsService {
    private readonly logger = new Logger(StatsService.name)
    constructor(
        private readonly prisma: PrismaService,
        private readonly notificationService: NotificationService,
    ) {}

    async appendAccessLog(log: AppendAccessLogDto) {
        await this.prisma.widget_access_log.create({
            data: {
                device_id: log?.device_id,
                app_id: log?.app_id,
                widget_tag: log?.widget_tag,
                link_id: log?.link_id,
                user: log?.user,
            },
        })
    }

    async genreateDailyRevenueStats(): Promise<RevenueStatsDto[]> {
        const revenueStats = await this.prisma.$queryRaw<RevenueStatsDto[]>`
with statements as (select id, widget_tag
                    from reward_pool_statement
                    where related_order_id in (select order_id from orders where current_status = 'rewards_released')
                      and widget_tag is not null
                      and chain_transaction is not null
                      and type = 'released'
                      and widget_tag != ''),
     yesterday as (SELECT DATE_SUB(CURDATE(), INTERVAL 1 DAY) as yesterday,
                          CURDATE()                           as today),
     revenue as (select widget_tag,
                        sum(case when date(created_at) = b.yesterday then usd_revenue else 0 end) as day_usd_revenue,
                        sum(case
                                when year(created_at) = year(b.yesterday) and month(created_at) = month(b.yesterday)
                                    then usd_revenue
                                else 0 end)                                                       as month_usd_revenue,
                        sum(usd_revenue)                                                          as total_usd_revenue
                 from reward_pool_statement a
                          cross join yesterday b
                 where id in (select id from statements)
                 group by widget_tag),
     allocation as (select sum(case
                                   when role = 'buyback' and date(created_at) = d.yesterday then rewards
                                   else 0 end)                                        as buyback_day_allocated,
                           sum(case
                                   when role = 'buyback' and year(created_at) = year(d.yesterday) and
                                        month(created_at) = month(d.yesterday) then rewards
                                   else 0 end)                                        as buyback_month_allocated,
                           sum(case when role = 'buyback' then rewards else 0 end)    as buyback_total_allocated,
                           sum(case
                                   when role = 'platform' and date(created_at) = d.yesterday then rewards
                                   else 0 end)                                        as platform_day_allocated,
                           sum(case
                                   when role = 'platform' and year(created_at) = year(d.yesterday) and
                                        month(created_at) = month(d.yesterday) then rewards
                                   else 0 end)                                        as platform_month_allocated,
                           sum(case when role = 'platform' then rewards else 0 end)   as platform_total_allocated
                            ,
                           sum(case
                                   when role = 'ip-holder' and date(created_at) = d.yesterday then rewards
                                   else 0 end)                                        as ip_holder_day_allocated,
                           sum(case
                                   when role = 'ip-holder' and year(created_at) = year(d.yesterday) and
                                        month(created_at) = month(d.yesterday) then rewards
                                   else 0 end)                                        as ip_holder_month_allocated,
                           sum(case when role = 'ip-holder' then rewards else 0 end)  as ip_holder_total_allocated
                            ,
                           sum(case
                                   when role = 'customized' and date(created_at) = d.yesterday then rewards
                                   else 0 end)                                        as customized_day_allocated,
                           sum(case
                                   when role = 'customized' and year(created_at) = year(d.yesterday) and
                                        month(created_at) = month(d.yesterday) then rewards
                                   else 0 end)                                        as customized_month_allocated,
                           sum(case when role = 'customized' then rewards else 0 end) as customized_total_allocated
                            ,
                           sum(case
                                   when is_cost = true and ifnull(role, '') != 'platform' and
                                        date(created_at) = d.yesterday then rewards
                                   else 0 end)                                        as developer_day_allocated,
                           sum(case
                                   when is_cost = true and ifnull(role, '') != 'platform' and
                                        year(created_at) = year(d.yesterday) and
                                        month(created_at) = month(d.yesterday) then rewards
                                   else 0 end)                                        as developer_month_allocated,
                           sum(case
                                   when is_cost = true and ifnull(role, '') != 'platform' then rewards
                                   else 0 end)                                        as developer_total_allocated
                            ,
                           sum(case
                                   when is_cost = false and
                                        role not in ('buyback', 'platform', 'ip-holder', 'customized') and
                                        date(created_at) = d.yesterday then rewards
                                   else 0 end)                                        as other_day_allocated,
                           sum(case
                                   when is_cost = false and
                                        role not in ('buyback', 'platform', 'ip-holder', 'customized') and
                                        year(created_at) = year(d.yesterday) and
                                        month(created_at) = month(d.yesterday) then rewards
                                   else 0 end)                                        as other_month_allocated,
                           sum(case
                                   when is_cost = false and
                                        role not in ('buyback', 'platform', 'ip-holder', 'customized') then rewards
                                   else 0 end)                                        as other_total_allocated
                            ,
                           b.widget_tag
                    from user_rewards a
                             join statements b on a.statement_id = b.id
                             cross join yesterday d
                    where a.statement_id in (select id from statements)
                      and a.ticker = 'usdc'
                    group by b.widget_tag)
select a.*,
       c.name                                                                               as widget_name,
       b.day_usd_revenue,
       b.month_usd_revenue,
       b.total_usd_revenue,
       b.day_usd_revenue -
       (a.buyback_day_allocated + a.customized_day_allocated + a.developer_day_allocated +
        a.ip_holder_day_allocated + a.other_day_allocated + a.platform_day_allocated)       as unsetted_day_allocation,
       b.month_usd_revenue -
       (a.buyback_month_allocated + a.customized_month_allocated + a.developer_month_allocated +
        a.ip_holder_month_allocated + a.other_month_allocated +
        a.platform_month_allocated)                                                         as unsetted_month_allocation,
       b.total_usd_revenue -
       (a.buyback_total_allocated + a.customized_total_allocated + a.developer_total_allocated +
        a.ip_holder_total_allocated + a.other_total_allocated + a.platform_total_allocated) as unsetted_total_allocation

from allocation a
         left join revenue b on a.widget_tag = b.widget_tag
         left join widgets c on c.tag = a.widget_tag;
`

        return revenueStats
    }

    async genreateTotalRevenueByIp(): Promise<TotalRevenueByIpDto[]> {
        //        const totalRevenueByIp = await this.prisma.$queryRaw<TotalRevenueByIpDto[]>`
        //with statements as (select id, widget_tag
        //                    from reward_pool_statement
        //                    where related_order_id in (select order_id from orders where current_status = 'rewards_released')
        //                      and widget_tag is not null
        //                      and chain_transaction is not null
        //                      and type = 'released'
        //                      and widget_tag != ''),
        //     yesterday as (SELECT DATE_SUB(CURDATE(), INTERVAL 1 DAY) as yesterday,
        //                          CURDATE()                           as today),
        //     revenue_with_app as (select a.widget_tag,
        //                                 b.app_id,
        //                                 sum(case when date(a.created_at) = y.yesterday then usd_revenue else 0 end) as day_usd_revenue,
        //                                 sum(case
        //                                         when year(a.created_at) = year(y.yesterday) and
        //                                              month(a.created_at) = month(y.yesterday)
        //                                             then usd_revenue
        //                                         else 0 end)                                                         as month_usd_revenue,
        //                                 sum(usd_revenue)                                                            as total_usd_revenue
        //                          from reward_pool_statement a
        //                                   left join orders b on a.related_order_id = b.order_id
        //                                   cross join yesterday y
        //                          where a.id in (select id from statements)
        //                          group by widget_tag, b.app_id)
        //select a.*, c.name as ip_name, d.name as widget_name
        //from revenue_with_app a
        //         left join app_bind_ips b on a.app_id = b.app_id
        //         left join ip_library c on b.ip_id = c.id
        //         left join widgets d on d.tag = a.widget_tag;
        //        `

        const totalRevenueByIp = await this.prisma.$queryRaw<TotalRevenueByIpDto[]>`
with statements as (select id, widget_tag
                    from reward_pool_statement
                    where related_order_id in (select order_id from orders where current_status = 'rewards_released')
                      and widget_tag is not null
                      and chain_transaction is not null
                      and type = 'released'
                      and widget_tag != ''),
     yesterday as (SELECT DATE_SUB(CURDATE(), INTERVAL 1 DAY) as yesterday,
                          CURDATE()                           as today)
select d.name                                                                      as ip_name,
       sum(case when date(a.created_at) = y.yesterday then usd_revenue else 0 end) as day_usd_revenue,
       sum(case
               when year(a.created_at) = year(y.yesterday) and
                    month(a.created_at) = month(y.yesterday)
                   then usd_revenue
               else 0 end)                                                         as month_usd_revenue,
       sum(usd_revenue)                                                            as total_usd_revenue
from reward_pool_statement a
         left join orders b on a.related_order_id = b.order_id
         left join app_bind_ips c on c.app_id = b.app_id
         left join ip_library d on c.ip_id = d.id
         cross join yesterday y
where a.id in (select id from statements)
group by d.name;
`
        return totalRevenueByIp
    }

    async genreateTotalRegisterdUserByIp(): Promise<TotalRegisterdUserDto[]> {
        const totalRegisterdUser = await this.prisma.$queryRaw<TotalRegisterdUserDto[]>`
with widget_in_app as (select app_id, widget_tag
                       from app_bind_widgets
                       where widget_tag != 'login_from_external'
                         and enabled = true),
     yesterday as (SELECT DATE_SUB(CURDATE(), INTERVAL 1 DAY) as yesterday,
                          CURDATE()                           as today)
select sum(case when date(a.created_at) = y.yesterday then 1 else 0 end) as day_registered,
       sum(case
               when year(a.created_at) = year(y.yesterday) and
                    month(a.created_at) = month(y.yesterday) then 1
               else 0 end)                                               as month_registered,
       sum(1)                                                            as total_registered,
       c.name                                                            as ip_name
from users a
         left join app_bind_ips b on a.register_app_id = b.app_id
         left join ip_library c on b.ip_id = c.id
         left join widget_in_app d on d.app_id = a.register_app_id
         left join widgets e on e.tag = d.widget_tag
         cross join yesterday y
where register_app_id != ''
  and register_app_id is not null
group by c.name;
        `
        //              register_app_id,
        //              c.name                                                            as ip_name,
        //              e.name                                                            as widget_name
        //
        //group by register_app_id, c.name, e.name;
        return totalRegisterdUser
    }

    /**
     * Formats revenue stats data for email template
     */
    private formatRevenueDataForTemplate(revenueStats: RevenueStatsDto[]) {
        return revenueStats.map((stat) => ({
            widget_name: stat.widget_name || stat.widget_tag || "N/A",
            // Revenue data
            day_usd_revenue: Number(stat.day_usd_revenue || 0).toFixed(2),
            month_usd_revenue: Number(stat.month_usd_revenue || 0).toFixed(2),
            total_usd_revenue: Number(stat.total_usd_revenue || 0).toFixed(2),
            // Buyback allocations
            buyback_day_allocated: Number(stat.buyback_day_allocated || 0).toFixed(2),
            buyback_month_allocated: Number(stat.buyback_month_allocated || 0).toFixed(2),
            buyback_total_allocated: Number(stat.buyback_total_allocated || 0).toFixed(2),
            // Platform allocations
            platform_day_allocated: Number(stat.platform_day_allocated || 0).toFixed(2),
            platform_month_allocated: Number(stat.platform_month_allocated || 0).toFixed(2),
            platform_total_allocated: Number(stat.platform_total_allocated || 0).toFixed(2),
            // IP Holder allocations
            ip_holder_day_allocated: Number(stat.ip_holder_day_allocated || 0).toFixed(2),
            ip_holder_month_allocated: Number(stat.ip_holder_month_allocated || 0).toFixed(2),
            ip_holder_total_allocated: Number(stat.ip_holder_total_allocated || 0).toFixed(2),
            // Customized allocations
            customized_day_allocated: Number(stat.customized_day_allocated || 0).toFixed(2),
            customized_month_allocated: Number(stat.customized_month_allocated || 0).toFixed(2),
            customized_total_allocated: Number(stat.customized_total_allocated || 0).toFixed(2),
            // Developer allocations
            developer_day_allocated: Number(stat.developer_day_allocated || 0).toFixed(2),
            developer_month_allocated: Number(stat.developer_month_allocated || 0).toFixed(2),
            developer_total_allocated: Number(stat.developer_total_allocated || 0).toFixed(2),
            // Other allocations
            other_day_allocated: Number(stat.other_day_allocated || 0).toFixed(2),
            other_month_allocated: Number(stat.other_month_allocated || 0).toFixed(2),
            other_total_allocated: Number(stat.other_total_allocated || 0).toFixed(2),
            // Unsetted allocations (unallocated revenue in wallet)
            unsetted_day_allocated: Number(stat.unsetted_day_allocation || 0).toFixed(2),
            unsetted_month_allocated: Number(stat.unsetted_month_allocation || 0).toFixed(2),
            unsetted_total_allocated: Number(stat.unsetted_total_allocation || 0).toFixed(2),
        }))
    }

    /**
     * Calculates summary totals from revenue stats
     */
    private calculateSummaryTotals(revenueStats: RevenueStatsDto[]) {
        return revenueStats.reduce(
            (totals, stat) => ({
                totalDayRevenue: totals.totalDayRevenue + Number(stat.day_usd_revenue || 0),
                totalMonthRevenue: totals.totalMonthRevenue + Number(stat.month_usd_revenue || 0),
                totalRevenue: totals.totalRevenue + Number(stat.total_usd_revenue || 0),
            }),
            { totalDayRevenue: 0, totalMonthRevenue: 0, totalRevenue: 0 },
        )
    }

    /**
     * Formats IP revenue data for email template
     */
    private formatIpRevenueDataForTemplate(ipRevenueData: TotalRevenueByIpDto[]) {
        return ipRevenueData.map((data) => ({
            // widget_name: data.widget_name || data.widget_tag || "N/A",
            // app_id: data.app_id || "N/A",
            ip_name: data.ip_name || "Unknown IP",
            day_usd_revenue: Number(data.day_usd_revenue || 0).toFixed(2),
            month_usd_revenue: Number(data.month_usd_revenue || 0).toFixed(2),
            total_usd_revenue: Number(data.total_usd_revenue || 0).toFixed(2),
        }))
    }

    /**
     * Formats IP user registration data for email template
     */
    private formatIpUserDataForTemplate(ipUserData: TotalRegisterdUserDto[]) {
        return ipUserData.map((data) => ({
            // register_app_id: data.register_app_id || "N/A",
            ip_name: data.ip_name || "-",
            // widget_name: data.widget_name || "Unknown Widget",
            day_registered: Number(data.day_registered || 0),
            month_registered: Number(data.month_registered || 0),
            total_registered: Number(data.total_registered || 0),
        }))
    }

    /**
     * Gets boss email list from environment variables
     */
    private getBossEmailList(): string[] {
        const emailList = process.env.BOSS_EMAIL_LIST || ""
        if (!emailList) {
            this.logger.warn("BOSS_EMAIL_LIST environment variable is not set")
            return []
        }
        return emailList
            .split(",")
            .map((email) => email.trim())
            .filter((email) => email.length > 0)
    }

    /**
     * Sends revenue stats email to bosses
     * Environment Variable Required: BOSS_EMAIL_LIST (comma-separated email addresses)
     * Example: BOSS_EMAIL_LIST=boss1@company.com,boss2@company.com,ceo@company.com
     */
    @Cron(CronExpression.EVERY_DAY_AT_1AM) // generate report at 0 AM
    //@Cron(CronExpression.EVERY_5_MINUTES) //for testing
    async sendRevenueStatsEmail(): Promise<void> {
        try {
            if (process.env.TASK_SLOT != "1") return
            if (process.env.ENV !== "product") {
                this.logger.log("Skipping revenue stats email generation in non-production environment")
                return
            }
            this.logger.log("Starting revenue stats email generation...")

            // Get all data concurrently
            const [revenueStats, ipRevenueData, ipUserData] = await Promise.all([
                this.genreateDailyRevenueStats(),
                this.genreateTotalRevenueByIp(),
                this.genreateTotalRegisterdUserByIp(),
            ])

            if (!revenueStats || revenueStats.length === 0) {
                this.logger.warn("No revenue stats data found, skipping email")
                return
            }

            // Get boss email list
            const bossEmails = this.getBossEmailList()
            if (bossEmails.length === 0) {
                this.logger.warn("No boss emails configured, skipping email")
                return
            }

            // Format data for template
            const formattedData = this.formatRevenueDataForTemplate(revenueStats)
            const summaryTotals = this.calculateSummaryTotals(revenueStats)
            const formattedIpRevenue = this.formatIpRevenueDataForTemplate(ipRevenueData)
            const formattedIpUsers = this.formatIpUserDataForTemplate(ipUserData)

            // Prepare template context
            const currentDate = new Date()
            const templateContext = {
                revenueData: formattedData,
                ipRevenueData: formattedIpRevenue,
                ipUserData: formattedIpUsers,
                reportDate: currentDate.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    timeZone: "UTC",
                }),
                period: `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`,
                totalDayRevenue: summaryTotals.totalDayRevenue.toFixed(2),
                totalMonthRevenue: summaryTotals.totalMonthRevenue.toFixed(2),
                totalRevenue: summaryTotals.totalRevenue.toFixed(2),
                totalWidgets: revenueStats.length,
                totalIPs: ipRevenueData.length,
            }

            // Send emails to all bosses
            const emailPromises = bossEmails.map(async (email) => {
                try {
                    await this.notificationService.sendNotification(
                        `📊 Daily Revenue & Allocation Report - ${templateContext.reportDate}`,
                        email,
                        "revenue_report",
                        templateContext,
                        "mail.giggle.pro",
                        "Giggle.Pro <app-noreply@giggle.pro>",
                    )
                    this.logger.log(`Revenue report sent successfully to ${email}`)
                } catch (error) {
                    this.logger.error(`Failed to send revenue report to ${email}:`, error)
                }
            })

            await Promise.allSettled(emailPromises)
            this.logger.log(`Revenue stats email process completed. Sent to ${bossEmails.length} recipients.`)
        } catch (error) {
            this.logger.error("Failed to generate/send revenue stats email:", error)
            throw error
        }
    }
}
