import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { describeItest } from "./helpers/itest"
import { seedWorld, USER } from "./helpers/fixtures"

/**
 * Records how this database engine actually behaves, on the real column pair.
 *
 * Old integer columns are kept as `FLOOR` projections of the new `*_precise`
 * ones. `adjustProjected` maintains both in a single statement written so that
 * it does not depend on which way `SET` is evaluated — the projection comes
 * first and repeats the arithmetic, so both assignments read the pre-statement
 * value under either semantics. See `credit-precision.ts` for why.
 *
 * The `SET evaluates left to right` cases below therefore document the engine
 * rather than guard the design. They are still worth keeping: the ordering
 * decides whether the delta would be applied once or twice if someone swapped
 * the two assignments, and the reversed-order control is the evidence that the
 * first assignment reads the old value. Production runs MariaDB while
 * development runs MySQL, so what an engine does here is a fact to be measured,
 * not inherited.
 *
 * The rest — FLOOR's direction, DECIMAL exactness, sub-scale rounding, the
 * declared shape of all eleven columns — is load bearing, and is asserted
 * against the real `users` columns rather than a synthetic table so that the
 * declared types are part of what is being tested.
 *
 * `scripts/mariadb-semantics-probe.sql` is the same set of questions in a form
 * that can be run against production without touching a real row.
 */
