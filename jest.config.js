module.exports = {
  preset: 'ts-jest/presets/default',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
  },
  // The app compiles with `jsx: "react-native"`, which emits JSX untouched for
  // Metro to finish. Under Jest nothing finishes it, so importing any .tsx from
  // a test died on the first `<`. Overridden here only — the app's own build is
  // unchanged, and this is what lets a component be tested at all.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};
