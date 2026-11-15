import { createRequire } from 'node:module';

/**
 * @google/genai ships as `type: module`. Under moduleResolution Node16,
 * a static ESM import from our CommonJS worker build is rejected (TS1479),
 * even though a runtime `require()` of its CJS export works. Bridge it.
 */
const nodeRequire = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const genai = nodeRequire('@google/genai') as typeof import('@google/genai', {
  with: { 'resolution-mode': 'import' },
});

export const GoogleGenAI = genai.GoogleGenAI;