describeItest("decimal column semantics", () => {
    beforeAll(cleanupFixtures)
    afterAll(async () => {
        await cleanupFixtures()
        await closeDb()
    })

    /** Puts the fixture user's balance pair at a known starting point. */
    const start = async (whole: number, precise: string) => {
        await cleanupFixtures()
        await seedWorld({ balance: whole })
        await db().$executeRawUnsafe(
            `UPDATE users SET current_credit_balance_precise = ? WHERE username_in_be = ?`,
            precise,
            USER,
        )
    }

    /**
     * `precise` is read through `CAST(... AS CHAR)` so the assertions see the
     * value as the column stores it, trailing zeros and all.
     *
     * Reading the column directly would not: Prisma hands back a decimal.js
     * object, and stringifying that normalises `6.500000` to `6.5`. Useful to
     * know — it is what any JSON response will carry — but it is decimal.js
     * formatting, not evidence about the column's scale, so it is kept separate.
     */
    const balances = async (): Promise<{ whole: number | null; precise: string; asPrismaSeesIt: string }> => {
        const [r] = await db().$queryRaw<{ whole: number | null; precise: string; raw: unknown }[]>`
            SELECT current_credit_balance                        AS whole,
                   CAST(current_credit_balance_precise AS CHAR)  AS precise,
                   current_credit_balance_precise                AS raw
              FROM users WHERE username_in_be = ${USER}`
        return {
            whole: r.whole === null ? null : Number(r.whole),
            precise: r.precise,
            asPrismaSeesIt: String(r.raw),
        }
    }

    it("reports which server this ran against", async () => {
        const [v] = await db().$queryRaw<{ version: string }[]>`SELECT VERSION() AS version`
        // Not an assertion — the flavour is what decides whether the deviation
        // below holds, so it belongs in the output of a run claiming to prove it.
        console.info(`  server: ${v.version}`)
        expect(typeof v.version).toBe("string")
    })

    it("has every precise column the code expects, as DECIMAL(18,6) NOT NULL", async () => {
        // The migration is applied by hand — there is no `prisma/migrations` to
        // diff against. This is what stands in for one: if a column was missed,
        // misspelled, or declared with a different scale on some environment,
        // the failure lands here rather than as a wrong balance in production.
        //
        // `precision` is reserved in MySQL 9, hence the renamed alias.
        const found = await db().$queryRaw<
            { table: string; column: string; type: string; scale: number; digits: number; nullable: string }[]
        >`
            SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`, DATA_TYPE AS type,
                   NUMERIC_SCALE AS scale, NUMERIC_PRECISION AS digits, IS_NULLABLE AS nullable
              FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND COLUMN_NAME LIKE '%\\_precise'
             ORDER BY TABLE_NAME, COLUMN_NAME`

        expect(found.map((c) => `${c.table}.${c.column}`)).toEqual([
            "credit_statements.amount_precise",
            "credit_statements.balance_precise",
            "free_credit_issues.amount_precise",
            "free_credit_issues.balance_precise",
            "orders.amount_precise",
            "orders.credit_paid_amount_precise",
            "orders.free_credit_paid_precise",
            "orders.refunded_amount_precise",
            "users.current_credit_balance_precise",
            "widget_subscription_credit_issues.current_balance_precise",
            "widget_subscription_credit_issues.issue_credits_precise",
        ])

        for (const c of found) {
            const where = `${c.table}.${c.column}`
            expect([where, c.type]).toEqual([where, "decimal"])
            expect([where, Number(c.digits)]).toEqual([where, 18])
            expect([where, Number(c.scale)]).toEqual([where, 6])
            // NOT NULL is what lets the invariant be a single expression: a
            // nullable column would need every comparison split into "backfilled"
            // and "not backfilled" cases.
            expect([where, c.nullable]).toEqual([where, "NO"])
        }
    })

    describe("SET evaluates left to right", () => {
        it("lets a later assignment read what an earlier one just wrote", async () => {
            await start(10, "10.000000")

            await db().$executeRawUnsafe(
                `UPDATE users
                    SET current_credit_balance_precise = current_credit_balance_precise - 3.5,
                        current_credit_balance         = FLOOR(current_credit_balance_precise)
                  WHERE username_in_be = ?`,
                USER,
            )

            const after = await balances()
            expect(after.precise).toBe("6.500000")
            // Left to right: FLOOR sees 6.5. Under the SQL standard it would see
            // the pre-statement 10 and this would still read 10.
            expect(after.whole).toBe(6)
        })

        it("gives a different answer when the assignments are swapped", async () => {
            // The positive control. Without it a `whole` that happened to equal
            // FLOOR(precise) for unrelated reasons would look like a pass.
            await start(10, "10.000000")

            await db().$executeRawUnsafe(
                `UPDATE users
                    SET current_credit_balance         = FLOOR(current_credit_balance_precise),
                        current_credit_balance_precise = current_credit_balance_precise - 3.5
                  WHERE username_in_be = ?`,
                USER,
            )

            const after = await balances()
            expect(after.precise).toBe("6.500000")
            expect(after.whole).toBe(10)
        })
    })

    describe("FLOOR", () => {
        it("rounds toward negative infinity, not toward zero", async () => {
            // Matters wherever a balance may go negative. `FLOOR(-0.5)` is -1,
            // so the integer projection of a small debt reads as a whole one.
            await start(0, "0.000000")

            await db().$executeRawUnsafe(
                `UPDATE users
                    SET current_credit_balance_precise = current_credit_balance_precise - 0.5,
                        current_credit_balance         = FLOOR(current_credit_balance_precise)
                  WHERE username_in_be = ?`,
                USER,
            )

            const after = await balances()
            expect(after.precise).toBe("-0.500000")
            expect(after.whole).toBe(-1)
        })

        it("leaves an exact integer alone", async () => {
            await start(0, "0.000000")

            await db().$executeRawUnsafe(
                `UPDATE users
                    SET current_credit_balance_precise = current_credit_balance_precise + 7,
                        current_credit_balance         = FLOOR(current_credit_balance_precise)
                  WHERE username_in_be = ?`,
                USER,
            )

            const after = await balances()
            expect(after.precise).toBe("7.000000")
            expect(after.whole).toBe(7)
        })
    })

    describe("DECIMAL arithmetic", () => {
        it("is exact where floating point is not", async () => {
            // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754. The reason these
            // columns are DECIMAL and not DOUBLE.
            await start(0, "0.100000")
            await db().$executeRawUnsafe(
                `UPDATE users SET current_credit_balance_precise = current_credit_balance_precise + 0.2
                  WHERE username_in_be = ?`,
                USER,
            )

            expect((await balances()).precise).toBe("0.300000")
        })

        it("accumulates many tiny charges without drift", async () => {
            await start(0, "0.000000")
            for (let i = 0; i < 300; i++) {
                await db().$executeRawUnsafe(
                    `UPDATE users SET current_credit_balance_precise = current_credit_balance_precise + 0.000001
                      WHERE username_in_be = ?`,
                    USER,
                )
            }

            expect((await balances()).precise).toBe("0.000300")
        })

        it("holds the documented range", async () => {
            // DECIMAL(18,6): twelve integer digits, roughly a trillion credits.
            // Not projected onto the INT column here — that would overflow, and
            // the range of the old column is not what this is about.
            await start(0, "999999999999.999999")

            expect((await balances()).precise).toBe("999999999999.999999")
        })
    })

    describe("what Prisma hands back", () => {
        it("drops the trailing zeros the column stores", async () => {
            await start(0, "6.500000")
            const after = await balances()

            // The column keeps its scale; decimal.js does not. Both are correct
            // and they disagree, which is why nothing downstream may compare a
            // precise value as a string.
            expect(after.precise).toBe("6.500000")
            expect(after.asPrismaSeesIt).toBe("6.5")
        })

        it("serialises to a JSON string, not a number", async () => {
            await start(0, "6.500000")
            const user = await db().users.findUnique({ where: { username_in_be: USER } })
            const wire = JSON.parse(
                JSON.stringify({ v: (user as Record<string, unknown>).current_credit_balance_precise }),
            )

            // The regression the whole serialisation section of the plan exists
            // to prevent: a `Decimal` reaching a response body arrives as "6.5".
            expect(wire.v).toBe("6.5")
            expect(typeof wire.v).toBe("string")
        })
    })

    describe("values finer than the scale", () => {
        it("rounds rather than truncates", async () => {
            // Half a micro-credit becomes a whole one. Rounding at the sixth
            // decimal is immaterial to any real amount, but it establishes that
            // the column is not a silent truncator.
            await start(0, "0.000000")
            await db().$executeRawUnsafe(
                `UPDATE users SET current_credit_balance_precise = current_credit_balance_precise + 0.0000005
                  WHERE username_in_be = ?`,
                USER,
            )

            expect((await balances()).precise).toBe("0.000001")
        })

        it("rounds a value below the midpoint down to zero", async () => {
            await start(0, "0.000000")
            await db().$executeRawUnsafe(
                `UPDATE users SET current_credit_balance_precise = current_credit_balance_precise + 0.0000004
                  WHERE username_in_be = ?`,
                USER,
            )

            expect((await balances()).precise).toBe("0.000000")
        })
    })
})
