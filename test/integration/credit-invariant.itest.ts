import { cleanupFixtures, closeDb, db } from "./helpers/db"
import { describeItest, PREFIX } from "./helpers/itest"
import { seedWorld, USER } from "./helpers/fixtures"
import { PAIR_COUNT, findBreaches } from "../../scripts/check-credit-invariant"

/**
 * Tests the invariant checker, not the invariant.
 *
 * A checker that reports "all consistent" is only worth running if it would say
 * something else when a column pair drifts apart. That is not self-evident: a
 * predicate with a subtly wrong COALESCE, or a pair silently dropped from its
 * list, produces a permanently green check over a broken database — the most
 * expensive possible failure, because it is indistinguishable from safety.
 *
 * So each case plants a specific breach and requires the checker to find it.
 */
describeItest("credit invariant checker", () => {
    // Scoped to fixture rows, so a breach elsewhere in a developer's database
    // cannot make these pass or fail for the wrong reason.
    const MINE = `${PREFIX}%`

    beforeAll(cleanupFixtures)
    afterAll(async () => {
        await cleanupFixtures()
        await closeDb()
    })

    beforeEach(async () => {
        await cleanupFixtures()
        await seedWorld({ balance: 100 })
    })

    it("watches every column pair", () => {
        expect(PAIR_COUNT).toBe(11)
    })

    it("says nothing when the fixtures are consistent", async () => {
        await db().credit_statements.create({
            data: { user: USER, amount: -5, amount_precise: -5, balance: 95, balance_precise: 95 } as never,
        })

        expect(await findBreaches(db(), MINE)).toEqual([])
    })

    it("catches an integer column moved without its precise sibling", async () => {
        // The realistic regression: someone reaches for Prisma's `{ decrement }`
        // on the old column, which is exactly what the codebase used to do
        // everywhere and what still compiles.
        await db().credit_statements.create({
            data: { user: USER, amount: -5, amount_precise: -5, balance: 95, balance_precise: 95 } as never,
        })
        await db().$executeRawUnsafe(`UPDATE credit_statements SET balance = 90 WHERE user = ?`, USER)

        const breaches = await findBreaches(db(), MINE)

        expect(breaches.map((b) => b.pair)).toEqual(["credit_statements.balance"])
        expect(breaches[0].offenders).toBe(1)
        expect(breaches[0].sample[0]).toMatchObject({ whole: 90, precise: "95.000000" })
    })

    it("catches a precise column moved without its integer sibling", async () => {
        await db().credit_statements.create({
            data: { user: USER, amount: -5, amount_precise: -5, balance: 95, balance_precise: 95 } as never,
        })
        await db().$executeRawUnsafe(`UPDATE credit_statements SET balance_precise = 90.5 WHERE user = ?`, USER)

        const breaches = await findBreaches(db(), MINE)

        expect(breaches.map((b) => b.pair)).toEqual(["credit_statements.balance"])
    })

    it("does not mistake a legitimate fraction for a breach", async () => {
        // 95.7 floors to 95. This is the whole point of the design and must not
        // be reported: a checker that flags every fractional balance is one
        // nobody will keep running.
        await db().credit_statements.create({
            data: { user: USER, amount: -5, amount_precise: -5, balance: 95, balance_precise: "95.7" } as never,
        })

        expect(await findBreaches(db(), MINE)).toEqual([])
    })

    it("treats a null integer column as consistent only against zero", async () => {
        // Nullable old columns predate any value being written. NULL reads as 0,
        // so it is consistent with a precise 0 and with nothing else.
        await db().credit_statements.create({
            data: { user: USER, amount: null, amount_precise: 0, balance: null, balance_precise: 0 } as never,
        })
        expect(await findBreaches(db(), MINE)).toEqual([])

        await db().$executeRawUnsafe(`UPDATE credit_statements SET amount_precise = 3 WHERE user = ?`, USER)

        expect((await findBreaches(db(), MINE)).map((b) => b.pair)).toEqual(["credit_statements.amount"])
    })

    it("reports every breached pair, not just the first", async () => {
        await db().credit_statements.create({
            data: { user: USER, amount: -5, amount_precise: -5, balance: 95, balance_precise: 95 } as never,
        })
        await db().$executeRawUnsafe(`UPDATE credit_statements SET amount = 0, balance = 0 WHERE user = ?`, USER)

        expect((await findBreaches(db(), MINE)).map((b) => b.pair)).toEqual([
            "credit_statements.amount",
            "credit_statements.balance",
        ])
    })

    it("counts every offending row and samples at most five", async () => {
        for (let i = 0; i < 7; i++) {
            await db().credit_statements.create({
                data: { user: USER, amount: -1, amount_precise: -1, balance: 1, balance_precise: 1 } as never,
            })
        }
        await db().$executeRawUnsafe(`UPDATE credit_statements SET balance = 99 WHERE user = ?`, USER)

        const [breach] = await findBreaches(db(), MINE)

        expect(breach.offenders).toBe(7)
        expect(breach.sample).toHaveLength(5)
    })
})
