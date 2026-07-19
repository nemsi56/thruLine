# Timeline App — Brainstorm v1

*A standalone app for story writers: multi-track timelines, scene organization, timing
analysis, and structural problem-solving. New project; may fold into SceneSetter later,
but designed on its own terms first. (Working title TBD — see §9.)*

---

## 1. The core insight: one story, two orders

The single most powerful idea in your description is buried in the last feature: *"create
the story linearly, then break it apart and present it to a reader in a nonlinear,
multi-POV fashion."* Narrative theory has names for these two orders:

- **Story time (fabula):** the order events actually happen in the world.
- **Narrative time (syuzhet):** the order the reader experiences them on the page.

Almost every structural problem writers wrestle with — flashbacks, multi-POV weaving,
mystery reveals, nonlinear structures — is a mismatch or deliberate tension between these
two orders. Most existing tools model only one of them (Aeon Timeline is chronology-first;
Plottr is manuscript-order-first). **The app that models both, with a scene existing
simultaneously in each and a visible mapping between them, is the differentiator.**

Concretely:

- A scene/event is entered **once**. It has a *chronological position* (when it happens)
  and a *manuscript position* (when the reader encounters it).
- Two primary views of the same data:
  - **Chronology view** — the racetrack. Tracks are subplots/POVs/locations; time flows
    left to right; cards sit in lanes. This is where you keep the world honest.
  - **Manuscript view** — the reading order. A single sequence (or chapters/parts) showing
    what the reader gets, in order. This is where you design the experience.
- Dragging a card in one view never corrupts the other — it just updates that dimension.
- A **mapping visualization** connects them: draw a line from each scene's chronological
  position to its manuscript position. A linear story is all parallel lines; a flashback
  is a crossing line. The *shape* of the crossings shows your structure at a glance —
  writers could recognize "oh, my act 2 is a rat's nest" visually. (Think of the arc
  diagrams people draw for *Memento* or *Cloud Atlas*.)

This also gives the app its natural workflow story: **draft in chronology, design in
manuscript order** — or the reverse for discovery writers, who can log scenes as written
and reconstruct the chronology afterward.

## 2. The racetrack (chronology view)

Your lane metaphor, elaborated:

- **Tracks = lanes** stacked vertically; **time = horizontal axis**. Cards (scenes/events)
  sit in lanes and are draggable horizontally (retiming) and vertically (reassigning
  track).
- **What is a track?** Don't hard-code it. A track is a *named grouping*, and the user
  chooses the lane dimension per view: by subplot, by POV character, by location, by
  storyline. The same scenes re-lane themselves when you switch dimension. (One scene can
  belong to multiple subplots — it renders in its "home" lane with badges, or spans lanes,
  TBD.)
- **Character threads:** overlay mode drawing a colored line through every scene a chosen
  character appears in, across lanes — the *xkcd movie narrative chart* look. This is the
  natural cousin of SceneSetter's trace lines, and it's even more at home here because the
  x-axis is real time. Threads make "where was Mara during act 2?" a glance, not a search.
