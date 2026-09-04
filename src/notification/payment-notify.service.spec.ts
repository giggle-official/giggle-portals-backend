import { PaymentNotifyService } from "./payment-notify.service"

describe("PaymentNotifyService", () => {
    const originalEnv = { url: process.env.PAYMENT_NOTIFY_URL, threshold: process.env.LARGE_TOPUP_NOTIFY_THRESHOLD }
    let service: PaymentNotifyService
    let fetchMock: jest.Mock

    beforeEach(() => {
        service = new PaymentNotifyService()
        fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
        global.fetch = fetchMock as unknown as typeof fetch
        process.env.PAYMENT_NOTIFY_URL = "https://chat.example/hooks/abc"
        delete process.env.LARGE_TOPUP_NOTIFY_THRESHOLD
    })

    afterAll(() => {
        if (originalEnv.url === undefined) delete process.env.PAYMENT_NOTIFY_URL
        else process.env.PAYMENT_NOTIFY_URL = originalEnv.url
        if (originalEnv.threshold === undefined) delete process.env.LARGE_TOPUP_NOTIFY_THRESHOLD
        else process.env.LARGE_TOPUP_NOTIFY_THRESHOLD = originalEnv.threshold
    })

    const event = {
        order_id: "order-1",
        email: "big@example.com",
        user: "u1",
        credits: 50_000,
        balance_after: 51_234.5,
        widget_tag: "storyclaw_api_management",
        paid_method: "alipay_global",
    }

    describe("threshold", () => {
        /** "超过 10000": strictly above, so the common 10,000 package itself is quiet. */
        it("defaults to strictly more than 10,000 credits", () => {
            expect(service.isLargeTopUp(10_000)).toBe(false)
            expect(service.isLargeTopUp(10_000.000001)).toBe(true)
            expect(service.isLargeTopUp(50_000_500)).toBe(true)
        })

        it("reads LARGE_TOPUP_NOTIFY_THRESHOLD", () => {
            process.env.LARGE_TOPUP_NOTIFY_THRESHOLD = "500"
            expect(service.isLargeTopUp(600)).toBe(true)
            expect(service.isLargeTopUp(500)).toBe(false)
        })

        it("falls back to the default when the variable is not a number", () => {
            process.env.LARGE_TOPUP_NOTIFY_THRESHOLD = "lots"
            expect(service.largeTopUpThreshold()).toBe(10_000)
        })
    })

    describe("notifyLargeTopUp", () => {
        it("posts a Mattermost message with the who, how much, and where", async () => {
            await service.notifyLargeTopUp(event)

            expect(fetchMock).toHaveBeenCalledTimes(1)
            const [url, init] = fetchMock.mock.calls[0]
            expect(url).toBe("https://chat.example/hooks/abc")
            expect(init.method).toBe("POST")
            const { text } = JSON.parse(init.body)
            expect(text).toContain("50,000 credits")
            expect(text).toContain("big@example.com")
            expect(text).toContain("u1")
            expect(text).toContain("storyclaw_api_management")
            expect(text).toContain("alipay_global")
            expect(text).toContain("order-1")
            expect(text).toContain("51,234.5")
        })

        it("does nothing when PAYMENT_NOTIFY_URL is unset", async () => {
            delete process.env.PAYMENT_NOTIFY_URL

            await service.notifyLargeTopUp(event)

            expect(fetchMock).not.toHaveBeenCalled()
        })

        /** A chat outage must never bubble up into the credit issue it describes. */
        it("swallows a network failure", async () => {
            fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))

            await expect(service.notifyLargeTopUp(event)).resolves.toBeUndefined()
        })

        it("swallows a non-2xx response", async () => {
            fetchMock.mockResolvedValue({ ok: false, status: 500 })

            await expect(service.notifyLargeTopUp(event)).resolves.toBeUndefined()
        })
    })
})
