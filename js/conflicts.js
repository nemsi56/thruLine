// conflicts.js — conflict engine (§12): pure computeConflicts(P), fingerprint/dismissal
// helpers (§12.6), the debounced recompute hook (§12), the Conflicts panel (§12.7), and
// flag mode (§12.7). Depends on time.js (anchorTs, fmtAnchor) already loaded first.
'use strict';

/* ==================================================================
   §12.1-12.5 — the pure conflict computation
   ================================================================== */

function computeConflicts(P) {
  if (!P) return [];
  var sceneById = {};
  P.scenes.forEach(function (s) { sceneById[s.id] = s; });
  var chronIndexMap = {};
  (P.chronOrder || []).forEach(function (id, i) { chronIndexMap[id] = i; });
  var msIndexMap = {};
  (P.msOrder || []).forEach(function (id, i) { msIndexMap[id] = i; });

  function title(id) { var s = sceneById[id]; return s ? s.title : '?'; }
  function chLabel(id) {
    var i = msIndexMap[id];
    return (i !== undefined) ? ('Ch ' + (i + 1)) : null;
  }

  function fp(type, ids, extraKey) {
    return type + ':' + ids.slice().sort().join(',') + ':' + (extraKey || '');
  }

  var byFingerprint = {};
  var fpOrder = [];
  function push(c) {
    if (byFingerprint[c.fingerprint]) return; // report each conflict once (§12.3/12.6)
    byFingerprint[c.fingerprint] = c;
    fpOrder.push(c.fingerprint);
  }

  /* ---------------- 12.1 anchor-vs-order contradictions ---------------- */
  var anchoredInChron = (P.chronOrder || []).filter(function (id) {
    var s = sceneById[id];
    return s && s.anchor && s.anchor.date;
  });
  for (var ai = 1; ai < anchoredInChron.length; ai++) {
    var aId = anchoredInChron[ai - 1], bId = anchoredInChron[ai];
    var a = sceneById[aId], b = sceneById[bId];
    var ta = anchorTs(a.anchor), tb = anchorTs(b.anchor);
    if (ta !== null && tb !== null && ta > tb) {
      var msg1 = "'" + title(bId) + "' is placed after '" + title(aId) +
        "' in the chronology, but its date (" + fmtAnchor(b.anchor) +
        ") is earlier (" + fmtAnchor(a.anchor) + ").";
      push({
        fingerprint: fp('anchor-order', [aId, bId], ''),
        type: 'anchor-order', severity: 'error',
        title: 'Anchor vs. order contradiction',
        message: msg1, sceneIds: [aId, bId]
      });
    }
  }

  /* ---------------- 12.3 constraint cycles (computed first so 12.2 can skip
     constraints that participate in a detected cycle, §12.3's "avoid double-reporting") ---------------- */
  var beforeLike = (P.constraints || []).filter(function (c) { return c.type === 'before' || c.type === 'offset'; });
  var adj = {}; // sceneId -> [{to, cid}]
  beforeLike.forEach(function (c) {
    (adj[c.a] = adj[c.a] || []).push({ to: c.b, cid: c.id });
  });

  var cycleConstraintIds = {};
  var visited = {}, inStack = {}, stack = [];
  function dfs(node) {
    visited[node] = true;
    inStack[node] = true;
    stack.push(node);
    var edges = adj[node] || [];
    for (var e = 0; e < edges.length; e++) {
      var edge = edges[e];
      if (inStack[edge.to]) {
        var idx = stack.indexOf(edge.to);
        var cyclePath = stack.slice(idx); // scene ids, in cycle order
        for (var k = 0; k < cyclePath.length; k++) {
          var from = cyclePath[k], to = cyclePath[(k + 1) % cyclePath.length];
          (adj[from] || []).forEach(function (ed) { if (ed.to === to) cycleConstraintIds[ed.cid] = true; });
        }
        var chainTitles = cyclePath.map(title);
        chainTitles.push(title(cyclePath[0]));
        var msg2 = "'" + chainTitles.join("' → '") + "' can't all be satisfied.";
        push({
          fingerprint: fp('cycle', cyclePath, ''),
          type: 'cycle', severity: 'error', title: 'Constraint cycle',
          message: msg2, sceneIds: cyclePath.slice()
        });
      } else if (!visited[edge.to]) {
        dfs(edge.to);
      }
    }
    stack.pop();
    inStack[node] = false;
  }
  Object.keys(adj).forEach(function (n) { if (!visited[n]) dfs(n); });

  /* ---------------- 12.2 constraint violations ---------------- */
  function tolerance(a, b) {
    return (!a.anchor.time || !b.anchor.time) ? (24 * 60 * 60 * 1000) : (60 * 1000);
  }
  function fmtOffsetMin(min) {
    if (min < 60) return min + ' min';
    if (min < 1440) {
      var hrs = Math.round(min / 60);
      return hrs + ' hr' + (hrs === 1 ? '' : 's');
    }
    var days = Math.round(min / 1440);
    return days + ' day' + (days === 1 ? '' : 's');
  }

  (P.constraints || []).forEach(function (c) {
    if (cycleConstraintIds[c.id]) return; // skipped: already reported as part of a cycle
    var a = sceneById[c.a], b = sceneById[c.b];
    if (!a || !b) return;
    var violated = false;
    var bothAnchored = !!(a.anchor && a.anchor.date && b.anchor && b.anchor.date);

    if (c.type === 'before' || c.type === 'offset') {
      var ia = chronIndexMap[c.a], ib = chronIndexMap[c.b];
      var chronViolated = (ia !== undefined && ib !== undefined && ia > ib);
      var anchorViolated = false;
      if (bothAnchored) {
        var ta2 = anchorTs(a.anchor), tb2 = anchorTs(b.anchor);
        if (c.type === 'before') {
          anchorViolated = ta2 > tb2;
        } else { // offset
          anchorViolated = Math.abs(tb2 - (ta2 + c.offsetMin * 60000)) > tolerance(a, b);
        }
      }
      violated = chronViolated || anchorViolated;
    } else if (c.type === 'same-time') {
      if (bothAnchored) {
        var ta3 = anchorTs(a.anchor), tb3 = anchorTs(b.anchor);
        violated = Math.abs(ta3 - tb3) > tolerance(a, b);
      }
    }

    if (!violated) return;

    var msg3;
    if (c.type === 'before') {
      msg3 = "'" + title(c.a) + "' must come before '" + title(c.b) + "' in the chronology, but it doesn't.";
    } else if (c.type === 'offset') {
      msg3 = "'" + title(c.b) + "' should be " + fmtOffsetMin(c.offsetMin) + " after '" + title(c.a) +
        "', but their placement/dates don't agree.";
    } else {
      msg3 = "'" + title(c.a) + "' and '" + title(c.b) + "' are marked as happening at the same time, but their dates don't match.";
    }
    push({
      fingerprint: fp('constraint', [c.a, c.b], c.id),
      type: 'constraint', severity: 'error', title: 'Constraint violated',
      message: msg3, sceneIds: [c.a, c.b]
    });
  });

  /* ---------------- 12.4 bilocation ---------------- */
  function sceneInterval(s) {
    var ts = anchorTs(s.anchor);
    if (ts === null) return null;
    if (!s.anchor.time) return { start: ts, end: ts + 24 * 60 * 60 * 1000 }; // whole day
    var durMs = (s.durationMin || 0) * 60000; // no duration -> instant
    return { start: ts, end: ts + durMs };
  }
  function intervalsOverlap(iv1, iv2) {
    // Half-open intervals: [start, end). A strict "<" boundary test means two
    // consecutive whole-day intervals (scene A's day ending exactly when scene B's day
    // begins) do NOT count as overlapping — verified against the sample data, where
    // "The Rusted Key" (June 13, no time) and "Dinner at the Overlook" (June 14, no
    // time) are adjacent days sharing Det. Reyes at different locations and must NOT
    // trigger bilocation. The one exception is two zero-length instants at the exact
    // same timestamp (both anchored with a time, neither with a duration) — a strict
    // test would miss that legitimate simultaneous-instant case since start===end for
    // both, so it's checked explicitly.
    if (iv1.start < iv2.end && iv2.start < iv1.end) return true;
    if (iv1.start === iv1.end && iv2.start === iv2.end && iv1.start === iv2.start) return true;
    return false;
  }
  var characterById = {};
  P.characters.forEach(function (c) { characterById[c.id] = c; });
  var locationById = {};
  P.locations.forEach(function (l) { locationById[l.id] = l; });

  var scenesArr = P.scenes;
  for (var i = 0; i < scenesArr.length; i++) {
    for (var j = i + 1; j < scenesArr.length; j++) {
      var sA = scenesArr[i], sB = scenesArr[j];
      if (!sA.anchor || !sA.anchor.date || !sB.anchor || !sB.anchor.date) continue;
      if (!sA.locationId || !sB.locationId || sA.locationId === sB.locationId) continue;
      var shared = (sA.characterIds || []).filter(function (cid) { return (sB.characterIds || []).indexOf(cid) !== -1; });
      if (!shared.length) continue;
      var ivA = sceneInterval(sA), ivB = sceneInterval(sB);
      if (!ivA || !ivB || !intervalsOverlap(ivA, ivB)) continue;

      var names = shared.map(function (cid) { return characterById[cid] ? characterById[cid].name : cid; });
      var locA = locationById[sA.locationId] ? locationById[sA.locationId].name : sA.locationId;
      var locB = locationById[sB.locationId] ? locationById[sB.locationId].name : sB.locationId;
      var dateLabel = fmtAnchor(sA.anchor.date && !sA.anchor.time ? { date: sA.anchor.date } : sA.anchor) || sA.anchor.date;
      var msg4 = names.join(', ') + ' ' + (names.length === 1 ? 'is' : 'are') + ' in both \'' + sA.title +
        "' and '" + sB.title + "' at the same time on " + dateLabel + ' — ' + locA + ' and ' + locB + '.';
      push({
        fingerprint: fp('bilocation', [sA.id, sB.id], ''),
        type: 'bilocation', severity: 'error', title: 'Character in two places at once',
        message: msg4, sceneIds: [sA.id, sB.id]
      });
    }
  }

  /* ---------------- 12.5 reveal order (walked against msOrder) ---------------- */
  var revealById = {};
  P.reveals.forEach(function (r) { revealById[r.id] = r; });
  var known = {};
  (P.msOrder || []).forEach(function (sceneId) {
    var s = sceneById[sceneId];
    if (!s) return;
    (s.requires || []).forEach(function (rvId) {
      if (known[rvId]) return;
      // find the first scene (in msOrder) that reveals rvId — since `known` accumulates
      // in msOrder walk order, any revealer not yet known must be at/after this scene.
      var revealer = null;
      for (var k = 0; k < P.msOrder.length; k++) {
        var s2 = sceneById[P.msOrder[k]];
        if (s2 && (s2.reveals || []).indexOf(rvId) !== -1) { revealer = s2; break; }
      }
      var label = revealById[rvId] ? revealById[rvId].label : rvId;
      if (revealer) {
        var msg5 = "'" + s.title + "' (" + chLabel(s.id) + ") requires '" + label +
          "' — not revealed until '" + revealer.title + "' (" + chLabel(revealer.id) + ").";
        push({
          fingerprint: fp('reveal-order', [s.id, revealer.id], rvId),
          type: 'reveal-order', severity: 'error', title: 'Reveal used before shown',
          message: msg5, sceneIds: [s.id, revealer.id]
        });
      } else {
        var msg6 = "'" + label + "' is never revealed to the reader.";
        push({
          fingerprint: fp('reveal-missing', [s.id], rvId),
          type: 'reveal-missing', severity: 'error', title: 'Reveal never shown',
          message: msg6, sceneIds: [s.id]
        });
      }
    });
    (s.reveals || []).forEach(function (rvId) { known[rvId] = true; });
  });

  return fpOrder.map(function (f) { return byFingerprint[f]; });
}

