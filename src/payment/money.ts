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

/** Decimal places a credit amount may carry: the scale of every `*_precise` column. */
export const CREDIT_SCALE = 6

/**
 * Whether `value` fits the precise columns without rounding.
 *
 * MariaDB rounds a `DECIMAL(18,6)` overflow instead of refusing it, so a
 * seventh decimal place has to be refused here or it is silently rounded on
 * the way in. The tolerance absorbs float representation noise (`0.1 * 1e6`
 * is not exactly `100000`) without admitting a real seventh digit.
 */
export function hasCreditScale(value: number): boolean {
    if (!Number.isFinite(value)) return false
    const scaled = value * 10 ** CREDIT_SCALE
    return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

/**
 * Snaps a running total back onto the credit grid.
 *
 * Bucket walks subtract one float from another in a loop, and `0.3 - 0.1` is
 * `0.19999999999999998`. The database would round that away, but the loop's own
 * exit test would not: a residue of `5e-17` still reads as "something left to
 * spend" and produces a zero-amount statement row.
 */
export function roundCredits(value: number): number {
    return Math.round(value * 10 ** CREDIT_SCALE) / 10 ** CREDIT_SCALE
}

/**
 * The value a legacy integer column holds beside its precise twin.
 *
 * `FLOOR`, matching the read-side projection: a fraction of a credit rounds
 * against the holder, so a balance is never overstated and a debt never
 * understated. Immutable rows take this at insert; accumulating columns take it
 * from the precise value the same statement just produced, never by
 * incrementing the integer column itself — `SUM(FLOOR(x)) != FLOOR(SUM(x))`,
 * and the gap grows with every row.
 */
export function legacyInt(value: Numeric | undefined): number {
    return Math.floor(toNumber(value))
}
