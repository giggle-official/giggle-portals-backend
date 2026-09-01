import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common"
import { credit_line_statement_type, credit_line_status, Prisma, user_credit_lines } from "@prisma/client"
import {
    WIDGET_PERMISSIONS_LIST,
    WidgetCaslAbilityFactory,
} from "src/casl/casl-ability.factory/widget-casl-ability.factory"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { CreditService } from "../credit/credit.service"
import { toNumber } from "src/payment/money"
import {
    CreditLineDto,
    GetCreditLinesResponseDto,
    GetCreditLineStatementQueryDto,
    GetCreditLineStatementsResponseDto,
    GrantCreditLineDto,
    RepayCreditLineDto,
    RepayCreditLineResponseDto,
    WidgetCreditLineDto,
} from "./credit-line.dto"
import { v4 as uuidv4 } from "uuid"

/**
 * Default ceiling on the limit a widget may grant one user. Generous because the
 * early users of credit lines are large B2B partners, and because the permission
 * bit is already a hand-maintained whitelist; the cap is here to bound a mistake,
 * not to be the primary control.
 */
const DEFAULT_WIDGET_GRANT_MAX = 1_000_000

/**
 * The credit line account: a per-(user, widget) debt balance that is completely
 * separate from the credit account (`users.current_credit_balance`), the way a
 * credit card account is separate from the debit account it is repaid from.
 *
 * Every primitive that moves `used` takes a `Prisma.TransactionClient`, because
 * a change to the debt is never the whole story: charging accompanies an order
 * update, repaying accompanies a deduction from the real balance. The caller
 * owns the transaction, and `lockLine` is how it takes the row lock that makes
 * the read-modify-write safe.
 *
 * Invariant: `used` always equals the `used_after` of the account's last ledger
 * row. That is the reconciliation anchor, so no primitive may touch `used`
 * without writing a `credit_line_statements` row in the same transaction.
 */
@Injectable()
export class CreditLineService {
    private readonly logger = new Logger(CreditLineService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly creditService: CreditService,
        private readonly widgetCaslAbilityFactory: WidgetCaslAbilityFactory,
    ) {}

    /**
     * How much of the line can still be spent.
     *
     * Clamped at 0: lowering a limit below the outstanding debt is a legal state
     * (that is how granting is switched off), and it leaves `credit_limit - used`
     * negative. A negative number must never reach a caller or an API response.
     */
    available(line: user_credit_lines | null): number {
        if (!line || line.status !== credit_line_status.active) {
            return 0
        }
        return Math.max(0, toNumber(line.credit_limit) - toNumber(line.used))
    }

    /**
     * Reads a line without locking. Returns null when the user has no line with
     * this widget — callers render that as a zeroed-out line, never as a 404, so
     * that the widget-facing lookups cannot be used to probe whether an email is
     * registered.
     */
    async getLine(user: string, widgetTag: string, tx?: Prisma.TransactionClient): Promise<user_credit_lines | null> {
        const prisma = tx || this.prisma
        return prisma.user_credit_lines.findUnique({
            where: { user_widget_tag: { user, widget_tag: widgetTag } },
        })
    }

    /**
     * Takes the row lock for one credit line and returns the locked row.
     *
     * When the line does not exist yet the `SELECT ... FOR UPDATE` matches
     * nothing but still gap-locks the slot in the `user_widget` unique index, so
     * two concurrent grants for the same (user, widget) serialise instead of
     * racing to insert.
     */
    async lockLine(tx: Prisma.TransactionClient, user: string, widgetTag: string): Promise<user_credit_lines | null> {
        await tx.$queryRaw`SELECT id FROM user_credit_lines WHERE user = ${user} AND widget_tag = ${widgetTag} FOR UPDATE`
        return this.getLine(user, widgetTag, tx)
    }

