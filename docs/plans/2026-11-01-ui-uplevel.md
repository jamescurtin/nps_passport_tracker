# UI Uplevel Plan

Date: 2026-11-01
Scope: better mobile support, modern styling, overall polish.
Decisions (confirmed with owner):

- Stack: stay on vanilla JS + plain CSS. No new runtime or build dependencies.
  Modern CSS (custom properties, `dvh`, `color-mix()`, `env()`, container
  queries, native `<dialog>`) covers every need. Inline SVG icons, no icon lib.
- Dark theme: yes, automatic via `prefers-color-scheme`.
- Mobile panels: bottom sheets. Desktop keeps floating cards / centered dialogs.

## 1. Current-state audit

Evidence from a code read (`src/index.js`, `src/js/*.js`, `src/css/map.css`)
and a visit to the live site at 1440x900.

### Structural problems

| #   | Problem                                                                                                                                                                                                                                                                           | Where                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| S1  | All page chrome (title, subtitle, legend, "Parks in State" button) is SVG `<text>`/`<rect>` inside the map SVG. It cannot use CSS layout, wraps badly, needs manual x/y repositioning on resize, and is hidden during zoom.                                                       | `src/index.js:110-181`, `207-221`, `742-749`      |
| S2  | Mobile is decided in JS once at load (`window.innerWidth <= 768`) for title text, subtitle, and map scale. Rotation or resize does not re-evaluate the title.                                                                                                                     | `src/index.js:31-35`, `199-205`, `687-689`        |
| S3  | Four overlays, four implementations: park modal (`modal.js`, `display`), stats (`statistics.js`, create/`remove()`), search (`search.js`, `display`), state list (`index.js`, classes). Four copies of close-button CSS. Only the park modal manages focus. No focus trap in any. | `map.css:226`, `356`, `567`, `719`                |
| S4  | No HTML template. Everything is appended to `<body>` by D3. No `theme-color`, `description`, `apple-touch-icon`, or manifest.                                                                                                                                                     | `webpack.config.js:40-44`                         |
| S5  | `colorscale.js` is a separate webpack entry only to export a 2-stop D3 scale. Color should live in CSS tokens so dark mode can override it.                                                                                                                                       | `webpack.config.js:27-35`, `src/js/colorscale.js` |

### Mobile defects

| #   | Problem                                                                                                                                    | Where                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| M1  | Search and address inputs render below 16px on mobile. iOS Safari auto-zooms the page on focus.                                            | `map.css:666-668`, `1173-1176`                     |
| M2  | `100vh` on `.map-container` and `height: 100%` on body. iOS Safari toolbars overlap the bottom buttons. Needs `100dvh`.                    | `map.css:55-64`, `75-80`                           |
| M3  | Fixed bottom buttons use `bottom: 24px`/`16px` with no `env(safe-area-inset-bottom)`. They sit under the home indicator on notched phones. | `map.css:521-525`, `678-682`, `652-656`, `836-840` |
| M4  | Park markers are `r=3` (6px tap target). No enlarged hit area on coarse pointers.                                                          | `src/index.js:40`, `279-307`                       |
| M5  | `:hover` fills on states are sticky on touch. Not wrapped in `@media (hover: hover)`.                                                      | `map.css:118-121`                                  |
| M6  | State name tooltip is `mouseover`-only, positioned at raw `pageX/pageY`, can overflow the right/bottom edge.                               | `src/index.js:258-270`, `294-306`                  |
| M7  | Centered "modal" for the state park list on a phone. Wide `<table>` with 16px cell padding and two columns. Visit dates wrap badly.        | `map.css:430-480`, `src/index.js:577-617`          |
| M8  | Stats bar chart is a fixed 350px `viewBox` with 10px labels; fine on desktop, small on phones.                                             | `src/js/statistics.js:182-185`                     |

### Visual / polish defects

