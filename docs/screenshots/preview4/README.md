# Bring & share viewport evidence

Seven original browser captures for `0.1.0-preview.4`, following **118 Node checks** (99 domain, 9 HTTP, 10 weather fixtures), a production build, and **19 browser flows**. Five flows exercise the new bring-item interaction. Release ZIP and tagged CI results are separate verification steps.

The test profiles Maya and Noah are temporary actors, not existing community activity. The two independently authored plans are **Park cookout · bring & share** and **Covered supper · bring & share**. The captures show the cookout, whose first two distinct slots deliberately share the label “Water.” All narrow images are exactly **390×844** with `fullPage: false`; desktop is **1440×1100**. Times use America/New_York.

| Original capture | Exercised state |
|---|---|
| [Open items](open-390x844.png) | Available numbered slots with distinct accessible names, public-intent disclosure, and refresh |
| [Accepted offers](claimed-390x844.png) | Maya and Noah cover separate Water entries; only the acting owner has a release command |
| [Pending offer](pending-claim-390x844.png) | Real offline worker reload retains the original queue ID; the slot stays visibly available until acceptance |
| [Pending release](pending-release-390x844.png) | Real offline worker reload retains the exact accepted claim ID; confirmed responsibility remains visible |
| [Conflict](conflict-390x844.png) | One of two competing offline offers loses; current owner and terminal rejection remain visible after reload |
| [Recovered offer](recovered-390x844.png) | After the winner releases, the other member deliberately makes a new accepted offer; keyboard focus remains on the same native control |
| [Desktop](claimed-desktop.png) | Main-column list before discussion, current owners and available items, beside the existing planning/decision context |

Screens are scrolled to the actual card or affected row; the main plan heading can be above the viewport. These are original viewport captures, not resized full-page images. The long item label, pending/conflict explanations, controls, and keyboard focus were inspected without horizontal overflow. The desktop's adjacent weather values come from the existing **controlled test forecast** fixture, not a live-provider observation; this increment did not repeat cloud weather validation.

The tests additionally verify a real server commit with a lost response and stable-ID replay, malformed incoming claim data preserving the prior browser snapshot/draft/identity, and unchanged ballots, reactions, RSVPs, progress, outcomes, and minutes. These are desktop Chromium results, not actual-handset evidence. See the [bounded plan, primary sources, and implementation record](../../bring-items-increment.md). Prior preview capture sets remain unchanged.
