import { BadRequestException } from "@nestjs/common"
import { Test, TestingModule } from "@nestjs/testing"
import { credit_line_statement_type, credit_line_status, user_credit_lines } from "@prisma/client"

// Mock the whole dependency chain before importing the service. `credit.service`
// pulls in `order.dto`, which is part of an import cycle with `order.service`;
// mocking `user.service` is what keeps that cycle from being evaluated here.
jest.mock("../../common/prisma.service")
jest.mock("../credit/credit.service")
jest.mock("../../casl/casl-ability.factory/widget-casl-ability.factory")
jest.mock("../../user/user.service")
jest.mock("../order/order.service")
jest.mock("../../notification/notification.service")
jest.mock("../settle/settle.service")

import { WidgetCaslAbilityFactory } from "../../casl/casl-ability.factory/widget-casl-ability.factory"
import { PrismaService } from "../../common/prisma.service"
import { CreditService } from "../credit/credit.service"
import { CreditLineService } from "./credit-line.service"

describe("CreditLineService", () => {
    let service: CreditLineService
    let prisma: any
    let credit: any

    const activeLine: user_credit_lines = {
        id: 7,
        user: "test_user_123",
        widget_tag: "test_widget",
        credit_limit: 1000,
        used: 200,
        status: credit_line_status.active,
        note: null,
        operator: "test_widget",
        created_at: new Date(),
        updated_at: new Date(),
    }

    let mockTx: any

    beforeEach(async () => {
        mockTx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            user_credit_lines: {
                findUnique: jest.fn().mockResolvedValue(activeLine),
                update: jest.fn(),
                upsert: jest.fn(),
            },
            credit_line_statements: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
            },
        }

        const module: TestingModule = await Test.createTestingModule({
            providers: [CreditLineService, PrismaService, CreditService, WidgetCaslAbilityFactory],
        }).compile()

        service = module.get<CreditLineService>(CreditLineService)
        prisma = module.get(PrismaService) as any
        credit = module.get(CreditService) as any

        prisma.$transaction = jest.fn((cb: any) => cb(mockTx))
        prisma.users = { findUnique: jest.fn().mockResolvedValue({ username_in_be: "test_user_123" }) }
        credit.getRepayableBalance = jest.fn().mockResolvedValue(1000)
        credit.spendForCreditLineRepayment = jest.fn().mockResolvedValue(undefined)
    })

    /** The `used` the line is left with after the primitive under test ran. */
    const usedAfter = () => mockTx.credit_line_statements.create.mock.calls[0][0].data.used_after

    const givenLine = (overrides: Partial<user_credit_lines> | null) => {
        const line = overrides === null ? null : { ...activeLine, ...overrides }
        mockTx.user_credit_lines.findUnique.mockResolvedValue(line)
        if (line) {
            mockTx.user_credit_lines.update.mockImplementation(({ data }: any) =>
                Promise.resolve({ ...line, used: line.used + data.used.increment }),
            )
        }
        return line
    }

    beforeEach(() => givenLine({}))

    describe("available", () => {
        it("is limit minus used", () => {
            expect(service.available({ ...activeLine, credit_limit: 1000, used: 200 })).toBe(800)
        })

        it("is 0 when there is no line", () => {
            expect(service.available(null)).toBe(0)
        })

        it("is 0 while frozen, so a frozen line cannot be spent", () => {
            expect(service.available({ ...activeLine, status: credit_line_status.frozen })).toBe(0)
        })

        it("clamps to 0 when the limit was lowered below the debt, never leaking a negative", () => {
            expect(service.available({ ...activeLine, credit_limit: 100, used: 500 })).toBe(0)
        })
    })

    describe("charge", () => {
        it("raises the debt and records it, with a negative amount", async () => {
            await service.charge(mockTx, "test_user_123", "test_widget", 300, "order_1")

            expect(mockTx.user_credit_lines.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { used: { increment: 300 } } }),
            )
            expect(mockTx.credit_line_statements.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    user: "test_user_123",
                    widget_tag: "test_widget",
                    type: credit_line_statement_type.consume,
                    amount: -300,
                    used_after: 500,
                    order_id: "order_1",
                    request_id: null,
                }),
            })
        })

        it("locks the line row before touching it", async () => {
            await service.charge(mockTx, "test_user_123", "test_widget", 300, "order_1")

            expect(mockTx.$queryRaw).toHaveBeenCalled()
            const lockSql = mockTx.$queryRaw.mock.calls[0][0].join("?")
            expect(lockSql).toContain("FOR UPDATE")
        })

        it("refuses to spend more than is available", async () => {
            givenLine({ credit_limit: 1000, used: 900 })

            await expect(service.charge(mockTx, "test_user_123", "test_widget", 200, "order_1")).rejects.toThrow(
                BadRequestException,
            )
            expect(mockTx.user_credit_lines.update).not.toHaveBeenCalled()
        })

        it("refuses when the line is frozen", async () => {
            givenLine({ status: credit_line_status.frozen })

            await expect(service.charge(mockTx, "test_user_123", "test_widget", 10, "order_1")).rejects.toThrow(
                BadRequestException,
            )
        })

        it("refuses when the widget never granted a line", async () => {
            givenLine(null)

            await expect(service.charge(mockTx, "test_user_123", "test_widget", 10, "order_1")).rejects.toThrow(
                BadRequestException,
            )
        })
    })

    describe("repay", () => {
        it("lowers the debt but keeps the amount negative, so the report can add it straight on", async () => {
            await service.repay(mockTx, "test_user_123", "test_widget", 200, "req_1")

            expect(mockTx.user_credit_lines.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { used: { increment: -200 } } }),
            )
            expect(mockTx.credit_line_statements.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    type: credit_line_statement_type.repay,
                    amount: -200,
                    used_after: 0,
                    order_id: null,
                    request_id: "req_1",
                }),
            })
        })

        it("rejects a replayed request id instead of charging twice", async () => {
            mockTx.credit_line_statements.findFirst.mockResolvedValue({ id: 1 })

            await expect(service.repay(mockTx, "test_user_123", "test_widget", 200, "req_1")).rejects.toThrow(
                BadRequestException,
            )
            expect(mockTx.user_credit_lines.update).not.toHaveBeenCalled()
        })

        it("dedupes on (user, widget, request_id), not on the request id alone", async () => {
            await service.repay(mockTx, "test_user_123", "test_widget", 200, "req_1")

            expect(mockTx.credit_line_statements.findFirst).toHaveBeenCalledWith({
                where: {
                    user: "test_user_123",
                    widget_tag: "test_widget",
                    type: credit_line_statement_type.repay,
                    request_id: "req_1",
                },
            })
        })

        it("still works when the limit was lowered below the debt", async () => {
            // The trap this guards: any limit check on the repay path would lock a
            // user out of paying off a debt they can no longer borrow against.
            givenLine({ credit_limit: 100, used: 500 })

            await service.repay(mockTx, "test_user_123", "test_widget", 500, "req_1")

            expect(usedAfter()).toBe(0)
        })
    })

    describe("refund", () => {
        it("lowers the debt with a positive amount and leaves the credit balance alone", async () => {
            await service.refund(mockTx, "test_user_123", "test_widget", 150, "order_1")

            expect(mockTx.credit_line_statements.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    type: credit_line_statement_type.refund,
                    amount: 150,
                    used_after: 50,
                    order_id: "order_1",
                }),
            })
        })

        it("lets the debt go negative, which is an overpayment the user can spend again", async () => {
            givenLine({ used: 0 })

            await service.refund(mockTx, "test_user_123", "test_widget", 100, "order_1")

            expect(usedAfter()).toBe(-100)
            expect(service.available({ ...activeLine, used: -100 })).toBe(1100)
        })
    })

    describe("repayCreditLine", () => {
        const user = { usernameShorted: "test_user_123", developer_info: null } as any

        it("spends real credit and lowers the debt, in that order", async () => {
            givenLine({ used: 500 })

            const result = await service.repayCreditLine({ widget_tag: "test_widget" }, user)

            expect(credit.spendForCreditLineRepayment).toHaveBeenCalledWith(mockTx, "test_user_123", 500)
            expect(mockTx.user_credit_lines.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { used: { increment: -500 } } }),
            )
            expect(result).toEqual({
                repaid: 500,
                credit_line_used: 0,
                credit_line_available: 1000,
                credit_balance: 500,
            })
        })

        it("locks the user row before the credit line row", async () => {
            givenLine({ used: 100 })

            await service.repayCreditLine({ widget_tag: "test_widget" }, user)

            const locks = mockTx.$queryRaw.mock.calls.map((c: any[]) => c[0].join("?"))
            expect(locks[0]).toContain("FROM users")
            expect(locks[1]).toContain("FROM user_credit_lines")
        })

        it("repays only what is owed when asked for more", async () => {
            givenLine({ used: 300 })

            const result = await service.repayCreditLine({ widget_tag: "test_widget", amount: 999999 }, user)

            expect(result.repaid).toBe(300)
            expect(credit.spendForCreditLineRepayment).toHaveBeenCalledWith(mockTx, "test_user_123", 300)
        })

        it("repays only what is affordable when the balance is short", async () => {
            givenLine({ used: 900 })
            credit.getRepayableBalance.mockResolvedValue(400)

            const result = await service.repayCreditLine({ widget_tag: "test_widget" }, user)

            expect(result).toMatchObject({ repaid: 400, credit_line_used: 500, credit_balance: 0 })
        })

        it("repays nothing, without erroring, when nothing is owed", async () => {
            givenLine({ used: 0 })

            const result = await service.repayCreditLine({ widget_tag: "test_widget" }, user)

            expect(result.repaid).toBe(0)
            expect(credit.spendForCreditLineRepayment).not.toHaveBeenCalled()
            expect(mockTx.user_credit_lines.update).not.toHaveBeenCalled()
        })

        it("repays nothing when the balance is all free credit", async () => {
            givenLine({ used: 500 })
            credit.getRepayableBalance.mockResolvedValue(0)

            const result = await service.repayCreditLine({ widget_tag: "test_widget" }, user)

            expect(result.repaid).toBe(0)
            expect(credit.spendForCreditLineRepayment).not.toHaveBeenCalled()
        })

        it("rejects a replayed request id even once the debt is already clear", async () => {
            // The reason the duplicate check runs before the nothing-to-repay
            // shortcut: otherwise a replay would report success.
            givenLine({ used: 0 })
            mockTx.credit_line_statements.findFirst.mockResolvedValue({ id: 1 })

            await expect(
                service.repayCreditLine({ widget_tag: "test_widget", request_id: "r1" }, user),
            ).rejects.toThrow(BadRequestException)
            expect(credit.spendForCreditLineRepayment).not.toHaveBeenCalled()
        })

        it("generates a request id when the caller omits one", async () => {
            givenLine({ used: 100 })

            await service.repayCreditLine({ widget_tag: "test_widget" }, user)

            const written = mockTx.credit_line_statements.create.mock.calls[0][0].data
            expect(typeof written.request_id).toBe("string")
            expect(written.request_id.length).toBeGreaterThan(0)
        })

        it("never consults credit_limit, so a revoked line can still be repaid", async () => {
            givenLine({ credit_limit: 0, used: 500 })

            const result = await service.repayCreditLine({ widget_tag: "test_widget" }, user)

            expect(result).toMatchObject({ repaid: 500, credit_line_used: 0, credit_line_available: 0 })
        })

        it("requires a user token to name the widget", async () => {
            await expect(service.repayCreditLine({}, user)).rejects.toThrow("widget_tag is required")
        })

        it("makes a widget token repay its own line, ignoring the body's widget_tag", async () => {
            givenLine({ used: 100 })
            const abilities = { can: jest.fn().mockReturnValue(true) }
            ;(service as any).widgetCaslAbilityFactory.createForWidget = jest.fn().mockResolvedValue(abilities)
            const widgetCaller = {
                usernameShorted: "dev",
                developer_info: { usernameShorted: "dev", tag: "test_widget" },
            } as any

            await service.repayCreditLine(
                { email: "target@example.com", widget_tag: "someone_elses_widget" },
                widgetCaller,
            )

            expect(prisma.users.findUnique).toHaveBeenCalledWith({ where: { email: "target@example.com" } })
            const locked = mockTx.$queryRaw.mock.calls[1][0].join("?")
            expect(locked).toContain("FROM user_credit_lines")
            expect(mockTx.$queryRaw.mock.calls[1]).toContain("test_widget")
        })

        it("refuses a widget without the permission bit", async () => {
            const abilities = { can: jest.fn().mockReturnValue(false) }
            ;(service as any).widgetCaslAbilityFactory.createForWidget = jest.fn().mockResolvedValue(abilities)

            await expect(
                service.repayCreditLine({ email: "target@example.com" }, {
                    usernameShorted: "dev",
                    developer_info: { usernameShorted: "dev", tag: "test_widget" },
                } as any),
            ).rejects.toThrow("not allowed")
        })

        it("requires a widget to name the user", async () => {
            const abilities = { can: jest.fn().mockReturnValue(true) }
            ;(service as any).widgetCaslAbilityFactory.createForWidget = jest.fn().mockResolvedValue(abilities)

            await expect(
                service.repayCreditLine({}, {
                    usernameShorted: "dev",
                    developer_info: { usernameShorted: "dev", tag: "test_widget" },
                } as any),
            ).rejects.toThrow("email is required")
        })
    })

    describe("amount validation", () => {
        it.each([
            ["charge", (amount: number) => service.charge(mockTx, "u", "w", amount, "order_1")],
            ["repay", (amount: number) => service.repay(mockTx, "u", "w", amount, "req_1")],
            ["refund", (amount: number) => service.refund(mockTx, "u", "w", amount, "order_1")],
        ])("%s rejects zero, negative and fractional amounts", async (_name, call) => {
            await expect(call(0)).rejects.toThrow(BadRequestException)
            await expect(call(-1)).rejects.toThrow(BadRequestException)
            await expect(call(1.5)).rejects.toThrow(BadRequestException)
        })
    })

    describe("setLimit", () => {
        it("sets an absolute limit, so a retried grant is idempotent", async () => {
            mockTx.user_credit_lines.upsert.mockResolvedValue({ ...activeLine, credit_limit: 500 })

            await service.setLimit(mockTx, "test_user_123", "test_widget", 500, { operator: "test_widget" })

            const call = mockTx.user_credit_lines.upsert.mock.calls[0][0]
            expect(call.update.credit_limit).toBe(500)
            expect(call.create.credit_limit).toBe(500)
        })

        it("allows a limit below the current debt, which is how borrowing is switched off", async () => {
            givenLine({ used: 500 })
            mockTx.user_credit_lines.upsert.mockResolvedValue({ ...activeLine, credit_limit: 100, used: 500 })

            const line = await service.setLimit(mockTx, "test_user_123", "test_widget", 100)

            expect(service.available(line)).toBe(0)
        })

        it("rejects a negative limit", async () => {
            await expect(service.setLimit(mockTx, "test_user_123", "test_widget", -1)).rejects.toThrow(
                BadRequestException,
            )
        })
    })
})
