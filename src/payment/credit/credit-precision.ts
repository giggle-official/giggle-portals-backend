import { Prisma } from "@prisma/client"

/**
 * The write side of decimal credit.
 *
 * Every money column that used to be a plain `INT` now has a `DECIMAL(18,6)`
 * sibling. The precise column is the value; the integer column is kept only as
 * its `FLOOR` projection, so that every reader written before this change keeps
 * returning the same whole number it always did.
 *
 * The invariant, true of every row at every moment:
 *
 *     COALESCE(<whole>, 0) = FLOOR(<precise>)
 *
 * It holds because the two columns are only ever written together, by the
 * helpers below. Nothing else in the codebase may assign either column of a
 * pair on its own — an `INT`-only write silently breaks the invariant, and the
 * balance it leaves behind looks perfectly ordinary.
 */

/**
 * Every integer money column that is now a projection, and the precise column
 * it projects from.
 *
 * Doubles as the enforcement boundary for the raw SQL below: identifiers are
 * only ever interpolated from this table, never from an argument, so no caller
 * can reach the statement text.
 */
export const PROJECTED = {
    userBalance: {
        table: "users",
        whole: "current_credit_balance",
        precise: "current_credit_balance_precise",
        key: "username_in_be",
    },
    freeCreditBalance: {
        table: "free_credit_issues",
        whole: "balance",
        precise: "balance_precise",
        key: "id",
    },
    subscriptionBalance: {
        table: "widget_subscription_credit_issues",
        whole: "current_balance",
        precise: "current_balance_precise",
        key: "id",
    },
    orderRefunded: {
        table: "orders",
        whole: "refunded_amount",
        precise: "refunded_amount_precise",
        key: "order_id",
    },
} as const

export type ProjectedPair = (typeof PROJECTED)[keyof typeof PROJECTED]

/** Anything that can stand for an amount of credit at a call site. */
export type CreditAmount = Prisma.Decimal | number | string

export const toDecimal = (v: CreditAmount): Prisma.Decimal => new Prisma.Decimal(v)

/**
 * Renders an amount for binding into a statement.
 *
 * A string, deliberately. Binding a JS `number` hands the driver an IEEE 754
 * double, which cannot represent most decimal fractions exactly — 0.07 arrives
 * as 0.070000000000000007 and the exactness the DECIMAL column exists for is
 * lost before MySQL ever sees the value. A decimal string is converted by MySQL
 * itself, exactly.
 */
const bind = (v: CreditAmount): string => toDecimal(v).toFixed(6)

/**
 * Adds `delta` (signed) to a projected column pair and returns the new values.
 *
 * The statement is deliberately written so that it is correct under *both* SQL
 * evaluation semantics, and depends on neither.
 *
 * The projection comes first and repeats the arithmetic rather than reading the
 * already-updated column:
 *
 *     SET whole   = FLOOR(precise + d),
 *         precise = precise + d
 *
 * Under the SQL standard every right-hand side sees the pre-statement row, so
 * both read the old `precise` and both are right. Under MySQL's and MariaDB's
 * left-to-right evaluation the first assignment reads `precise` before anything
 * has written it, which is the same value — so both are right there too.
 *
 * The obvious form — updating `precise` first and projecting with a bare
 * `FLOOR(precise)` — is shorter but only correct on an engine that evaluates
 * left to right. That was the original design, and it made the entire feature
 * rest on one non-standard behaviour, on an engine that differs between
 * development (MySQL) and production (MariaDB). Binding the delta twice is a
 * small price for not having to be right about that.
 *
 * The order still matters, just for a weaker reason: with the assignments
 * swapped, a left-to-right engine would add the delta twice. The reversed-order
 * control in `decimal-semantics.itest.ts` is what pins that down.
 *
 * Doing it in one statement also means the pair cannot be observed apart, and
 * that a concurrent writer holding the row lock cannot interleave between them.
 *
 * The caller owns the transaction and is responsible for having locked the row
 * and for checking that the result is allowed to be negative.
 */
export async function adjustProjected(
    tx: Prisma.TransactionClient,
    pair: ProjectedPair,
    key: string | number,
    delta: CreditAmount,
): Promise<{ whole: number; precise: Prisma.Decimal }> {
    const { table, whole, precise, key: keyColumn } = pair
    const amount = bind(delta)

    await tx.$executeRawUnsafe(
        `UPDATE ${table}
            SET ${whole}   = FLOOR(${precise} + CAST(? AS DECIMAL(18,6))),
                ${precise} = ${precise} + CAST(? AS DECIMAL(18,6))
          WHERE ${keyColumn} = ?`,
        amount,
        amount,
        key,
    )

    const [row] = await tx.$queryRawUnsafe<{ whole: number | null; precise: Prisma.Decimal }[]>(
        `SELECT ${whole} AS whole, ${precise} AS \`precise\` FROM ${table} WHERE ${keyColumn} = ?`,
        key,
    )

    if (!row) {
        throw new Error(`adjustProjected: no ${table} row for ${keyColumn} = ${String(key)}`)
    }

    // Read back rather than compute: the value that matters downstream is what
    // the row now holds, and after `FLOOR` that is not always what arithmetic on
    // the previous value would predict.
    return { whole: Number(row.whole ?? 0), precise: toDecimal(row.precise) }
}

/**
 * The value pair for an insert, or for an absolute set that replaces rather
 * than adjusts.
 *
 * Spread into a Prisma `data` object so both columns are written from one
 * expression and neither can be forgotten:
 *
 *     data: { user, ...projectedValues("amount", spent.negated()) }
 *
 * `Math.floor` semantics, matching the SQL `FLOOR` used by `adjustProjected`,
 * so a stored row and an adjusted row agree on what the projection of a
 * negative fraction is: -0.5 projects to -1, not to 0.
 */
export function projectedValues<N extends string>(
    name: N,
    value: CreditAmount,
): { [K in N | `${N}_precise`]: K extends N ? number : Prisma.Decimal } {
    const precise = toDecimal(value)
    return {
        [name]: Math.floor(precise.toNumber()),
        [`${name}_precise`]: precise,
    } as { [K in N | `${N}_precise`]: K extends N ? number : Prisma.Decimal }
}
