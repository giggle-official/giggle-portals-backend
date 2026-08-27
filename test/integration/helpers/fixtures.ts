import { db } from "./db"
import { itestId } from "./itest"

/**
 * Wire values written out rather than imported from `OrderStatus` /
 * `PaymentMethod`, for two reasons.
 *
 * These strings are stored in the database and sent to integrators, so they are
 * part of the contract; spelling them here means changing an enum's value
 * breaks these tests loudly instead of quietly agreeing with itself.
 *
 * It also keeps this file out of the `order.dto` ⇄ `order.service` import
 * cycle, which resolves only when the module graph is entered through
 * `AppModule` — importing the enum here loads it from the wrong end and leaves
 * `PaymentMethod` half-built.
 */
const STATUS_PENDING = "pending"
const METHOD_CREDIT = "credit"
const METHOD_CREDIT_LINE = "credit-line"

export const USER = itestId("u1")
export const EMAIL = `${USER}@example.com`
export const WIDGET = itestId("wg")
export const APP = itestId("app")
export const IP_ID = 999_999

/**
 * The smallest world in which a credit flow is legal: one user, one widget that
 * may issue credit and grant credit lines, and an app bound to an IP so that
 * income-side views have something to (not) pick up.
 */
export async function seedWorld(opts: { balance?: number } = {}): Promise<void> {
    const p = db()
    await p.users.create({
        data: {
            username_in_be: USER,
            username: USER,
            email: EMAIL,
            // Not a login. The column is required and tests never authenticate.
            password: itestId("not_a_login"),
            // Both columns, always. Writing only the integer one leaves the
            // fixture itself breaching `COALESCE(whole,0) = FLOOR(precise)`,
            // which makes every suite seeded from here start out inconsistent.
            current_credit_balance: opts.balance ?? 0,
            current_credit_balance_precise: opts.balance ?? 0,
        } as never,
    })
    await p.widgets.create({
        data: {
            tag: WIDGET,
            name: WIDGET,
            author: USER,
            request_permissions: { can_issue_token: true, can_grant_credit_line: true },
        } as never,
    })
    await p.app_bind_ips.create({ data: { app_id: APP, ip_id: IP_ID } as never })
}

let seq = 0

/** A pending order owned by the fixture user, payable by credit and by credit line. */
export async function seedOrder(overrides: Record<string, unknown> = {}): Promise<string> {
    const order_id = itestId(`o${++seq}`)
    await db().orders.create({
        data: {
            order_id,
            owner: USER,
            widget_tag: WIDGET,
            amount: 100,
            amount_precise: 100,
            current_status: STATUS_PENDING,
            supported_payment_method: [METHOD_CREDIT, METHOD_CREDIT_LINE],
            costs_allocation: [],
            ...overrides,
        } as never,
    })
    return order_id
}

/** Resets the per-run order counter so ids stay stable across suites. */
export function resetOrderSeq(): void {
    seq = 0
}
