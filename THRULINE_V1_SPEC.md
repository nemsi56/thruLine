# ThruLine v1 — Implementation Spec

**Audience:** an implementing model/developer building this app from scratch. Follow this
document exactly. Where the spec is silent, prefer the simplest implementation that
matches the visual reference. Do not add features not listed here.

**Visual references** (in this folder; open them in a browser before starting; they are
throwaway code — copy their *look*, not their implementation):
- `mockup_sidebyside.html` — the design target for the editor's Side-by-Side view AND
  the dark theme: layout, card design, wire drawing, hover behavior, conflicts panel.
- `mockup_braid.html` — the design target for the Braid view (§9.5).
- `mockup_writers_desk.html` — source of the LIGHT theme's color palette ONLY. Its
  layout, serif typography, and margin-note conflict presentation are NOT part of this
  app (see §19).

**Product summary:** ThruLine is a structure tool for story writers. Every scene has
two independent positions: a **chronological** one (when it happens in the story world)
and a **manuscript** one (when the reader encounters it). The editor shows both timelines
at once with curved "wires" connecting each scene's two positions. A passive conflict
engine ("linter, not gate") flags timing contradictions, character bilocation, and
reveals referenced before the reader learns them. There is no prose editor — scenes carry
title, summary, and metadata only.

---

## 1. Hard requirements

1. **Stack:** plain HTML/CSS/JavaScript. No frameworks, no build step, no external
   dependencies, no CDN requests. Runs as static files (`python3 -m http.server` for
   dev). All data in `localStorage`; JSON file export/import for backup.
2. **CSP from day one.** Every HTML page carries:
   ```html
   <meta http-equiv="Content-Security-Policy"
         content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;">
   ```
   Consequences: **no inline `<script>` blocks and no inline event-handler attributes
   anywhere** (`onclick=""` etc. is forbidden). All wiring uses `addEventListener` in
   external `.js` files.
3. **XSS safety:** every piece of user-entered text (titles, summaries, names, labels)
   rendered into the DOM goes through `textContent`, or through an `esc()` helper
   (HTML-entity escape) when building HTML strings. No exceptions, including tooltips
   and SVG `<text>`.
4. **Keyboard shortcuts** match on `e.code` (physical key, e.g. `'KeyZ'`), never `e.key`,
   for any shortcut involving Alt/Option — macOS remaps `e.key` under Option.
5. All timestamps stored as ISO strings; all ids are strings (see §4.1).
6. Undo/redo covers every data mutation (see §5.3).

## 2. Files and load order

```
index.html        — project list page
editor.html       — the main app (one page, three view modes)
styles.css        — all styles, both pages
js/state.js       — data model, persistence, ids, undo/redo
js/time.js        — time parsing/formatting, chronological position computation
js/conflicts.js   — conflict engine (pure functions over project data)
js/chron.js       — chronology view rendering + drag + threads + markers
js/manuscript.js  — manuscript view rendering + drag + dividers
js/wires.js       — the SVG mapping overlay between the two views
js/braid.js       — the Braid view (read-only structure chart, §9.5)
js/inspector.js   — right-panel inspector (scene editing forms)
js/ui.js          — top bar, view switching, conflicts panel, modals, toasts
js/projects.js    — project list page logic (index.html only)
js/editor-init.js — editor.html event wiring (runs last)
js/projects-init.js — index.html event wiring (runs last)
data/sample-glass-harbor.json — seed sample project (§15)
```

`editor.html` script order: `state.js, time.js, conflicts.js, chron.js, manuscript.js,
wires.js, braid.js, inspector.js, ui.js, editor-init.js`. Scripts share one global scope; each file
exposes a small set of named functions. Avoid top-level name collisions.

## 3. Layout (editor.html)

Fixed full-viewport app, `overflow:hidden` on body. Vertical structure:

```
┌ top bar (52px) ──────────────────────────────────────────────┐
├ main (flex row) ─────────────────────────────┬───────────────┤
│  stage (flex column, flex:1)                 │ right panel   │
│   ├ chronology section (height: managed)     │ (280px,       │
│   ├ divider (6px, draggable)                 │  collapsible) │
│   ├ wires zone (flex:1, min 60px)            │  tabs:        │
│   └ manuscript section (content height)      │  Inspector /  │
│                                              │  Conflicts    │
├ footer hint bar (24px) ──────────────────────┴───────────────┤
```

- One absolutely-positioned `<svg id="wires">` covers the whole stage (z-index above
  panels, `pointer-events:none`) and draws the mapping curves.
- **Flex pitfall (known issue from prior projects):** every scrollable/flexible child in
  a column flexbox needs explicit `min-height:0` or it grows past its container instead
  of scrolling.
- A `ResizeObserver` on the stage triggers `redrawWires()` (debounced 150ms) — window
  `resize` events alone miss panel collapse and divider drags.

### 3.1 Top bar contents (left → right)

Logo/app name · project name · spacer · view switcher (segmented: Chronology /
Side-by-Side / Manuscript / Braid) · axis mode (segmented: Ordinal / True scale; hidden
in Braid mode) · thread picker (dropdown of characters + "None") · theme toggle (☀/☾
icon button — switches dark/light instantly, stored globally in `tl_prefs`) · Conflicts
button with count badge (errors only, not dismissed) · overflow menu (⋯): Export JSON,
Import JSON, Back to Projects.

### 3.2 View modes

- **Side-by-Side** (default): as diagrammed. The draggable divider sets the chronology
  section's height (persisted per project); wires zone absorbs remaining space.
- **Chronology**: chronology section fills the stage; manuscript section and wires
  hidden. Lanes get taller (cards can show 2-line summaries).
- **Manuscript**: manuscript section fills the stage, rendered as a wrapping grid of
  cards (rows wrap like text), dividers as full-width headers. Wires hidden.
- **Braid**: the read-only structure chart (§9.5) fills the stage. Wires hidden; no
  dragging in this mode.
- Switching modes never changes data. Persist last mode per project.

### 3.3 Visual design & themes

