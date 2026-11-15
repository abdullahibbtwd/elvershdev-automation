import type { Config } from 'jest';
import path from 'node:path';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: path.join(__dirname, 'tsconfig.json'),
      },
    ],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@ai-video/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
  },
};

export default config;
