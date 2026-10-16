module.exports = {
  preset: "jest-expo",
  transform: { "^.+\\.mjs$": ["babel-jest", { presets: ["babel-preset-expo"] }] },
  modulePaths: ["<rootDir>/node_modules"],
  testMatch: ["**/tests/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.cjs"],
  clearMocks: true,
};
