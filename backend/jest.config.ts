export default {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  testTimeout: 15000,
  moduleNameMapper: {
    '^@oneto/shared$': '<rootDir>/../../shared/src/index',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!@noble/ed25519|@noble/hashes)/',
  ],
};