/* ==================================================================
   Cache + debounced re-run (§12: "re-run (debounced 150ms) after every commit")
   The computation itself is pure/cheap; what's debounced is the follow-up UI refresh
   (badge, warn-dots via re-render, panel) so a burst of commits (e.g. a drag that
   fires several in quick succession) doesn't thrash re-renders. saveProject() (state.js)
   calls scheduleConflictsRecompute() on every commit; editor-init.js calls
   conflictsCacheRefreshNow() once synchronously on load so the very first render (not
   a commit) isn't stuck showing an empty cache for 150ms.
   ================================================================== */

var _activeConflicts = [];
var _conflictsDebounceTimer = null;
var _flaggedFingerprint = null;

function conflictsCacheRefreshNow() {
  _activeConflicts = (typeof P !== 'undefined' && P) ? computeConflicts(P) : [];
}

function scheduleConflictsRecompute() {
  clearTimeout(_conflictsDebounceTimer);
  _conflictsDebounceTimer = setTimeout(function () {
    conflictsCacheRefreshNow();
    if (typeof renderConflictsBadge === 'function') renderConflictsBadge();
    if (P && P.viewPrefs && P.viewPrefs.panelTab === 'conflicts' && typeof renderConflictsPanel === 'function') renderConflictsPanel();
    if (typeof renderChron === 'function') renderChron();
    if (typeof renderManuscript === 'function') renderManuscript();
    if (typeof renderBraid === 'function') renderBraid();
    if (typeof redrawWires === 'function') redrawWires();
  }, 150);
}

