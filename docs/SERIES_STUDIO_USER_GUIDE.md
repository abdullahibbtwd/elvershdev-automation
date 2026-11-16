# Series Studio — User Guide

## Concepts

| Concept | Meaning |
| --- | --- |
| **Movie planning** | AI writes the full series bible (including the ending) and episode outlines. Cheap compared to media. |
| **Episode scripting** | Generates the next episode script + continuity check. |
| **Media production** | Visuals → motion → narration → FFmpeg render (credits / GPU). |
| **Publishing** | Posts a **completed** render at the lane publish time. Independent of production. |

## Recommended daily setup (Series A + B)

1. Enable Series Studio.
2. Set Series A publish `08:00` and Series B `19:00` in `Africa/Lagos` (or your zone).
3. Set **production lead time** (e.g. 240 minutes) so prep starts before publish.
4. Production start mode: **At next scheduled production window** (default).
5. Turn on **Automatic Episode Production**, keep approvals ON, leave **Automatic Publishing** off until channels are ready.
6. Click **Plan Movies for All Lanes** — review and approve both movies.
7. Leave the studio running. Do not click Generate / Produce / Publish every day unless you want a manual override.

## Master switches

- **Automatic Episode Production** — allows auto scripts + media *only* for stages that are also ON.
- **Automatic Movie Planning** — plans a movie when a lane has none.
- **Automatic Publishing** — hands completed episodes to social at publish time.
- **Automatic Replacement Planning** — prepares the next movie early; **Automatic Replacement Approval** stays OFF by default.

If production master is ON but visuals are OFF, scripts can still run; automatic media **stops** before visuals with a clear blocker.

## Plan ahead vs produce now

- **Plan Movie / Plan Movies for All Lanes** → complete plans only (unless you explicitly enable start-media).
- **Produce Next Episode** / **Run Now** → manual advance; may spend media credits; still respects approvals.
- **Prepare Next Episodes** → queues eligible prep across lanes inside production windows.

## If something stalls

| Symptom | What to do |
| --- | --- |
| Awaiting approval | Approve movie or episode |
| Blocker mentions a disabled stage | Enable that stage or use Produce Next |
| Ready to publish but not posted | Enable Automatic Publishing or publish manually |
| Missed publish window | System reschedules when the render is ready — no duplicate episode |
| Emergency stop | Resume from Settings / overview controls |
