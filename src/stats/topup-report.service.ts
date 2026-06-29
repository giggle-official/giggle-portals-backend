import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Pool } from "pg"
import { NotificationService } from "src/notification/notification.service"

interface TopUpReportRow {
    time: Date | null
    order_id: string
    credit: number | string | null
    in_usd: number | string | null
    channel: string | null
    in_cny: number | string | null
    email: string | null
}

const REPORT_SQL = `
SELECT
  t.pay_time AS "time",
  t.id AS "order_id",
  t.credits AS "credit",
  t.usd_amount AS "in_usd",
  COALESCE(cp.pay_method, t.payment_type) AS "channel",
  cp.amount AS "in_cny",
  t.user_email AS "email"
FROM top_up_orders t
LEFT JOIN china_payments cp ON cp.top_up_order_id = t.id
WHERE t.status = 'credits_issued'
ORDER BY t.pay_time DESC
`

@Injectable()
export class TopUpReportService implements OnModuleDestroy {
    private readonly logger = new Logger(TopUpReportService.name)
    private pool: Pool | null = null

    constructor(private readonly notificationService: NotificationService) { }

    onModuleDestroy() {
        return this.pool?.end()
    }

    private getPool(): Pool | null {
        const connectionString = process.env.TOPUP_REPORT_DATABASE_URL
        if (!connectionString) return null
        if (!this.pool) {
            this.pool = new Pool({
                connectionString,
                // Supabase / managed Postgres requires TLS. Set TOPUP_REPORT_DB_SSL=false for a local DB.
                ssl: process.env.TOPUP_REPORT_DB_SSL === "false" ? false : { rejectUnauthorized: false },
                max: 2,
            })
        }
        return this.pool
    }

    // Every Monday at 09:00 Beijing time (01:00 UTC)
    @Cron("0 1 * * 1")
    async sendWeeklyTopUpReport(): Promise<void> {
        if (process.env.TASK_SLOT != "1") return

        const pool = this.getPool()
        if (!pool) {
            this.logger.warn("TOPUP_REPORT_DATABASE_URL not configured, skipping top-up report")
            return
        }

        const recipients = this.getRecipients()
        if (recipients.length === 0) {
            this.logger.warn("No top-up report recipients configured, skipping")
            return
        }
        const to = recipients.join(",")

        try {
            this.logger.log("Generating weekly top-up report...")
            const { rows } = await pool.query<TopUpReportRow>(REPORT_SQL)

            const csv = this.buildCsv(rows)
            const today = new Date().toISOString().slice(0, 10)

            await this.notificationService.sendTextNotificationWithAttachment(
                `充值统计 ${today}（${rows.length} 笔）`,
                to,
                `本周充值统计见附件，共 ${rows.length} 笔。`,
                {
                    data: Buffer.from("﻿" + csv, "utf-8"), // BOM so Excel reads UTF-8
                    filename: `topup-report-${today}.csv`,
                    contentType: "text/csv",
                },
            )
            this.logger.log(`Top-up report sent to ${to} (${rows.length} rows)`)
        } catch (error) {
            this.logger.error("Failed to generate/send top-up report:", error)
        }
    }

    // Comma-separated TOPUP_REPORT_EMAIL. No default — skip sending when unset.
    private getRecipients(): string[] {
        return (process.env.TOPUP_REPORT_EMAIL || "")
            .split(",")
            .map((email) => email.trim())
            .filter((email) => email.length > 0)
    }

    private buildCsv(rows: TopUpReportRow[]): string {
        const headers = ["time", "order_id", "credit", "in_usd", "channel", "in_cny", "email"] as const
        const lines = [headers.join(",")]
        for (const row of rows) {
            lines.push(
                [
                    this.formatTime(row.time),
                    row.order_id,
                    row.credit,
                    row.in_usd,
                    row.channel,
                    row.in_cny,
                    row.email,
                ]
                    .map((value) => this.csvCell(value))
                    .join(","),
            )
        }
        return lines.join("\n")
    }

    private formatTime(value: Date | null): string {
        if (!value) return ""
        return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
    }

    private csvCell(value: unknown): string {
        const str = value === null || value === undefined ? "" : String(value)
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
    }
}
