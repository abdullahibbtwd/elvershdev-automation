import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

/**
 * Prefer the compiled worker binary so e2e does not depend on tsx IPC,
 * which can fail in restricted environments.
 */
export function spawnWorkerProcess(
  env: NodeJS.ProcessEnv = process.env,
): ChildProcessWithoutNullStreams {
  const workerDir = path.resolve(__dirname, '../../worker');
  return spawn('node', ['dist/main.js'], {
    cwd: workerDir,
    env: {
      ...env,
      NODE_ENV: 'test',
      GEMINI_USE_MOCK: 'true',
      GEMINI_TTS_USE_MOCK: 'true',
      FAL_USE_MOCK: 'true',
      VIDEO_GENERATION_PROVIDER: env.VIDEO_GENERATION_PROVIDER ?? 'hailuo',
      HAILUO_USE_MOCK: 'true',
      KLING_USE_MOCK: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