| #   | Problem                                                                                                                                                                                                                                                         | Where                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| V1  | Every surface uses a 2px solid brown border plus a hard shadow. Reads as a 2010-era widget.                                                                                                                                                                     | `map.css` throughout (`border: 2px solid var(--nps-brown)`)                |
| V2  | State `<path>` stroke (`stroke-width: 0.5`) is not counter-scaled on zoom. Borders become thick dark bands when zoomed into a state (confirmed on live site). The separate `.mesh` layer already draws counter-scaled borders, so the path stroke is redundant. | `map.css:102-116`, `src/index.js:94-97`                                    |
| V3  | Ocean `#a8d4e6` is saturated and competes with the land. Not-visited markers (`#d2b48c`) on light-green states have low contrast.                                                                                                                               | `map.css:15`, `src/js/colorscale.js`                                       |
| V4  | Hard-coded hex colors inside JS (`#3d2314`, `#d32f2f`, `#2d5a27`, `rgba(45,90,39,.12)`). They cannot follow a dark theme.                                                                                                                                       | `src/index.js:169`, `460-473`, `503`; `statistics.js:219`, `232`           |
| V5  | Bold system font at 14px for everything, no type scale, no tabular numerals on stat values.                                                                                                                                                                     | `map.css:27-33`                                                            |
| V6  | Text labels "Search", "Stats", "☰ Parks in State", "✕", "×", "✖" — three different close glyphs, no icons.                                                                                                                                                     | `search.js:267`, `statistics.js:273`, `index.js:123`, `174`; `modal.js:39` |
| V7  | Loading state is a plain text box; chrome appears only after data loads.                                                                                                                                                                                        | `src/index.js:183-187`                                                     |
| V8  | Park modal: one 80%-wide tan card, images at `width: 20%`, plain `<p>` for description. Park `designation` and the first NPS image are available but unused.                                                                                                    | `src/js/modal.js`, `map.css:187-258`                                       |
| V9  | No `prefers-reduced-motion` handling; zoom and panel transitions always animate.                                                                                                                                                                                | `map.css`, `src/index.js:48`                                               |
| V10 | Legend is an SVG at a fixed `x = width - 110`. Not tappable, not a filter.                                                                                                                                                                                      | `src/index.js:126-153`                                                     |

## 2. Target design

### Layout

```
Desktop (>= 768px)                      Mobile (< 768px)
┌────────────────────────────────────┐  ┌──────────────────┐
│ ◉ Title            97/437 · 22% ⓘ  │  │ ◉ 97/437 · 22% ⓘ │  <- header bar, translucent
│                                    │  │                  │
│            [ map ]                 │  │     [ map ]      │
│                                    │  │                  │
│ ┌──────────┐                       │  │                  │
│ │ search   │ (floating card,       │  │                  │
│ │ panel    │  bottom-left)         │  ├──────────────────┤
│ └──────────┘                       │  │ ═══ drag handle  │  <- bottom sheet
│ [🔍 Search] [▦ Parks in MA]   [📊] │  │  panel content   │
└────────────────────────────────────┘  │ [🔍] [▦ MA] [📊] │  <- toolbar, safe-area aware
                                        └──────────────────┘
```

- `<header class="app-bar">`: title, live visited count pill, legend popover
  trigger. Stays visible when zoomed (currently hidden). Translucent
  `backdrop-filter: blur()` over the ocean.
- `<nav class="toolbar">`: pill buttons with inline SVG icons. Bottom-center on
  mobile, bottom corners on desktop. "Parks in <state>" appears here when a
  state is active, instead of the SVG rect at top-left.
- One `Sheet` primitive for all four overlays. Desktop: floating card
  (search) or centered `<dialog>` (park, stats, state list). Mobile: bottom
  sheet with drag handle, `max-height: 85dvh`, scroll inside, snap to
  half/full by drag.
- Legend becomes an HTML popover from the header count pill. Rows are tappable
  and toggle the visited / not-visited filter (replaces the filter buttons'
  duplicate role for the simple case; the search panel keeps its own).

