// `order.dto` sits in an import cycle that runs through these three modules and
// back into `order.service`, whose class body reads `PaymentMethod` while the
// enum is still half-built. Mocking them cuts the cycle before it closes; the
// same list is what the other order specs use.
jest.mock("src/payment/rewards-pool/rewards-pool.service")
jest.mock("src/user/user.service")
jest.mock("src/web3/giggle/giggle.service")

import { PaymentMethod } from "src/payment/order/order.dto"
import { RewardPoolOnChainService } from "./reward-pool-on-chain.service"

/**
 * `createBuyBackOrders` sends real money on chain. Buying back against credit
 * the user has not repaid would spend the platform's own funds, so credit line
 * orders must never be picked up.
 *
 * The filter is spelled out as an OR rather than the obvious
 * `paid_method: { not: CREDIT_LINE }` because Prisma's `not` does not match
 * NULL: the obvious form would silently drop every order whose paid_method was
 * never recorded, turning a defensive filter into a way to stop buying back
 * most of the table. That is the failure these tests exist for.
 */
describe("RewardPoolOnChainService - buyback excludes credit line orders", () => {
    let service: RewardPoolOnChainService
    let prisma: any
    const originalTaskSlot = process.env.TASK_SLOT
    const originalUpdating = process.env.SC_UPDATING

    beforeEach(() => {
        process.env.TASK_SLOT = "1"
        delete process.env.SC_UPDATING

        prisma = {
            orders: { findMany: jest.fn().mockResolvedValue([]) },
            // No admin user means the cron stops right after the query, which is
            // all these tests need to see.
            users: { findFirst: jest.fn().mockResolvedValue(null) },
        }

        // Built without running the constructor, which demands four wallet env
        // vars and opens an https agent for a chain RPC this test never calls.
        // `createBuyBackOrders` reads nothing but prisma before the query under
        // test, so the rest can stay unset.
        service = Object.assign(Object.create(RewardPoolOnChainService.prototype), {
            prisma,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        })
    })

    afterEach(() => {
        process.env.TASK_SLOT = originalTaskSlot
        if (originalUpdating === undefined) delete process.env.SC_UPDATING
        else process.env.SC_UPDATING = originalUpdating
    })

    const capturedWhere = () => prisma.orders.findMany.mock.calls[0][0].where

    it("filters credit line orders out of the buyback query", async () => {
        await service.createBuyBackOrders()

        expect(JSON.stringify(capturedWhere())).toContain(PaymentMethod.CREDIT_LINE)
    })

    it("keeps orders with no recorded payment method in scope", async () => {
        await service.createBuyBackOrders()

        // Both branches must be present. `{ not: CREDIT_LINE }` on its own would
        // exclude NULL rows; the explicit `{ paid_method: null }` branch is what
        // lets legacy orders through.
        expect(capturedWhere().OR).toEqual(
            expect.arrayContaining([
                { paid_method: null },
                { paid_method: { not: PaymentMethod.CREDIT_LINE } },
            ]),
        )
    })

    it("does not put the exclusion at the top level, where it would drop NULL rows", async () => {
        await service.createBuyBackOrders()

        expect(capturedWhere().paid_method).toBeUndefined()
    })

    it("leaves the pre-existing buyback conditions alone", async () => {
        await service.createBuyBackOrders()

        const where = capturedWhere()
        expect(where.buyback_after_paid).toBe(true)
        expect(where.buyback_order_id).toBeNull()
    })
})