**Two themes ship in v1** — dark (default) and light — toggled from the top bar, stored
globally in `tl_prefs`, applied as `data-theme="dark"|"light"` on `<html>`. Typography
is identical in both themes: the system sans stack
(`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`). Do NOT use serif
fonts anywhere — the writers-desk mockup's serif look is explicitly not part of this app.

Chrome colors via CSS variables, defined once per theme:

```
DARK (from mockup_sidebyside.html):
--bg:#12141a  --panel:#191c25  --panel2:#151821  --line:#2a2f3d
--tx:#e8eaf2  --mut:#8b91a5    --faint:#5a6072
--red:#ef6a6a --thread:#3fd6b7 --ok:#6ad19a

LIGHT (palette from mockup_writers_desk.html — colors only):
--bg:#f4eee0  --panel:#fffdf6  --panel2:#efe7d4  --line:#ddd2bc
--tx:#2b2620  --mut:#847a6a    --faint:#a89d89
--red:#b3413a --thread:#2e8b7a --ok:#3f8f68
```

Storyline colors: one 10-color palette PER THEME, index-matched — a storyline keeps its
palette index forever and the hex swaps with the theme. Assigned round-robin at
storyline creation; user cannot pick colors in v1.

```
dark:  #5aa9e6 #e0a458 #a78bfa #6ad19a #e66a9a #58c4d4 #d4c458 #c48a58 #8a9ae6 #6ae0c4
light: #3d6c9e #b07a35 #7b5ea7 #3f8f68 #b3486f #35809a #8f7d2e #8f5b32 #4f5fa8 #2e8b7a
```

Because storyline colors are painted into inline styles and SVG attributes, they MUST
come from a JS lookup `slColor(paletteIndex)` that reads the current theme — never from
hardcoded hex in render code — and switching themes triggers a full `refreshAll()` so
every card, wire, thread, and braid node repaints. Verify every visual state in BOTH
themes.

Cards: 8px radius, 1px `--line` border, 3px top border in the storyline color, title
(600 weight) + small meta line. Hover/dim/flag states exactly as the side-by-side
mockup: hovering a scene highlights it in both views + its wire, dims everything else
to ~0.28 opacity.

## 4. Data model

### 4.1 Ids and helpers

`newId(prefix)` returns e.g. `"sc_lqz3k8_4"` — prefix + base36 timestamp + counter.
Prefixes: `sc_` scene, `st_` storyline, `ch_` character, `lo_` location, `rv_` reveal,
`cn_` constraint, `mk_` marker, `dv_` divider, `pr_` project.

### 4.2 Project object (one localStorage blob per project)

```js
{
  schemaVersion: 1,
  projectUid: "pr_…",         // permanent, survives rename
  name: "The Glass Harbor",
  createdAt: "2026-07-18T…", modifiedAt: "…",
  revision: 12,               // increments on every save
  scenes: [Scene, …],
  storylines: [{id, name, paletteIndex}],   // = chronology lanes; ≥1 always;
                                            // paletteIndex → slColor() per theme (§3.3)
  characters: [{id, name}],
  locations:  [{id, name}],
  reveals:    [{id, label}],                // named story facts, e.g. "The fire happened"
  constraints:[Constraint, …],
  chronOrder: ["sc_…", …],    // ALL scene ids, chronological order (source of truth)
  msOrder:    ["sc_…", …],    // ids of scenes with offscreen:false, reading order
  markers:  [{id, label, beforeSceneId}],   // chronology time markers (§7.4)
  dividers: [{id, label, beforeSceneId}],   // manuscript chapter/part breaks (§8.2)
  dismissed: ["fingerprint", …],            // dismissed conflict fingerprints (§12.5)
  viewPrefs: { mode:"side", axis:"ordinal", threadCharId:null, chronHeightPx:260,
               panelTab:"inspector", panelOpen:true }
}
```

### 4.3 Scene

```js
{
  id: "sc_…",
  title: "The Fire",          // required, non-empty
  summary: "",                // plain text, may be ""
  storylineId: "st_…",        // required — the scene's HOME storyline (drives its lane)
  alsoStorylineIds: [],       // secondary storylines (convergence, §7.1); never
                              // contains storylineId, no duplicates
  characterIds: ["ch_…", …],
  locationId: null | "lo_…",
  offscreen: false,           // true = happens in the world but is never on the page:
                              // appears in chronology, has NO manuscript position
  anchor: null | { date:"YYYY-MM-DD", time:null|"HH:MM" },
  durationMin: null | int>0,  // minutes; null = instant/unknown
  reveals:  ["rv_…", …],      // facts the reader LEARNS in this scene
  requires: ["rv_…", …]       // facts the reader must ALREADY KNOW
}
```

**Invariants (enforce on every mutation and on load/import):**
- `chronOrder` contains every scene id exactly once; `msOrder` contains exactly the ids
  of scenes with `offscreen:false`, each once.
- Toggling `offscreen` on removes the id from `msOrder`; toggling off appends it to the
  end of `msOrder`.
- Deleting a scene removes it from both orders, from all constraints that reference it
  (delete the constraint), and from `markers`/`dividers` `beforeSceneId` (re-anchor to
  the next scene in that order, or `null` = end).
- Deleting a storyline requires ≥2 storylines, reassigns its scenes (as home) to the
  first remaining storyline, and strips its id from every scene's `alsoStorylineIds`
  (confirm dialog states this). Setting a home storyline that's already in
  `alsoStorylineIds` removes it from that list.
- Deleting a character/location/reveal strips its id from every scene (confirm dialog).

### 4.4 Constraint

```js
{ id:"cn_…", type:"before"|"same-time"|"offset", a:"sc_…", b:"sc_…",
  offsetMin: int>0 }   // offset type only: "b happens offsetMin minutes after a"
```
`before` = a precedes b chronologically. `same-time` = a and b are simultaneous.
`offset` implies before. UI for offsets accepts value+unit (minutes/hours/days) and
stores minutes. Constraints are created/edited in the inspector (§11.4).