### Visual language

- Surfaces: no 2px borders. `border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent)`,
  two-layer soft shadow, radius 16px (cards) / 24px (sheets) / 999px (pills).
- Tokens: keep the NPS brown/green identity but desaturate. Ocean becomes a
  pale blue-gray; states a warm off-white; complete states forest green;
  visited markers green; not-visited markers a mid brown with white ring so
  they read on any fill. Full token table in section 4.
- Dark theme: dark slate ocean, charcoal land, same accent greens brightened
  one step; surfaces `#1c1a17`-ish warm charcoal, text warm off-white.
- Type: system stack, `font-size: clamp(15px, 0.9rem + 0.2vw, 17px)` base,
  `font-variant-numeric: tabular-nums` on stats, 600 weight for headings
  (not 700), tighter letter-spacing on the big stat numbers.
- Motion: 200ms ease-out for UI, 600ms for map zoom; all gated by
  `prefers-reduced-motion`.
- Icons: 6 inline SVGs (search, chart, list, close, pin, locate) defined once
  in `src/js/icons.js` as template strings. No dependency.

## 3. Work plan

Each phase is one PR. Phases 1–3 are prerequisites for the rest; 4–7 can land
in any order after 3.

### Phase 1 — HTML shell and tokens (foundation)

Files:

- Create `src/index.html` (HtmlWebpackPlugin `template`). Contains `<header>`,
  `<main id="map-container">`, `<nav class="toolbar">`, `<div id="sheets">`,
  meta tags (`viewport` with `viewport-fit=cover`, `theme-color` light+dark,
  `description`, `color-scheme`), `apple-touch-icon`.
- Add `src/img/icon-180.png` and `src/img/icon.svg` (map pin on NPS brown).
- `webpack.config.js`: set `template`, drop the `colorscale` entry, add
  `asset/resource` rule already covers png.
- Split `src/css/map.css` into `src/css/tokens.css`, `base.css`, `map.css`,
  `components.css`, `sheets.css`. `src/index.js` imports `src/css/index.css`
  which `@import`s them (css-loader resolves `@import`).
- `tokens.css`: light + `@media (prefers-color-scheme: dark)` sets. Includes
  `--safe-bottom: env(safe-area-inset-bottom, 0px)`.
- `base.css`: `100dvh` layout, `overscroll-behavior: none`, `color-scheme`,
  16px minimum on inputs, reduced-motion reset.
- `src/js/colorscale.js`: delete. Replace with `src/js/theme.js` that reads
  `getComputedStyle(document.documentElement)` for `--color-visited` etc. and
  listens to `matchMedia("(prefers-color-scheme: dark)")` to re-apply marker
  fills and search overlay colors (fixes V4).
- `src/index.js`: select existing DOM nodes instead of appending to `body`.
  Remove the SVG title/subtitle/legend/`sidebarControl` (S1). Render count
  into the header pill. Delete `handleResize` legend/title repositioning.

Exit criteria: site renders identically in function; no SVG chrome; dark mode
flips surface colors; `npm run lint-check && npm test && npm run build` pass.

### Phase 2 — Map rendering polish

Files: `src/index.js`, `src/css/map.css`.

- Remove `stroke` from `.state`/`.state-complete`; the `.mesh` layer is the
  only border (V2). Add an outer country outline path with slightly heavier
  stroke for definition.
- Markers: render as `<g class="park-marker">` with a visible circle plus a
  transparent `r=12/k` hit circle on `(pointer: coarse)` (M4). Not-visited
  markers get a 1px white stroke (V3).
- Hover states wrapped in `@media (hover: hover)` (M5).
- Tooltip: clamp to viewport, offset 12px from pointer, `role="tooltip"`,
  suppressed on touch (M6).
- Active-state style: dim the other states to 60% instead of recoloring the
  active one tan.
