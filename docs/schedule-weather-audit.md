# Schedule and forecast context audit

Prepared October 29, 2026 (America/New_York), before substantive schedule/weather edits. Source: `95077a924b4fcd892beacf5473ee9349b849bfd2`, immutable public preview.6. [Spec.pdf](https://github.com/Sanokei/Zaction/blob/262a06b2e67ca676d30c8f11d92d6fb4a902ac88/Spec.pdf) remains SHA-256 `243bb265e8a5aa80621070a73f858b375149cebdbcbeccf3500a4d12576baa3f`. No applicable AGENTS.md was found. The prior screenshot gallery is publicly accessible [on GitHub](https://github.com/Sanokei/Zaction/blob/95077a924b4fcd892beacf5473ee9349b849bfd2/docs/screenshots/preview6/README.md).

## Findings and sources

`planning.date` is a civil date; `timeHint` is optional free text such as “Late afternoon” or “7 pm Pacific.” It is not a parsed time, event instant, or timezone-aware appointment. Blank/whitespace notes currently disappear from “Date & time,” and the date display omits the year. The known city IANA zone is not shown alongside the schedule. Keep the entered note rather than deriving a clock time from it.

Weather is intentionally a daily outlook for a selected public city centroid and city-local date, not the free-text venue, a precise meetup spot, or event hour. The backend already validates the horizon/units/measurements, uses city+date cache keys, preserves `checkedAt`, and restricts stale fallback to the same query. Ten existing provider-fixture tests cover these rules. API responses are excluded from the service-worker cache; an offline reload currently has no persisted weather. These behaviors do not need new provider features or duplicate tests.

Actual UI gaps: a previous result can render under new city/date props before an effect clears it; the client accepts response city/date without matching them to the requested query; and an in-place offline view can retain available/favorable wording without identifying that the retained result is cached. Initial loading should not briefly claim a missing forecast. A general same-city/day forecast can legitimately be reused across linked plans with its original check timestamp; it carries no consent or event-readiness state.

Primary sources read October 29, 2026:

- [WHATWG HTML](https://github.com/whatwg/html/blob/939677714df7379fee3667040113b41c91c851e7/source): a date is Gregorian year/month/day without timezone information. The app's free-text note does not become a valid parsed time merely by being displayed beside it.
- [TC39 Intl.DateTimeFormat](https://github.com/tc39/ecma402/blob/3691634ebc1794f2af74cb26e59824b21090c3ad/spec/datetimeformat.html): omitted timezone uses the viewer/system zone; explicit named zones are resolved. Format a civil date independently of viewer-zone shifts, and show the selected city's reference IANA zone separately.
- [Open-Meteo schema](https://github.com/open-meteo/open-meteo/blob/e29ee554151b43076ae32724028eea9cdefab7c4/openapi/forecast.yml#L528-L551) and [daily alignment](https://github.com/open-meteo/open-meteo/blob/e29ee554151b43076ae32724028eea9cdefab7c4/Sources/App/Helper/ForecastapiQuery.swift#L445-L456): IANA timezone and daily local windows, with a maximum 16-day forecast request. Individual values can still be missing.
- [Daily precipitation aggregation](https://github.com/open-meteo/open-meteo/blob/e29ee554151b43076ae32724028eea9cdefab7c4/Sources/App/Controllers/VariableDaily.swift#L226-L227): a daily maximum of hourly precipitation probabilities; it is not a prediction for the meetup hour.

Spec §3.7 pp.10–11 requires useful logistics and stated uncertainty; §4.5 p.13 requires honest freshness; §4.6 pp.13–14 requires foreground recovery. Preserve Learn/Serve/Organize, equal voice, listing/decision separation, and prior participation/history. No new schedule parser, provider, GPS/geocoding, notifications, payments, persistent weather store, or environment publication is in this increment.

## Actual provider evidence

One current unmocked `node --use-env-proxy scripts/check-weather.mjs` observation, recorded **October 29, 2026, 5:49:48 PM EDT**, returned exit **1**, `status: unavailable`, `cityId: new-york`, date `2026-10-30`, reason “The weather provider could not be reached. Try again later.” No `checkedAt` or measurements were returned; the observation time is not a successful forecast timestamp. The request targets `api.open-meteo.com/v1/forecast` using public NYC centroid `40.7128,-74.006` and `America/New_York`.

The ten backend fixtures are controlled tests. Earlier main/release runs `40957281974`/`40957808297` separately reported successful real provider checks for preview.6; no values or timestamps are inferred from their notice alone. CI's live-provider step is nonblocking, so an overall green run does not establish live weather. No provider provisioning or network-setting application is performed here.

## Bounded implementation plan

1. Display civil dates with their year, independent of viewer timezone. Show raw nonempty time notes as provided; blank notes explicitly say **“Time to be agreed.”** Show the known city's IANA reference zone separately, without assigning that zone to arbitrary free text or converting an unprovided time. Preserve all stored values.
2. Reuse that schedule meaning in comparison, detail and feed. Keep comparison readable at 390×844. A copied time note remains editable and visible when date/city changes; do not silently reinterpret or delete it.
3. Match weather response identity to the exact requested city/date, for available and unavailable payloads. Validate displayed check timestamp, description, stale flag and measurement ranges; a mismatched/invalid payload becomes an honest unavailable result for the requested query.
4. Render only weather state matching current city/date/retry generation. A changed query immediately shows loading or offline guidance with no previous metrics. Preserve the existing effect cleanup so late responses cannot overwrite a newer query. Same-query linked plans may reuse city/day data and its original timestamp; do not introduce an action-specific weather cache.
5. Clearly label daily/city scope, the selected IANA reference zone, daily maximum precipitation chance and original check time. Stale or offline retained results lead with cached/uncertain wording instead of current favorable planning advice. Empty-query/offline reload states invent no measurements. No persistent weather caching is added.

## Retry scope and acceptance

The server's 30-minute cache is unchanged. Checking again requests the current city/date; a fresh cache hit retains its original `checkedAt`, and a failed refresh may expose only that query's explicitly stale result. Invalid/out-of-range dates return unavailable before provider access or cache fallback. Forecast dates are the selected city's today through day 15. A date/location change must never reuse another query's cache or reason. Offline reload has no weather data, and reconnect/retry checks the current query.

Add targeted browser evidence for unset/raw timing notes and civil dates in a different viewer zone; changed city/date with delayed/out-of-order responses; mismatched available/unavailable payloads; stale current-query retry; clearing a date; offline/reload/reconnect; and a linked replacement with fresh query identity or honest same-query timestamp reuse. Preserve the 10 backend tests rather than duplicating their coverage. Inspect current original desktop and 390×844 schedule/weather captures, keep controlled fixtures separate from any actual provider observation, then verify the extracted build and exact public release. Use accessible GitHub gallery links in the handoff. Earlier releases remain immutable.

## Implemented and locally verified

Preview.7 implements explicit unset/raw timing notes, year-preserving civil dates, separate city reference zones, synchronous weather query/generation guards, strict response identity/display-field checks, and honest stale/offline context. IANA identifiers have a preferred break after the slash so city identifiers stay intact on narrow screens. No data schema, backend provider/cache policy, or participation behavior changed.

Actual checks: **151 existing Node checks**, the production TypeScript/Vite/service-worker build, and **31 production-browser flows** passed on the final source assets. The five targeted flows exercise timing note persistence and calendar-day invariance between New York and UTC+14 viewers; delayed/late query responses and date clearing; mismatched available/unavailable payloads and invalid timestamp/stale metadata; same-query stale retry and exact retrieval timestamps; in-place offline versus reload/reconnect; and linked-plan query identity with legitimate same-city/day timestamp reuse. Existing focus, exact pending-operation retention, consent/history, equal-weight ballots, RSVP and bring-item tests remain in place.

The [nine original captures and actual observation JSON](screenshots/preview7/README.md) were inspected at 390×844/1440×1100. They distinguish fixture values from an unmocked final UI request recorded **October 29, 2026, 6:02:16 PM EDT**, for `new-york/2026-10-31`: unavailable, no successful retrieval timestamp or measurements. That observation is independent from the earlier CLI request for October 30. The public version/tag and `RELEASE.json` identify the final committed source; extracted/public build verification follows these local checks. Prior evidence and Spec pins remain unchanged.
