import { maskEmail } from "./mask"

describe("maskEmail", () => {
    it("keeps three characters of the local part and replaces the domain", () => {
        expect(maskEmail("zhangsan@gmail.com")).toBe("zha****@****.com")
    })

    it("keeps what is there when the local part is shorter than three", () => {
        expect(maskEmail("ab@x.com")).toBe("ab****@****.com")
        expect(maskEmail("a@x.com")).toBe("a****@****.com")
    })

    /**
     * Only the last segment survives. Keeping `.co.uk` would name the registry
     * and, with the suffix, start to identify the domain again.
     */
    it("keeps only the final suffix segment", () => {
        expect(maskEmail("alice@example.co.uk")).toBe("ali****@****.uk")
    })

    it("splits on the last @, so an address containing one is not truncated early", () => {
        expect(maskEmail("weird@name@example.com")).toBe("wei****@****.com")
    })

    it("masks something that is not an address rather than guessing its shape", () => {
        expect(maskEmail("not-an-email")).toBe("****")
        expect(maskEmail("@leading.com")).toBe("****")
    })

    it("returns an empty string for a missing address", () => {
        expect(maskEmail(null)).toBe("")
        expect(maskEmail(undefined)).toBe("")
        expect(maskEmail("")).toBe("")
    })

    it("emits no suffix when the domain has none", () => {
        expect(maskEmail("someone@localhost")).toBe("som****@****")
    })
})
