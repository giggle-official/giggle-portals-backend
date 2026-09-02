import { Logger } from "@nestjs/common"

/**
 * Staff domains, from `INTERNAL_EMAIL_DOMAINS` — a comma separated list, e.g.
 * `cobra37.com,3bodylabs.ai`. Accounts on these belong to us, not to a customer,
 * and are dropped from reports that leave the building.
 *
 * Read at call time rather than at import, so the list can be changed without a
 * restart and so tests can set it.
 *
 * There is no default. An unset variable means nothing is filtered, and the cost
 * of that going unnoticed is staff accounts in a report handed to an integrator —
 * so the first read of an empty list says so in the log rather than quietly
 * passing everything through.
 */
const logger = new Logger("InternalEmail")

let cachedRaw: string | undefined
let cachedDomains: string[] = []
let warned = false

export function internalEmailDomains(): string[] {
    const raw = process.env.INTERNAL_EMAIL_DOMAINS ?? ""
    if (raw !== cachedRaw) {
        cachedRaw = raw
        cachedDomains = raw
            .split(",")
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean)
        warned = false
    }
    if (cachedDomains.length === 0 && !warned) {
        warned = true
        logger.warn("INTERNAL_EMAIL_DOMAINS is not set; no accounts will be treated as internal")
    }
    return cachedDomains
}

/**
 * Subdomains count: `qa@mail.cobra37.com` is as internal as `qa@cobra37.com`.
 * The suffix test is anchored on a dot so that `notcobra37.com` does not match.
 */
export function isInternalEmail(email: string | null | undefined): boolean {
    if (!email) return false

    const at = email.lastIndexOf("@")
    if (at < 0) return false

    const host = email.slice(at + 1).toLowerCase()
    return internalEmailDomains().some((d) => host === d || host.endsWith(`.${d}`))
}
