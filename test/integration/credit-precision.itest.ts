import { Prisma } from "@prisma/client"
import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { describeItest } from "./helpers/itest"
import { seedWorld, USER, WIDGET } from "./helpers/fixtures"
import {
    PROJECTED,
    adjustProjected,
    assertProjection,
    projectedValues,
} from "../../src/payment/credit/credit-precision"

/**
 * Tests the write primitive, on a real database, against the invariant it
 * exists to guarantee:
 *
 *     COALESCE(<whole>, 0) = FLOOR(<precise>)
 *
 * Every assertion here checks both columns. Checking only the precise one would
 * pass even if the projection stopped being maintained, which is the single
 * failure this design has to make impossible.
 */
describeItest("credit write primitive", () => {
    beforeAll(cleanupFixtures)
    afterAll(async () => {
        await cleanupFixtures()
        await closeDb()
    })

    /** Both columns as the row actually holds them, precise read at full scale. */
    const balance = async (): Promise<{ whole: number | null; precise: string }> => {
        const [r] = await db().$queryRaw<{ whole: number | null; precise: string }[]>`
            SELECT current_credit_balance                       AS whole,
                   CAST(current_credit_balance_precise AS CHAR) AS precise
              FROM users WHERE username_in_be = ${USER}`
        return { whole: r.whole === null ? null : Number(r.whole), precise: r.precise }
    }

    const start = async (whole: number) => {
        await cleanupFixtures()
        await seedWorld({ balance: whole })
        await db().$executeRawUnsafe(
            `UPDATE users SET current_credit_balance_precise = ? WHERE username_in_be = ?`,
            String(whole),
            USER,
        )
    }

    describe("adjustProjected", () => {
        it("keeps the integer column as the floor of the precise one", async () => {
            await start(10)

            const after = await adjustProjected(db(), PROJECTED.userBalance, USER, "-3.5")

            expect(after.precise.toFixed(6)).toBe("6.500000")
            expect(after.whole).toBe(6)
            expect(await balance()).toEqual({ whole: 6, precise: "6.500000" })
        })

        it("returns what the row now holds, not what arithmetic would predict", async () => {
            // 10 - 3.5 is 6.5, and the caller might reasonably expect the integer
            // column to read 7 by rounding or 10 by staying put. It reads 6,
            // because FLOOR is what the projection is defined as.
            await start(10)

            const after = await adjustProjected(db(), PROJECTED.userBalance, USER, "-3.5")

            expect(after.whole).toBe(6)
        })

        it("accepts a Decimal, a number and a string alike", async () => {
            await start(0)

            await adjustProjected(db(), PROJECTED.userBalance, USER, new Prisma.Decimal("0.25"))
            await adjustProjected(db(), PROJECTED.userBalance, USER, 0.25)
            await adjustProjected(db(), PROJECTED.userBalance, USER, "0.25")

            expect(await balance()).toEqual({ whole: 0, precise: "0.750000" })
        })

        it("does not lose exactness on a value a double cannot represent", async () => {
            // 0.07 is not representable in IEEE 754. Bound as a number rather
            // than a decimal string it arrives as 0.070000000000000007, and the
            // hundredth charge lands a millionth off.
            await start(0)
            for (let i = 0; i < 100; i++) {
                await adjustProjected(db(), PROJECTED.userBalance, USER, 0.07)
            }

            expect(await balance()).toEqual({ whole: 7, precise: "7.000000" })
        })

        it("crosses an integer boundary without the projection lagging", async () => {
            await start(1)

            // 1 -> 0.4: the whole column has to fall to 0 even though only a
            // fraction was spent.
            await adjustProjected(db(), PROJECTED.userBalance, USER, "-0.6")
            expect(await balance()).toEqual({ whole: 0, precise: "0.400000" })

            // 0.4 -> 1.4: and climb back to 1 on a fractional credit.
            await adjustProjected(db(), PROJECTED.userBalance, USER, "1.0")
            expect(await balance()).toEqual({ whole: 1, precise: "1.400000" })
        })

        it("projects a small debt to a whole negative one", async () => {
            // FLOOR, not truncation. A user 0.5 in the red reads as -1 to every
            // caller still looking at the integer column, which is the
            // conservative direction for a balance check.
            await start(0)

            const after = await adjustProjected(db(), PROJECTED.userBalance, USER, "-0.5")

            expect(after.whole).toBe(-1)
            expect(await balance()).toEqual({ whole: -1, precise: "-0.500000" })
        })

        it("writes a non-null integer even when the column started null", async () => {
            // `current_credit_balance` is nullable and some rows predate any
            // balance being set. Prisma's `{ increment }` on a NULL column
            // evaluates NULL + n = NULL and quietly leaves it null; the
            // projection assigns FLOOR of the precise value, so it does not.
            await cleanupFixtures()
            await seedWorld()
            await db().$executeRawUnsafe(
                `UPDATE users SET current_credit_balance = NULL, current_credit_balance_precise = 0
                  WHERE username_in_be = ?`,
                USER,
            )
            expect((await balance()).whole).toBeNull()

            await adjustProjected(db(), PROJECTED.userBalance, USER, "5")

            expect(await balance()).toEqual({ whole: 5, precise: "5.000000" })
        })

        it("throws rather than silently doing nothing when the row is absent", async () => {
            await start(0)

            await expect(adjustProjected(db(), PROJECTED.userBalance, "no_such_user", "1")).rejects.toThrow(
                /no users row/,
            )
        })

        it("maintains the invariant across a long run of fractional charges", async () => {
            await start(100)

            const charges = ["0.001", "0.37", "2.5", "0.000001", "11.999999", "0.5", "0.5"]
            for (const c of charges) {
                const after = await adjustProjected(db(), PROJECTED.userBalance, USER, `-${c}`)
                // Asserted every step, not only at the end: a projection that
                // drifts and then happens to realign would pass a final check.
                expect(after.whole).toBe(Math.floor(after.precise.toNumber()))
            }

            // 15.871 spent in seven charges, none of them representable as a
            // double, and the balance is exact to the last micro-credit.
            expect(await balance()).toEqual({ whole: 84, precise: "84.129000" })
        })
    })

    describe("every projected pair", () => {
        it("is adjustable and stays consistent", async () => {
            // Walks the registry rather than naming the tables again, so a pair
            // added later is covered here the moment it is declared.
            await cleanupFixtures()
            await seedWorld({ balance: 0 })

            const free = await db().free_credit_issues.create({
                data: { user: USER, amount: 0, balance: 0 } as never,
            })
            const sub = await db().widget_subscription_credit_issues.create({
                data: {
                    user_id: USER,
                    widget_tag: WIDGET,
                    subscription_id: "zz_itest_sub",
                    issue_credits: 0,
                    current_balance: 0,
                } as never,
            })
            const order = await db().orders.create({
                data: {
                    order_id: "zz_itest_precision_o1",
                    owner: USER,
                    amount: 0,
                    current_status: "pending",
                    costs_allocation: [],
                } as never,
            })

            const keys: Record<string, string | number> = {
                userBalance: USER,
                freeCreditBalance: free.id,
                subscriptionBalance: sub.id,
                orderRefunded: order.order_id,
            }

            for (const [name, pair] of Object.entries(PROJECTED)) {
                const after = await adjustProjected(db(), pair, keys[name], "1.75")

                expect([name, after.precise.toFixed(6)]).toEqual([name, "1.750000"])
                expect([name, after.whole]).toEqual([name, 1])
            }
        })
    })

    describe("assertProjection", () => {
        // The runtime guard that stands in for the write probe we cannot run
        // against production. MySQL cannot be made to compute the projection
        // wrongly on demand, so what is tested here is the guard's own
        // judgement: it has to accept every shape a correct row can take and
        // reject a drifted one.
        const at = (whole: number, precise: string) => () =>
            assertProjection({ whole, precise: new Prisma.Decimal(precise) }, "t.whole", "id = 1")

        it("accepts an exact integer", () => {
            expect(at(7, "7.000000")).not.toThrow()
        })

        it("accepts a fraction floored down", () => {
            expect(at(6, "6.999999")).not.toThrow()
        })

        it("accepts a negative floored away from zero", () => {
            expect(at(-1, "-0.000001")).not.toThrow()
        })

        it("rejects a value that was rounded instead of floored", () => {
            // The likeliest way for this to be wrong in practice: something
            // reimplements the projection with ROUND, and every balance ending
            // above .5 reads one credit too high.
            expect(at(7, "6.999999")).toThrow(/projection broken/)
        })

        it("rejects a value that was truncated instead of floored", () => {
            // Math.trunc on a negative gives 0 where FLOOR gives -1.
            expect(at(0, "-0.5")).toThrow(/projection broken/)
        })

        it("rejects an integer column left at its pre-update value", () => {
            // Exactly what a right-to-left engine, or a lost second assignment,
            // would leave behind.
            expect(at(10, "6.5")).toThrow(/projection broken/)
        })

        it("names the column, both values and the row in the message", () => {
            expect(at(10, "6.5")).toThrow(/t\.whole is 10 but FLOOR\(precise\) is 6.*precise = 6\.500000.*id = 1/)
        })
    })

    describe("projectedValues", () => {
        it("produces both columns from one expression", () => {
            expect(projectedValues("amount", "12.5")).toEqual({
                amount: 12,
                amount_precise: new Prisma.Decimal("12.5"),
            })
        })

        it("floors a negative fraction the same way the SQL does", () => {
            // Consumption is stored as a negative amount, so this is the common
            // case, not an edge one. `Math.trunc` here would disagree with
            // `adjustProjected` and break the invariant on inserted rows.
            expect(projectedValues("amount", "-0.5").amount).toBe(-1)
        })

        it("survives a round trip through the database at full scale", async () => {
            await cleanupFixtures()
            await seedWorld()

            await db().credit_statements.create({
                data: { user: USER, ...projectedValues("amount", "-0.123456") } as never,
            })

            const [row] = await db().$queryRaw<{ amount: number; precise: string }[]>`
                SELECT amount, CAST(amount_precise AS CHAR) AS precise
                  FROM credit_statements WHERE user = ${USER}`

            expect({ amount: Number(row.amount), precise: row.precise }).toEqual({
                amount: -1,
                precise: "-0.123456",
            })
        })
    })
})
