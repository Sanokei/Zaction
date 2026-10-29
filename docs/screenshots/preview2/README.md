# Multi-action browser captures

These original captures are historical evidence for `0.1.0-preview.2`, source `14f314293bfd95b04ec732b9308b65cf398f0e1f`. Its matching local pipeline passed 52 domain/HTTP checks, the production build, and 16 browser-flow checks. These counts and images do not validate the later social-planning increment. Release publication and its workflow result are separate evidence.

All narrow captures are exactly **390×844**, captured with `fullPage: false`; the desktop image is **1440×1100**. The browser uses America/New_York time. They show real exercised application states, not mockups or proof of actual-phone/GPU behavior. The original preview.1 images in the parent directory remain unchanged.

| Capture | State shown |
|---|---|
| [Desktop home](home-desktop.png) | Multi-action directory and entry into member authoring |
| [Narrow home](home-390x844.png) | Navigation and home layout at the original narrow viewport |
| [Open proposal](open-390x844.png) | An action's proposal before final closure |
| [Pending submission](pending-390x844.png) | Durable local intent awaiting acceptance; pending is distinct from counted |
| [Rejected submission](rejected-390x844.png) | Action-specific rejection and retained submission context |
| [Input retained after save failure](recovery-390x844.png) | Unsaved input remains visible and recoverable |
| [Saved after retry](storage-recovered-390x844.png) | Retried browser persistence succeeds without replacing the input |
| [Rejected contribution restored](restored-390x844.png) | Original rejected text restored to its original action; unrelated action draft remains separate |

See the [multi-action flow and evidence](../../multi-action-flow.md) for the functional acceptance contract and the distinction between local checks and tagged-release validation.