- Replace the SVG `.openbtn` with the toolbar "Parks in <state>" button
  (Phase 1 toolbar node). It shows while `active` is set.
- `getMapScale()` → use `matchMedia("(max-width: 768px)")` and re-run on
  change (S2). Compute scale from the container's bounding box, not
  `window.inner*`, so the header/toolbar never overlap the map.
- Zoom duration respects reduced motion (V9).

Exit criteria: zoom into any state shows 1px borders; markers tappable on a
phone; no hover artifacts on touch.

### Phase 3 — Sheet primitive and overlay unification

Files: create `src/js/sheet.js`, `src/css/sheets.css`; modify `modal.js`,
`statistics.js`, `search.js`, `index.js`.

- `sheet.js` exports `createSheet({ id, title, modal, mobile: "sheet" })`
  returning `{ el, body, open(), close(), isOpen() }`.
  - Desktop + `modal: true` → native `<dialog>` with `showModal()` (focus
    trap, Escape, `::backdrop` for free).
  - Desktop + `modal: false` → floating card (`position: fixed`).
  - Mobile → bottom sheet with drag handle; translateY transition; pointer
    events for drag-to-dismiss; `inert` applied to the map when modal.
  - One shared close button with the `close` icon.
  - Registry so `closeTopSheet()` replaces the hand-rolled Escape chain in
    `index.js:760-781`.
- `modal.js`: `clickedPoint` fills a sheet body. Layout: hero image
  (`images[0]`, `aspect-ratio: 16/9`, `object-fit: cover`), designation
  badge, name, visited chip(s) with dates, notes callout, description,
  thumbnail grid `repeat(auto-fill, minmax(120px, 1fr))`, NPS link button
  (V8).
- `statistics.js`: dashboard renders into a sheet. Stat cards use
  `tabular-nums`. Year chart uses a `ResizeObserver` and `currentColor` /
  CSS variables (M8, V4). Top states as horizontal bars, not a list.
- `search.js`: panel renders into a non-modal sheet. Filter buttons become a
  segmented control (`role="radiogroup"`). Results list rows get the
  visited dot, name, states, and distance in one consistent row component
  shared with the state list.
- State park list (`index.js:571-617`): replace the `<table>` with the same
  row component; header shows "X of Y visited" progress bar (M7).

Exit criteria: all four overlays open/close through `sheet.js`; Escape and
backdrop click work; focus returns to the trigger; on a 390px-wide viewport
each overlay is a bottom sheet that scrolls internally.

### Phase 4 — Toolbar, header, legend

Files: `src/index.html`, `src/js/icons.js`, `src/js/legend.js`,
`src/css/components.css`.

- Toolbar pill buttons with icon + label; label hidden below 400px.
- Header count pill opens the legend popover (native `popover` attribute,
  Baseline 2024). Rows toggle a visited/not-visited quick filter via
  `ParkSearch.setVisitedFilter` (V10).
- `aria-live="polite"` region for result counts.

### Phase 5 — Loading and first paint

Files: `src/index.js`, `src/css/base.css`.

- Header and toolbar render from HTML before JS runs (V7).
- Loading: skeleton ocean background with a centered spinner; markers fade
  in with a 300ms stagger after data loads (skipped under reduced motion).
- Error state inside the same slot with the retry button.

### Phase 6 — Dark theme pass

Files: `src/css/tokens.css`, `src/js/theme.js`, `statistics.js`.

- Verify every surface, chart, marker, and search overlay in dark mode.
- Contrast check: all text ≥ 4.5:1, markers ≥ 3:1 against land fills, in
  both themes. Record results in the PR.
- `theme-color` meta switches via `media` attribute.

### Phase 7 — Accessibility and keyboard

Files: `src/index.js`, `src/js/search.js`.

- States: `tabindex="0"`, `role="button"`, `aria-label`, Enter/Space zoom.
- Markers: same, with `aria-label="<name>, visited"`.
- Skip-to-toolbar link.
- Verify with VoiceOver on iOS and Safari macOS.

