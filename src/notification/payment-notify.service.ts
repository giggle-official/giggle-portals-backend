import { Injectable, Logger } from "@nestjs/common"

/**
 * Posts payment events to the ops chat (a Mattermost incoming webhook at
 * `PAYMENT_NOTIFY_URL`).
 *
 * Best effort by design: a notification that fails must never fail the credit
 * issue it describes, so every path here swallows its own errors and logs them.
 */
@Injectable()
export class PaymentNotifyService {
    private readonly logger = new Logger(PaymentNotifyService.name)

    /** Top-ups strictly above this many credits are announced. */
    static readonly DEFAULT_LARGE_TOPUP_THRESHOLD = 10_000

    largeTopUpThreshold(): number {
        const raw = process.env.LARGE_TOPUP_NOTIFY_THRESHOLD
        const parsed = raw === undefined || raw === "" ? NaN : Number(raw)
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : PaymentNotifyService.DEFAULT_LARGE_TOPUP_THRESHOLD
    }

    isLargeTopUp(credits: number): boolean {
        return credits > this.largeTopUpThreshold()
    }

    async notifyLargeTopUp(event: {
        order_id: string
        email: string | null
        user: string
        credits: number
        balance_after: number
        widget_tag: string | null
        paid_method: string | null
    }): Promise<void> {
        const text = [
            `:moneybag: **Large top-up: ${formatCredits(event.credits)} credits**`,
            `- user: ${event.email ?? "(no email)"} (\`${event.user}\`)`,
            `- widget: ${event.widget_tag ?? "-"} · paid via ${event.paid_method ?? "-"}`,
            `- order: \`${event.order_id}\``,
            `- balance after: ${formatCredits(event.balance_after)}`,
        ].join("\n")
        await this.post(text)
    }

    private async post(text: string): Promise<void> {
        const url = process.env.PAYMENT_NOTIFY_URL
        if (!url) {
            this.logger.warn("PAYMENT_NOTIFY_URL is not set; payment notification dropped")
            return
        }
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
                signal: AbortSignal.timeout(5_000),
            })
            if (!res.ok) {
                this.logger.error(`Payment notification rejected: HTTP ${res.status}`)
            }
        } catch (error) {
            this.logger.error(`Payment notification failed: ${(error as Error).message}`)
        }
    }
}

function formatCredits(value: number): string {
    return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 6 })
}
