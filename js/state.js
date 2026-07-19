// state.js — data model, persistence, ids, undo/redo
'use strict';

/* ---------------- ids ---------------- */

var _idCounters = {};

function newId(prefix) {
  var t = Date.now().toString(36);
  _idCounters[prefix] = (_idCounters[prefix] || 0) + 1;
  return prefix + '_' + t + '_' + _idCounters[prefix];
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ---------------- palette ---------------- */

var STORYLINE_PALETTE = {
  dark: ['#5aa9e6', '#e0a458', '#a78bfa', '#6ad19a', '#e66a9a', '#58c4d4', '#d4c458', '#c48a58', '#8a9ae6', '#6ae0c4'],
  light: ['#3d6c9e', '#b07a35', '#7b5ea7', '#3f8f68', '#b3486f', '#35809a', '#8f7d2e', '#8f5b32', '#4f5fa8', '#2e8b7a']
};

function slColor(paletteIndex) {
  var theme = (getPrefs().theme === 'light') ? 'light' : 'dark';
  var pal = STORYLINE_PALETTE[theme];
  return pal[((paletteIndex % pal.length) + pal.length) % pal.length];
}

/* ---------------- convergence dots (§7.1, reused by chron.js + manuscript.js) ----------------
   For each id in scene.alsoStorylineIds, a small dot in that storyline's color
   (max 4 dots, then "+n"). Returns null when the scene has no secondary storylines. */
function renderConvDots(scene, storylineById) {
  if (!scene.alsoStorylineIds || !scene.alsoStorylineIds.length) return null;
  var dots = document.createElement('div');
  dots.className = 'convDots';
  var shown = scene.alsoStorylineIds.slice(0, 4);
  shown.forEach(function (stId) {
    var st = storylineById[stId];
    if (!st) return;
    var d = document.createElement('span');
    d.className = 'convDot';
    d.style.background = slColor(st.paletteIndex);
    d.title = st.name;
    dots.appendChild(d);
  });
  if (scene.alsoStorylineIds.length > 4) {
    var more = document.createElement('span');
    more.className = 'convMore';
    more.textContent = '+' + (scene.alsoStorylineIds.length - 4);
    dots.appendChild(more);
  }
  return dots;
}

/* ---------------- project object shape ---------------- */

function makeEmptyProject(name) {
  var now = new Date().toISOString();
  var stId = newId('st_');
  return {
    schemaVersion: 1,
    projectUid: newId('pr_'),
    name: name || 'Untitled project',
    createdAt: now,
    modifiedAt: now,
    revision: 0,
    scenes: [],
    storylines: [{ id: stId, name: 'Main', paletteIndex: 0 }],
    characters: [],
    locations: [],
    reveals: [],
    constraints: [],
    chronOrder: [],
    msOrder: [],
    markers: [],
    dividers: [],
    dismissed: [],
    viewPrefs: { mode: 'side', axis: 'ordinal', threadCharId: null, chronHeightPx: 260, panelTab: 'inspector', panelOpen: true, pxPerScene: 110 }
  };
}

function makeScene(overrides) {
  var s = {
    id: newId('sc_'),
    title: 'Untitled scene',
    summary: '',
    storylineId: null,
    alsoStorylineIds: [],
    characterIds: [],
    locationId: null,
    offscreen: false,
    anchor: null,
    durationMin: null,
    reveals: [],
    requires: []
  };
  if (overrides) Object.assign(s, overrides);
  return s;
}

/* ---------------- invariants (§4.3) ---------------- */

function enforceInvariants(P) {
  var sceneIds = P.scenes.map(function (s) { return s.id; });
  var sceneSet = {};
  sceneIds.forEach(function (id) { sceneSet[id] = true; });

  // chronOrder: every scene id exactly once
  var seen = {};
  P.chronOrder = P.chronOrder.filter(function (id) {
    if (!sceneSet[id] || seen[id]) return false;
    seen[id] = true;
    return true;
  });
  sceneIds.forEach(function (id) {
    if (!seen[id]) { P.chronOrder.push(id); seen[id] = true; }
  });

  // msOrder: exactly the ids of on-screen scenes, each once
  var onscreenSet = {};
  P.scenes.forEach(function (s) { if (!s.offscreen) onscreenSet[s.id] = true; });
  var msSeen = {};
  P.msOrder = P.msOrder.filter(function (id) {
    if (!onscreenSet[id] || msSeen[id]) return false;
    msSeen[id] = true;
    return true;
  });
  Object.keys(onscreenSet).forEach(function (id) {
    if (!msSeen[id]) { P.msOrder.push(id); msSeen[id] = true; }
  });

  // alsoStorylineIds: never contains storylineId, no duplicates
  P.scenes.forEach(function (s) {
    var out = [];
    var seenSt = {};
    (s.alsoStorylineIds || []).forEach(function (id) {
      if (id === s.storylineId || seenSt[id]) return;
      seenSt[id] = true;
      out.push(id);
    });
    s.alsoStorylineIds = out;
  });
}

/* ---------------- mutation helpers used by later milestones ---------------- */

function deleteScene(P, sceneId) {
  P.scenes = P.scenes.filter(function (s) { return s.id !== sceneId; });
  P.chronOrder = P.chronOrder.filter(function (id) { return id !== sceneId; });
  P.msOrder = P.msOrder.filter(function (id) { return id !== sceneId; });
  P.constraints = P.constraints.filter(function (c) { return c.a !== sceneId && c.b !== sceneId; });
  ['markers', 'dividers'].forEach(function (key) {
    P[key].forEach(function (m) {
      if (m.beforeSceneId === sceneId) {
        var order = key === 'markers' ? P.chronOrder : P.msOrder;
        var idx = order.indexOf(sceneId);
        // re-anchor to next scene in that order, or null
        var remaining = order; // sceneId already removed above for msOrder/chronOrder
        m.beforeSceneId = remaining[idx] || null;
      }
    });
  });
}

function toggleOffscreen(P, sceneId, value) {
  var s = P.scenes.find(function (x) { return x.id === sceneId; });
  if (!s) return;
  s.offscreen = value;
  if (value) {
    P.msOrder = P.msOrder.filter(function (id) { return id !== sceneId; });
  } else if (P.msOrder.indexOf(sceneId) === -1) {
    P.msOrder.push(sceneId);
  }
}

/* ---------------- localStorage persistence (§5.1-5.2) ---------------- */

var LS_INDEX_KEY = 'tl_index';
var LS_PREFS_KEY = 'tl_prefs';
function LS_PROJ_KEY(uid) { return 'tl_proj_' + uid; }

var _quotaAlertShown = false;

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (!_quotaAlertShown) {
      _quotaAlertShown = true;
      alert('Changes may not be saved — export a backup');
    }
    return false;
  }
}

