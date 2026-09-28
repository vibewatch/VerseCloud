# Production user-journey audit

Last verified: 2026-09-28

## Evidence model

Run the reproducible audit with:

```bash
npm run audit:user-journey
```

The audit creates one screenshot and one structured diagnostic record after every interaction:

- `test-results/user-journey-audit/desktop/`: 52 desktop screenshots plus `interactions.json`.
- `test-results/user-journey-audit/mobile/`: 13 mobile and landscape screenshots plus `interactions.json`.
- Playwright traces are retained for failures under `test-results/`.

These runtime artifacts are intentionally ignored by Git. The test itself is the durable, reproducible evidence definition.

## Coverage inventory

| Area | Recorded interaction evidence |
| --- | --- |
| Entry | Landing state, first keyboard Tab, entry action, audio startup fallback |
| Global controls | Mute, restore sound, all four seasons, compass reset, brand home link |
| Period browsing | All 11 literary periods and their first rendered work |
| Map | Single selection path, cluster expansion, same-place chooser, zoom in/out, drag/pan, route transition |
| People and places | Life-trail toggle, folded verse slip and unfold, station register, trail-poem selection, poet register search, companion hand-off |
| Library | Open by pointer and keyboard, poems/poets tabs, focus trap, all curriculum filters, author search, empty state, selection, evidence update |
| Closing behavior | Explicit close button, Escape, outside scrim, focus restored to trigger |
| External links | Text source, OpenFreeMap, and OpenStreetMap links open in a new page |
| Responsive states | 1440x960 desktop, 390x844 portrait, 844x390 landscape |
| Full content | Separate Playwright sweep selects and measures all 313 poems across all 11 periods at 390x844 |

Every recorded step checks duplicate IDs, accessible control names, horizontal overflow, active focus, and core target dimensions. Desktop targets use a 24px WCAG 2.5.8 baseline; the touch journey enforces 44x44px.

## Findings and implemented solutions

| Finding | User impact | Implementation |
| --- | --- | --- |
| The first Tab on the landing view focused a period button hidden behind the entry overlay | Keyboard users lost their place before entering | The background experience is now inert and hidden from the accessibility tree until entry; the entry action is the first focus target |
| The library behaved visually like a modal but allowed focus into the map and did not restore focus when closed | Keyboard and screen-reader context could escape or disappear | Added dialog semantics, background isolation, a Tab/Shift+Tab focus loop, Escape handling, and trigger focus restoration |
| Mobile navigation, season, audio, filter, close, and search controls measured 28-42px | High risk of missed or accidental taps | Core mobile controls now meet a 44x44px minimum without overlapping portrait or landscape layouts |
| Dense Tang and Song maps forced every marker label to overlap | Place names obscured terrain and the selected poem | Added collision-aware labels and zoom-driven progressive disclosure while keeping the selected place and representative anchors visible |
| Search empty-state, evidence, metadata, and entry helper text were too small and muted | Important guidance was visually easy to miss | Increased readable type sizes, contrast, control height, and drawer width while retaining the visual system |
| The same-place radial chooser placed its upper option over the verse slip | A transient choice obscured the poem being compared | Choices now fan into the lower semicircle beneath the verse slip |
| With 313 poems, lifting nearby places onto stacked tiers moved markers away from their coordinates and still overlapped | Readers could not tell where a poem was written, and tiered markers were hard to hit | Markers keep their true coordinates at one height; nearby places merge into count seals that expand on zoom or click, and same-place groups of more than six open a scrollable register instead of a crowded fan |
| Poems appeared as isolated points with no sense of the life behind them | The relationship between a poet's movements and their work was invisible | A 时 · 人 · 地 folio gives each poem its place on the period axis and the poet's lifespan, age at writing, and distance from home. Life-trail mode draws numbered stations, folds the verse slip, dims unrelated poems, and syncs a station register with the map |
| The earlier audit recorded diagnostics but did not fail on them | Console errors and accessibility regressions could ship with a green test | The audit now fails on runtime/page errors, unexpected request failures, duplicate IDs, unlabeled controls, overflow, and undersized core targets |

## Network boundaries

The default audit clicks every external link and verifies its new-page behavior through a deterministic local response. This proves the application interaction without making third-party uptime part of the release gate.

To additionally verify live external destinations:

```bash
RUN_EXTERNAL_AUDIT=1 npm run audit:user-journey
```

OpenFreeMap tile requests canceled during a camera transition are retained in `expectedAbortedRequests` only when the host is `tiles.openfreemap.org` and Chromium reports `ERR_ABORTED`. All other request failures remain release-blocking.

## Release gates

Before declaring the UI audit complete, run:

```bash
npm run typecheck
npm test
npm run verify:corpus
npm run build
npm audit --audit-level=high
npm run test:e2e
git diff --check
```

The full Playwright suite combines the 65-step recorded journeys with all-period browsing, the 313-poem mobile layout sweep, and narrow-screen WebGL survival checks.
