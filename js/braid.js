// braid.js — the Braid view (§9.5): read-only structure chart.
// One <svg> inside a horizontal scroll container filling the stage. No dragging, no
// editing. Mirrors wires.js's explicit-width/height SVG sizing pattern (a bare
// position:absolute/inset:0 <svg> silently falls back to the 300x150 UA default —
// bit us once already in M3's thread overlay) and reuses the shared
// highlightScene()/clearHighlight()/selectScene() cross-view machinery rather than
// reinventing hover/selection.
'use strict';

var BRAID_NS = 'http://www.w3.org/2000/svg';

var BRAID_COL_X0 = 110;   // x of the 0th msOrder scene
var BRAID_COL_DX = 93;    // px between reading-order columns
var BRAID_ROW_Y0 = 70;    // y of the 0th chronOrder rank
var BRAID_LEFT = 60;      // left edge of gridlines/bands
var BRAID_RIGHT_PAD = 210; // room to the right of the last node for its label
var BRAID_LABEL_FLIP_ZONE = 160; // flip label to the left within this many px of the right edge
var BRAID_MIN_ROWH = 26;
var BRAID_MAX_ROWH = 52;

function _braidEl(tag, attrs) {
  var e = document.createElementNS(BRAID_NS, tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    });
  }
  return e;
}

function braidColX(i) { return BRAID_COL_X0 + i * BRAID_COL_DX; }
function braidRowY(chronIndex, rowH) { return BRAID_ROW_Y0 + chronIndex * rowH; }

