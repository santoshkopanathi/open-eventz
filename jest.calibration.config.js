// Manual LLM calibration runner (v1.2 spec, Layer 6, Tier 2).
// Runs the REAL Claude model against the price ground-truth set — costs money and
// requires ANTHROPIC_API_KEY, so it is NOT part of `npm test`/CI. The target file is
// named *.llm.ts (not *.test.ts) precisely so the default jest config never collects it.
// Run with: npm run calibrate:price
// Kept as .js (not .ts) so no ts-node is needed to parse it in a clean environment.
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/price-calibration.llm.ts'],
  testTimeout: 60_000,
}

module.exports = config
