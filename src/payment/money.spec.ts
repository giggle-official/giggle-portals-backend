import { Prisma } from "@prisma/client"
import { hasCreditScale, legacyInt, roundCredits, toNumber } from "./money"

describe("money helpers", () => {
    describe("hasCreditScale", () => {
        it("accepts up to six decimal places", () => {
            expect(hasCreditScale(10)).toBe(true)
            expect(hasCreditScale(0.1)).toBe(true)
            expect(hasCreditScale(0.000001)).toBe(true)
            expect(hasCreditScale(123456789.123456)).toBe(true)
        })

        /** The database would round these instead of refusing them. */
        it("refuses a seventh decimal place", () => {
            expect(hasCreditScale(0.1234567)).toBe(false)
            expect(hasCreditScale(0.0000001)).toBe(false)
            expect(hasCreditScale(10.0000005)).toBe(false)
        })

        it("refuses what is not a finite number", () => {
            expect(hasCreditScale(NaN)).toBe(false)
            expect(hasCreditScale(Infinity)).toBe(false)
        })
    })

    describe("roundCredits", () => {
        it("snaps float residue back onto the grid", () => {
            expect(roundCredits(0.3 - 0.1)).toBe(0.2)
            expect(roundCredits(1 - 0.9)).toBe(0.1)
            expect(roundCredits(0.5 - 0.5)).toBe(0)
        })

        it("keeps six places and no more", () => {
            expect(roundCredits(1 / 3)).toBe(0.333333)
            expect(roundCredits(-1 / 3)).toBe(-0.333333)
        })
    })

    describe("legacyInt", () => {
        it("is the floor, so a balance is never overstated", () => {
            expect(legacyInt(100.6)).toBe(100)
            expect(legacyInt(new Prisma.Decimal("6.999999"))).toBe(6)
            expect(legacyInt("0.5")).toBe(0)
        })

        /** Not TRUNC: a consumption of half a credit is recorded as a whole one, a debt is never understated. */
        it("floors a negative value away from zero", () => {
            expect(legacyInt(-0.5)).toBe(-1)
            expect(legacyInt(new Prisma.Decimal("-5.5"))).toBe(-6)
        })

        it("treats an absent value as zero, like toNumber", () => {
            expect(legacyInt(null)).toBe(0)
            expect(legacyInt(undefined)).toBe(0)
            expect(toNumber(null)).toBe(0)
        })
    })
})