function getActiveConflicts() {
  return _activeConflicts.filter(function (c) { return !P || P.dismissed.indexOf(c.fingerprint) === -1; });
}
function getDismissedConflicts() {
  if (!P) return [];
  return _activeConflicts.filter(function (c) { return P.dismissed.indexOf(c.fingerprint) !== -1; });
}

/* §7.1/§9.5 warn-dot rule: a scene is "warned" when it's a member of any non-dismissed
   conflict. Forward-compat hook already anticipated by braid.js (M8). */
function sceneHasWarning(sceneId) {
  var active = getActiveConflicts();
  for (var i = 0; i < active.length; i++) {
    if (active[i].sceneIds.indexOf(sceneId) !== -1) return true;
  }
  return false;
}

/* ==================================================================
   Flag mode (§12.7)
   ================================================================== */

function isFlagModeActive() {
  return !!_flaggedFingerprint;
}

function getFlaggedSceneIds() {
  if (!_flaggedFingerprint) return null;
  var c = _activeConflicts.filter(function (x) { return x.fingerprint === _flaggedFingerprint; })[0];
  return c ? c.sceneIds : null;
}

function setFlagMode(fingerprint) {
  _flaggedFingerprint = fingerprint;
  document.body.classList.add('flagging');
  document.querySelectorAll('.flag').forEach(function (el) { el.classList.remove('flag'); });
  var ids = getFlaggedSceneIds() || [];
  ids.forEach(function (id) {
    document.querySelectorAll('[data-scene-id="' + id + '"]').forEach(function (el) { el.classList.add('flag'); });
  });
  if (typeof redrawWires === 'function') redrawWires();
}

