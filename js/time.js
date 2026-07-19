// time.js — time parsing/formatting, chronological position computation
'use strict';

/* ---------------- chronX (§6) ----------------
   Returns Map<sceneId, x> with x in 0-100 (percent across the track width).
   Layout code adds its own left/right padding. */

function chronX(project, axisMode) {
  if (axisMode === 'true') {
    return chronXTrueScale(project);
  }
  return chronXOrdinal(project);
}

/* §6.1 Ordinal mode: scenes evenly spaced in chronOrder order. */
function chronXOrdinal(project) {
  var map = new Map();
  var order = project.chronOrder || [];
  var n = order.length;
  order.forEach(function (id, i) {
    map.set(id, ((i + 0.5) / n) * 100);
  });
  return map;
}

/* Parse an anchor {date, time} to an epoch-ms timestamp; date at 00:00 if no time. */
function anchorTs(anchor) {
  if (!anchor || !anchor.date) return null;
  var t = anchor.time || '00:00';
  var ms = Date.parse(anchor.date + 'T' + t + ':00');
  return isNaN(ms) ? null : ms;
}

/* §6.2 True-scale mode.
   1. Parse each anchored scene to a timestamp (chronOrder sequence).
   2. If fewer than 2 anchored scenes, unavailable — callers fall back to ordinal
      spacing (the toggle itself is grayed out by editor.js/chron.js UI code).
   3. Map timestamps linearly to x = 4 + (t - tMin)/(tMax - tMin) * 92.
   4. Unanchored scenes between two anchored neighbors are spaced evenly between
      those neighbors' x values; before-first/after-last extend outward in steps of 3
      (clamped to [0,100]).
   5. Anchored scenes out of order vs. chronOrder still render — position is purely by
      timestamp; conflict detection for this case lives separately in conflicts.js (§12.1).
   6. Collision pass per lane: sort by x, sweep left->right enforcing a minimum gap. */
function chronXTrueScale(project) {
  var order = project.chronOrder || [];
  var sceneById = {};
  (project.scenes || []).forEach(function (s) { sceneById[s.id] = s; });

  // Step 1: anchored scenes in chronOrder sequence.
  var anchored = [];
  order.forEach(function (id, idx) {
    var s = sceneById[id];
    if (!s) return;
    var ts = anchorTs(s.anchor);
    if (ts !== null) anchored.push({ id: id, ts: ts, chronIdx: idx });
  });

  // Step 2: fewer than 2 anchors -> true-scale unavailable, fall back to ordinal.
  if (anchored.length < 2) return chronXOrdinal(project);

  // Step 5: sort by timestamp for positioning (out-of-order anchors don't crash/misrender).
  var byTs = anchored.slice().sort(function (a, b) { return a.ts - b.ts; });
  var tMin = byTs[0].ts, tMax = byTs[byTs.length - 1].ts;

  var map = new Map();
  var anchoredSet = {};
  if (tMax === tMin) {
    // All anchors at the same instant: put them all at the midpoint.
    byTs.forEach(function (a) { map.set(a.id, 50); anchoredSet[a.id] = true; });
  } else {
    byTs.forEach(function (a) {
      var x = 4 + ((a.ts - tMin) / (tMax - tMin)) * 92;
      map.set(a.id, x);
      anchoredSet[a.id] = true;
    });
  }

  // Step 4: unanchored scenes, walked in chronOrder, spaced between anchored neighbors
  // (by chronOrder position, i.e. the anchored scenes immediately before/after them in
  // chronOrder — not by timestamp, since §6.2 step 4 refers to "chronOrder neighbors").
  var n = order.length;
  var anchoredIdxList = []; // indices into `order` that are anchored, in chronOrder sequence
  order.forEach(function (id, idx) { if (anchoredSet[id]) anchoredIdxList.push(idx); });

  var i = 0;
  while (i < n) {
    var id = order[i];
    if (anchoredSet[id]) { i++; continue; }
    // find the run of consecutive unanchored scenes starting at i
    var runStart = i, runEnd = i;
    while (runEnd < n && !anchoredSet[order[runEnd]]) runEnd++;
    // runEnd is now the first anchored index after the run (or n)
    var prevAnchoredIdx = -1;
    for (var k = anchoredIdxList.length - 1; k >= 0; k--) {
      if (anchoredIdxList[k] < runStart) { prevAnchoredIdx = anchoredIdxList[k]; break; }
    }
    var nextAnchoredIdx = -1;
    for (var m = 0; m < anchoredIdxList.length; m++) {
      if (anchoredIdxList[m] >= runEnd) { nextAnchoredIdx = anchoredIdxList[m]; break; }
    }
    var runLen = runEnd - runStart; // count of unanchored scenes in this run
    if (prevAnchoredIdx !== -1 && nextAnchoredIdx !== -1) {
      // spaced evenly between the two neighbors' x values
      var xPrev = map.get(order[prevAnchoredIdx]);
      var xNext = map.get(order[nextAnchoredIdx]);
      for (var j = 0; j < runLen; j++) {
        var frac = (j + 1) / (runLen + 1);
        map.set(order[runStart + j], xPrev + (xNext - xPrev) * frac);
      }
    } else if (prevAnchoredIdx === -1 && nextAnchoredIdx !== -1) {
      // before the first anchored scene: extend outward in steps of 3, clamped
      var xNext2 = map.get(order[nextAnchoredIdx]);
      for (var j2 = 0; j2 < runLen; j2++) {
        var stepsBack = runLen - j2;
        map.set(order[runStart + j2], Math.max(0, xNext2 - stepsBack * 3));
      }
    } else if (nextAnchoredIdx === -1 && prevAnchoredIdx !== -1) {
      // after the last anchored scene: extend outward in steps of 3, clamped
      var xPrev2 = map.get(order[prevAnchoredIdx]);
      for (var j3 = 0; j3 < runLen; j3++) {
        map.set(order[runStart + j3], Math.min(100, xPrev2 + (j3 + 1) * 3));
      }
    } else {
      // no anchored scenes at all (shouldn't happen, guarded above) — even spacing
      for (var j4 = 0; j4 < runLen; j4++) {
        map.set(order[runStart + j4], ((runStart + j4 + 0.5) / n) * 100);
      }
    }
    i = runEnd;
  }

  // Step 6: collision pass, per lane — sort that lane's scenes by x, sweep left->right
  // enforcing a minimum gap of cardWidthPx / trackWidthPx * 100 percent.
  var laneOf = {};
  order.forEach(function (id) {
    var s = sceneById[id];
    if (s) laneOf[id] = s.storylineId;
  });
  var byLane = {};
  order.forEach(function (id) {
    var lane = laneOf[id];
    if (lane === undefined) return;
    (byLane[lane] = byLane[lane] || []).push(id);
  });

  var trackEl = document.getElementById('track');
  var trackWidthPx = (trackEl && trackEl.clientWidth) || 800;
  var fullChron = project.viewPrefs && project.viewPrefs.mode === 'chron';
  var cardWidthPx = fullChron ? 140 : 96;
  var minGapPct = (cardWidthPx / Math.max(1, trackWidthPx)) * 100;

  Object.keys(byLane).forEach(function (lane) {
    var ids = byLane[lane].slice().sort(function (a, b) { return map.get(a) - map.get(b); });
    for (var q = 1; q < ids.length; q++) {
      var prevX = map.get(ids[q - 1]);
      var curX = map.get(ids[q]);
      if (curX - prevX < minGapPct) {
        map.set(ids[q], prevX + minGapPct);
      }
    }
  });

  return map;
}

