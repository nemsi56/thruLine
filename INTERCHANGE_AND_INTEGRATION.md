# SceneSetter ↔ ThruLine: Interchange and Integration

**Status:** design document, July 2026. Nothing here is implemented. This expands the
one-paragraph reservation in `THRULINE_V1_SPEC.md` §19 ("SceneSetter interchange,
planned v1.x") into a full design, and adds a second path not covered there:
folding ThruLine into SceneSetter as a feature of one app.

**The two paths are alternatives with different end states:**

- **Part 1 — Interchange:** both apps stay independent; a project moves between them
  via exported JSON files, round-tripping losslessly.
- **Part 2 — Integration:** ThruLine's views and conflict engine become a feature of
  SceneSetter; one app, one project file, no sync problem.

Part 1 is less work up front but carries a permanent tax: every future feature in
either app must re-answer "how does this survive the round trip?", and the
lost-update problem (§1.8) never fully goes away — it can only be warned about.
Part 2 is more work once, then the tax disappears. **Recommendation: build Part 2
unless ThruLine needs a standalone identity;** in that case build Part 1, but make
the schema decisions in §1.3–§1.5 knowing Part 2 may follow (they are compatible —
the id-map work in §1.4 is a subset of the entity-id migration in §2.3).

Schema facts referenced throughout (as of July 2026):

| | SceneSetter (v "2") | ThruLine (schemaVersion 1) |
|---|---|---|
| Scene ids | sequential integers + `nextId` counter | strings (`sc_…`) |
| Characters/locations | `{name, notes}` — **no ids; referenced by name string** | `{id, name}` — referenced by id |
| Manuscript order | `scenes` array order | `msOrder` array of ids |
| Story-time order | none | `chronOrder` array of ids |
| Grouping | sections: `sectionId` stamped on each scene, `{id, name, color}` | dividers: separators anchored `beforeSceneId` in msOrder |
| Scene-only-in-this-app fields | `wordCount`, `povs`, `notes`, `themes`, `misc` | `storylineId`, `alsoStorylineIds`, `anchor`, `durationMin`, `offscreen`, `reveals`, `requires` |
| Project-only-in-this-app | themes/misc libraries, `andOr`, `theme` | storylines, constraints, markers, `dismissed`, `viewPrefs`, `projectUid`, `revision`, `modifiedAt` |
| File identity/provenance | `projectUid`, `revision`, `exportedAt`/`lastExportedAt` — added at export time (older sample files predate them) | `projectUid`, `revision`, `modifiedAt` |

---

## Part 1 — File interchange between independent apps

### 1.1 Architecture: native formats + a foreign-data sidecar

No third file format, and no shared superset format that both apps read natively
(that couples the apps' release cycles forever — every field one app adds churns the
other's parser). Instead:

1. Each app keeps its own export format unchanged.
2. Each app's **importer** learns to recognize and read the other's format.
   Detection is unambiguous: SceneSetter files have `v: "2"`, ThruLine files have
   `schemaVersion: 1`.
3. Each app's **exporter**, when the project originated from (or has round-tripped
   through) the other app, embeds everything it could not translate in a namespaced
   blob — `x_thruline` inside a SceneSetter file, `x_scenesetter` inside a ThruLine
   file — which the receiving app preserves untouched and re-emits on the return
   trip.

**Attach foreign data at the entity level, not as one project-level lump.** A scene
object in a SceneSetter file carries its own `x_thruline: {anchor, durationMin,
reveals, requires, storylineRef, …}`. Deleting, reordering, or duplicating the scene
then automatically carries or discards the right foreign data — its lifecycle rides
the entity's lifecycle, with no bookkeeping. Only genuinely project-level ThruLine
data (storylines, constraints, markers, `chronOrder`, `dismissed`) goes in a
project-level `x_thruline` blob, and its scene-id references are pruned on import by
the same cascade logic the host app already runs for its own data.

### 1.2 The sanitizer carve-out (prerequisite in BOTH apps)

Both apps currently drop unknown fields on import, deliberately: ThruLine's
`sanitizeImportedProject` rebuilds a clean object from a whitelist, and
SceneSetter's import was hardened the same way in its July 2026 audit. As written,
**each app destroys the other's sidecar on import.** Each needs an explicit
carve-out:

- Preserve `x_scenesetter` / `x_thruline` byte-for-byte at whatever level it appears
  (per-scene and project-level). Unknown fields *inside* the blob are preserved too —
  that is what lets one app rev without breaking the other (§1.7).
- Validation must not reject the field's presence, but must not trust its contents
  either: the blob is opaque except for the well-known reference section (§1.7),
  and nothing inside it is ever rendered or executed. (Both apps render exclusively
  via `textContent` under a `script-src 'self'` CSP, so even hostile blob contents
  are inert — but keep the blob out of the DOM entirely.)

### 1.3 Field mapping

| Data | Rule |
|---|---|
| Scene title, summary | Direct, both ways. ThruLine requires non-empty title; empty titles get "Untitled scene" on import. |
| SceneSetter board order | → `msOrder` always; → `chronOrder` **on first import only** (per spec §19). On re-import, existing scenes keep their chronOrder positions; new scenes append. |
| ThruLine `msOrder` | → SceneSetter `scenes` array order. `chronOrder` → project-level sidecar. |
| Sections ↔ dividers | N sections → N−1 dividers anchored at each section's first scene (the first section has no leading divider). Divider labels ↔ section names. Section colors → sidecar. See §1.5 for the semantic rule. |
| Characters, locations | Both ways, via the id-map (§1.4). SceneSetter `notes` → sidecar. |
| POV, themes, misc, wordCount, scene notes | No ThruLine home → sidecar (per-scene where per-scene, else project-level). |
| Storylines + scene storyline refs, anchors, durations, offscreen, reveals/requires, constraints, markers | No SceneSetter home → sidecar. |
| Settings/prefs (`theme`, `andOr`, `viewPrefs`) | **Not round-tripped at all.** Per-app preferences; an import must not reset the user's theme. |

### 1.4 Identity and the id-map

The single hardest problem. Scene ids are mechanically bridgeable (each side records
the counterpart id in the per-scene sidecar; SceneSetter's `nextId` must be advanced
past every id minted during import to prevent collisions). Characters and locations
are worse: **SceneSetter has no entity ids — the name string IS the reference** in
`scenes[].characters`, `povs`, etc. A rename in either app therefore looks like a
delete-plus-add to the naive join, orphaning POVs, notes, and ThruLine reveals.

Rule: the project-level sidecar carries an **id-map** — `[{tlId, ssName}]` for every
character and location, captured at export time. Import matching runs in strict
precedence: **id-map hit → exact-name hit → create new entity** (and extend the map).
Everything inside the sidecar that refers to an entity (POV lists above all) refers
to it through the map's stable key, never through a raw name, so renames performed in
the app that can't see that data cannot corrupt it.

Cascade rules on import, applied to sidecar contents as well as native data:

- **Entity deleted** (character/location): prune from scene refs, from the id-map,
  and from sidecar data that references it (a deleted character who was a POV; a
  ThruLine `viewPrefs.threadCharId` simply nulls — though prefs aren't round-tripped
  anyway).
- **Scene deleted**: the host app's normal delete cascade must also run against the
  foreign project-level blob — ThruLine constraints/markers referencing a scene
  deleted in SceneSetter are pruned when the file comes home, exactly as
  `enforceInvariants`/`deleteScene` prune native references today.

### 1.5 Reorder vs. section assignment

Sections and dividers are not the same concept. SceneSetter sections are
*assignments* (a `sectionId` stamped on the scene, wherever it sits); ThruLine
dividers are *positional separators* (moving a scene past a divider implicitly
changes its chapter). The conversion rule is: **section membership is derived from
position at conversion time.** Contiguous runs between dividers become sections;
whatever the old `sectionId`s said, the run a scene sits in wins. Document this in
both apps' import UI copy — it is the one place a user can see data "change" without
having edited it.

Reordering the board in SceneSetter updates `msOrder` only and **never touches
`chronOrder`** for existing scenes. Manuscript order changing does not mean
story-time changed — that separation is ThruLine's entire premise, and the importer
must not "helpfully" re-sync the two.

### 1.6 Offscreen scenes

Offscreen scenes exist in `chronOrder` but not `msOrder`, so they have no board
position. Options: (a) hold them entirely in the sidecar and restore on return;
(b) export them into a dedicated "Offscreen" section at the board's end. **v1 uses
(a)** — putting them on the board invites meaningless reordering and muddies §1.5's
position-derived section rule — with the import toast reporting "N offscreen scenes
preserved" so nothing feels silently lost. Accepted trade-off: they are invisible
and uneditable while the project lives in SceneSetter. Revisit (b) if that proves
annoying in practice.

### 1.7 Versioning and future app updates

- The interchange contract gets **its own version, inside the sidecar**
  (`x_thruline: {xv: 1, …}`), independent of either app's schema version. Each app
  validates its own fields exactly as strictly as today and treats the foreign blob
  as opaque — with one exception: a small, well-known, versioned **reference
  section** of the blob (the id-map plus any scene-id lists) that the host app is
  allowed to read and prune per §1.4. Everything else in the blob is carried
  byte-for-byte, unknown fields included.
- That preservation policy is what lets ThruLine v1.3 add a field while SceneSetter
  stays at v2: the new data simply rides through. An app seeing a *newer* reference-
  section version than it knows should warn and import anyway (preserving the blob
  unmodified and skipping the pruning it doesn't understand) rather than refuse.
- When either app bumps its own schema version, its importer keeps accepting the old
  version (both already do migration-on-load internally); the sidecar is unaffected.

### 1.8 Provenance and the lost-update problem

Export to ThruLine, keep editing in SceneSetter, then import the round-trip file:
the interim SceneSetter edits silently revert. This cannot be prevented with files —
only warned about. **Both apps already have the machinery** (correcting an earlier
draft of this doc, which claimed SceneSetter files carried no provenance — that was
true only of its static sample files): ThruLine has `projectUid` + `modifiedAt` +
the "your local copy was modified more recently" modal; SceneSetter's export stamps
`projectUid`/`revision`/`exportedAt` and its import resolves same-uid conflicts by
revision with Update/Keep-Both/Cancel dialogs (`projects.js` `importProjectJSON`).
What interchange adds is only the cross-app wrinkle: each importer must run this
check when the incoming file's uid matches, regardless of which app exported it, so
the uid must survive the format conversion in both directions.

Interchange semantics are **whole-project replace, with that warning**. No
field-level merge of divergent edits in any version — it is a tarpit.

### 1.9 Acceptance tests

The two invariants that keep every rule above honest:

1. **Idempotence:** A → B → A with no edits in B is deep-equal to A (both
   directions).
2. **Edit isolation:** A → B → (exactly one edit) → A equals A with exactly that
   edit applied — across each of: reorder, section/divider move, scene add, scene
   delete, entity rename, entity delete, offscreen toggle.

The day either fails, some data found a path around the sidecar.

---

## Part 2 — Folding ThruLine into SceneSetter as a feature

> **Implementation spec exists (July 2026):** this part has been expanded into a
> full implementation-grade spec, grounded in a line-level audit of the SceneSetter
> codebase — see `SCENESETTER_V3_TIMELINE_SPEC.md` in the SceneSetter repo
> (storyboard_v2). Where the two disagree on a detail, that spec wins; this section
> remains the design rationale.

The alternative that dissolves the sync problem instead of managing it: ThruLine's
chronology view, wires, and conflict engine become a **Timeline feature inside
SceneSetter**. One app, one project file, no sidecars, no id-maps, no provenance
stamps. `BRAINSTORM.md` §8–9 anticipated this ("if it folds into SceneSetter
eventually, it becomes 'SceneSetter Timeline'").

### 2.1 What the merged data model looks like (SceneSetter schema v3)

SceneSetter's schema grows a superset of ThruLine's data; nothing is removed:

- **Scenes** gain optional fields: `chronRank` is NOT added — instead a top-level
  `chronOrder` array of scene ids (matching ThruLine's design; an order array
  survives splices better than per-scene ranks), plus per-scene `storylineId`,
  `alsoStorylineIds`, `anchor {date, time}`, `durationMin`, `offscreen`, `reveals`,
  `requires`. All optional/defaulted, so v2 projects migrate by filling defaults:
  `chronOrder` initialized to board order, `storylineId` to a single created "Main"
  storyline — exactly the first-import rule from §1.3.
- **New top-level collections:** `storylines`, `revealsLib` (reveal definitions),
  `constraints`, `markers`, `dismissed`.
- **Sections replace dividers entirely.** ThruLine's dividers were a stand-in for
  chapters; SceneSetter's sections ARE chapters, with names and colors. The braid
  view's "CH n" ticks and the manuscript strip's chapter badges read section
  membership directly. One grouping concept, no §1.5 conversion rule needed —
  this is the single biggest simplification integration buys.
- **Manuscript order = board order.** Already the same concept; `msOrder` is not
  imported as a separate array. Offscreen scenes: a scene with `offscreen: true`
  stays on the board (SceneSetter users expect to see and edit every card) but is
  badged "off", excluded from wordCount totals/reports where appropriate, and
  excluded from the reader-knowledge (reveal-order) checks — which is precisely
  ThruLine's rule, minus the "hidden from the manuscript strip" behavior that only
  made sense when the strip was the sole board.

### 2.2 What the UI looks like

- A new **Timeline** view alongside SceneSetter's existing views: the chronology
  strip (lanes = storylines, ordinal/true-scale axis) above the existing board,
  with the SVG wires connecting each scene's two positions — ThruLine's
  side-by-side mode with the manuscript strip replaced by the board SceneSetter
  already has. Braid view comes along as a second tab if wanted; it is read-only
  and cheap to carry.
- The **conflict engine ports as-is.** It is pure functions over project data
  (order relations, cycle detection, interval overlap — no DOM), which was a
  deliberate ThruLine design choice. Panel UI, warn-dots, flag mode, and dismissal
  fingerprints carry over; fingerprints are stable strings, so `dismissed`
  survives migration.
- Inspector: SceneSetter's scene editor gains a "Timing" group (anchor, duration,
  storyline, also-part-of, offscreen) and a "Reveals" group. Characters/locations
  editing stays exactly where it is — that is the point.

### 2.3 The entity-id migration (the one real schema surgery)

ThruLine's data references characters by id; SceneSetter references them by name.
Integration forces the choice §1.4 only papered over: **give SceneSetter's
characters, locations, themes, and misc entries stable string ids in v3**, and
migrate scene refs (`characters`, `povs`, `locations`, `themes`, `misc`) from name
arrays to id arrays on load. This is the largest single work item — it touches
every SceneSetter feature that reads those arrays (board chips, filters, reports,
charts, tracking) — but it also fixes a standing SceneSetter fragility for free:
today, renaming a character only works because the app rewrites every scene's name
strings in one pass; ids make renames a one-field edit and make the
"same name = same entity" ambiguity impossible.

Migration on load (v2 → v3) is mechanical: mint ids in library order, rewrite scene
refs by exact-name lookup (names are unique within a library today, enforced by the
UI), keep `name` as a display field. Old v2 exports remain importable forever via
the same migration; v3 exports are the only format written.

### 2.4 What happens to ThruLine and to interchange

- ThruLine the standalone app freezes (or continues as a demo/sandbox); its export
  format remains importable into SceneSetter v3 **once**, via the §1.3 mapping
  minus the sidecar machinery (there is no return trip, so nothing needs
  preserving — untranslatable ThruLine data all has a native v3 home by
  construction).
- Part 1 is then never built. If a project must leave for another tool, that is
  ordinary SceneSetter export, and the `x_thruline` reservation in the ThruLine
  spec becomes moot.

### 2.5 Costs and risks, honestly

- **Effort concentrates in §2.3** (entity ids) and in restyling ThruLine's views to
  SceneSetter's CSS. Both apps share the same architecture on purpose — vanilla JS,
  no build step, localStorage, same CSP, same `textContent`-only rendering, same
  commit/undo pattern — so the port is transplantation, not rewrite.
- SceneSetter's codebase grows by roughly ThruLine's ~4,300 lines minus the
  duplicated infrastructure (state/persistence/undo/projects page — ThruLine's
  versions are discarded).
- Undo scope: SceneSetter's undo must cover the new mutations (chron reorders,
  anchor edits, constraint add/remove). Both apps use snapshot-based undo, so this
  is automatic once the data lives in the one project object.
- Feature-flag the Timeline view for the first release so v3's data migration can
  ship and soak before the new UI is the story.

### 2.6 Decision summary

| | Part 1: Interchange | Part 2: Integration |
|---|---|---|
| Up-front work | Moderate (two importers, sidecar plumbing, SceneSetter provenance fields) | Larger (entity-id migration, view port, restyle) |
| Ongoing tax | Permanent — every new feature must answer the round-trip question; §1.8 never fully closes | None — one file, one app |
| User experience | Export/import round trips, two apps to learn | One app; timeline is just another view |
| Keeps ThruLine standalone | Yes | No (frozen or demo-only) |
| Reversible | Yes — apps stay independent | Effectively no once users have v3 data |

If the timeline is ultimately *for* SceneSetter's users, Part 2 is the better
destination and Part 1 is scaffolding that gets thrown away. Build Part 1 only if
ThruLine standalone matters in its own right.