function clearFlagMode() {
  _flaggedFingerprint = null;
  document.body.classList.remove('flagging');
  document.querySelectorAll('.flag').forEach(function (el) { el.classList.remove('flag'); });
  if (typeof redrawWires === 'function') redrawWires();
}

function toggleFlagMode(fingerprint) {
  if (_flaggedFingerprint === fingerprint) clearFlagMode();
  else setFlagMode(fingerprint);
}

/* ==================================================================
   Conflicts button badge (top bar)
   ================================================================== */

function renderConflictsBadge() {
  var countEl = document.getElementById('confCount');
  if (countEl) countEl.textContent = String(getActiveConflicts().length);
}

/* ==================================================================
   Conflicts panel (§12.7) — right panel tab, built into #panelBody like inspector.js
   builds the Inspector tab's content. Only one of the two tabs owns #panelBody at a
   time (editor.js's refreshAll() routes on P.viewPrefs.panelTab).
   ================================================================== */

function renderConflictsPanel() {
  var body = document.getElementById('panelBody');
  if (!body || !P) return;
  body.textContent = '';

  var active = getActiveConflicts();
  var dismissed = getDismissedConflicts();

  if (!active.length && !dismissed.length) {
    var empty = document.createElement('div');
    empty.className = 'panelEmpty';
    empty.textContent = 'No conflicts found.';
    body.appendChild(empty);
    return;
  }

  var list = document.createElement('div');
  list.className = 'conflictList';

  active.forEach(function (c) { list.appendChild(_buildConflictRow(c, false)); });

  if (dismissed.length) {
    var hdr = document.createElement('div');
    hdr.className = 'conflictGroupHeader';
    hdr.textContent = 'Dismissed';
    list.appendChild(hdr);
    dismissed.forEach(function (c) { list.appendChild(_buildConflictRow(c, true)); });
  }

  body.appendChild(list);
}