/* §7.2: given the sorted-by-timestamp anchored list, find the single largest gap
   between consecutive anchored scenes if it exceeds 5x the median gap. Returns
   {x, ms, fromId, toId} or null. Purely cosmetic — positions stay linear (uses the
   already-computed xMap for placement, ms for the fmtGap() label). */
function chronTrueScaleGapDivider(project, xMap) {
  var order = project.chronOrder || [];
  var sceneById = {};
  (project.scenes || []).forEach(function (s) { sceneById[s.id] = s; });

  var anchored = [];
  order.forEach(function (id) {
    var s = sceneById[id];
    if (!s) return;
    var ts = anchorTs(s.anchor);
    if (ts !== null) anchored.push({ id: id, ts: ts });
  });
  if (anchored.length < 2) return null;

  var byTs = anchored.slice().sort(function (a, b) { return a.ts - b.ts; });
  var gaps = [];
  for (var i = 1; i < byTs.length; i++) {
    gaps.push({ ms: byTs[i].ts - byTs[i - 1].ts, from: byTs[i - 1], to: byTs[i] });
  }
  if (!gaps.length) return null;

  var sortedMs = gaps.map(function (g) { return g.ms; }).sort(function (a, b) { return a - b; });
  var mid = Math.floor(sortedMs.length / 2);
  var median = sortedMs.length % 2 ? sortedMs[mid] : (sortedMs[mid - 1] + sortedMs[mid]) / 2;

  var largest = gaps.reduce(function (best, g) { return (!best || g.ms > best.ms) ? g : best; }, null);
  if (!largest || median <= 0 || largest.ms <= median * 5) return null;

  var xFrom = xMap.get(largest.from.id);
  var xTo = xMap.get(largest.to.id);
  if (xFrom === undefined || xTo === undefined) return null;

  return { x: (xFrom + xTo) / 2, ms: largest.ms, fromId: largest.from.id, toId: largest.to.id };
}

/* ---------------- formatting helpers (§6) ---------------- */

var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* fmtAnchor(anchor) -> "Oct 12, 1998" / "Oct 12, 1998 · 21:30" */
function fmtAnchor(anchor) {
  if (!anchor || !anchor.date) return null;
  var parts = anchor.date.split('-');
  var y = parts[0], m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
  var name = MONTH_NAMES[m] || '';
  var out = name + ' ' + d + ', ' + y;
  if (anchor.time) out += ' · ' + anchor.time;
  return out;
}

/* fmtGap(ms) -> "3 days", "≈ 10 yrs" — used by true-scale gap dividers (M7). Stub for now. */
function fmtGap(ms) {
  var day = 24 * 60 * 60 * 1000;
  var year = 365.25 * day;
  if (ms >= year) {
    var yrs = Math.round(ms / year);
    return '≈ ' + yrs + ' yr' + (yrs === 1 ? '' : 's');
  }
  var days = Math.round(ms / day);
  return days + ' day' + (days === 1 ? '' : 's');
}
