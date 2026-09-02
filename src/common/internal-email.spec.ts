import { isInternalEmail } from "./internal-email"

describe("isInternalEmail", () => {
    const original = process.env.INTERNAL_EMAIL_DOMAINS

    beforeEach(() => {
        process.env.INTERNAL_EMAIL_DOMAINS = "cobra37.com,3bodylabs.ai"
    })

    afterAll(() => {
        if (original === undefined) delete process.env.INTERNAL_EMAIL_DOMAINS
        else process.env.INTERNAL_EMAIL_DOMAINS = original
    })

    it("matches the configured domains", () => {
        expect(isInternalEmail("someone@cobra37.com")).toBe(true)
        expect(isInternalEmail("info@3bodylabs.ai")).toBe(true)
    })

    it("ignores case, and whitespace around the list entries", () => {
        process.env.INTERNAL_EMAIL_DOMAINS = " Cobra37.COM , 3bodylabs.ai "
        expect(isInternalEmail("Someone@Cobra37.COM")).toBe(true)
        expect(isInternalEmail("info@3BodyLabs.ai")).toBe(true)
    })

    it("matches subdomains", () => {
        expect(isInternalEmail("qa@mail.cobra37.com")).toBe(true)
    })

    /** The suffix test is anchored on a dot, so a lookalike domain is not staff. */
    it("does not match a domain that merely ends with the same letters", () => {
        expect(isInternalEmail("someone@notcobra37.com")).toBe(false)
        expect(isInternalEmail("someone@cobra37.com.cn")).toBe(false)
    })

    it("treats customers and non-addresses as external", () => {
        expect(isInternalEmail("user@gmail.com")).toBe(false)
        expect(isInternalEmail("not-an-email")).toBe(false)
        expect(isInternalEmail(null)).toBe(false)
        expect(isInternalEmail(undefined)).toBe(false)
        expect(isInternalEmail("")).toBe(false)
    })

    /**
     * Unset means nothing is internal. That is the honest behaviour for an empty
     * list, and the module logs a warning the first time it sees one — but it must
     * not start guessing at domains.
     */
    it("treats everyone as external when the variable is unset", () => {
        delete process.env.INTERNAL_EMAIL_DOMAINS
        expect(isInternalEmail("someone@cobra37.com")).toBe(false)
    })

    it("picks up a change to the variable without a restart", () => {
        expect(isInternalEmail("someone@later.example")).toBe(false)
        process.env.INTERNAL_EMAIL_DOMAINS = "later.example"
        expect(isInternalEmail("someone@later.example")).toBe(true)
    })
})
