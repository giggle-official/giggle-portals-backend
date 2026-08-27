import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, join } from "path"

const DIR = join(__dirname, "..", "__golden__")

/**
 * Values that differ between runs by design. Replaced with a token that names
 * the JSON type rather than dropped, so that a field turning from `number` into
 * `string` still shows up as a diff even though its value is volatile.
 */
const VOLATILE = new Set([
    "id",
    "order_id",
    "buyback_order_id",
    "order_url",
    "user",
    "owner",
    "user_email",
    "email",
    "request_id",
    "created_at",
    "updated_at",
    "paid_time",
    "refund_time",
    "refunded_time",
    "expire_date",
    "issue_date",
    "reportDate",
    "period",
])

const typeToken = (v: unknown): string => {
    if (v === null) return "<null>"
    if (Array.isArray(v)) return "<array>"
    if (v instanceof Date) return "<Date>"
    return `<${typeof v}>`
}

/**
 * Normalises a response for comparison.
 *
 * Deliberately NOT sorting keys: key order is what the API actually emits, and
 * a reordering is cheap to eyeball but would otherwise hide behind a sort.
 * Money fields are never volatile, so their exact literal — `100` vs `100.0`
 * vs `"100"` — is what the comparison is really watching.
 */
export function normalise(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value
    if (value instanceof Date) return "<Date>"
    if (Array.isArray(value)) return value.map(normalise)

    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = VOLATILE.has(k) ? typeToken(v) : normalise(v)
    }
    return out
}

/**
 * Serialises the way the wire does.
 *
 * `JSON.stringify` is the point of the exercise, not an implementation detail:
 * a Prisma `Decimal` survives every in-memory assertion and only reveals itself
 * here, as `"100"` instead of `100`.
 */
export const serialise = (value: unknown): string =>
    JSON.stringify(normalise(JSON.parse(JSON.stringify(value))), null, 2)

const fileFor = (name: string) => join(DIR, `${name}.json`)

/**
 * Compares against the recorded baseline, or records it when run with
 * `ITEST_RECORD=1`.
 *
 * Recording is explicit and never automatic: a baseline that rewrites itself
 * whenever it disagrees is not a baseline.
 */
export function matchGolden(name: string, value: unknown): void {
    const path = fileFor(name)
    const actual = serialise(value)

    if (process.env.ITEST_RECORD === "1") {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${actual}\n`)
        return
    }

    if (!existsSync(path)) {
        throw new Error(
            `No golden baseline for "${name}". Record one on an unmodified checkout with:\n` +
                `  ITEST_RECORD=1 npm run test:integration\n` +
                `Recording it from modified code would bake the change into the baseline it is meant to catch.`,
        )
    }

    expect(actual).toBe(readFileSync(path, "utf8").trimEnd())
}
