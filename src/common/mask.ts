/**
 * `zhangsan@gmail.com` -> `zha****@****.com`
 *
 * Three characters of the local part survive, the domain is replaced wholesale,
 * and only the last suffix segment is kept — `a@b.co.uk` masks to `a****@****.uk`
 * rather than `a****@****.co.uk`, because keeping two segments starts to identify
 * the domain again for anything but the common suffixes.
 *
 * A local part shorter than three characters keeps what it has: padding it out
 * would suggest an address longer than the real one, and the leak is a character
 * or two of something already truncated.
 */
export function maskEmail(email: string | null | undefined): string {
    if (!email) return ""

    const at = email.lastIndexOf("@")
    if (at <= 0) {
        // Not an address. Mask it whole rather than guess at its shape.
        return "****"
    }

    const local = email.slice(0, at).slice(0, 3)
    const domain = email.slice(at + 1)
    const dot = domain.lastIndexOf(".")
    const suffix = dot >= 0 ? domain.slice(dot) : ""

    return `${local}****@****${suffix}`
}