function renderBraid() {
  var scroll = document.getElementById('braidScroll');
  var svg = document.getElementById('braidSvg');
  if (!scroll || !svg || !P) return;

  var msOrder = P.msOrder || [];
  var chronOrder = P.chronOrder || [];
  var N = chronOrder.length;

  svg.textContent = '';

  if (!msOrder.length || N < 1) {
    svg.setAttribute('width', scroll.clientWidth || 1);
    svg.setAttribute('height', scroll.clientHeight || 1);
    return;
  }

  var sceneById = {};
  P.scenes.forEach(function (s) { sceneById[s.id] = s; });
  var storylineById = {};
  P.storylines.forEach(function (st) { storylineById[st.id] = st; });

  var chronIndex = {};
  chronOrder.forEach(function (id, i) { chronIndex[id] = i; });

  var msIndex = {};
  msOrder.forEach(function (id, i) { msIndex[id] = i; });

  // rowH fits the stage height, clamped 26-52px (§9.5).
  var stageH = scroll.clientHeight || 400;
  var rowH = N > 1 ? (stageH - 140) / (N - 1) : BRAID_MAX_ROWH;
  rowH = Math.max(BRAID_MIN_ROWH, Math.min(BRAID_MAX_ROWH, rowH));

  var contentW = Math.max(scroll.clientWidth || 0, braidColX(msOrder.length - 1) + BRAID_RIGHT_PAD);
  var contentH = Math.max(scroll.clientHeight || 0, braidRowY(N - 1, rowH) + 60);
  var chartRight = braidColX(msOrder.length - 1) + 110;

  // CRITICAL (repeated pitfall, §16.3/prior milestones): an <svg> is a CSS "replaced
  // element" — position/CSS sizing alone does not stretch it; without explicit
  // width/height ATTRIBUTES it silently falls back to the UA's 300x150 default and
  // clips everything beyond that. Set them explicitly on every redraw, same as
  // wires.js does for #wires.
  svg.setAttribute('width', contentW);
  svg.setAttribute('height', contentH);

  // ---- gridlines: one 1px line per chronOrder rank ----
  for (var r = 0; r < N; r++) {
    var gl = _braidEl('line', {
      x1: BRAID_LEFT, x2: chartRight, y1: braidRowY(r, rowH), y2: braidRowY(r, rowH),
      'stroke-width': 1
    });
    gl.style.stroke = 'var(--line)';
    svg.appendChild(gl);
  }

  // ---- top edge: "READING ORDER ->" label + "CH n" tick per column ----
  var topLabel = _braidEl('text', { x: BRAID_LEFT, y: 20, 'font-size': 10, 'font-weight': 'bold', 'letter-spacing': '1.5px' });
  topLabel.style.fill = 'var(--faint)';
  topLabel.textContent = 'READING ORDER →';
  svg.appendChild(topLabel);

  msOrder.forEach(function (id, i) {
    var tick = _braidEl('text', { x: braidColX(i), y: 38, 'font-size': 10, 'text-anchor': 'middle' });
    tick.style.fill = 'var(--mut)';
    tick.textContent = 'CH ' + (i + 1);
    svg.appendChild(tick);
  });

  // ---- left edge: rotated "STORY TIME v" ----
  var leftY = braidRowY((N - 1) / 2, rowH);
  var leftLabel = _braidEl('text', {
    x: 18, y: leftY, 'font-size': 10, 'font-weight': 'bold', 'letter-spacing': '1.5px',
    'text-anchor': 'middle', transform: 'rotate(-90 18 ' + leftY + ')'
  });
  leftLabel.style.fill = 'var(--faint)';
  leftLabel.textContent = 'STORY TIME ↓';
  svg.appendChild(leftLabel);

  // ---- markers (§7.4), rendered as horizontal dashed lines at the y midway between
  // the ranks they separate, label at the left inside the chart ----
  var markersLayer = _braidEl('g', { class: 'braidMarkers' });
  svg.appendChild(markersLayer);
  (P.markers || []).forEach(function (m) {
    var y;
    if (!m.beforeSceneId) {
      y = braidRowY(N - 1, rowH) + rowH / 2;
    } else {
      var idx = chronIndex[m.beforeSceneId];
      if (idx === undefined) return;
      y = (idx === 0) ? braidRowY(0, rowH) - rowH / 2 : (braidRowY(idx - 1, rowH) + braidRowY(idx, rowH)) / 2;
    }
    var line = _braidEl('line', { x1: BRAID_LEFT, x2: chartRight, y1: y, y2: y, 'stroke-width': 1, 'stroke-dasharray': '5 4' });
    line.style.stroke = 'var(--faint)';
    markersLayer.appendChild(line);

    var label = _braidEl('text', { x: BRAID_LEFT + 4, y: y - 4, 'font-size': 9, 'letter-spacing': '.6px', 'font-weight': 'bold' });
    label.style.fill = 'var(--faint)';
    label.textContent = m.label;
    markersLayer.appendChild(label);
  });

  // ---- dividers (§8.2), rendered as short vertical ticks along the top edge between
  // the relevant CH columns ----
  var dividersLayer = _braidEl('g', { class: 'braidDividers' });
  svg.appendChild(dividersLayer);
  (P.dividers || []).forEach(function (d) {
    var x;
    if (!d.beforeSceneId) {
      x = braidColX(msOrder.length - 1) + BRAID_COL_DX / 2;
    } else {
      var idx = msIndex[d.beforeSceneId];
      if (idx === undefined) return; // offscreen scene (or unresolved) — dividers only apply to msOrder positions
      x = (idx === 0) ? braidColX(0) - BRAID_COL_DX / 2 : (braidColX(idx - 1) + braidColX(idx)) / 2;
    }
    var tick = _braidEl('line', { x1: x, x2: x, y1: 46, y2: 58, 'stroke-width': 2 });
    tick.style.stroke = 'var(--thread)';
    dividersLayer.appendChild(tick);
  });

  // ---- reading path (§9.5): cubic bezier per consecutive msOrder pair, drawn before nodes ----
  var pathsLayer = _braidEl('g', { class: 'braidPaths' });
  svg.appendChild(pathsLayer);
  var pathEls = [];
  for (var i = 0; i < msOrder.length - 1; i++) {
    var aId = msOrder[i], bId = msOrder[i + 1];
    var aIdx = chronIndex[aId], bIdx = chronIndex[bId];
    if (aIdx === undefined || bIdx === undefined) continue;
    var ax = braidColX(i), ay = braidRowY(aIdx, rowH);
    var bx = braidColX(i + 1), by = braidRowY(bIdx, rowH);
    var mx = (ax + bx) / 2;
    var isFlashback = bIdx < aIdx; // upward = backward in story time
    var d = 'M ' + ax + ' ' + ay + ' C ' + mx + ' ' + ay + ', ' + mx + ' ' + by + ', ' + bx + ' ' + by;
    var path = _braidEl('path', {
      d: d, fill: 'none', 'stroke-width': 2.5,
      opacity: isFlashback ? 0.9 : 0.55, 'stroke-linecap': 'round',
      'data-from': aId, 'data-to': bId, 'data-flash': isFlashback ? 'true' : 'false'
    });
    if (isFlashback) {
      // §9.5 spec: literal per-theme hex for the flashback accent (not a CSS variable) —
      // dark theme #e0a458 / light theme #b07a35.
      path.style.stroke = (getPrefs().theme === 'light') ? '#b07a35' : '#e0a458';
      path.setAttribute('stroke-dasharray', '7 5');
    } else {
      path.style.stroke = 'var(--mut)';
    }
    pathsLayer.appendChild(path);
    pathEls.push(path);
  }

  // ---- nodes + labels (§9.5) ----
  var nodesLayer = _braidEl('g', { class: 'braidNodes' });
  svg.appendChild(nodesLayer);

  var hoveredEl = document.querySelector('.scene.hi, .msCard.hi, .braidNode.hi');
  var hoveredId = hoveredEl ? hoveredEl.getAttribute('data-scene-id') : null;

  msOrder.forEach(function (id, i) {
    var s = sceneById[id];
    if (!s) return;
    var idx = chronIndex[id];
    if (idx === undefined) return;
    var x = braidColX(i), y = braidRowY(idx, rowH);
    var st = storylineById[s.storylineId];
    var color = st ? slColor(st.paletteIndex) : 'var(--faint)';

    var g = _braidEl('g', { class: 'braidNode', 'data-scene-id': id });
    if (id === _chronSelectedSceneId) g.classList.add('sel');
    if (hoveredId && id === hoveredId) g.classList.add('hi');

    var circle = _braidEl('circle', { cx: x, cy: y, r: 11, 'stroke-width': 3 });
    circle.style.fill = 'var(--panel)';
    circle.style.stroke = color;
    g.appendChild(circle);

    var num = _braidEl('text', {
      x: x, y: y, 'font-size': 10, 'font-weight': 'bold', 'text-anchor': 'middle',
      'dominant-baseline': 'central', 'pointer-events': 'none'
    });
    num.style.fill = 'var(--tx)';
    num.textContent = String(i + 1);
    g.appendChild(num);

    // Warn-dot (§7.1 rules): present but inactive in M8 — no conflict data exists yet
    // (that's M9). sceneHasWarning() is a forward-compat hook: when conflicts.js lands,
    // defining that function turns this on with no braid.js change required.
    var hasWarn = (typeof sceneHasWarning === 'function') && sceneHasWarning(id);
    if (hasWarn) {
      var warn = _braidEl('circle', { cx: x + 9, cy: y - 9, r: 4, 'stroke-width': 2, 'pointer-events': 'none' });
      warn.style.fill = 'var(--red)';
      warn.style.stroke = 'var(--panel)';
      g.appendChild(warn);
    }

    // "within 160px of the chart's right edge" (§9.5) means the rightmost node column,
    // not contentW — contentW already includes BRAID_RIGHT_PAD sized to fit an
    // un-flipped label past the last column, so comparing against it would never trigger
    // (confirmed against the mockup: its last two columns, ch11/ch12 of 12, are the ones
    // that flip).
    var lastColX = braidColX(msOrder.length - 1);
    var flip = (lastColX - x) < BRAID_LABEL_FLIP_ZONE;
    var labelX = flip ? x - 18 : x + 18;
    var anchor = flip ? 'end' : 'start';

    var title = _braidEl('text', { x: labelX, y: y - 2, 'font-size': 11, 'text-anchor': anchor, 'pointer-events': 'none' });
    title.style.fill = 'var(--tx)';
    title.textContent = s.title;
    g.appendChild(title);

    var timeLabel = _braidEl('text', { x: labelX, y: y + 11, 'font-size': 9.5, 'text-anchor': anchor, 'pointer-events': 'none' });
    timeLabel.style.fill = 'var(--mut)';
    timeLabel.textContent = fmtAnchor(s.anchor) || '—';
    g.appendChild(timeLabel);

    // Interactions (§9.5): hover = shared cross-view highlight + this node's
    // arriving/departing path segments thicken to width 4, opacity 1. Click = select
    // + open inspector (selectScene() already exists — extended in chron.js to also
    // ring-select .braidNode).
    g.style.cursor = 'pointer';
    g.addEventListener('mouseenter', function () {
      highlightScene(id, true);
      _braidThickenPaths(pathEls, id, true);
    });
    g.addEventListener('mouseleave', function () {
      highlightScene(id, false);
      _braidThickenPaths(pathEls, id, false);
    });
    g.addEventListener('click', function (e) {
      e.stopPropagation();
      selectScene(id);
    });

    nodesLayer.appendChild(g);
  });
}

function _braidThickenPaths(pathEls, sceneId, on) {
  pathEls.forEach(function (p) {
    var from = p.getAttribute('data-from'), to = p.getAttribute('data-to');
    if (from !== sceneId && to !== sceneId) return;
    if (on) {
      p.setAttribute('stroke-width', 4);
      p.setAttribute('opacity', 1);
    } else {
      var isFlash = p.getAttribute('data-flash') === 'true';
      p.setAttribute('stroke-width', 2.5);
      p.setAttribute('opacity', isFlash ? 0.9 : 0.55);
    }
  });
}

/* Empty-space click deselects, mirroring chron.js's track click handler and
   manuscript.js's row click handler. Wired once (persistent DOM node, like theirs). */
function initBraidScrollListeners() {
  var scroll = document.getElementById('braidScroll');
  if (!scroll) return;
  scroll.addEventListener('click', function (e) {
    if (e.target === scroll || e.target.id === 'braidSvg') selectScene(null);
  });
}
