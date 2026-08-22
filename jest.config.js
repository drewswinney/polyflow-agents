module.exports = {
  preset: 'ts-jest/presets/default',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};