- **Two x-axis modes**, both necessary:
  - **True-to-scale time:** gaps and clumps are visible ("nothing happens for three
    months, then everything happens in one night"). Great for diagnosing pacing of the
    *world*.
  - **Ordinal/compressed:** every scene gets equal width, reading like a storyboard. Great
    for working, since true-scale often makes dense stretches unusably cramped.
  - Zoom smoothly between scales (decades → years → days → hours) for stories that span
    generations but climax in an evening.
- **Spans, not just points:** some events have duration (a war, a voyage, a pregnancy).
  Cards can be instants or ranges; range cards render as bars in the lane.
- **Era/act bands:** vertical background bands marking acts, parts, or story eras, plus
  milestone markers (inciting incident, midpoint, climax) that structural writers can pin.

## 3. Time itself: fuzzy first, precise when earned

This is the make-or-break design decision, and where Aeon Timeline loses people: it
demands dates too early. Writers usually know *order* before they know *when*. Model time
in tiers, and let every scene live at whatever tier it's earned:

1. **Pure order** — "this happens after that." (Just sequence; the default.)
2. **Relative offset** — "three days after the wedding," "the same night as scene 12."
3. **Anchored** — an actual date/time (supporting fictional calendars eventually, but real
   calendar + "Day 1 / Day 2" style relative calendars covers most of v1).

Under the hood this is a **constraint system**: pinned events + relationships between
events. That sounds heavy, but the UI can stay light — dragging a card pins it; typing
"2 days after the heist" creates a link. The payoff is enormous, because constraints are
what power the problem-solver (§4): the app can *derive* feasible time ranges for floating
events, ripple a change ("you moved the heist a week later — these six dependent scenes
moved with it"), and flag contradictions instead of silently allowing them.

## 4. The problem-solver

Three distinct families of "discrepancy," worth treating separately in the UI:

### 4a. Chronology conflicts (world logic)
- **Bilocation:** a character appears in two scenes whose time ranges overlap in different
  places.
- **Travel time:** scene 9 ends in Rome at dusk; scene 10 starts in Paris the same night.
  (v1: user-declared "minimum gap" constraints between locations; later: smarter.)
- **Constraint contradictions:** A is before B, B is before C, C is before A — the solver
  reports the cycle and shows the chain that causes it.
- **Age/date math:** birthdays, durations, "she'd be 9 here, not 12." (Character birth
  dates + automatic age display on any scene a character appears in gets 90% of this.)

### 4b. Reader-knowledge conflicts (narrative logic) — the sleeper feature
Each scene can declare what it **reveals** (reader learns the butler did it) and what it
**requires** (reader must already know the will was forged). Checked against *manuscript*
order, not chronological order:
- Flag any scene that requires a reveal that hasn't happened yet in reading order.
- **Reveal map:** for any point in the manuscript, what does the reader currently know?
  This is *the* tool for mysteries, thrillers, and nonlinear structures — reordering
  scenes for effect without breaking comprehension is exactly the hard problem your
  "break it apart for the reader" workflow creates, and nothing on the market does this
  well.
- Same machinery, per character: what does each *character* know and when? (v2 — but it
  falls out of the same data model, and it catches "how does she know that?" plot holes.)

### 4c. Structural/pacing analysis (soft warnings, not errors)
- POV distribution: "Kell narrates 60% of act 1 and disappears for 11 chapters."
- Subplot neglect: "the smuggling subplot goes untouched for 90 pages."
- Time-gap rhythm in manuscript order: consecutive-scene jumps in story time, visualized.
- Tension/stakes curve if the user rates scenes (optional field → line chart overlay).

Presentation principle: **a linter, not a gate.** Problems appear in a panel and as badges
on the offending cards; nothing blocks a save. Writers break rules on purpose — every
warning needs a "dismiss/intentional" state (a flashback *is* a knowledge-order violation,
deliberately).

## 5. Look and feel

- The racetrack should feel **physical**: smooth drag with inertia-free precision,
  snapping (to other events, day boundaries, "same time as"), ghost preview while
  dragging, and a satisfying settle. Reorder/retime is the core loop — it must feel great
  before anything else matters.
- **Minimap** strip for long timelines; **collapsible lanes** (fold a subplot away);
  **focus mode** (dim everything but one thread).
- Color by any dimension (track, POV, location, tension) — one active color scheme at a
  time, pickable, like SceneSetter's themes philosophy.
- Density control: full cards (title + summary + badges) ↔ compact bars ↔ dots, driven by
  zoom level automatically with manual override.
- The connection view (§1's crossing-lines mapping) should be beautiful enough to
  screenshot — it's the app's signature image, the thing people post. Design it like a
  poster, not a debug view.

## 6. Scope: what v1 is and isn't

**v1 is a structure tool, not a writing tool.** No prose editor. Scenes carry title,
summary, and metadata; the manuscript lives in Scrivener/Word/wherever. This keeps scope
sane and positions the app as a *companion*, which is also the wedge against
do-everything suites (Campfire, World Anvil) that do timelines badly.

Suggested v1 core:
1. Projects, scenes/events with the tiered time model (§3, possibly starting with tiers
   1–2 only).
2. Chronology view: lanes, drag/retime/re-lane, zoom, both axis modes.
3. Manuscript view: simple ordered list/board with drag-reorder, chapter grouping.
4. The dual-order mapping visualization.
5. Conflict panel v1: order contradictions, bilocation, and reveal/require checking
   (§4b's basic form — it's cheap once the data model has it, and it's the headline).
6. JSON export/import, local-first storage.

Explicitly later: fictional calendars, per-character knowledge, travel-time inference,
tension curves, AI-assisted anything, real-time sync/collaboration, Scrivener sync.

## 7. Landscape (know thy neighbors)

- **Aeon Timeline** — the incumbent. Powerful, chronology-first, syncs with Scrivener.
  Widely described as unintuitive with a steep learning curve; dual-order narrative
  design is not its center of gravity. Beating it on *feel* and on the
  fabula/syuzhet mapping is a real position.
- **Plottr** — friendly plotline grid ("timeline" in name only — it's ordinal cards, no
  real time model). Validates the lanes-of-cards UX; weak on everything in §3–4.
- **Campfire / World Anvil / novelWriter** — suites with timeline modules; none treat
  timing as a first-class problem.
- Nobody does reader-knowledge tracking. That plus the dual-order view is the moat.

## 8. Tech notes (for later, but they shape design)

- Your SceneSetter stack — vanilla JS, static hosting, localStorage, JSON
  export/import, no backend — carries over cleanly and keeps the same
  privacy/portability story. Main new demand: the timeline canvas wants SVG (or Canvas
  at very high card counts) with virtualized rendering for long timelines; the charts.js
  experience (path measurement, segment slicing, ResizeObserver lessons) is directly
  reusable experience.
- **Data-model compatibility is the cheap insurance for a future fold-in:** scenes with
  ids, library-style entities (characters/locations), sections ↔ chapters. If the
  Timeline app's JSON can *import* a SceneSetter project (scenes → cards in manuscript
  order, chronology initially unset), the two apps are bridged from day one without
  sharing any code.
- Constraint solver: don't fear it — v1's checks are order relations (a DAG +
  cycle detection + interval overlap), not a SAT solver. A few hundred lines, no
  dependencies.

## 9. Name ideas (parking lot)

Storyline, Throughline, Chronica, Fabula, Plotline, Timeweave, Strands, Braid,
TrackChanges (taken, sadly), Sequence, Reorder, Interleaf. "Throughline" and "Fabula"
both gesture at the actual differentiator. If it folds into SceneSetter eventually, it
becomes "SceneSetter Timeline" and the standalone name matters less.

## 10. Decisions so far (July 18, 2026)

1. **Time model: full tiered support in v1.** Projects vary — some date-driven, some
   sequence-only — so all three tiers (order / relative / anchored) ship in v1. A
   project-level "time style" setting can default the UI (a sequence-only project never
   shows date pickers unprompted), but the data model supports all tiers everywhere.
   Fictional calendars remain post-v1.
2. **Views are equals — side-by-side is the identity of the app.** Neither chronology nor
   manuscript is "home"; the flagship layout shows both (stacked or split, with the
   crossing-lines mapping drawn live between them), one keystroke to focus either. This
   is the strongest version of the dual-order concept and should drive the visual design
   from day one, not be retrofitted.
3. **Problem-solver v1 = conflicts + reveal tracking.** Order contradictions, bilocation,
   and reveals/requires checking against manuscript order — all passive (linter, not
   gate) with per-warning "intentional" dismissal.
4. **Stack: static web, SceneSetter-style.** Vanilla JS, localStorage, JSON
   export/import, static hosting. Same privacy/portability story; easiest eventual
   fold-in. SVG timeline canvas.

## 11. Decisions round two (July 18, 2026) — design comparison outcome

Three design mockups were built and compared (`mockup_sidebyside.html` = A "mission
control", `mockup_writers_desk.html` = B "writer's desk", `mockup_braid.html` = C "the
braid"). Outcomes:

5. **Design A is the primary workspace.** B is not built as a layout; its paper palette
   becomes the LIGHT THEME (dark + light both ship in v1, same sans typography as A —
   no serif). C ships as a read-only fourth view mode ("Braid") — cheap, high value.
6. **Name: ThruLiner** (working). Spec renamed to `THRULINER_V1_SPEC.md`.
7. **One card type + "offscreen" flag** (no separate event entity). Audience: novelists
   first.
8. **Storyline convergence:** a scene has one HOME storyline (its lane) plus optional
   secondary storylines rendered as small color dots on the card; character threads
   also make convergence visible.
9. **Long timelines scroll, they don't shrink:** per-strip horizontal scrolling with a
   bounded zoom (70–200 px/scene), wires tracking scroll, and counterpart auto-scroll
   on selection. A true split-pane over the chronology is a named v1.x follow-up, as is
   a minimap.
10. **SceneSetter relationship:** ThruLiner ships standalone; two-way interchange is
    designed but deferred (v1.x). Lossless round-tripping will require SceneSetter to
    preserve an `x_thruliner` blob through its import/export — SG will make that
    SceneSetter-side change later, when making the apps interactive. Same-origin
    hosting can eventually let both apps share localStorage ("jump between apps").
11. **Conflicts stay non-AI:** user-declared reveals/requires + set arithmetic over
    reading order; all metadata optional, checks activate only when data exists.
