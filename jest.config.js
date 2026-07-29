// Plain-JS Jest config. Kept as .js (not .ts) so Jest needs no ts-node to parse it —
// a .ts config requires ts-node, which isn't a declared dependency and so was missing
// in CI's clean `npm ci`, failing the unit job before any test ran. ts-jest (the preset)
// still compiles the TypeScript test files; only the config file itself is plain JS.
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Jest owns the unit tests under src/. Playwright E2E specs live in e2e/ and run via `npm run test:e2e`.
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

module.exports = config
