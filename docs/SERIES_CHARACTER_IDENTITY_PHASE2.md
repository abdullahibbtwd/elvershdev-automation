# Series Studio — Phase 2: Character Identity & Consistency

**Status:** Implemented  
**Date:** 2026-11-20  
**Depends on:** Phase 1 (xAI Grok Lite provider)

## Goal

Give every series character a persistent identity profile that is reused in continuity digests and future Grok Lite clip prompts. Lite does **not** support multi-reference face locking — textual canon + approved portraits maximize consistency but do not guarantee identical faces.

## What landed

### Schema
New nullable columns on `series_characters`:
- `gender_presentation`
- `skin_tone`
- `hairstyle`
- `facial_hair`

Migration: `20261120100000_series_character_identity_profile`

Existing fields still used: age, face, hair color, body, clothing, voice, personality, `canonicalVisualDescription`, `identityVersion`, `approvedAt`.

### Shared helpers (`packages/shared/src/series/character-identity.ts`)
- Identity profile schema + update schema
- `buildSeriesCanonicalVisualDescription`
- `formatCharacterIdentityForClipPrompt`
- `buildCharacterIdentityDigestLine`
- `validateCharactersForClipProduction`
- `seriesCharacterToIdentityProfile`

### Backend
- `GET /series/:id/characters/:characterId`
- `PATCH /series/:id/characters/:characterId/identity`
- `POST /series/:id/characters/:characterId/approve-identity`
- `POST /series/:id/characters/approve-identities`
- `POST /series/:id/characters/validate-clip`
- `POST /series/:id/characters/references/:assetId/approve`
- `POST /series/:id/characters/references/:assetId/primary`

Identity edits bump `identityVersion` and clear `approvedAt`. Approving locks the current canonical description.

Continuity digests and pipeline materialization now inject full identity prompt blocks instead of a single short prose string.

### Frontend
`SeriesCharactersPage` supports:
- View identity + approval state
- Edit identity fields
- Rebuild canonical description
- Approve one / all identities
- Generate reference portraits

## Apply migration

```bash
pnpm --filter @ai-video/api prisma:deploy
# or locally:
pnpm --filter @ai-video/api prisma:migrate
```

## Out of scope (later phases)
- Automatic Grok clip planner using these prompts (Phase 3–4)
- Guaranteed face consistency across clips
- Multi-reference / voice-reference uploads (Lite unsupported)
