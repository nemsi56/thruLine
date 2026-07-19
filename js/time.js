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

/* §6.2 True-scale mode — implemented in M7. Stub keeps the chronX(project, axisMode)
   signature stable so M7 can fill this in without touching any callers. */
function chronXTrueScale(project) {
  // M7: parse anchors, map linearly, space unanchored scenes, run the per-lane
  // collision pass. Until then, fall back to ordinal spacing so callers never break.
  return chronXOrdinal(project);
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
