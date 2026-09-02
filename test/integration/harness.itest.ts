import { cleanupFixtures, closeDb, db, leftoverFixtures, withRivalConnection } from "./helpers/db"
import { describeItest, PREFIX } from "./helpers/itest"
import { seedWorld, USER } from "./helpers/fixtures"

/**
 * Tests the harness itself. If these fail, nothing else in this directory can
 * be believed: a suite that silently talks to no database, or that leaves rows
 * behind for the next suite to inherit, produces green runs that mean nothing.
 */
describeItest("integration harness", () => {
    beforeAll(cleanupFixtures)
    afterAll(async () => {
        await cleanupFixtures()
        await closeDb()
    })

    it("is talking to a real database", async () => {
        const [row] = await db().$queryRaw<{ n: number }[]>`SELECT 1 AS n`
        expect(Number(row.n)).toBe(1)
    })

    it("creates and removes its fixtures completely", async () => {
        await seedWorld()
        expect(await db().users.count({ where: { username_in_be: USER } })).toBe(1)

        await cleanupFixtures()

        expect(Object.values(await leftoverFixtures())).toEqual(Array(11).fill(0))
    })

    it("scopes every fixture under the reserved prefix", async () => {
        await seedWorld()
        const users = await db().users.findMany({ where: { username_in_be: { startsWith: PREFIX } } })
        const widgets = await db().widgets.findMany({ where: { tag: { startsWith: PREFIX } } })

        expect(users.length).toBeGreaterThan(0)
        expect(widgets.length).toBeGreaterThan(0)
        await cleanupFixtures()
    })

    it("can make two connections genuinely contend for the same row", async () => {
        await seedWorld({ balance: 100 })

        // The first transaction takes the row lock, the second asks for the same
        // row while it is held. The contender is started but NOT awaited inside
        // the first transaction — awaiting it there would deadlock by
        // construction, since it cannot proceed until the lock it is waiting on
        // is released by the very transaction doing the awaiting.
        const order: string[] = []
        await withRivalConnection(async (rival) => {
            let contender!: Promise<unknown>

            await db().$transaction(async (tx) => {
                await tx.$queryRaw`SELECT id FROM users WHERE username_in_be = ${USER} FOR UPDATE`
                order.push("first-locked")

                contender = rival
                    .$transaction(
                        async (rtx) => {
                            await rtx.$queryRaw`SELECT id FROM users WHERE username_in_be = ${USER} FOR UPDATE`
                            order.push("second-acquired")
                        },
                        // Long enough to outlast the hold below; the default 5s
                        // would expire while it is legitimately queued.
                        { timeout: 20_000 },
                    )
                    .catch((e) => order.push(`second-failed: ${(e as Error).message}`))

                await new Promise((r) => setTimeout(r, 300))
                order.push("first-releasing")
            })

            await contender
        })

        // The rival must not have got in while the first transaction held the lock.
        expect(order).toEqual(["first-locked", "first-releasing", "second-acquired"])

        await cleanupFixtures()
    })
})