## 4. Token set

Light:

| Token             | Value     | Use                 |
| ----------------- | --------- | ------------------- |
| `--ocean`         | `#dbe7ee` | map background      |
| `--land`          | `#f3efe4` | state fill          |
| `--land-complete` | `#8fb57a` | fully-visited state |
| `--border-map`    | `#9a8b78` | mesh stroke         |
| `--visited`       | `#2f6b2a` | markers, chips      |
| `--not-visited`   | `#b08a5a` | markers             |
| `--surface`       | `#fffdf8` | cards, sheets       |
| `--surface-2`     | `#f4efe6` | nested cards        |
| `--ink`           | `#2b1f16` | text                |
| `--ink-2`         | `#6b5a4b` | secondary text      |
| `--accent`        | `#3d2314` | primary buttons     |
| `--danger`        | `#c62828` | address pin         |

Dark:

| Token             | Value     |
| ----------------- | --------- |
| `--ocean`         | `#1b2229` |
| `--land`          | `#2a2d2a` |
| `--land-complete` | `#3f6b38` |
| `--border-map`    | `#5a5248` |
| `--visited`       | `#7fc272` |
| `--not-visited`   | `#c9a97a` |
| `--surface`       | `#1e1b18` |
| `--surface-2`     | `#2a2622` |
| `--ink`           | `#f1ebe2` |
| `--ink-2`         | `#b4a898` |
| `--accent`        | `#d9c3a5` |

Spacing scale, radii, shadows, z-index, and motion tokens carry over from the
existing `:root` block with values adjusted as described in section 2.

## 5. Test strategy

- Unit (vitest, existing): keep `search.test.js` and `statistics.test.js`
  green. Add `sheet.test.js` (open/close/registry/focus restore with jsdom)
  and `theme.test.js` (token read + media change re-apply).
- Build + lint in CI (`test.yml`) unchanged. Stylelint will need
  `declaration-property-value-no-unknown` tuned for `color-mix()` if it
  flags it; check on first run.
- Visual check per phase in Chrome at 1440x900 and in the device emulator at
  iPhone 14 (390x844) and Pixel 7 (412x915), both color schemes. Record
  screenshots in the PR description. The Chrome extension cannot resize a
  window below ~500px on macOS; use DevTools device mode or Safari Responsive
  Design Mode by hand.
- Real-device check on an iPhone before Phase 3 and Phase 6 merge
  (safe-area, `dvh`, input zoom, sheet drag).
- Lighthouse mobile run before and after; target ≥ 95 accessibility.

## 6. Risks

| Risk                                                             | Mitigation                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `<dialog>`, `popover`, `dvh`, `color-mix()` support              | All Baseline 2023/2024. GitHub Pages audience is personal; accept. Add a `@supports` fallback for `dvh` → `vh` only.               |
| Bottom-sheet drag conflicts with D3 zoom/pan on the map          | Sheet captures pointer events on its own element only; set `touch-action: pan-y` on the sheet and `touch-action: none` on the SVG. |
| Deleting the `colorscale` webpack entry changes output filenames | `gh-pages.yml` deploys `dist/` wholesale; no hard-coded names. Verify after Phase 1 build.                                         |
| `css-loader` `@import` ordering with style-loader                | Single entry `index.css`; order is explicit. Or keep one file and use section comments if `@import` causes FOUC.                   |
| Stylelint standard config rejects some modern syntax             | Pin and extend `.stylelintrc.json` rules per finding; do not disable wholesale.                                                    |
| Scope creep into map projection/data                             | Out of scope. No changes to `update_parks.py`, `visits.json`, or projection.                                                       |

## 7. Out of scope

- Data pipeline, NPS API, park metadata.
- URL routing / deep links to parks (worth a follow-up).
- PWA offline support (manifest is added, service worker is not).
