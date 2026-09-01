import { PrismaClient } from "@prisma/client"

/**
 * Compares each integer money column against the shadow DECIMAL column written
 * alongside it:
 *
 *     COALESCE(<whole>, 0) = FLOOR(<precise>)
 *
 * for every column pair, on every row.
 *
 * This is the whole point of phase one. The shadow columns are written but read
 * by nothing; their only job is to be comparable to the columns that are still
 * authoritative. Running this over real traffic for a while is what earns the
 * right to start reading them.
 *
 * Run it against any environment after a deploy, after a backfill, and on a
 * schedule while the old integer columns are still being served. It is the only
 * check that can tell an integer column drifting away from its precise sibling
 * from an ordinary balance, because a drifted value looks entirely normal.
 *
 *     npx ts-node -r tsconfig-paths/register scripts/check-credit-invariant.ts
 *
 * Exits non-zero when anything is off, so it can be wired to an alert.
 */

/**
 * Spelled out here rather than derived from the Prisma schema on purpose.
 *
 * This script exists to catch the case where the application's idea of the
 * schema is wrong. Deriving the list from the application would mean a column
 * dropped there also silently drops out of the check, which is exactly when the
 * check is most needed.
 */
const PAIRS = [
    {
        table: "users",
        owner: "username_in_be",
        whole: "current_credit_balance",
        precise: "current_credit_balance_precise",
        key: "id",
    },
    { table: "credit_statements", owner: "user", whole: "amount", precise: "amount_precise", key: "id" },
    { table: "credit_statements", owner: "user", whole: "balance", precise: "balance_precise", key: "id" },
    { table: "free_credit_issues", owner: "user", whole: "amount", precise: "amount_precise", key: "id" },
    { table: "free_credit_issues", owner: "user", whole: "balance", precise: "balance_precise", key: "id" },
    { table: "orders", owner: "owner", whole: "amount", precise: "amount_precise", key: "id" },
    { table: "orders", owner: "owner", whole: "credit_paid_amount", precise: "credit_paid_amount_precise", key: "id" },
    { table: "orders", owner: "owner", whole: "free_credit_paid", precise: "free_credit_paid_precise", key: "id" },
    { table: "orders", owner: "owner", whole: "refunded_amount", precise: "refunded_amount_precise", key: "id" },
    {
        table: "widget_subscription_credit_issues",
        owner: "user_id",
        whole: "issue_credits",
        precise: "issue_credits_precise",
        key: "id",
    },
    {
        table: "widget_subscription_credit_issues",
        owner: "user_id",
        whole: "current_balance",
        precise: "current_balance_precise",
        key: "id",
    },
] as const

export interface Breach {
    pair: string
    offenders: number
    sample: { key: unknown; whole: unknown; precise: unknown }[]
}

/** Anything with the raw-query methods this needs — a client or a transaction. */
type Queryable = Pick<PrismaClient, "$queryRawUnsafe">

/**
 * Returns one entry per column pair that has at least one offending row, with
 * up to five examples. An empty array means the invariant holds everywhere.
 *
 * `ownerLike` narrows the scan to matching users — a SQL LIKE pattern, bound as
 * a parameter. Each table names its own owner column, since they disagree:
 * `user`, `owner` and `user_id` all mean the same thing here.
 */
export async function findBreaches(prisma: Queryable, ownerLike = "%"): Promise<Breach[]> {
    const breaches: Breach[] = []

    for (const { table, owner, whole, precise, key } of PAIRS) {
        // COALESCE on the old column only: the precise columns are NOT NULL, so
        // a null there is itself a breach and must not be swallowed.
        const predicate = `(COALESCE(${whole}, 0) <> FLOOR(${precise}) OR ${precise} IS NULL) AND ${owner} LIKE ?`

        const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*) AS n FROM ${table} WHERE ${predicate}`,
            ownerLike,
        )
        const offenders = Number(n)
        if (offenders === 0) continue

        const sample = await prisma.$queryRawUnsafe<{ key: unknown; whole: unknown; precise: unknown }[]>(
            `SELECT ${key} AS \`key\`, ${whole} AS \`whole\`, CAST(${precise} AS CHAR) AS \`precise\`
               FROM ${table} WHERE ${predicate} ORDER BY ${key} LIMIT 5`,
            ownerLike,
        )

        breaches.push({ pair: `${table}.${whole}`, offenders, sample })
    }

    return breaches
}

export const PAIR_COUNT = PAIRS.length

async function main(): Promise<void> {
    const prisma = new PrismaClient()
    let breaches: Breach[]
    try {
        breaches = await findBreaches(prisma)
    } finally {
        await prisma.$disconnect()
    }

    if (breaches.length === 0) {
        console.log(`all ${PAIRS.length} column pairs consistent`)
        return
    }

    for (const b of breaches) {
        console.error(`BREACH ${b.pair}: ${b.offenders} row(s)`)
        for (const r of b.sample) {
            console.error(`         key=${String(r.key)} whole=${String(r.whole)} precise=${String(r.precise)}`)
        }
    }
    const total = breaches.reduce((sum, b) => sum + b.offenders, 0)
    console.error(`\n${total} row(s) breach the invariant across ${breaches.length} column pair(s).`)
    process.exit(1)
}

// Only when run directly, so the integration test can import the pieces above
// without the process exiting underneath it.
if (require.main === module) {
    main().catch((e) => {
        console.error(e)
        process.exit(1)
    })
}
