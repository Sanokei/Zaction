# Schedule and weather context evidence

Nine original viewport images for `0.1.0-preview.7`, after **151 Node checks** (129 domain, 12 HTTP, the unchanged 10 provider fixtures), the production build and **31 production-browser flows** passed. Five flows cover the new schedule/query context. Extracted ZIP and tagged public CI/release verification are separate steps.

The first eight images use controlled, explicitly labelled weather fixtures and temporary test profiles. Their viewer timezone is intentionally **Pacific/Kiritimati (UTC+14)**; another New York viewer is checked against the same civil-date text. This proves that the entered calendar day does not shift with the viewer. Retrieval timestamps are real instants formatted for the viewer, so their displayed day can differ. All eight narrow images are **390×844**, `fullPage:false`; desktop is **1440×1100**. No image was resized or synthetically edited.

| Capture | State and scope |
|---|---|
| [Unset timing note](schedule-fallback-390x844.png) | Year, explicit “Time to be agreed,” and selected city reference zone |
| [Original/proposed schedule](known-raw-note-390x844.png) | Original unset time versus literal “7 pm Pacific (host note; please confirm),” separately showing New York/Chicago reference zones; no inferred conversion |
| [Changed query loading](query-loading-390x844.png) | Seattle/current date while a response is delayed; no earlier-query measurements |
| [Rejected response](unavailable-390x844.png) | Mismatched/invalid controlled payload becomes current-query unavailable without carrying its values or reason |
| [Same-query stale outlook](stale-390x844.png) | Labelled cached test forecast, original check timestamp, and uncertainty before planning advice |
| [In-place offline outlook](offline-390x844.png) | Only the matching in-memory city/day outlook is retained; original timestamp and offline warning remain visible |
| [Linked replacement](replacement-390x844.png) | New city/date daily context; fixture data is labelled; same-query reuse retains the original retrieval timestamp |
| [Replacement desktop](replacement-desktop.png) | Literal timing note and reference zone beside the scoped daily outlook |
| [Actual provider unavailable](weather-observed-390x844.png) | Unmocked New York/date request in a separate America/New_York viewer; no measurements invented |

The [actual response JSON](weather-observed.json) was recorded **October 29, 2026, 6:02:16 PM EDT** (`observedAt: 2026-10-29T22:02:16.933Z`). It returned `status: unavailable`, `cityId: new-york`, date `2026-10-31`, reason “The weather provider could not be reached. Try again later.” There is **no `checkedAt` or measurement**. `observedAt` records the audit, not a successful forecast retrieval. This is separate from the earlier CLI probe for October 30 and from every controlled forecast fixture.

The five targeted browser checks additionally verify ignored late responses; mismatched available and unavailable identities; invalid displayed metadata; empty-date/no-request behavior; retry/checked-time preservation; offline reload with no persistent weather data; current-query reconnect; literal note persistence; and unchanged participation/history on original and linked plans. The existing 26 flows retain their strict focus and durable-save/reload assertions. These are desktop Chromium checks, not actual-phone validation. A green workflow does not establish provider reachability because its live smoke step is nonblocking; inspect the actual observation/annotation separately.

See the [source-pinned audit, primary references, and bounded plan](../../schedule-weather-audit.md). Earlier preview evidence and releases remain unchanged. This README and its relative image/JSON links are accessible through GitHub; cloud workspace paths are not needed for review.