function getPrefs() {
  try {
    var raw = localStorage.getItem(LS_PREFS_KEY);
    if (!raw) return { theme: 'dark', lastOpenedProjectUid: null, samplesSeeded: false };
    var p = JSON.parse(raw);
    if (!p.theme) p.theme = 'dark';
    return p;
  } catch (e) {
    return { theme: 'dark', lastOpenedProjectUid: null, samplesSeeded: false };
  }
}

function savePrefs(prefs) {
  safeSetItem(LS_PREFS_KEY, JSON.stringify(prefs));
}

function getIndex() {
  try {
    var raw = localStorage.getItem(LS_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveIndex(index) {
  safeSetItem(LS_INDEX_KEY, JSON.stringify(index));
}

function loadProject(uid) {
  try {
    var raw = localStorage.getItem(LS_PROJ_KEY(uid));
    if (!raw) return null;
    var P = JSON.parse(raw);
    enforceInvariants(P);
    return P;
  } catch (e) {
    return null;
  }
}

function updateIndexEntry(P) {
  var index = getIndex();
  var chapters = P.dividers.length + 1;
  var entry = {
    projectUid: P.projectUid,
    name: P.name,
    modifiedAt: P.modifiedAt,
    sceneCount: P.scenes.length,
    chapterCount: chapters
  };
  var idx = index.findIndex(function (e) { return e.projectUid === P.projectUid; });
  if (idx === -1) index.push(entry); else index[idx] = entry;
  saveIndex(index);
}

function removeIndexEntry(uid) {
  var index = getIndex().filter(function (e) { return e.projectUid !== uid; });
  saveIndex(index);
  try { localStorage.removeItem(LS_PROJ_KEY(uid)); } catch (e) {}
}

/* current in-memory project, set by editor-init/projects-init as needed */
var P = null;

function saveProject() {
  if (!P) return;
  P.revision = (P.revision || 0) + 1;
  P.modifiedAt = new Date().toISOString();
  enforceInvariants(P);
  pruneDismissed(P);
  safeSetItem(LS_PROJ_KEY(P.projectUid), JSON.stringify(P));
  updateIndexEntry(P);
  if (typeof refreshAll === 'function') refreshAll();
}

function pruneDismissed(P) {
  // Stale dismissed fingerprints (no longer produced) are pruned on save.
  if (typeof computeConflicts !== 'function') return;
  try {
    var active = computeConflicts(P).map(function (c) { return c.fingerprint; });
    P.dismissed = P.dismissed.filter(function (fp) { return active.indexOf(fp) !== -1; });
  } catch (e) { /* conflicts engine not loaded yet in this milestone */ }
}

/* ---------------- undo/redo scaffolding (§5.3) ---------------- */

var _undoStack = [];
var _redoStack = [];
var UNDO_MAX = 50;
var _dragActive = false;

function _dataPortion(proj) {
  var copy = JSON.parse(JSON.stringify(proj));
  delete copy.viewPrefs;
  return copy;
}

function pushUndo(label) {
  if (!P) return;
  _undoStack.push({ label: label, data: _dataPortion(P) });
  if (_undoStack.length > UNDO_MAX) _undoStack.shift();
  _redoStack = [];
}

function commit(label, fn) {
  pushUndo(label);
  fn(P);
  saveProject();
}

function setDragActive(v) { _dragActive = !!v; }

function _canFireUndo(e) {
  if (_dragActive) return false;
  var t = e && e.target;
  if (t) {
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return false;
  }
  return true;
}

function undo(e) {
  if (e && !_canFireUndo(e)) return;
  if (!_undoStack.length || !P) return;
  var entry = _undoStack.pop();
  var redoEntry = { label: entry.label, data: _dataPortion(P) };
  _redoStack.push(redoEntry);
  var viewPrefs = P.viewPrefs;
  Object.keys(P).forEach(function (k) { delete P[k]; });
  Object.assign(P, entry.data);
  P.viewPrefs = viewPrefs;
  saveProject();
}

function redo(e) {
  if (e && !_canFireUndo(e)) return;
  if (!_redoStack.length || !P) return;
  var entry = _redoStack.pop();
  _undoStack.push({ label: entry.label, data: _dataPortion(P) });
  var viewPrefs = P.viewPrefs;
  Object.keys(P).forEach(function (k) { delete P[k]; });
  Object.assign(P, entry.data);
  P.viewPrefs = viewPrefs;
  saveProject();
}

function resetUndoStacks() {
  _undoStack = [];
  _redoStack = [];
}

/* ---------------- import validation (§13.2) ---------------- */

function validateProject(obj) {
  var errs = [];
  function fail(msg) { errs.push(msg); }
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Not a JSON object.'] };
  if (obj.schemaVersion !== 1) fail('schemaVersion must be 1.');

  var arrayFields = ['scenes', 'storylines', 'characters', 'locations', 'reveals', 'constraints', 'chronOrder', 'msOrder', 'markers', 'dividers', 'dismissed'];
  arrayFields.forEach(function (f) {
    if (!Array.isArray(obj[f])) fail('"' + f + '" must be an array.');
  });
  if (errs.length) return { ok: false, errors: errs };

  if (typeof obj.projectUid !== 'string' || !obj.projectUid) fail('projectUid must be a non-empty string.');
  if (typeof obj.name !== 'string') fail('name must be a string.');

  var isStr = function (x) { return typeof x === 'string'; };

  // scene ids unique, all strings
  var sceneIds = {};
  obj.scenes.forEach(function (s, i) {
    if (!s || !isStr(s.id)) { fail('Scene ' + i + ' missing string id.'); return; }
    if (sceneIds[s.id]) fail('Duplicate scene id: ' + s.id);
    sceneIds[s.id] = true;
    if (!isStr(s.title) || !s.title.trim()) fail('Scene ' + s.id + ' missing required title.');
    if (typeof s.summary !== 'undefined' && !isStr(s.summary)) fail('Scene ' + s.id + ' summary must be a string.');
    if (!isStr(s.storylineId)) fail('Scene ' + s.id + ' missing storylineId.');
    if (s.alsoStorylineIds && !Array.isArray(s.alsoStorylineIds)) fail('Scene ' + s.id + ' alsoStorylineIds must be an array.');
    if (s.alsoStorylineIds && s.alsoStorylineIds.indexOf(s.storylineId) !== -1) fail('Scene ' + s.id + ' alsoStorylineIds contains its own storylineId.');
    if (s.alsoStorylineIds) {
      var seenSt = {};
      s.alsoStorylineIds.forEach(function (id) {
        if (seenSt[id]) fail('Scene ' + s.id + ' has duplicate alsoStorylineIds entry: ' + id);
        seenSt[id] = true;
      });
    }
    if (s.anchor) {
      if (typeof s.anchor.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.anchor.date)) fail('Scene ' + s.id + ' has malformed anchor date.');
      if (s.anchor.time !== null && typeof s.anchor.time !== 'undefined' && !/^\d{2}:\d{2}$/.test(s.anchor.time)) fail('Scene ' + s.id + ' has malformed anchor time.');
    }
    if (s.durationMin !== null && typeof s.durationMin !== 'undefined') {
      if (!Number.isInteger(s.durationMin) || s.durationMin <= 0) fail('Scene ' + s.id + ' durationMin must be a positive integer.');
    }
  });

  var storylineIds = {};
  obj.storylines.forEach(function (st) {
    if (!st || !isStr(st.id)) { fail('Storyline missing string id.'); return; }
    if (storylineIds[st.id]) fail('Duplicate storyline id: ' + st.id);
    storylineIds[st.id] = true;
    if (!Number.isInteger(st.paletteIndex) || st.paletteIndex < 0 || st.paletteIndex > 9) fail('Storyline ' + st.id + ' paletteIndex must be an integer 0-9.');
  });

  var characterIds = {};
  obj.characters.forEach(function (c) {
    if (!c || !isStr(c.id)) { fail('Character missing string id.'); return; }
    if (characterIds[c.id]) fail('Duplicate character id: ' + c.id);
    characterIds[c.id] = true;
  });

  var locationIds = {};
  obj.locations.forEach(function (l) {
    if (!l || !isStr(l.id)) { fail('Location missing string id.'); return; }
    if (locationIds[l.id]) fail('Duplicate location id: ' + l.id);
    locationIds[l.id] = true;
  });

  var revealIds = {};
  obj.reveals.forEach(function (r) {
    if (!r || !isStr(r.id)) { fail('Reveal missing string id.'); return; }
    if (revealIds[r.id]) fail('Duplicate reveal id: ' + r.id);
    revealIds[r.id] = true;
  });

  var constraintIds = {};
  obj.constraints.forEach(function (c) {
    if (!c || !isStr(c.id)) { fail('Constraint missing string id.'); return; }
    if (constraintIds[c.id]) fail('Duplicate constraint id: ' + c.id);
    constraintIds[c.id] = true;
    if (['before', 'same-time', 'offset'].indexOf(c.type) === -1) fail('Constraint ' + c.id + ' has invalid type.');
    if (!sceneIds[c.a] || !sceneIds[c.b]) fail('Constraint ' + c.id + ' references unknown scene.');
    if (c.type === 'offset' && (!Number.isInteger(c.offsetMin) || c.offsetMin <= 0)) fail('Constraint ' + c.id + ' offsetMin must be a positive integer.');
  });

  if (errs.length) return { ok: false, errors: errs };

  // reference resolution
  obj.scenes.forEach(function (s) {
    if (!storylineIds[s.storylineId]) fail('Scene ' + s.id + ' storylineId does not resolve.');
    (s.alsoStorylineIds || []).forEach(function (id) { if (!storylineIds[id]) fail('Scene ' + s.id + ' alsoStorylineIds references unknown storyline ' + id); });
    (s.characterIds || []).forEach(function (id) { if (!characterIds[id]) fail('Scene ' + s.id + ' references unknown character ' + id); });
    if (s.locationId !== null && typeof s.locationId !== 'undefined' && !locationIds[s.locationId]) fail('Scene ' + s.id + ' references unknown location ' + s.locationId);
    (s.reveals || []).forEach(function (id) { if (!revealIds[id]) fail('Scene ' + s.id + ' references unknown reveal ' + id); });
    (s.requires || []).forEach(function (id) { if (!revealIds[id]) fail('Scene ' + s.id + ' requires unknown reveal ' + id); });
  });

  ['markers', 'dividers'].forEach(function (key) {
    obj[key].forEach(function (m) {
      if (!m || !isStr(m.id)) { fail(key + ' entry missing string id.'); return; }
      if (m.beforeSceneId !== null && !sceneIds[m.beforeSceneId]) fail(key + ' ' + m.id + ' beforeSceneId does not resolve.');
      if (!isStr(m.label)) fail(key + ' ' + m.id + ' label must be a string.');
    });
  });

  // chronOrder / msOrder invariants
  var chronSet = {};
  obj.chronOrder.forEach(function (id) {
    if (!sceneIds[id]) fail('chronOrder references unknown scene ' + id);
    if (chronSet[id]) fail('chronOrder contains duplicate ' + id);
    chronSet[id] = true;
  });
  Object.keys(sceneIds).forEach(function (id) { if (!chronSet[id]) fail('chronOrder is missing scene ' + id); });

  var msSet = {};
  obj.msOrder.forEach(function (id) {
    if (!sceneIds[id]) fail('msOrder references unknown scene ' + id);
    if (msSet[id]) fail('msOrder contains duplicate ' + id);
    msSet[id] = true;
  });
  var expectedOnscreen = {};
  obj.scenes.forEach(function (s) { if (!s.offscreen) expectedOnscreen[s.id] = true; });
  Object.keys(expectedOnscreen).forEach(function (id) { if (!msSet[id]) fail('msOrder is missing on-screen scene ' + id); });
  Object.keys(msSet).forEach(function (id) {
    var s = obj.scenes.find(function (x) { return x.id === id; });
    if (s && s.offscreen) fail('msOrder contains offscreen scene ' + id);
  });

  return { ok: errs.length === 0, errors: errs };
}

function sanitizeImportedProject(obj) {
  // Drop unknown top-level fields; keep only the known shape.
  var clean = makeEmptyProject(obj.name);
  clean.schemaVersion = 1;
  clean.projectUid = obj.projectUid;
  clean.name = obj.name;
  clean.createdAt = obj.createdAt || new Date().toISOString();
  clean.modifiedAt = obj.modifiedAt || new Date().toISOString();
  clean.revision = Number.isInteger(obj.revision) ? obj.revision : 0;
  clean.scenes = obj.scenes.map(function (s) {
    return makeScene({
      id: s.id, title: s.title, summary: s.summary || '', storylineId: s.storylineId,
      alsoStorylineIds: (s.alsoStorylineIds || []).slice(), characterIds: (s.characterIds || []).slice(),
      locationId: s.locationId || null, offscreen: !!s.offscreen,
      anchor: s.anchor ? { date: s.anchor.date, time: s.anchor.time || null } : null,
      durationMin: s.durationMin || null, reveals: (s.reveals || []).slice(), requires: (s.requires || []).slice()
    });
  });
  clean.storylines = obj.storylines.map(function (st) { return { id: st.id, name: st.name, paletteIndex: st.paletteIndex }; });
  clean.characters = obj.characters.map(function (c) { return { id: c.id, name: c.name }; });
  clean.locations = obj.locations.map(function (l) { return { id: l.id, name: l.name }; });
  clean.reveals = obj.reveals.map(function (r) { return { id: r.id, label: r.label }; });
  clean.constraints = obj.constraints.map(function (c) {
    var out = { id: c.id, type: c.type, a: c.a, b: c.b };
    if (c.type === 'offset') out.offsetMin = c.offsetMin;
    return out;
  });
  clean.chronOrder = obj.chronOrder.slice();
  clean.msOrder = obj.msOrder.slice();
  clean.markers = obj.markers.map(function (m) { return { id: m.id, label: m.label, beforeSceneId: m.beforeSceneId }; });
  clean.dividers = obj.dividers.map(function (d) { return { id: d.id, label: d.label, beforeSceneId: d.beforeSceneId }; });
  clean.dismissed = (obj.dismissed || []).slice();
  clean.viewPrefs = Object.assign(clean.viewPrefs, obj.viewPrefs || {});
  enforceInvariants(clean);
  return clean;
}
