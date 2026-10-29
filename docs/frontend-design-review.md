# Community frontend design review

The human asked for the frontend skill and a community app they would want to use, while keeping the PDF's product direction. The installed skill catalog did not include frontend design. The public upstream `frontend-design` skill was located and read at [anthropics/skills, exact commit ca45fc496a3436251f191354091d557da31c15b5](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/skills/frontend-design/SKILL.md). It was applied as a design and critique guide, not installed or represented as an available plugin.

## Design brief and review

Zaction should help people find a reason to spend time together and turn that connection into useful shared action. A BBQ, potluck, game night, neighborhood walk, or practical help request is a concrete entry into Learn, Serve, and Organize (§§1, 3.3–3.5). Post interest and RSVPs support discovery and coordination; a separate explicit vote decides a proposal. No popularity ranking or extra voting weight follows from social activity (§3.8).

The first social pass had useful onboarding and feed interactions, but repeated decorative labels and a large starter carousel pushed actual posts below the first mobile viewport. The critique pass moves posts first in a populated community, retains prominent starter ideas for an empty community, makes controls larger, reduces ornamental labels, and uses the gathering illustrations as the main visual character.

## Compact design system

| Token | Value and purpose |
|---|---|
| Picnic paper | `#F7FAF2`, a light outdoor/pavilion background |
| Table white | `#FFFFFF`, readable content surfaces |
| Ink | `#16251D`, clear body text |
| Canopy | `#1B5B42`, primary actions and focus |
| Lemon | `#F2D658`, restrained emphasis |
| Ember | `#ED6C4A`, a secondary accent relating to the BBQ illustration |

Use self-hosted Bricolage Grotesque variable type with intentional display/body weights. The OFL license ships in `public/fonts/`; browser installation does not depend on a font CDN. Keep long reading lines below roughly 80 characters and important mobile metadata readable. Social/RSVP controls have comfortable touch targets. Respect reduced motion; emphasize feedback for user actions rather than decorative page animation.

Desktop uses a quiet community navigation rail, a readable main feed, and concise contextual planning help. Mobile puts the composer, topic controls, and real posts in the primary column, with a short bottom navigation. The weather card is next to the date/planning context, including when forecasts cannot be loaded.

```text
Desktop:  navigation | composer, topics, real posts | useful planning context
Mobile:   compact greeting → composer → topics → actual post → starter ideas
Onboard:  public pseudonym → broad city → optional interests → community
Plan:     idea → date/place → weather + rain backup → cost estimate → discuss
Decision: social interest and RSVPs → separate group vote → notes and next steps
```

## Product and evidence boundaries

RSVP visibility is explained near the action; it is a public intention, not attendance. A no-quorum close is labeled as no decision, and one self-reported task is a first step rather than completion of a gathering. Budget totals and per-person arithmetic are planning estimates, with no collection or payment. Weather uses real Open-Meteo data when reachable, explicit timestamps/staleness, and a useful unavailable state. Sunny/rain browser fixtures are visibly labeled test forecasts and are not presented as current conditions.

The critique is checked against real desktop and narrow-browser screenshots, keyboard navigation, offline saves, and working interactions. Actual output/counts are recorded with the release source after validation; the previous releases' counts remain historical.