    /**
     * Sets the line's limit to an absolute value, creating the line if needed.
     *
     * Absolute rather than incremental so that a retried grant is idempotent: a
     * duplicated "set the limit to 500" is harmless, a duplicated "add 500" is
     * not. The new limit is deliberately allowed to be below the current debt —
     * that is the supported way to stop a user from borrowing more.
     */
    async setLimit(
        tx: Prisma.TransactionClient,
        user: string,
        widgetTag: string,
        creditLimit: number,
        options: { operator?: string; note?: string } = {},
    ): Promise<user_credit_lines> {
        if (!Number.isInteger(creditLimit) || creditLimit < 0) {
            throw new BadRequestException("Credit limit must be a non-negative integer")
        }

        await this.lockLine(tx, user, widgetTag)

        return tx.user_credit_lines.upsert({
            where: { user_widget_tag: { user, widget_tag: widgetTag } },
            create: {
                user,
                widget_tag: widgetTag,
                credit_limit: creditLimit,
                operator: options.operator,
                note: options.note,
            },
            update: {
                credit_limit: creditLimit,
                operator: options.operator,
                ...(options.note !== undefined && { note: options.note }),
            },
        })
    }

    /**
     * Spends `amount` of the line on an order. The only primitive that raises the
     * debt.
     */
    async charge(
        tx: Prisma.TransactionClient,
        user: string,
        widgetTag: string,
        amount: number,
        orderId: string,
    ): Promise<user_credit_lines> {
        this.assertPositiveAmount(amount)

        const line = await this.lockLine(tx, user, widgetTag)
        if (!line) {
            throw new BadRequestException("No credit line granted by this widget")
        }
        if (line.status !== credit_line_status.active) {
            throw new BadRequestException("Credit line is frozen")
        }
        if (this.available(line) < amount) {
            throw new BadRequestException("Insufficient credit line")
        }

        return this.applyToLine(tx, line, {
            type: credit_line_statement_type.consume,
            usedDelta: amount,
            amount: amount * -1,
            orderId,
        })
    }

    /**
     * Repays `amount` of the debt.
     *
     * Makes no assumption about where the money came from: the caller is
     * responsible for the credit-account leg (and for clamping `amount` to what
     * is actually owed and affordable). Keeping this primitive source-agnostic is
     * what will let a future statement-based auto-debit reuse it unchanged.
     *
     * It deliberately never looks at `credit_limit`. A limit lowered below the
     * debt must not stop a user from paying that debt off.
     */
    async repay(
        tx: Prisma.TransactionClient,
        user: string,
        widgetTag: string,
        amount: number,
        requestId: string,
    ): Promise<user_credit_lines> {
        this.assertPositiveAmount(amount)

        const line = await this.lockLine(tx, user, widgetTag)
        if (!line) {
            throw new BadRequestException("No credit line granted by this widget")
        }

        await this.assertRepaymentNotReplayed(tx, user, widgetTag, requestId)

        return this.applyToLine(tx, line, {
            // Negative, like consumption: a repayment spends real credit. The
            // settlement report adds this straight onto the paid figure, and
            // flipping a sign there is the easiest mistake to make and the
            // hardest to notice.
            type: credit_line_statement_type.repay,
            usedDelta: amount * -1,
            amount: amount * -1,
            requestId,
        })
    }

    /**
     * Rejects a repayment whose idempotency key has already been used.
     *
     * Deduped on the (user, widget_tag, request_id) triple rather than on
     * request_id alone: the key comes from the caller and may well be an order
     * number or a counter, which collides across users; deduping on the column
     * alone would hand user B a baffling "duplicate" error. The line row is
     * locked by the time this runs, so the check-then-insert cannot race.
     *
     * Public because the repayment flow has to run it before it decides there is
     * nothing to repay — otherwise a replay of a repayment that already cleared
     * the debt would report success instead of telling the caller it is a replay.
     */
    async assertRepaymentNotReplayed(
        tx: Prisma.TransactionClient,
        user: string,
        widgetTag: string,
        requestId: string,
    ): Promise<void> {
        const duplicated = await tx.credit_line_statements.findFirst({
            where: {
                user,
                widget_tag: widgetTag,
                type: credit_line_statement_type.repay,
                request_id: requestId,
            },
        })
        if (duplicated) {
            throw new BadRequestException("Duplicate repayment request id")
        }
    }

