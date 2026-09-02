import { Prisma } from "@prisma/client"

/**
 * Every shape a money value arrives in before it is a `number`.
 *
 * Prisma hands `DECIMAL` columns back as `Decimal`, and MariaDB hands
 * `SUM()`/`COUNT()` back as string, number or bigint depending on the column
 * type — so a raw row and an ORM row disagree about the type of the same value.
 */
export type Numeric = Prisma.Decimal | string | number | bigint | null

/**
 * The one seam between those shapes and the `number` the wire carries.
 *
 * None of them may reach a response as-is. A `Decimal` is the worst of them
 * because it survives every in-memory assertion and only reveals itself on
 * serialisation, where `JSON.stringify(new Decimal(6.5))` is `"6.5"` — a string
 * sitting among numbers, which silently breaks any integrator doing arithmetic
 * on it. Arriving at a response through this function is what keeps that from
 * happening.
 *
 * `Number`, never `Math.floor`. While every amount is a whole credit the two are
 * identical, but the moment a fraction exists flooring here would silently
 * truncate it where `Number` carries it through. The legacy integer fields take
 * their floor from their own column, not from this.
 */
export function toNumber(value: Numeric | undefined): number {
    if (value === null || value === undefined) return 0
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}