### 4.5 Time style note

There is no per-project "time style" switch in v1. The tiers coexist naturally: a scene
with no anchor and no constraints is tier-1 (pure order); constraints add tier 2;
anchors add tier 3. The UI never forces a date.

## 5. Persistence, state, undo

### 5.1 localStorage keys

- `tl_index` — `[{projectUid, name, modifiedAt, sceneCount}]` for the projects page.
- `tl_proj_<projectUid>` — the full project blob.
- `tl_prefs` — global prefs (last-opened projectUid, theme, `samplesSeeded`).
- Editor page reads `?p=<projectUid>` from the URL; missing/unknown id → redirect to
  index.html.

### 5.2 Save path

One function `saveProject()`: bumps `revision` and `modifiedAt`, writes the blob,
updates `tl_index`, then calls `refreshAll()` (re-render both views, wires, conflicts,
inspector). Every mutation funnels through `commit(label, mutateFn)`:

```js
function commit(label, fn){ pushUndo(label); fn(P); saveProject(); }
```

Wrap `localStorage.setItem` in try/catch; on failure show one alert per session
("Changes may not be saved — export a backup"), not one per edit.

> **Known gap (found in audit, July 2026):** `saveProject()` calls `updateIndexEntry(P)`
> unconditionally, even when the preceding `safeSetItem(LS_PROJ_KEY(...), ...)` returned
> `false` (quota exceeded). `tl_index` then claims a scene count/`modifiedAt` for data
> that was never actually written to `tl_proj_<uid>`. Low-severity (quota failures are
> rare and the user is already warned), but the fix is small: only call
> `updateIndexEntry` when `safeSetItem` succeeded. Not fixed as part of the July 2026
> audit pass; left for a future milestone.

### 5.3 Undo/redo

