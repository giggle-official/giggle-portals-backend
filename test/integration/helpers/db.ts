import { PrismaClient } from "@prisma/client"
import { PREFIX } from "./itest"

let client: PrismaClient | null = null

/** One client for the whole run. A second connection is only opened deliberately, by `withRivalConnection`. */
export const db = (): PrismaClient => (client ??= new PrismaClient())

export async function closeDb(): Promise<void> {
    await client?.$disconnect()
    client = null
}

/**
 * Opens a second, independent connection so a test can make two transactions
 * genuinely race. `db().$transaction` twice would not: those share one
 * connection and serialise, which silently turns a concurrency test into a
 * sequential one that always passes.
 */
export async function withRivalConnection<T>(fn: (rival: PrismaClient) => Promise<T>): Promise<T> {
    const rival = new PrismaClient()
    try {
        return await fn(rival)
    } finally {
        await rival.$disconnect()
    }
}

/**
 * Deletes everything the fixtures could have created, children before parents.
 *
 * Runs before as well as after a suite: a previous run killed mid-way leaves
 * rows behind, and inheriting them silently is how a test starts passing for
 * the wrong reason.
 */
export async function cleanupFixtures(): Promise<void> {
    const p = db()
    const user = { startsWith: PREFIX }
    const tag = { startsWith: PREFIX }

    await p.credit_line_statements.deleteMany({ where: { user } })
    await p.user_credit_lines.deleteMany({ where: { user } })
    await p.credit_statements.deleteMany({ where: { user } })
    await p.free_credit_issues.deleteMany({ where: { user } })
    await p.widget_subscription_credit_issues.deleteMany({ where: { user_id: user } })
    await p.widget_subscriptions.deleteMany({ where: { user_id: user } })
    await p.orders.deleteMany({ where: { owner: user } })
    await p.widget_sessions.deleteMany({ where: { user: user } })
    await p.app_bind_ips.deleteMany({ where: { app_id: { startsWith: PREFIX } } })
    await p.widgets.deleteMany({ where: { tag } })
    await p.users.deleteMany({ where: { username_in_be: user } })
}

/**
 * Waits until a `new Date()` taken now would be strictly past every fixture
 * row's stored timestamp, in every table the reports window on.
 *
 * `created_at` columns are `TIMESTAMP(0)`, and MySQL **rounds** fractional
 * seconds rather than truncating them: a row written at 11:52:22.9 is stored as
 * 11:52:23, up to half a second in the future. The reports filter with
 * `created_at < now` where `now` is a `new Date()` from the Node process — so a
 * freshly written row can be excluded purely because of when in the second it
 * landed, and the daily and monthly figures drop to zero while the totals, which
 * have no upper bound, stay right.
 *
 * Two things this has to get right, both learned the hard way:
 *
 * The comparison is made in exactly the terms the report makes it — a JS `Date`
 * bound as a parameter, against the stored column. An earlier version compared
 * MySQL's own `NOW()` instead, which is a different clock than the one the
 * filter uses and can agree while the report still disagrees.
 *
 * And it covers every table the report reads, not just one. The earlier version
 * waited only on `free_credit_issues`, so the consumption figures — which come
 * from `credit_statements`, written later in the suite — were never waited for
 * at all.
 *
 * Sleeping a fixed interval is not a fix: it is the stored timestamps that
 * matter, and how far in the future they landed is not known in advance.
 */
export async function waitPastFixtureClock(user: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
        const [row] = await db().$queryRaw<{ ok: number | null }[]>`
            SELECT ${new Date()} > MAX(t) AS ok FROM (
                SELECT MAX(created_at) AS t FROM free_credit_issues WHERE user = ${user}
                UNION ALL
                SELECT MAX(created_at)      FROM credit_statements  WHERE user = ${user}
                UNION ALL
                SELECT MAX(created_at)      FROM orders             WHERE owner = ${user}
            ) x`
        // NULL means there are no fixture rows at all, which is trivially past.
        if (row?.ok === null || Number(row?.ok) === 1) return
        await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error("fixture timestamps never fell behind the process clock")
}

/** Counts anything the fixtures could have left behind. Every entry must be 0. */
export async function leftoverFixtures(): Promise<Record<string, number>> {
    const p = db()
    const user = { startsWith: PREFIX }
    const [lineStatements, lines, statements, freeCredits, subCredits, orders, sessions, binds, widgets, users] =
        await Promise.all([
            p.credit_line_statements.count({ where: { user } }),
            p.user_credit_lines.count({ where: { user } }),
            p.credit_statements.count({ where: { user } }),
            p.free_credit_issues.count({ where: { user } }),
            p.widget_subscription_credit_issues.count({ where: { user_id: user } }),
            p.orders.count({ where: { owner: user } }),
            p.widget_sessions.count({ where: { user: user } }),
            p.app_bind_ips.count({ where: { app_id: { startsWith: PREFIX } } }),
            p.widgets.count({ where: { tag: { startsWith: PREFIX } } }),
            p.users.count({ where: { username_in_be: user } }),
        ])
    return {
        credit_line_statements: lineStatements,
        user_credit_lines: lines,
        credit_statements: statements,
        free_credit_issues: freeCredits,
        widget_subscription_credit_issues: subCredits,
        orders,
        widget_sessions: sessions,
        app_bind_ips: binds,
        widgets,
        users,
    }
}
