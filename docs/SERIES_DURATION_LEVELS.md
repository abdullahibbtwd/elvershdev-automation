# Series Studio — Duration Levels

**Status:** Implemented  
**Date:** 2026-11-20

## Three independent levels

| Level | Meaning | Default | Config keys |
| --- | --- | --- | --- |
| **Complete story / movie** | Total runtime of the whole work | Derived as count × episode when unset | `defaultStoryDurationSeconds`, `storyDurationSeconds`, `targetStoryDurationSeconds` |
| **Individual episode** | Runtime of one episode | **60 seconds** (unchanged) | `defaultEpisodeDurationSeconds`, `episodeDurationSeconds`, `targetEpisodeDurationSeconds` |
| **Individual video clip** | Max Grok Lite generation length | **15 seconds** | `defaultMaxClipDurationSeconds`, `maxClipDurationSeconds` |

Never treat movie duration as episode duration, or episode duration as clip duration.

## Production formats

- **episodic** (default): story ÷ episode → episode count; last episode may be shorter.
- **standalone**: one production unit equal to the complete story duration.

## Examples

| Story | Episode | Result |
| --- | --- | --- |
| 600s (10 min) | 60s | ~10 episodes |
| 600s (10 min) | 300s (5 min) | ~2 episodes |
| 600s standalone | — | 1 movie unit of 600s |
| unset | 60s + count 10 | legacy 10×60s = 600s story |

Each episode is later split into clips of ≤15s for Grok Lite, then assembled with FFmpeg.

## Compatibility

- Existing projects keep 60s episode defaults.
- `defaultStoryDurationSeconds` / lane & series story fields are **nullable** so legacy count×episode behaviour remains until configured.
- Existing rows are not rewritten by migration.

## Shared helper

`packages/shared/src/series/duration-plan.ts`

- `resolveSeriesDurationPlan`
- `planClipDurationsForEpisode`
- `estimateGrokLiteCostFromDurationPlan`