Snapshot-based: `pushUndo` deep-copies the data portion of the project (everything
except `viewPrefs`) onto a stack, max 50; redo stack cleared on new commit. Ctrl/Cmd+Z /
Ctrl/Cmd+Shift+Z (also Ctrl+Y). Guards: **do not** fire when focus is in an
input/textarea/select (let the field's native undo work) or while any drag is active.
Corrupt project on load (JSON parse failure / validation failure) → do NOT open an empty
editor over it; alert and bounce to index.html leaving the stored blob untouched.

## 6. Chronological position computation (`time.js`)

`chronX(project, axisMode)` returns `Map<sceneId, x>` with x in 0–100 (percent across
the track width). Layout code adds its own left/right padding.

### 6.1 Ordinal mode

Scenes evenly spaced in `chronOrder` order: `x = (i + 0.5) / N * 100`.

> **Known gap (found in M4 verification, July 2026):** this formula spaces scenes by
> their position in the GLOBAL `chronOrder`, not per-lane, so two same-lane scenes that
> are adjacent in the overall order can land closer together (in pixels) than the fixed
> card width once the track is narrower than roughly `cardWidth × N`. Confirmed
> reproducing as visibly overlapping/unreadable cards in both the chronology and
> manuscript strips at ordinary window widths. §6.2's collision pass is currently
> scoped to true-scale mode only — it does not run in ordinal mode, and no scroll
> container exists yet either (that's §7.6, M7). Decision: leave as-is for now; §7.6's
> scroll + zoom work is the intended real fix (cards get room instead of being
> squeezed), so do not build a separate ordinal-mode collision pass unless M7 is
> deliberately reprioritized earlier. Until M7 lands, expect overlapping cards on
> screenshots/demos of any project denser than a handful of scenes per lane — this is
> known, not a regression to chase in M5/M6.

### 6.2 True-scale mode

1. Parse each anchored scene to a timestamp: date at `00:00` if no time. Collect
   anchored scenes **in chronOrder sequence**.
2. If fewer than 2 anchored scenes, true-scale is unavailable: gray out the toggle with
   tooltip "Anchor at least two scenes to dates to enable true scale."
3. Map timestamps linearly to x: `x = 4 + (t - tMin)/(tMax - tMin) * 92`.
4. Unanchored scenes between two anchored neighbors (in chronOrder) are spaced evenly
   between those neighbors' x values. Unanchored scenes before the first / after the
   last anchored scene extend outward in steps of 3 (clamped to [0,100]).
5. If an anchored scene is chronologically out of order vs. chronOrder (its timestamp is
   earlier than a preceding anchored scene's), true-scale still renders — sort by
   timestamp for positioning — and the conflict engine flags it (§12.1). The axis does
   not try to be clever.
6. **Collision pass, per lane:** sort that lane's scenes by x; sweep left→right
   enforcing a minimum gap of `cardWidthPx / trackWidthPx * 100` percent by pushing
   scenes rightward. (Cards center on x via `translateX(-50%)`.)

> **Known gap (found in audit, July 2026):** the collision-pass sweep only pushes
> rightward and never clamps or renormalizes against the 100% track edge, so a dense
> lane near the right edge can place a card's x past 100 (off the visible track). In
> practice this is bounded by how many anchored scenes cluster in one lane near the same
> timestamp — uncommon, and the card just renders partially off-screen rather than
> crashing. Not fixed as part of the July 2026 audit pass; a real fix would renormalize
> the whole lane's spacing to fit [0,100] when the naive sweep overflows.

Formatting helpers: `fmtAnchor(anchor)` → `"Oct 12, 1998"` / `"Oct 12, 1998 · 21:30"`;
relative gap label `fmtGap(ms)` → `"3 days"`, `"≈ 10 yrs"`.

## 7. Chronology view (`chron.js`)

### 7.1 Structure

Left column (128px): one label per storyline — color swatch, name, scene count. Track
area (flex:1, `position:relative`): one lane row per storyline (row height = available
height / lane count, min 64px; dashed bottom border between lanes), scene cards
absolutely positioned at `left: x%` from §6, vertically centered in their lane row.
Card width 96px (Side-by-Side) / 140px (full Chronology mode, plus a 2-line summary).

Card content: title (2-line clamp), meta line = anchor/marker-derived time label (or
"—") left, `Ch N` (manuscript position, from msOrder index +1; "off" for offscreen
scenes, rendered at 60% opacity with a dashed border) right. Red warn-dot top-right when
the scene is involved in any non-dismissed error.

**Convergence dots:** for each id in `alsoStorylineIds`, a 6px filled dot in that
storyline's color at the card's bottom-right (max 4 dots, then "+n"). This is how two
storylines meeting in one scene stays visible: the scene sits in its HOME lane, dotted
with the other storylines it belongs to. Rendered on manuscript cards too (§8.1).
Character threads (§7.3) are unaffected — they already cross lanes freely.

### 7.2 True-scale gap compression

In true-scale mode, if the largest time gap between consecutive anchored scenes exceeds
5× the median gap, render a vertical dashed "gap divider" at that x with a small label
(`≈ 10 yrs`) — purely cosmetic, positions are still linear. Implement only the single
largest such gap; do not implement multi-gap axis breaking in v1.

### 7.3 Character thread overlay

When `viewPrefs.threadCharId` is set: an SVG inside the track (z-index BELOW cards,
above lane rows) draws a 2.5px smooth curve (cubic segments through consecutive points,
control points at horizontal midpoints — see mockup source) through the center of every
card whose scene includes that character, in chronOrder order, in `--thread-default`
color, with a 4px dot per scene. Thread picker lists all characters; "None" hides it.

### 7.4 Time markers

`markers` render as vertical dashed lines spanning all lanes at the x midway between the
`beforeSceneId` scene and its predecessor (or at the far left/right for first/end), with
a small label at top (e.g. "TEN YEARS EARLIER", "PART II"). Add via track context menu
(right-click → "Add marker here"); edit/delete via clicking the label (small popover:
text input + Delete). Markers are cosmetic — the conflict engine ignores them.

> **Fixed in audit, July 2026:** right-clicking the track twice without dismissing the
> first "Add marker here" menu appended a second `#markerContextMenu` div and a second
> `document` click listener without removing the first — the outside-click handler only
> ever resolves `getElementById('markerContextMenu')`, which always returns the first
> same-id node, so later menus/listeners could never find "their" menu to clean up and
> lingered until Escape happened to remove one of them. Same issue existed for the
> manuscript strip's "Add divider here" menu (`manuscriptRowContextMenu` in
> `manuscript.js`). Fixed by adding `closeMarkerContextMenu()` / `closeDividerContextMenu()`
> helpers that remove both the DOM node and the listener, called at the start of each
> context-menu opener (so a stale one is always cleared before a new one opens), from
> the "Add …" button's own click handler, and from editor-init.js's Escape handler —
> replacing the ad hoc `menu.remove()` calls that previously existed in only some of
> those places.

### 7.5 Drag behavior (chronology)

- Threshold: a drag starts after 4px of mouse movement with button held; plain click =
  select (§10.2).
- **Horizontal drag (ordinal mode):** ghost card follows cursor; a 2px vertical accent
  insertion line shows the drop slot (nearest gap between cards in the hovered lane's
  x-sorted order — but the slot is a position in `chronOrder`, computed as: find the
  scene nearest right of the cursor across ALL lanes by x, insert before it). On drop:
  `commit("Move scene (time)", …)` reorders `chronOrder`. msOrder is untouched.
- **Vertical drag:** dropping in a different lane row sets `storylineId` (may combine
  with horizontal move in one commit).
- **True-scale mode:** horizontal drag is disabled (cursor `default`, one-time toast
  "Switch to Ordinal to reorder by drag"); vertical lane drag still works.
- **Self-heal (known issue from prior projects):** at the top of the global `mousemove`
  handler, if `e.buttons === 0` while any drag state is active, cancel the drag
  completely without committing (mouse was released outside the window).
- Escape cancels an active drag.

### 7.6 Scrolling, zoom, and finding the counterpart

The answer to long timelines is scrolling, not shrinking — cards never drop below
readable size.

- The track sits in a horizontal scroll container (`overflow-x:auto`). Track width =
  `max(container width, N × pxPerScene + padding)`. `pxPerScene` defaults to 110 and is
  adjustable via a small zoom slider in the chronology section header (range 70–200,
  persisted in `viewPrefs`). When content fits the container, there's no scrollbar and
  the slider still works (spreads or tightens spacing).
- Wires: endpoints come from `getBoundingClientRect`, which already reflects scroll —
  but BOTH strips' `scroll` events must trigger `redrawWires()` (throttled via
  `requestAnimationFrame`). Wires to off-viewport cards clip at the stage edge; that's
  correct behavior.
- **Counterpart auto-scroll:** when a scene is selected (click), if its card in the
  OTHER strip is outside that strip's viewport, that strip smooth-scrolls to center it.
  This — plus hover wires and the Braid view — is v1's answer to "first in chronology,
  last in manuscript." A true split-pane (two independent viewports over one strip) is
  deliberately deferred (§19); nothing in this layout may block adding it later.

## 8. Manuscript view (`manuscript.js`)

### 8.1 Structure

Side-by-Side mode: one horizontal row (aligned with the track area, left margin matching
the lane-label column), one card per `msOrder` entry, gap 8px, `flex:1` each until that would
drop a card below 110px wide — then cards fix at 110px `min-width` and the row scrolls
horizontally in its own `overflow-x:auto` container (scroll wiring per §7.6). Card:
`CH N` label (index+1), title (3-line clamp, `hyphens:auto`), 3px top border in the
scene's storyline color, small tag showing the scene's time label when it's anchored to
a different era than the previous card (v1 simplification: show the anchor's year when
the previous card's year differs). Warn-dot and convergence dots as in §7.1.
Full Manuscript mode: cards in a wrapping flex grid, fixed 150px width, dividers as
full-width rows.

### 8.2 Dividers (chapters/parts)

Same mechanism as markers: `{id, label, beforeSceneId}`. Side-by-Side mode renders a
divider as a thin vertical bar with a rotated-none small label above the row ("PART II");
full Manuscript mode renders a full-width heading row. Add via context menu on the row;
edit/delete via click popover. Dividers do not affect numbering in v1 (chapters are just
labels; `CH N` is the global msOrder index).

### 8.3 Drag behavior

Horizontal drag reorders `msOrder` only (`commit("Move scene (manuscript)")`); insertion
line in the gap nearest the cursor. chronOrder untouched. Same threshold, self-heal, and
Escape rules as §7.5.

## 9. Mapping wires (`wires.js`)

For every scene with `offscreen:false`, draw a cubic bezier from the bottom-center of
its chronology card to the top-center of its manuscript card (coordinates relative to
the stage, recomputed from `getBoundingClientRect` on every redraw):

```
M ax ay  C ax (ay+dy), bx (by−dy), bx by      where dy = max(40, (by−ay)/2)
```

Stroke = storyline color, width 1.6, opacity 0.5. States: hovered scene's wire → width
2.6, opacity 1, all others opacity 0.08; conflict-flagged scenes' wires → `--red`,
width 2.6, opacity 1, others 0.06. `redrawWires()` is called from `refreshAll()`, the
ResizeObserver, divider drags, scroll (if any), and hover changes. Rebuild all paths
each call (n ≤ a few hundred; no incremental diffing).

> **Fixed in audit, July 2026:** the original per-scene loop interleaved
> `getBoundingClientRect()` reads with `svg.appendChild(path)` writes on every
> iteration, forcing a synchronous layout recalculation each time — real cost on a
> project with many scenes, since this runs on every hover and every commit. Rewritten
> as three phases: (1) one `querySelectorAll` per card type instead of a fresh
> `document.querySelector` per scene per card, (2) a read-only pass collecting every
> card's `getBoundingClientRect()`, (3) a write-only pass building all `<path>`s into a
> `DocumentFragment` and appending once. If you're implementing this from scratch,
> preserve that read/write separation — it's easy to reintroduce the thrash by moving a
> single read back inside the write loop.

## 9.5 Braid view (`braid.js`)

Read-only structure chart; design target `mockup_braid.html`. One `<svg>` inside a
horizontal scroll container filling the stage. No dragging, no editing.

- **Axes:** x = reading order — the i-th scene of `msOrder` sits at
  `x = 110 + i × 93` (offscreen scenes do not appear in this view). y = story time —
  `y = 70 + chronIndex × rowH`, where chronIndex is the scene's index in `chronOrder`
  (all scenes, so offscreen scenes still occupy a rank and leave a visible row gap) and
  `rowH` fits the stage height (`(stageH − 140) / (N − 1)`, clamped 26–52px). Top edge:
  "READING ORDER →" label + "CH n" tick per column. Left edge: rotated "STORY TIME ↓".
  One 1px gridline per rank.
- **Reading path:** for each consecutive `msOrder` pair, a cubic bezier
  `M ax ay C (ax+bx)/2 ay, (ax+bx)/2 by, bx by`, drawn before nodes. Downward segment
  (forward in time): `--mut`, width 2.5, opacity .55. Upward segment (flashback):
  flashback accent (dark theme `#e0a458` / light `#b07a35`), width 2.5, dasharray
  `7 5`, opacity .9.
- **Nodes:** circle r=11, fill `--panel`, 3px stroke in the HOME storyline color
  (`slColor`), chapter number inside (10px bold `--tx`). Warn-dot rules as §7.1. Label
  (title 11px `--tx`, time 9.5px `--mut` beneath) to the node's right; flip to the left
  when the node is within 160px of the chart's right edge.
- **Markers** (§7.4) render here as horizontal dashed lines spanning the chart at the y
  midway between the ranks they separate, label at the left inside the chart. Dividers
  (§8.2) render as short vertical ticks along the top edge between the relevant CH
  columns.
- **Interactions:** hover a node = the standard cross-view highlight state (it's the
  same scene selection machinery) plus its arriving/departing path segments thicken to
  width 4, opacity 1. Click = select + open inspector (§10.2). Conflict flag-mode
  (§12.7) highlights involved nodes red and dims the rest. The thread picker does not
  apply in this view (control hidden, like the axis toggle).

## 10. Global interactions

### 10.1 Hover linking

`mouseenter` on a card (either view) adds `.hi` to both of that scene's cards, sets a
`hovering` class on `<body>` (dims non-`.hi` cards via CSS), and redraws wires.
`mouseleave` reverses. Hover does nothing during a drag.

> **Fixed in audit, July 2026:** "hover does nothing during a drag" was implemented as
> an early return at the top of `highlightScene()` — which also swallows the
> `mouseleave`(`on=false`) call that starting a drag naturally triggers (the cursor
> moves off the card's original position). Nothing else cleared hover state afterward
> (`clearHighlight()` existed in `wires.js` but had no caller anywhere), so the dragged
> card, its counterpart, and its wire stayed highlighted/others stayed dimmed after the
> drag ended, until the user happened to hover a different card. Fix: both drag-begin
> functions (`_chronDragBegin` in `chron.js`, `_msDragBegin` in `manuscript.js`) now call
> `clearHighlight()` immediately after `setDragActive(true)`, before the guard in
> `highlightScene()` can start blocking updates.

### 10.2 Selection & inspector

Click selects a scene (both cards get `.sel`, 1px accent ring) and opens the right
panel's Inspector tab with that scene loaded. Escape or clicking empty track space
deselects. Delete key (when not in an input) deletes the selected scene after a confirm
modal. Only single-select in v1.

### 10.3 Keyboard

Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z / Ctrl+Y (undo/redo, guarded per §5.3) · Delete/Backspace
(delete selected, confirm) · Escape (cancel drag → close popover/modal → clear
selection, in that priority order) · Cmd/Ctrl+E (export JSON). Nothing else in v1.

### 10.4 Adding scenes

"+ Scene" button in each section header (chronology and manuscript). Both create the
scene at the END of both orders (storyline = first storyline, title = "Untitled scene")
and open it in the inspector with the title focused/selected. Finer placement is done by
dragging afterward.

## 11. Inspector (right panel, `inspector.js`)

Fields, top to bottom, each committing on change (`change`/`blur`, one commit per field
edit):

1. **Title** (text, required — empty reverts on blur with a shake).
2. **Summary** (textarea, 3 rows).
3. **Storyline** (select — the scene's home lane) and, directly beneath it, **Also part
   of** (checkbox list of every OTHER storyline → `alsoStorylineIds`; checking the home
   storyline is impossible because it isn't listed).
4. **Characters** (checkbox list + "New character…" inline add).
5. **Location** (select with "None" + "New location…" inline add).
6. **Offscreen** (toggle) — label: "Offscreen — happens in the world, never on the page".
7. **When** (collapsible group): anchor date (native `<input type=date>`), optional time
   (`<input type=time>`), duration (number + unit select: min/hr/days), and a "Clear
   anchor" link. Below, read-only text: this scene's position, e.g. "12th of 14 in
   chronology · Ch 9 of 12" .
8. **Constraints** (list of this scene's constraints, each as a sentence — "before
   ‘The Vote’", "2 days after ‘The Vault Job’" — with a ✕ to delete). "Add constraint…"
   opens a 3-field row: type select (before / same time as / after / N after), scene
   select (all other scenes), offset value+unit (offset types only). "after X" stores as
   `{type:'before', a:X, b:this}`.
9. **Reveals** / **Requires**: two chip lists with a combo input — typing filters
   existing reveal labels; Enter on no match creates a new reveal (`rv_`). Chips have ✕.
10. **Danger row:** Duplicate scene (copies everything, "(copy)" suffix, inserts after
    the original in both orders) · Delete scene.

With no selection, the panel shows project-level lists: storylines (add/rename/delete,
drag to reorder lanes), characters, locations, reveals (add/rename/delete each).

> **Implementation note (M6):** storyline reordering shipped as up/down buttons rather
> than drag — deliberately, to avoid bolting a second independently-scoped drag system
> onto the milestone that also built every other Inspector field and all the delete
> cascades. Same persisted outcome (lane order), lower risk. Revisit only if the button
> UX proves unpleasant in practice; not a gap to "fix" by default.

## 12. Conflict engine (`conflicts.js`)

Pure function `computeConflicts(P)` → array of
`{fingerprint, type, severity:"error", title, message, sceneIds:[…]}`, re-run
(debounced 150ms) after every commit. Messages name scenes by title in quotes and
include chapter/day references like the mockup's examples.

### 12.1 Anchor-vs-order contradictions

Walk anchored scenes in chronOrder sequence; for each **consecutive anchored pair**
(i, j) with `t_i > t_j`: conflict `type:"anchor-order"`, scenes `[i, j]`, message
"‘B’ is placed after ‘A’ in the chronology, but its date (…) is earlier (…)."

### 12.2 Constraint violations

For each constraint (a, b):
- `before`/`offset`: if `chronIndex(a) > chronIndex(b)` → violation. If both anchored:
  `before` violated when `t_a > t_b`; `offset` violated when
  `|t_b − (t_a + offsetMin)|` exceeds tolerance (24h when either anchor lacks a
  time-of-day, else 1 min).
- `same-time`: violated when both anchored and timestamps differ beyond that same
  tolerance. (Order is not checked; adjacent placement not required.)
Type `"constraint"`, scenes `[a, b]`.

### 12.3 Constraint cycles

Digraph: edge a→b for every `before`/`offset` constraint. DFS cycle detection; report
each cycle once — type `"cycle"`, scenes = the cycle path, message lists the chain
("‘A’ → ‘B’ → ‘C’ → ‘A’ can't all be satisfied"). Constraints in a detected cycle are
skipped by §12.2 (avoid double-reporting).

### 12.4 Bilocation

For every pair of scenes sharing ≥1 character, where both have anchors, both have
non-null and **different** `locationId`: scene interval = `[t, t + durationMin]`
(no time-of-day → whole day; no duration → instant, but two no-time same-day anchors
count as overlapping). If intervals overlap: type `"bilocation"`, scenes `[A,B]`,
message names the shared character(s), both locations, and the date. O(n²) pair scan is
fine.

### 12.5 Reveal order (checked against msOrder — reading order)

Walk `msOrder` accumulating a `known` set from each scene's `reveals` (accumulate AFTER
checking the scene's `requires`). A scene requiring an unknown reveal → type
`"reveal-order"`, scenes = [the requiring scene, the scene that reveals it (if any)],
message like the mockup: "‘Dinner at the Overlook’ (Ch 6) requires ‘the warehouse fire’
— not revealed until ‘The Fire’ (Ch 9)." A required reveal that NO scene reveals →
type `"reveal-missing"`, message "…is never revealed to the reader." Offscreen scenes
contribute nothing and are never checked (they're not read).

### 12.6 Fingerprints & dismissal

`fingerprint = type + ":" + sceneIds.slice().sort().join(",") + ":" + extraKey` where
`extraKey` is the constraint id (§12.2/12.3) or reveal id (§12.5) or "" — stable across
re-runs and unrelated edits. `P.dismissed` holds dismissed fingerprints; dismissed
conflicts render grayed at the bottom of the panel with "restore warning"; active ones
have "show scenes" (flag mode, §12.7) and "mark intentional". The top-bar badge counts
non-dismissed conflicts only. Stale dismissed fingerprints (no longer produced) are
pruned on save.

### 12.7 Conflicts panel & flag mode

Right panel tab. Each conflict: severity dot, title, message, action links. Clicking a
conflict toggles **flag mode**: involved scenes get `.flag` (red ring) in both views,
wires per §9, everything else dims; clicking again, clicking another conflict, or
Escape clears it. Warn-dots on cards reflect membership in any non-dismissed conflict.

> **Fixed in audit, July 2026:** in `styles.css`, the hover-dim rule
> `body.hovering .scene:not(.hi)` (3 classes of specificity) beat `.scene.flag`
> (2 classes) regardless of source order, so hovering ANY card while flag mode was
> active dimmed the flagged scenes back down to .28 — defeating flag mode's entire
> purpose. Fixed by scoping the hover-dim selector to `:not(.hi):not(.flag)`. If you're
> implementing flag mode and hover-dim as separate CSS rules, either keep them mutually
> exclusive like this or unify them into one rule that computes the right opacity per
> state, since specificity math between two independently-authored rules is easy to get
> backwards.

## 13. Export / import

### 13.1 Export

Download `<project-name>.thruline.json` — the full project blob, pretty-printed.
(Cmd/Ctrl+E and the ⋯ menu.)

### 13.2 Import (index.html and the ⋯ menu)

Strict validation BEFORE writing anything; on any failure, reject with a specific
message and touch nothing:
- `schemaVersion === 1`; required top-level arrays present and of correct type.
- Every id a string; scene ids unique; storyline/character/location/reveal/constraint
  ids unique; every reference (storylineId, alsoStorylineIds, characterIds, locationId,
  reveals, requires, constraint a/b, beforeSceneId) resolves; `alsoStorylineIds` AND
  `characterIds` have no duplicates, and `alsoStorylineIds` never contains the scene's
  own storylineId; every storyline `paletteIndex` an integer 0–9; `chronOrder`/`msOrder`
  satisfy §4.3 invariants; anchors match `YYYY-MM-DD` / `HH:MM`; `durationMin`/`offsetMin`
  are positive integers via `Number.isInteger`; every user-text field is a string;
  `viewPrefs`, if present, is type-checked field-by-field (`mode`/`axis`/`panelTab`
  against their enum of valid values, `threadCharId` string-or-null, `chronHeightPx`/
  `pxPerScene` numbers, `panelOpen` boolean) before `sanitizeImportedProject` merges it
  over the trusted defaults — added in the July 2026 audit pass after finding it was the
  one top-level field with no validation at all, letting malformed imported data reach
  the editor's view-mode/axis/panel logic unchecked.
  ("Every user-text field" means every one — an early implementation only checked
  scene title/summary and marker/divider labels; storyline/character/location/reveal
  names had no type check at all. Fixed in the M10 audit. If you're implementing this
  rule fresh, enumerate every user-text field explicitly rather than trusting an
  earlier pass caught them all.)
- Repairable oddities (unknown extra fields) are dropped silently.

> **Known gap (found in audit, July 2026), not yet fixed:** `createdAt`/`modifiedAt`
> are required to be present but not type-checked as ISO date strings, `name` may
> validate as an empty string, and the anchor regexes (`YYYY-MM-DD` / `HH:MM`) accept
> calendrically impossible values like `2020-13-45` or `99:99` — these fail silently
> later via `Date.parse` returning `NaN` (`anchorTs()` in `time.js` treats the scene as
> unanchored) rather than being rejected at import time with a clear error.

If `projectUid` matches an existing project: compare `revision` and offer
**Update local copy / Keep both / Cancel** (Keep Both assigns a fresh uid). Warn before
Update when the local copy's `modifiedAt` is newer than the file's.

## 14. Projects page (index.html)

Card grid: project name, "N scenes · M chapters" (chapters = dividers+1), modified date;
actions per card: Open, Rename, Duplicate (fresh uid), Export, Delete (typed-confirm
modal: user types the project name). Top bar: app name, "New project" (name prompt →
creates project with one storyline "Main", empty everything → opens editor), "Import
project (JSON file)". First-ever visit (no `tl_index`): seed the sample project from
`data/sample-glass-harbor.json` via fetch, guarded by a `samplesSeeded` flag in
`tl_prefs` set SYNCHRONOUSLY before the fetch starts (prevents double-seed races).

## 15. Sample project — "The Glass Harbor"

Ship the mockup's story as `data/sample-glass-harbor.json`, extended with real model
data. Contents: 3 storylines (Investigation / The Heist / Harbor Politics), 4 characters
(Det. Reyes, Elena Vasquez, Marcus Webb, Councilwoman Aldana), 4 locations (The Harbor,
The Old Warehouse, City Hall, The Docks), 12 scenes matching the mockup's titles,
chronOrder, and msOrder exactly. Anchors: the three 1998 scenes dated Oct–Nov 1998; the
2008 scenes dated consecutively June 12–18, 2008; "The Vote" and "Confrontation at the
Docks" BOTH June 17 with times 19:00 and 19:30 and durations 90 min, both including
Det. Reyes with different locations → produces the bilocation conflict. Reveals:
`the-heist` (revealed by "The Vault Job"), `the-betrayal` ("The Betrayal"),
`the-fire` ("The Fire"), `elena-alive` ("Elena, Alive"). Requires: "Marcus Talks"
requires `the-heist`; "Dinner at the Overlook" requires `the-fire` → produces the
reveal-order conflict; "Confrontation at the Docks" requires `elena-alive` (satisfied).
Two markers: "1998 — TEN YEARS EARLIER" before "The Vault Job", and "2008 — PRESENT DAY"
before "A Body in the Harbor". One divider: "PART II" before Ch 7. Convergence example:
"The Vote" has home storyline Harbor Politics and `alsoStorylineIds` containing the
Investigation storyline (its dot must show on both of its cards). `dismissed` starts
empty; the sample must open showing exactly 2 active conflicts (the reveal-order and the
bilocation). In the Braid view this sample must reproduce the mockup's shape: three
dashed flashback segments rising at Ch 2, Ch 7, and Ch 9.

## 16. Known pitfalls (learned on a prior sibling project — read before coding)

1. `min-height:0` on flex children that must scroll (§3).
2. `ResizeObserver`, not just window resize, for redraw triggers (§3).
3. `e.code` not `e.key` for Alt/Option shortcuts on macOS (§1.4).
4. Drag self-heal via `e.buttons === 0` check in global mousemove (§7.5).
5. Undo must not hijack text-field undo, and must not fire mid-drag (§5.3).
6. Never let a failed project load open an empty editor that can overwrite the stored
   blob (§5.3).
7. Guard every cross-file function reference used before another file's load with
   `typeof fn === 'function'` if load order could vary.
8. localStorage quota failures: alert once per session, never once per edit (§5.2).
9. Escape-key and shortcut handlers must respect open modals (track open modal state
   centrally; Alt/plain shortcuts don't fire under a modal).
10. SVG `getBBox()` does not include stroke width — don't use it to size around thick
    strokes.

## 17. Build order (milestones — complete and manually verify each before the next)

- **M1** `state.js` + projects page: create/open/rename/duplicate/delete/export/import
  (validation complete), sample seeding. Verify with localStorage inspection.
- **M2** Editor shell: top bar, stage layout, right panel skeleton, view-mode switching,
  divider drag, project load/save/undo plumbing.
- **M3** Chronology view rendering (ordinal): lanes, cards, markers, selection, hover.
- **M4** Manuscript view rendering + wires + cross-view hover linking.
- **M5** Drag: both views, both axes (reorder/re-lane), with self-heal + Escape.
- **M6** Inspector: all fields including constraints and reveals editing; project-level
  lists; add/duplicate/delete scene.
- **M7** `time.js` true-scale mode + gap divider; anchor display on cards; zoom slider
  + scroll containers + counterpart auto-scroll (§7.6).
- **M8** Braid view (§9.5) + light theme & theme toggle (§3.3).
- **M9** Conflict engine + panel + flag mode + dismissal + warn-dots.
- **M10** Sample project data file; polish pass against the mockups; verification (§18).

## 18. Verification checklist (manual, in-browser)

1. Fresh profile → index.html seeds and lists The Glass Harbor; opening it shows the
   mockup's layout with 2 conflicts badged.
2. Hover any scene in either view: both cards + wire highlight, rest dims; leave resets.
3. Click each conflict: correct scenes flag in both views, wires turn red; "mark
   intentional" moves it to the dismissed section and the badge decrements; "restore
   warning" reverses; dismissal survives reload.
4. Drag "The Betrayal" after "The Fire" in chronology → anchor-order conflict appears;
   undo removes it; redo restores it.
5. Drag "The Fire" (Ch 9) before "Dinner at the Overlook" (Ch 6) in the manuscript →
   reveal-order conflict disappears.
6. Vertical-drag a scene to another lane → color, lane, and wire update everywhere.
7. Release the mouse outside the window mid-drag → drag cancels cleanly on re-entry, no
   data change (verify scene count/order via console before/after).
8. True scale: 1998 cluster compresses left with the "≈ 10 yrs" gap divider; Ordinal
   toggle returns even spacing; with <2 anchors (new project) the toggle is disabled.
9. Thread: pick Elena → curve threads her 5 scenes across lanes below the cards; None
   hides it.
10. Inspector: every field round-trips (edit → reload → persisted); title cannot be
    emptied; offscreen toggle removes the card from manuscript + wires and its Ch badge
    shows "off"; constraints and reveals add/remove correctly; new reveal created by
    typing an unknown label.
11. Delete a scene involved in a constraint and a conflict → constraint gone, conflicts
    recomputed, orders intact; undo restores everything including the constraint.
12. Export → clear localStorage → import the file → project identical (deep-compare in
    console). Import a file with a duplicated scene id and a malformed date → both
    rejected with specific messages, nothing written.
13. Same-uid import: newer file offers Update/Keep Both/Cancel; Keep Both creates a
    second project with a new uid.
14. Undo/redo: 10-step mixed sequence (moves, edits, deletes) fully reversible; Ctrl+Z
    inside the summary textarea edits text only.
15. Resize window and drag the split divider: wires stay glued to card edges (no drift).
16. Console clean (no errors/warnings) throughout all of the above; CSP: zero inline
    handlers/scripts (grep the HTML), no CSP violations in console.
17. All user text rendered safely: set a scene title to
    `<img src=x onerror=alert(1)>` — renders as literal text everywhere (cards, tooltip,
    inspector, conflict messages, braid labels, exports).
18. Theme toggle: switch to light — every surface recolors (cards, wires, thread, braid,
    panel, modals), storyline colors swap to the light palette at the same indices, the
    preference survives reload; re-run checks 2 and 3 while in light theme.
19. Braid: sample shows the three dashed flashback rises at Ch 2/7/9; hovering a node
    thickens its two adjacent segments; clicking a node opens the inspector; a scene
    marked offscreen disappears from the braid path but leaves its rank gap.
20. Zoom & scroll: zoom to 200px/scene → chronology scrolls; wires stay glued to cards
    while scrolling EITHER strip; selecting a scene whose counterpart is off-screen
    auto-scrolls the other strip to center it.
21. Convergence: check "Also part of → Investigation" on "The Vote" → colored dot
    appears on both its cards; unchecking removes it; deleting that storyline (after
    adding a throwaway one) strips the dot without touching the scene's home lane.

## 19. Explicitly out of scope for v1 (do not build)

Prose/word-count fields · fictional calendars · per-character knowledge tracking ·
travel-time inference · tension curves and analytics · multi-select · mobile/touch ·
collaboration/sync · AI features · backup-reminder nudges · print/reports ·
**split-pane timeline** (two independently scrolled viewports over one strip — planned
v1.x; §7.6's scroll layout must not block it) · minimap · custom storyline colors ·
the writers-desk mockup's vertical layout, serif typography, and margin-note conflict
presentation (its palette is used for the light theme; nothing else) ·
**SceneSetter interchange** (planned v1.x, both directions: SceneSetter→ThruLine maps
board order to both orders, sections→dividers, characters/locations→same;
ThruLine→SceneSetter maps msOrder→board order, dividers→sections; lossless
round-tripping additionally requires SceneSetter to preserve a namespaced
`x_thruline` blob through its own import/export — a future SceneSetter-side change.
Do not implement any of this now, but do not make schema choices that would block it.
Full design — including the alternative of folding ThruLine into SceneSetter as a
feature instead — now lives in `INTERCHANGE_AND_INTEGRATION.md`, July 2026).
