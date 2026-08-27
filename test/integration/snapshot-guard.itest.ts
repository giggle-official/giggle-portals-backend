import { Decimal } from "@prisma/client/runtime/library"
import { describeItest } from "./helpers/itest"
import { serialise } from "./helpers/snapshot"

/**
 * Tests the comparator, not the application.
 *
 * A golden baseline is only worth having if it fails when the contract moves.
 * Checking that by hand once, at the moment it is written, is not a guarantee —
 * a normaliser that grows one token too many quietly turns every future
 * comparison into a tautology. These assertions keep it honest.
 */
describeItest("golden comparator", () => {
    it("sees a number turning into a string", () => {
        // Exactly the regression this project has to prevent: a Prisma `Decimal`
        // passes every in-memory assertion and only reveals itself on the wire.
        expect(serialise({ balance: new Decimal(100) })).not.toBe(serialise({ balance: 100 }))
        expect(serialise({ balance: new Decimal(100) })).toContain('"100"')
        expect(serialise({ balance: 100 })).toContain("100")
    })

    it("sees a value change", () => {
        expect(serialise({ balance: 100 })).not.toBe(serialise({ balance: 99 }))
    })

    it("sees a fraction appear", () => {
        expect(serialise({ balance: 100 })).not.toBe(serialise({ balance: 99.537 }))
    })

    it("sees a field appear or disappear", () => {
        expect(serialise({ a: 1 })).not.toBe(serialise({ a: 1, b: 2 }))
    })

    it("sees fields reorder", () => {
        // Key order is not meaningful to a JSON consumer, but a reordering is a
        // signal that a mapper was rewritten, and that is worth a second look.
        expect(serialise({ a: 1, b: 2 })).not.toBe(serialise({ b: 2, a: 1 }))
    })

    it("sees a volatile field change type, even though its value is ignored", () => {
        // `created_at` values differ every run so they are tokenised — but the
        // token names the type, so a Date becoming a number still surfaces.
        expect(serialise({ created_at: "2026-01-01" })).not.toBe(serialise({ created_at: 1 }))
    })

    it("ignores the value of a volatile field", () => {
        expect(serialise({ created_at: "2026-01-01" })).toBe(serialise({ created_at: "2026-06-30" }))
    })

    it("looks through nested objects and arrays", () => {
        expect(serialise({ rows: [{ amount: 1 }] })).not.toBe(serialise({ rows: [{ amount: new Decimal(1) }] }))
    })
})
