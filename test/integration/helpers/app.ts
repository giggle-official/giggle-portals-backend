import { INestApplicationContext } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
// Must be the first thing loaded from `src`. `order.dto` and `order.service`
// form an import cycle that only resolves when the graph is entered through
// `AppModule` — the way `main.ts` enters it. Reaching for a service module
// directly enters from the wrong end and leaves `PaymentMethod` half-built,
// which surfaces as "Cannot read properties of undefined (reading 'WALLET')".
import { AppModule } from "src/app.module"

let ctx: INestApplicationContext | null = null

/**
 * Boots the real application context once per run and hands back its container.
 *
 * An application context rather than an HTTP server: the money paths are
 * reached through services, and standing up HTTP would drag in JWT minting and
 * `widget_sessions` seeding for no extra coverage of the thing under test.
 * Responses are still compared as serialised JSON (see `snapshot.ts`), so the
 * serialisation faults this project exists to prevent are still caught.
 */
export async function appContext(): Promise<INestApplicationContext> {
    return (ctx ??= await NestFactory.createApplicationContext(AppModule, {
        // Quiet by default; `ITEST_VERBOSE=1` restores logging, which is the only
        // way to see why bootstrap failed — Nest exits the process on a DI error
        // and the reason goes out through the logger it was just told to silence.
        logger: process.env.ITEST_VERBOSE === "1" ? ["error", "warn"] : false,
        abortOnError: false,
    }))
}

export async function get<T>(type: new (...args: never[]) => T): Promise<T> {
    return (await appContext()).get(type)
}

export async function closeApp(): Promise<void> {
    await ctx?.close()
    ctx = null
}

/**
 * Services are re-exported from here so that suites never import them directly.
 * That is not tidiness: importing `credit.service` first re-enters the cycle
 * described above from the wrong end. Going through this module guarantees
 * `AppModule` is loaded first no matter what order a suite lists its imports in.
 */
export { CreditService } from "src/payment/credit/credit.service"
export { CreditLineService } from "src/payment/credit-line/credit-line.service"
export { OrderService } from "src/payment/order/order.service"