    /**
     * Refunds `amount` of a credit line order back onto the line.
     *
     * The real balance is not touched — the user never spent real credit on this
     * order. `used` may go negative when the debt was already repaid, which is
     * the credit-card notion of an overpayment: the account carries a prepaid
     * amount that can be spent again.
     */
    async refund(
        tx: Prisma.TransactionClient,
        user: string,
        widgetTag: string,
        amount: number,
        orderId: string,
    ): Promise<user_credit_lines> {
        this.assertPositiveAmount(amount)

        const line = await this.lockLine(tx, user, widgetTag)
        if (!line) {
            throw new BadRequestException("No credit line granted by this widget")
        }

        return this.applyToLine(tx, line, {
            type: credit_line_statement_type.refund,
            usedDelta: amount * -1,
            amount,
            orderId,
        })
    }

    /**
     * The single place `used` moves. Writes the ledger row and the new `used` in
     * one step so the two can never drift apart.
     *
     * `amount` carries the direction of money for the user (negative when they
     * spend), `type` decides which way `used` moves; the two are independent and
     * `usedDelta` states the second one explicitly rather than inferring it.
     */
    private async applyToLine(
        tx: Prisma.TransactionClient,
        line: user_credit_lines,
        entry: {
            type: credit_line_statement_type
            usedDelta: number
            amount: number
            orderId?: string
            requestId?: string
        },
    ): Promise<user_credit_lines> {
        const updated = await tx.user_credit_lines.update({
            where: { id: line.id },
            data: { used: { increment: entry.usedDelta } },
        })

        await tx.credit_line_statements.create({
            data: {
                user: line.user,
                widget_tag: line.widget_tag,
                type: entry.type,
                amount: entry.amount,
                used_after: updated.used,
                order_id: entry.orderId ?? null,
                request_id: entry.requestId ?? null,
            },
        })

        return updated
    }

    /**
     * Throws unless the widget still holds the permission that let it lend.
     *
     * Checked on every borrow and every widget-side read rather than only when
     * the limit is granted, so that revoking the permission takes effect at
     * once instead of leaving already-granted limits spendable forever.
     */
    async assertWidgetMayLend(widgetTag: string): Promise<void> {
        const abilities = await this.widgetCaslAbilityFactory.createForWidget(widgetTag)
        if (!abilities.can(WIDGET_PERMISSIONS_LIST.CAN_GRANT_CREDIT_LINE)) {
            throw new ForbiddenException("This widget is not allowed to grant credit lines")
        }
    }

