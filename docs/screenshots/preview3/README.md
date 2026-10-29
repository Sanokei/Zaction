# Social community preview captures

These 11 original images accompany the `0.1.0-preview.3` local release candidate after a frozen install, 81 Node checks (65 domain, 6 HTTP, 10 weather fixtures), the production build, and 14 social browser flows passed. Extracted-release validation, tagged CI/release results, and provider observations are separate evidence.

Every narrow image is exactly **390×844**, captured with `fullPage: false`; desktop is **1440×1100**. The browser uses America/New_York time. Maya and Noah are temporary test profiles used to exercise the public flow, not real-community activity or an attendance claim. Template covers are original illustrations, not event photographs. These browser viewport checks do not establish actual-phone or GPU behavior.

| Capture | Exercised state and evidence boundary |
|---|---|
| [Onboarding](onboarding-390x844.png) | Public pseudonym/coarse-city onboarding with private device interests |
| [Community feed](feed-390x844.png) | Social feed populated by the temporary test profiles |
| [Desktop feed](feed-desktop.png) | Main feed, navigation, and contextual planning layout at 1440×1100 |
| [Plan](plan-390x844.png) | Member-created gathering plan, estimates, and separate participation controls |
| [Available test forecast](weather-available-390x844.png) | Controlled available/rain scenario with a visible **test forecast** label; not live provider data |
| [Unavailable weather fixture](weather-unavailable-390x844.png) | Deterministic **controlled test failure**, checking the unavailable UI |
| [Actual provider observation](weather-observed-390x844.png) | Unmocked configured-provider request observed **unavailable** in the current cloud; not a passing live-weather check |
| [Pending submission](pending-390x844.png) | Durable local work waiting for acceptance; pending is not published or counted |
| [Rejected submission](rejected-390x844.png) | Explicit rejection retains the original action/submission context |
| [Recovery](recovery-390x844.png) | Recoverable draft/input state after the exercised failure |
| [Final feed](feed-final-390x844.png) | Final skill-guided palette, bundled type, touch-target, and copy review |

Available/sunny/rainy conditions exercised by the browser tests are fixtures, visibly labeled as test forecasts. The separate actual provider check returned unavailable; its underlying cloud read was blocked by proxy CONNECT 403. The saved network draft was not applied to the running instance. CI's separate live-weather observation can warn/fail without failing its job, so a green workflow does not establish provider success.

See the [social increment and source evidence](../../social-planning-increment.md) and [applied frontend design review](../../frontend-design-review.md). Previous release captures remain unchanged in their original directories.
