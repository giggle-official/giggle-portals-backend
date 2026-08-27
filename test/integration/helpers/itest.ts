/**
 * `describeItest` instead of `describe`: skips the whole suite when
 * `global-setup.ts` could not reach a database, so a developer without a local
 * MySQL sees skipped tests rather than a wall of red.
 */
export const describeItest = process.env.ITEST_DB === "1" ? describe : describe.skip

/** Every row these tests create carries this prefix, and teardown deletes by it. */
export const PREFIX = "zz_itest_"

export const itestId = (name: string) => `${PREFIX}${name}`
