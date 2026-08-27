/**
 * Integration tests run against a real MySQL. They exist because the unit suite
 * mocks Prisma away, and a mocked round-trip cannot tell you whether a value
 * survives storage — "0.037 went in and 0.037 came out" is a tautology when the
 * database is a jest.fn().
 *
 * Separate config rather than a testRegex tweak on the main one: these need a
 * database, run serially, and must not fail CI when no database is reachable.
 */
module.exports = {
    rootDir: "../..",
    testEnvironment: "node",
    testRegex: "test/integration/.*\\.itest\\.ts$",
    // `module: NodeNext` in tsconfig.json implies `esModuleInterop`, which is how
    // `nest build` gets a working default import of CommonJS packages like
    // markdown-it. ts-jest compiles to plain CommonJS, dropping that implication
    // and turning those imports into `undefined` — the app then fails to boot with
    // "markdown_it_1.default is not a constructor". Restore it explicitly.
    transform: { "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: { esModuleInterop: true } }] },
    moduleFileExtensions: ["js", "json", "ts"],
    moduleNameMapper: { "^src/(.*)$": "<rootDir>/src/$1" },
    globalSetup: "<rootDir>/test/integration/global-setup.ts",
    // One database, shared fixtures, row locks in the concurrency tests: parallel
    // workers would fight each other for no gain.
    maxWorkers: 1,
    testTimeout: 60_000,
}
