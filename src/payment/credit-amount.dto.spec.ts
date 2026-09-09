// Must be the first thing loaded from `src`: `order.dto` and `order.service` form an
// import cycle that only resolves when entered through `AppModule` (see
// test/integration/helpers/app.ts).
import "src/app.module"
import { plainToInstance } from "class-transformer"
import { validate } from "class-validator"
import { IssueFreeCreditDto, SubscriptionCreditDto, TopUpDto } from "./credit/credit.dto"
import { GrantCreditLineDto, RepayCreditLineDto } from "./credit-line/credit-line.dto"
import { CreateOrderDto, RefundOrderDto } from "./order/order.dto"

/**
 * The request boundary for fractional credit.
 *
 * Every money field used to carry `@IsInt()`. It now accepts up to six decimal
 * places and refuses a seventh: the precise columns are `DECIMAL(18,6)` and the
 * database rounds an overflow instead of rejecting it, so silently accepting
 * `0.0000005` would store `0.000001` and bill something the client never sent.
 */
describe("credit amount validation", () => {
    const failing = async (cls: new () => object, body: object, field: string): Promise<boolean> => {
        const errors = await validate(plainToInstance(cls, body))
        return errors.some((e) => e.property === field)
    }

    const cases: [string, new () => object, string, object][] = [
        ["TopUpDto.amount", TopUpDto, "amount", { amount: 10 }],
        ["IssueFreeCreditDto.amount", IssueFreeCreditDto, "amount", { amount: 1, email: "a@example.com" }],
        [
            "SubscriptionCreditDto.amount",
            SubscriptionCreditDto,
            "amount",
            { amount: 1, issue_date: "2026-01-01", expire_date: "2026-02-01" },
        ],
        ["CreateOrderDto.amount", CreateOrderDto, "amount", { amount: 1 }],
        ["RefundOrderDto.refund_amount", RefundOrderDto, "refund_amount", { order_id: "o", refund_amount: 1 }],
        [
            "GrantCreditLineDto.credit_limit",
            GrantCreditLineDto,
            "credit_limit",
            { email: "a@example.com", credit_limit: 1 },
        ],
        ["RepayCreditLineDto.amount", RepayCreditLineDto, "amount", { widget_tag: "w", amount: 1 }],
    ]

    describe.each(cases)("%s", (_name, cls, field, valid) => {
        const withAmount = (value: number) => ({ ...valid, [field]: value })

        it("accepts six decimal places", async () => {
            expect(await failing(cls, withAmount((valid as Record<string, number>)[field] + 0.123456), field)).toBe(
                false,
            )
        })

        it("rejects a seventh decimal place rather than rounding it", async () => {
            expect(await failing(cls, withAmount((valid as Record<string, number>)[field] + 0.1234567), field)).toBe(
                true,
            )
        })

        it("still rejects a non-number", async () => {
            expect(await failing(cls, { ...valid, [field]: "10" }, field)).toBe(true)
        })
    })

    describe("lower bounds", () => {
        it("keeps the 10 credit top-up minimum", async () => {
            expect(await failing(TopUpDto, { amount: 9.999999 }, "amount")).toBe(true)
            expect(await failing(TopUpDto, { amount: 10.000001 }, "amount")).toBe(false)
        })

        it("lets an order be worth a fraction of a credit", async () => {
            expect(await failing(CreateOrderDto, { amount: 0.000001 }, "amount")).toBe(false)
        })

        it("refunds and repayments must be positive, not at least one", async () => {
            expect(await failing(RefundOrderDto, { order_id: "o", refund_amount: 0.5 }, "refund_amount")).toBe(false)
            expect(await failing(RefundOrderDto, { order_id: "o", refund_amount: 0 }, "refund_amount")).toBe(true)
            expect(await failing(RepayCreditLineDto, { widget_tag: "w", amount: 0.5 }, "amount")).toBe(false)
            expect(await failing(RepayCreditLineDto, { widget_tag: "w", amount: 0 }, "amount")).toBe(true)
        })
    })
})
