import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { SubtitleCue, SubtitleStyle } from '@ai-video/shared';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : [text.slice(0, maxChars)];
}

function yForAlignment(
  alignment: SubtitleStyle['alignment'],
  height: number,
  marginV: number,
  lineCount: number,
  fontSize: number,
): number {
  const blockHeight = lineCount * fontSize * 1.25;
  if (alignment === 'top') return Math.max(fontSize, marginV);
  if (alignment === 'center') return Math.round((height - blockHeight) / 2);
  return Math.max(fontSize, height - marginV - blockHeight);
}

export async function renderSubtitlePng(options: {
  text: string;
  width: number;
  height: number;
  style: SubtitleStyle;
  outputPath: string;
}): Promise<string> {
  const { width, height, style } = options;
  const lines = wrapLines(options.text, style.maxCharsPerLine, style.maxLines);
  const fontSize = style.fontSize;
  const startY = yForAlignment(style.alignment, height, style.marginV, lines.length, fontSize);
  const stroke = Math.max(1, style.outlineWidth);
  const lineNodes = lines
    .map((line, index) => {
      const y = startY + index * fontSize * 1.25;
      return `<text x="50%" y="${y}" text-anchor="middle" dominant-baseline="hanging"
        font-family="${escapeXml(style.font)}, Helvetica, Arial, sans-serif"
        font-size="${fontSize}" font-weight="700"
        fill="${escapeXml(style.primaryColor)}"
        stroke="${escapeXml(style.outlineColor)}"
        stroke-width="${stroke}"
        paint-order="stroke"
        style="filter: drop-shadow(0 ${style.shadow}px 0 rgba(0,0,0,0.85))">${escapeXml(line)}</text>`;
    })
    .join('\n');

  const box =
    style.backgroundBox && lines.length
      ? `<rect x="${Math.round(width * 0.08)}" y="${startY - fontSize * 0.25}"
          width="${Math.round(width * 0.84)}" height="${lines.length * fontSize * 1.35}"
          rx="18" fill="rgba(0,0,0,${style.backgroundOpacity})" />`
      : '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${box}
  ${lineNodes}
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(options.outputPath);
  return options.outputPath;
}

export async function prepareSubtitleOverlays(options: {
  cues: SubtitleCue[];
  width: number;
  height: number;
  style: SubtitleStyle;
  workDir: string;
}): Promise<Array<{ path: string; startSeconds: number; endSeconds: number }>> {
  const overlays: Array<{ path: string; startSeconds: number; endSeconds: number }> = [];
  for (let i = 0; i < options.cues.length; i += 1) {
    const cue = options.cues[i]!;
    if (!cue.text.trim()) continue;
    const end = Math.max(cue.startSeconds + 0.2, cue.endSeconds);
    const path = join(options.workDir, `subtitle-cue-${String(i).padStart(3, '0')}.png`);
    await renderSubtitlePng({
      text: cue.text,
      width: options.width,
      height: options.height,
      style: options.style,
      outputPath: path,
    });
    overlays.push({ path, startSeconds: cue.startSeconds, endSeconds: end });
  }
  return overlays;
}

export async function writeSubtitleOverlayInputs(
  workDir: string,
  overlays: Array<{ path: string; startSeconds: number; endSeconds: number }>,
): Promise<{
  inputArgs: string[];
  filter: string;
  videoLabel: string;
}> {
  // Persist a tiny manifest for debugging
  await writeFile(
    join(workDir, 'subtitle-overlays.json'),
    JSON.stringify(overlays, null, 2),
    'utf8',
  );

  if (overlays.length === 0) {
    return { inputArgs: [], filter: '[0:v]null[vout]', videoLabel: 'vout' };
  }

  const inputArgs: string[] = [];
  let filter = '';
  let prev = '0:v';
  for (let i = 0; i < overlays.length; i += 1) {
    const cue = overlays[i]!;
    inputArgs.push('-i', cue.path);
    const out = i === overlays.length - 1 ? 'vout' : `vsub${i}`;
    const enable = `between(t\\,${cue.startSeconds.toFixed(3)}\\,${cue.endSeconds.toFixed(3)})`;
    filter += `[${prev}][${i + 1}:v]overlay=0:0:format=auto:enable='${enable}'[${out}];`;
    prev = out;
  }
  return { inputArgs, filter: filter.replace(/;$/, ''), videoLabel: 'vout' };
}