    private assertPositiveAmount(amount: number): void {
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new BadRequestException("Amount must be a positive integer")
        }
    }

    /* ------------------------------------------------------------------ *
     * API surface
     * ------------------------------------------------------------------ */

    /**
     * Widget-facing: set a user's limit on the calling widget's own credit line.
     *
     * `req.user` under `IsWidgetGuard` is the widget AUTHOR, not the end user, so
     * the target is resolved from the body's email. Reading it off `req.user`
     * would silently grant the limit to the developer's own account — and since
     * the developer is usually a legitimate user of their own widget, nothing
     * would look wrong.
     */
    async grantCreditLine(body: GrantCreditLineDto, userInfo: UserJwtExtractDto): Promise<CreditLineDto> {
        const widgetTag = this.requireWidgetTag(userInfo)

        const max = this.widgetGrantMax()
        if (body.credit_limit > max) {
            throw new BadRequestException(`Credit limit exceeds the maximum a widget may grant (${max})`)
        }

        const target = await this.prisma.users.findUnique({ where: { email: body.email } })
        if (!target) {
            throw new BadRequestException("User not found")
        }

        const line = await this.prisma.$transaction(async (tx) =>
            this.setLimit(tx, target.username_in_be, widgetTag, body.credit_limit, {
                // The widget, not `req.user` — that is the author's account.
                operator: widgetTag,
                note: body.note,
            }),
        )

        return this.toDto(line, widgetTag)
    }

    /**
     * Pays off part or all of a credit line with real credit.
     *
     * Explicit and atomic, never triggered by a top-up. The balance is global
     * while credit lines are per-widget, so an automatic offset on top-up would be
     * dodged by topping up through a widget that grants no credit line: the money
     * lands in the global balance and the debt does not move. The widget is the
     * gatekeeper instead — it can see "has balance, owes me" and make the user
     * come through here.
     *
     * Both accounts move, which is what makes this the one action that writes to
     * both ledgers: the credit balance genuinely drops, so it must show up on the
     * credit statement, and the debt drops, so it must show up on the credit line
     * statement. The credit leg writes one row per bucket it crosses; the credit
     * line leg writes exactly one, because `used` moved once.
     */
    async repayCreditLine(body: RepayCreditLineDto, userInfo: UserJwtExtractDto): Promise<RepayCreditLineResponseDto> {
        const { user, widgetTag } = await this.resolveRepaymentTarget(body, userInfo)
        const requestId = body.request_id || uuidv4()

        return this.prisma.$transaction(async (tx) => {
            // Users row first, then the credit line row. Every path that touches
            // both takes them in this order.
            await tx.$queryRaw`SELECT id FROM users WHERE username_in_be = ${user} FOR UPDATE`
            const line = await this.lockLine(tx, user, widgetTag)
            if (!line) {
                throw new BadRequestException("No credit line granted by this widget")
            }

            // Before the nothing-to-repay shortcut below, so that replaying a
            // repayment that already cleared the debt is reported as a replay
            // rather than as a successful no-op.
            //
            // The mirror case is deliberate the other way: a call that repays
            // nothing writes no ledger row, so it does not consume the key. A
            // no-op should not permanently burn an idempotency key that the
            // caller may need once a debt actually exists.
            await this.assertRepaymentNotReplayed(tx, user, widgetTag, requestId)

            const repayableBalance = await this.creditService.getRepayableBalance(user, tx)
            const owed = Math.max(0, toNumber(line.used))
            const repaid = Math.min(body.amount ?? Number.MAX_SAFE_INTEGER, owed, repayableBalance)

            // Nothing owed, or nothing to pay with. Not an error: a widget that
            // forces every user through this endpoint should not have to special
            // case the ones who owe nothing.
            if (repaid <= 0) {
                return this.repaymentResult(line, repayableBalance, 0)
            }

            await this.creditService.spendForCreditLineRepayment(tx, user, repaid)
            const updated = await this.repay(tx, user, widgetTag, repaid, requestId)

            return this.repaymentResult(updated, repayableBalance - repaid, repaid)
        })
    }

    private repaymentResult(
        line: user_credit_lines,
        creditBalance: number,
        repaid: number,
    ): RepayCreditLineResponseDto {
        return {
            repaid,
            credit_line_used: toNumber(line.used),
            credit_line_available: this.available(line),
            credit_balance: creditBalance,
        }
    }

    /**
     * Who is repaying whose credit line.
     *
     * A widget token repays its own line for the user named by email — it may act
     * on the user's behalf because it granted the line and the spending happened
     * in its own product. A user token repays the line of the widget they name.
     * Either way `widget_tag` from a widget caller comes from the token, never the
     * body, so a widget cannot reach another widget's line.
     */
    private async resolveRepaymentTarget(
        body: RepayCreditLineDto,
        userInfo: UserJwtExtractDto,
    ): Promise<{ user: string; widgetTag: string }> {
        const callerWidgetTag = userInfo.developer_info?.tag
        if (!callerWidgetTag) {
            if (!body.widget_tag) {
                throw new BadRequestException("widget_tag is required")
            }
            return { user: userInfo.usernameShorted, widgetTag: body.widget_tag }
        }

        await this.assertWidgetMayLend(callerWidgetTag)
        if (!body.email) {
            throw new BadRequestException("email is required when repaying with a widget token")
        }

        const target = await this.prisma.users.findUnique({ where: { email: body.email } })
        if (!target?.username_in_be) {
            throw new BadRequestException("User not found")
        }
        return { user: target.username_in_be, widgetTag: callerWidgetTag }
    }

    /** User-facing: every credit line granted to the caller, one per widget. */
    async getUserCreditLines(userInfo: UserJwtExtractDto): Promise<GetCreditLinesResponseDto> {
        const lines = await this.prisma.user_credit_lines.findMany({
            where: { user: userInfo.usernameShorted },
            orderBy: { widget_tag: "asc" },
        })

        return { credit_lines: lines.map((line) => this.toDto(line, line.widget_tag)) }
    }

    /**
     * Widget-facing: one user's credit line with the calling widget, plus the
     * balance they could repay it with, so that a single call answers "should I
     * make this user repay before serving them?".
     *
     * An unknown email returns a zeroed-out line rather than a 404 — otherwise
     * this becomes an oracle for whether an email is registered.
     */
    async getWidgetCreditLine(email: string, userInfo: UserJwtExtractDto): Promise<WidgetCreditLineDto> {
        const widgetTag = this.requireWidgetTag(userInfo)

        const target = await this.prisma.users.findUnique({ where: { email } })
        if (!target) {
            return { ...this.toDto(null, widgetTag), credit_balance: 0 }
        }

        const line = await this.getLine(target.username_in_be, widgetTag)
        const creditBalance = await this.creditService.getRepayableBalance(target.username_in_be)

        return { ...this.toDto(line, widgetTag), credit_balance: creditBalance }
    }

    /**
     * The credit line's own statement. Callable with a user JWT (their own lines,
     * optionally narrowed to one widget) or with a widget JWT, which always reads
     * its own line and must name the target user by email.
     */
    async getStatements(
        query: GetCreditLineStatementQueryDto,
        userInfo: UserJwtExtractDto,
    ): Promise<GetCreditLineStatementsResponseDto> {
        const where = await this.resolveStatementScope(query, userInfo)

        const page = Math.max(1, parseInt(query.page?.toString()) || 1)
        const pageSize = Math.max(1, parseInt(query.page_size?.toString()) || 10)

        const [statements, count] = await Promise.all([
            this.prisma.credit_line_statements.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { id: "desc" },
            }),
            this.prisma.credit_line_statements.count({ where }),
        ])

        return {
            count,
            statements: statements.map((statement) => ({
                id: statement.id,
                widget_tag: statement.widget_tag,
                type: statement.type,
                amount: toNumber(statement.amount),
                used_after: toNumber(statement.used_after),
                order_id: statement.order_id,
                request_id: statement.request_id,
                created_at: statement.created_at,
            })),
        }
    }

    private async resolveStatementScope(
        query: GetCreditLineStatementQueryDto,
        userInfo: UserJwtExtractDto,
    ): Promise<Prisma.credit_line_statementsWhereInput> {
        const widgetTag = userInfo.developer_info?.tag
        if (!widgetTag) {
            return {
                user: userInfo.usernameShorted,
                ...(query.widget_tag && { widget_tag: query.widget_tag }),
            }
        }

        // Widget caller. `IsWidgetGuard` cannot be used here because the route
        // also serves user JWTs, so the permission bit is checked by hand.
        await this.assertWidgetMayLend(widgetTag)
        if (!query.email) {
            throw new BadRequestException("email is required when reading a statement with a widget token")
        }

        const target = await this.prisma.users.findUnique({ where: { email: query.email } })
        return {
            // An unknown email matches nothing instead of erroring, for the same
            // reason getWidgetCreditLine does not 404.
            user: target?.username_in_be ?? "",
            widget_tag: widgetTag,
        }
    }

    private toDto(line: user_credit_lines | null, widgetTag: string): CreditLineDto {
        return {
            widget_tag: widgetTag,
            credit_limit: toNumber(line?.credit_limit),
            used: toNumber(line?.used),
            available: this.available(line),
            status: line?.status ?? credit_line_status.active,
        }
    }

    private requireWidgetTag(userInfo: UserJwtExtractDto): string {
        const widgetTag = userInfo.developer_info?.tag
        if (!widgetTag) {
            throw new BadRequestException("Widget tag is required")
        }
        return widgetTag
    }

    /**
     * The ceiling on the limit a widget may set for one user, defaulting to
     * DEFAULT_WIDGET_GRANT_MAX.
     *
     * This caps a single (user, widget) line, not a widget's total exposure: a
     * widget can hold many lines at the cap. What bounds the total today is who
     * holds CAN_GRANT_CREDIT_LINE, which is granted by hand.
     */
    private widgetGrantMax(): number {
        const raw = process.env.CREDIT_LINE_WIDGET_GRANT_MAX
        if (!raw) {
            return DEFAULT_WIDGET_GRANT_MAX
        }
        const parsed = Number(raw)
        if (!Number.isInteger(parsed) || parsed < 0) {
            // Falling back silently would hide a typo in a money setting behind a
            // limit nobody chose.
            this.logger.warn(
                `CREDIT_LINE_WIDGET_GRANT_MAX is not a non-negative integer ("${raw}"), ` +
                    `falling back to ${DEFAULT_WIDGET_GRANT_MAX}`,
            )
            return DEFAULT_WIDGET_GRANT_MAX
        }
        return parsed
    }
}