function _buildConflictRow(c, isDismissed) {
  var row = document.createElement('div');
  row.className = 'conflictRow' + (isDismissed ? ' dismissed' : '');
  row.dataset.fingerprint = c.fingerprint;
  if (!isDismissed && c.fingerprint === _flaggedFingerprint) row.classList.add('flagActive');

  var head = document.createElement('div');
  head.className = 'conflictHead';
  var dot = document.createElement('span');
  dot.className = 'conflictDot';
  head.appendChild(dot);
  var titleEl = document.createElement('span');
  titleEl.className = 'conflictTitle';
  titleEl.textContent = c.title;
  head.appendChild(titleEl);
  row.appendChild(head);

  var msgEl = document.createElement('div');
  msgEl.className = 'conflictMsg';
  msgEl.textContent = c.message;
  row.appendChild(msgEl);

  var actions = document.createElement('div');
  actions.className = 'conflictActions';

  if (isDismissed) {
    var restoreBtn = document.createElement('button');
    restoreBtn.className = 'linkBtn';
    restoreBtn.textContent = 'restore warning';
    restoreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      commit('Restore warning', function (proj) {
        proj.dismissed = proj.dismissed.filter(function (fp) { return fp !== c.fingerprint; });
      });
    });
    actions.appendChild(restoreBtn);
  } else {
    var showBtn = document.createElement('button');
    showBtn.className = 'linkBtn';
    showBtn.textContent = 'show scenes';
    showBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleFlagMode(c.fingerprint);
      if (typeof renderConflictsPanel === 'function') renderConflictsPanel();
    });
    actions.appendChild(showBtn);

    var dismissBtn = document.createElement('button');
    dismissBtn.className = 'linkBtn';
    dismissBtn.textContent = 'mark intentional';
    dismissBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_flaggedFingerprint === c.fingerprint) clearFlagMode();
      commit('Mark conflict intentional', function (proj) {
        if (proj.dismissed.indexOf(c.fingerprint) === -1) proj.dismissed.push(c.fingerprint);
      });
    });
    actions.appendChild(dismissBtn);
  }
  row.appendChild(actions);

  // Clicking the row body (not the action links) also toggles flag mode (§12.7:
  // "Clicking a conflict toggles flag mode"), for active conflicts only.
  if (!isDismissed) {
    row.addEventListener('click', function () {
      toggleFlagMode(c.fingerprint);
      if (typeof renderConflictsPanel === 'function') renderConflictsPanel();
    });
  }

  return row;
}
