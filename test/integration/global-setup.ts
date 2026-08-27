import { PrismaClient } from "@prisma/client"

/**
 * Probes the database once and records the verdict for the suites to read.
 *
 * A machine with no database must get skipped tests, not red ones — otherwise
 * the first person to run the suite without a local MySQL concludes the branch
 * is broken. The flag is an env var because `describe.skip` has to be decided
 * synchronously, before any test body runs.
 */
export default async function globalSetup() {
    // Crons are registered when the Nest context boots. Slot 2 keeps them from
    // firing against the same database the tests are asserting on.
    process.env.TASK_SLOT = process.env.TASK_SLOT || "2"

    const prisma = new PrismaClient()
    try {
        await prisma.$queryRaw`SELECT 1`
        process.env.ITEST_DB = "1"
    } catch (error) {
        process.env.ITEST_DB = "0"
        // eslint-disable-next-line no-console
        console.warn(
            `\n[integration] no database reachable, suites will be skipped: ${(error as Error).message}\n` +
                `[integration] set DATABASE_URL in .env to run them\n`,
        )
    } finally {
        await prisma.$disconnect()
    }
}
