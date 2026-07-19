// chron.js — chronology view rendering (M3: ordinal lanes/cards/markers/selection/hover)
// M5 adds drag (reorder + re-lane); true-scale gap compression (M7) is not implemented here.
'use strict';

var _chronSelectedSceneId = null;
var _chronMarkerPopoverId = null;

/* ---------------- drag (§7.5) ----------------
   _chronDrag is null when no drag is in progress. It goes through two phases:
   "candidate" (mousedown happened, active:false) while under the 4px threshold, then
   "active" (ghost/insertion-line visible) once the threshold is crossed. Global
   mousemove/mouseup listeners are wired ONCE in initChronTrackListeners() (called once
   from editor-init.js) rather than per-card, mirroring editor.js's divider-drag pattern
   including its e.buttons===0 self-heal check. */
var _chronDrag = null;
var _chronDragOccurred = false; // set true after an active drag ends, so the card's
                                 // subsequent click event (which always fires after
                                 // mouseup) doesn't also select the scene.
var _chronTrueScaleToastShown = false;

/* §7.6: track width = max(scroll-container width, N * pxPerScene + padding).
   trackEl is #track; its scroll container is the parent (#chronScroll). pxPerScene
   defaults to 110 and is adjustable via the zoom slider (viewPrefs.pxPerScene, 70-200).
   When content fits the container, this returns the container's own width (no
   scrollbar) and the slider still visibly spreads/tightens spacing since collision-pass
   minGap in time.js is computed against this same width. */
function chronTrackWidth(trackEl) {
  var scrollEl = trackEl.parentElement;
  var containerW = (scrollEl && scrollEl.clientWidth) || trackEl.clientWidth || 0;
  var n = (P && P.chronOrder && P.chronOrder.length) || 0;
  var pxPerScene = (P && P.viewPrefs && P.viewPrefs.pxPerScene) || 110;
  var PADDING = 80; // room for card half-widths at the track's own edges
  var needed = n * pxPerScene + PADDING;
  return Math.max(containerW, needed);
}

/* Wired once (not per-render) since #track is a persistent DOM node reused across
   renderChron() calls — attaching inside renderChron would stack duplicate listeners. */
function initChronTrackListeners() {
  var track = document.getElementById('track');
  if (!track) return;
  track.addEventListener('click', function (e) {
    if (_chronDragOccurred) { _chronDragOccurred = false; return; } // drag dropped on empty track space
    if (e.target === track) selectScene(null);
  });
  track.addEventListener('contextmenu', chronTrackContextMenu);

  // Global drag listeners — wired once here, not per-card/per-render (§7.5).
  window.addEventListener('mousemove', function (e) {
    if (!_chronDrag) return;
    // Self-heal (§7.5, §16.4): mirrors editor.js's divider-drag e.buttons===0 check,
    // at the top of the handler, before anything else runs.
    if (e.buttons === 0) { _chronDragCancel(); return; }
    if (!_chronDrag.active) {
      var dx = e.clientX - _chronDrag.startX, dy = e.clientY - _chronDrag.startY;
      if (Math.hypot(dx, dy) < 4) return; // still under the click/drag threshold
      _chronDragBegin(e);
    }
    _chronDragMove(e);
  });
  window.addEventListener('mouseup', function () {
    if (!_chronDrag) return;
    if (!_chronDrag.active) { _chronDrag = null; return; } // never crossed threshold: plain click
    _chronDragFinish();
  });
}

/* isChronDragActive()/cancelChronDrag() are called from editor-init.js's Escape
   handler, at the HIGHEST priority per §10.3 ("cancel drag -> close popover/modal ->
   clear selection") — checked before the marker-popover / divider-popover branches
   that already exist there. */
function isChronDragActive() {
  return !!(_chronDrag && _chronDrag.active);
}

function cancelChronDrag() {
  if (_chronDrag) _chronDragCancel();
}

function _chronDragBegin(e) {
  var d = _chronDrag;
  d.active = true;
  setDragActive(true); // §5.3: undo must not fire mid-drag

  var track = document.getElementById('track');
  var srcEl = track.querySelector('.scene[data-scene-id="' + d.sceneId + '"]');
  if (srcEl) srcEl.classList.add('dragSource');

  var scene = P.scenes.find(function (x) { return x.id === d.sceneId; });
  if (!scene) { _chronDragCancel(); return; }

  var fullChron = P.viewPrefs.mode === 'chron';
  var cardW = fullChron ? 140 : 96;
  var storylineById = {};
  P.storylines.forEach(function (st) { storylineById[st.id] = st; });
  var st = storylineById[scene.storylineId];

  var ghost = document.createElement('div');
  ghost.className = 'scene chronGhost';
  ghost.style.width = cardW + 'px';
  ghost.style.setProperty('--c', st ? slColor(st.paletteIndex) : 'var(--faint)');
  var t = document.createElement('div');
  t.className = 't';
  t.textContent = scene.title;
  ghost.appendChild(t);
  track.appendChild(ghost);
  d.ghostEl = ghost;

  var line = document.createElement('div');
  line.className = 'chronInsertLine';
  line.style.display = 'none';
  track.appendChild(line);
  d.insertLineEl = line;

  // Horizontal reorder is ordinal-mode only (§7.5) — true-scale still allows the
  // vertical lane move, but shows a one-time toast and a plain cursor.
  if (P.viewPrefs.axis === 'true') {
    document.body.style.cursor = 'default';
    _chronShowTrueScaleToast();
  }
}

function _chronShowTrueScaleToast() {
  if (_chronTrueScaleToastShown) return;
  _chronTrueScaleToastShown = true;
  var t = document.createElement('div');
  t.className = 'dragToast';
  t.textContent = 'Switch to Ordinal to reorder by drag';
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2200);
}

/* Find the scene nearest to the right of the cursor ACROSS ALL LANES by x (§7.5) —
   the drop slot is a position in chronOrder, not per-lane. Reads actual card rects
   (not the xMap) so it works correctly regardless of the known ordinal-overlap issue
   (§6.1) — overlapping cards still have real, distinct DOM positions. */
function _chronFindDropBeforeId(localX, excludeId) {
  var track = document.getElementById('track');
  var trackRect = track.getBoundingClientRect();
  // .chronGhost also carries the base 'scene' class (for matching card styling), so it
  // must be excluded here explicitly — otherwise it's picked up as a "card" candidate,
  // and since it tracks the cursor exactly it's almost always the nearest match, with
  // no dataset.sceneId of its own, silently corrupting every drop into a no-op.
  var cards = Array.prototype.slice.call(track.querySelectorAll('.scene:not(.chronGhost)'));
  var best = null, bestX = Infinity;
  cards.forEach(function (el) {
    var id = el.dataset.sceneId;
    if (!id || id === excludeId) return;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2 - trackRect.left;
    if (cx >= localX && cx < bestX) { bestX = cx; best = id; }
  });
  return best; // null = insert at the end of chronOrder
}

function _chronInsertionX(track, trackRect, beforeId, excludeId) {
  if (beforeId) {
    var el = track.querySelector('.scene[data-scene-id="' + beforeId + '"]');
    if (el) { var r = el.getBoundingClientRect(); return r.left - trackRect.left - 4; }
  }
  var cards = Array.prototype.slice.call(track.querySelectorAll('.scene'));
  var maxRight = 0;
  cards.forEach(function (el) {
    if (el.dataset.sceneId === excludeId) return;
    var r = el.getBoundingClientRect();
    var rx = r.right - trackRect.left;
    if (rx > maxRight) maxRight = rx;
  });
  return maxRight + 4;
}

function _chronLaneAtClientY(clientY) {
  var rows = Array.prototype.slice.call(document.querySelectorAll('.laneRow'));
  if (!rows.length) return null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i].getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) return rows[i].dataset.storylineId;
  }
  var firstR = rows[0].getBoundingClientRect();
  if (clientY < firstR.top) return rows[0].dataset.storylineId;
  return rows[rows.length - 1].dataset.storylineId;
}

function _chronDragMove(e) {
  var d = _chronDrag;
  var track = document.getElementById('track');
  var trackRect = track.getBoundingClientRect();
  var localX = e.clientX - trackRect.left;
  var localY = e.clientY - trackRect.top;

  d.ghostEl.style.left = localX + 'px';
  d.ghostEl.style.top = localY + 'px';

  if (P.viewPrefs.axis !== 'true') {
    var beforeId = _chronFindDropBeforeId(localX, d.sceneId);
    d.targetBeforeId = beforeId;
    d.insertLineEl.style.left = _chronInsertionX(track, trackRect, beforeId, d.sceneId) + 'px';
    d.insertLineEl.style.display = '';
  } else {
    d.targetBeforeId = undefined; // not computed: true-scale reorder is disabled
    d.insertLineEl.style.display = 'none';
  }

  var laneStId = _chronLaneAtClientY(e.clientY);
  d.targetStorylineId = laneStId;
  document.querySelectorAll('.laneRow').forEach(function (row) {
    row.classList.toggle('dropTarget', row.dataset.storylineId === laneStId);
  });
}

function _chronDragCleanupVisual() {
  if (_chronDrag) {
    if (_chronDrag.ghostEl) _chronDrag.ghostEl.remove();
    if (_chronDrag.insertLineEl) _chronDrag.insertLineEl.remove();
    var srcEl = document.querySelector('.scene[data-scene-id="' + _chronDrag.sceneId + '"]');
    if (srcEl) srcEl.classList.remove('dragSource');
  }
  document.querySelectorAll('.laneRow.dropTarget').forEach(function (r) { r.classList.remove('dropTarget'); });
  document.body.style.cursor = '';
}

function _chronDragCancel() {
  _chronDragCleanupVisual();
  setDragActive(false);
  _chronDrag = null;
}

function _chronDragFinish() {
  var d = _chronDrag;
  _chronDragCleanupVisual();
  setDragActive(false);
  _chronDrag = null;
  _chronDragOccurred = true; // suppress the click that follows this mouseup

  var scene = P.scenes.find(function (x) { return x.id === d.sceneId; });
  if (!scene) return;

  var newChronOrder = null;
  if (P.viewPrefs.axis !== 'true' && d.targetBeforeId !== undefined) {
    var without = P.chronOrder.filter(function (id) { return id !== d.sceneId; });
    var idx = d.targetBeforeId ? without.indexOf(d.targetBeforeId) : -1;
    if (idx === -1) idx = without.length;
    var candidate = without.slice();
    candidate.splice(idx, 0, d.sceneId);
    var same = candidate.length === P.chronOrder.length &&
      candidate.every(function (id, i) { return id === P.chronOrder[i]; });
    if (!same) newChronOrder = candidate;
  }

  var relane = !!(d.targetStorylineId && d.targetStorylineId !== scene.storylineId);

  if (!newChronOrder && !relane) return; // no-op drag: nothing moved, no commit

  var label = newChronOrder ? 'Move scene (time)' : 'Move scene (lane)';

  // commit() -> saveProject() -> refreshAll() already re-renders chron/manuscript and
  // calls redrawWires() last (see editor.js) — no separate redraw call needed here.
  commit(label, function (proj) {
    if (newChronOrder) proj.chronOrder = newChronOrder;
    if (relane) {
      var s = proj.scenes.find(function (x) { return x.id === d.sceneId; });
      if (s) s.storylineId = d.targetStorylineId;
    }
  });
}

function renderChron() {
  var laneLabels = document.getElementById('laneLabels');
  var track = document.getElementById('track');
  if (!laneLabels || !track || !P) return;

  laneLabels.textContent = '';
  track.textContent = '';

  var scenesByStoryline = {};
  P.storylines.forEach(function (st) { scenesByStoryline[st.id] = []; });
  P.chronOrder.forEach(function (id) {
    var s = P.scenes.find(function (x) { return x.id === id; });
    if (s && scenesByStoryline[s.storylineId]) scenesByStoryline[s.storylineId].push(s);
  });

  var laneCount = P.storylines.length || 1;
  var fullChron = P.viewPrefs.mode === 'chron';
  var laneH = fullChron ? 96 : 78;
  var cardW = fullChron ? 140 : 96;

  track.style.height = (laneCount * laneH) + 'px';
  // §7.6: size the track (in px) BEFORE computing xMap, since the true-scale collision
  // pass (time.js) reads #track's clientWidth to compute the minimum on-screen gap.
  track.style.width = chronTrackWidth(track) + 'px';

  // lane labels + lane rows
  P.storylines.forEach(function (st, i) {
    var count = scenesByStoryline[st.id].length;
    var label = document.createElement('div');
    label.className = 'laneLabel';
    label.style.height = laneH + 'px';
    var sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = slColor(st.paletteIndex);
    label.appendChild(sw);
    var nameEl = document.createElement('span');
    nameEl.className = 'laneName';
    nameEl.textContent = st.name;
    label.appendChild(nameEl);
    var countEl = document.createElement('i');
    countEl.textContent = count + (count === 1 ? ' scene' : ' scenes');
    label.appendChild(countEl);
    laneLabels.appendChild(label);

    var row = document.createElement('div');
    row.className = 'laneRow';
    row.style.top = (i * laneH) + 'px';
    row.style.height = laneH + 'px';
    row.dataset.storylineId = st.id;
    track.appendChild(row);
  });

  // thread overlay svg (below cards, above lane rows)
  var threadSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  threadSvg.setAttribute('id', 'chronThreadSvg');
  threadSvg.style.position = 'absolute';
  threadSvg.style.inset = '0';
  // SVG is a "replaced element" per CSS — inset:0 alone anchors top/left but does NOT
  // stretch it to fill an absolutely-positioned container the way it would a normal
  // block; without an intrinsic size it falls back to the UA default 300x150 and
  // silently clips anything beyond that. Must set width/height explicitly (both via
  // CSS for layout and as attributes below so the SVG's own coordinate system matches).
  threadSvg.style.width = '100%';
  threadSvg.style.height = '100%';
  // Explicit width/height ATTRIBUTES (not just CSS) so the SVG's own coordinate system
  // is never left to the UA's 300x150 replaced-element default — this matters more now
  // that #track's pixel size changes with the zoom slider (§7.6) instead of being fixed.
  threadSvg.setAttribute('width', chronTrackWidth(track));
  threadSvg.setAttribute('height', laneCount * laneH);
  threadSvg.style.zIndex = '1';
  threadSvg.style.pointerEvents = 'none';
  track.appendChild(threadSvg);

  // markers layer
  var markersLayer = document.createElement('div');
  markersLayer.className = 'markersLayer';
  markersLayer.style.position = 'absolute';
  markersLayer.style.inset = '0';
  markersLayer.style.zIndex = '1';
  markersLayer.style.pointerEvents = 'none';
  track.appendChild(markersLayer);

  var xMap = chronX(P, P.viewPrefs.axis);
  var laneIndex = {};
  P.storylines.forEach(function (st, i) { laneIndex[st.id] = i; });

  var msIndex = {};
  P.msOrder.forEach(function (id, i) { msIndex[id] = i; });

  var storylineById = {};
  P.storylines.forEach(function (st) { storylineById[st.id] = st; });

  // cards
  P.scenes.forEach(function (s) {
    var x = xMap.get(s.id);
    if (x === undefined) return;
    var lane = laneIndex[s.storylineId];
    if (lane === undefined) return;

    var card = document.createElement('div');
    card.className = 'scene';
    card.dataset.sceneId = s.id;
    card.style.width = cardW + 'px';
    card.style.left = x + '%';
    card.style.top = (lane * laneH + laneH / 2) + 'px';
    card.style.setProperty('--c', slColor(storylineById[s.storylineId].paletteIndex));
    if (s.offscreen) card.classList.add('offscreen');
    if (s.id === _chronSelectedSceneId) card.classList.add('sel');

    var warnDot = document.createElement('div');
    warnDot.className = 'warnDot';
    card.appendChild(warnDot);

    var title = document.createElement('div');
    title.className = 't';
    title.textContent = s.title;
    card.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'm';
    var timeSpan = document.createElement('span');
    timeSpan.textContent = fmtAnchor(s.anchor) || '—';
    var chSpan = document.createElement('span');
    chSpan.className = 'ch';
    if (s.offscreen) {
      chSpan.textContent = 'off';
    } else {
      var msIdx = msIndex[s.id];
      chSpan.textContent = (msIdx !== undefined) ? ('Ch ' + (msIdx + 1)) : '—';
    }
    meta.appendChild(timeSpan);
    meta.appendChild(chSpan);
    card.appendChild(meta);

    // convergence dots (shared helper, also used by manuscript.js)
    var convDots = renderConvDots(s, storylineById);
    if (convDots) card.appendChild(convDots);

    card.addEventListener('mouseenter', function () { highlightScene(s.id, true); });
    card.addEventListener('mouseleave', function () { highlightScene(s.id, false); });
    card.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_chronDragOccurred) { _chronDragOccurred = false; return; } // a drag just ended here
      selectScene(s.id);
    });
    card.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      _chronDrag = {
        sceneId: s.id, active: false, startX: e.clientX, startY: e.clientY,
        ghostEl: null, insertLineEl: null, targetBeforeId: undefined, targetStorylineId: null
      };
    });

    track.appendChild(card);
  });

  renderChronMarkers(markersLayer, xMap);
  renderChronThread(threadSvg);
  renderChronGapDivider(markersLayer, xMap);

  // zoom slider (§7.6) — keep it in sync with viewPrefs.pxPerScene on every render.
  var zoomEl = document.getElementById('chronZoom');
  if (zoomEl && document.activeElement !== zoomEl) {
    zoomEl.value = (P.viewPrefs && P.viewPrefs.pxPerScene) || 110;
  }

  // axis toggle availability (§6.2 step 2) — gray out True scale with a tooltip when
  // fewer than 2 scenes are anchored to dates.
  updateAxisAvailability();
}

/* §6.2 step 2: "Anchor at least two scenes to dates to enable true scale." */
function updateAxisAvailability() {
  var btn = document.querySelector('#axisSwitcher button[data-axis="true"]');
  if (!btn || !P) return;
  var anchoredCount = P.scenes.filter(function (s) { return s.anchor && s.anchor.date; }).length;
  var available = anchoredCount >= 2;
  btn.disabled = !available;
  btn.title = available ? '' : 'Anchor at least two scenes to dates to enable true scale.';
  if (!available && P.viewPrefs.axis === 'true') {
    // True scale was selected but is no longer available (e.g. anchors cleared) —
    // fall back to ordinal so callers never render against an unavailable axis.
    P.viewPrefs.axis = 'ordinal';
    document.querySelectorAll('#axisSwitcher button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.axis === 'ordinal');
    });
  }
}

/* §7.2: in true-scale mode, if the largest gap between consecutive anchored scenes
   exceeds 5x the median gap, render a vertical dashed divider with an fmtGap() label. */
function renderChronGapDivider(layer, xMap) {
  var existing = layer.querySelector('.gapDivider');
  if (existing) existing.remove();
  if (P.viewPrefs.axis !== 'true') return;
  if (typeof chronTrueScaleGapDivider !== 'function') return;
  var gap = chronTrueScaleGapDivider(P, xMap);
  if (!gap) return;

  var el = document.createElement('div');
  el.className = 'gapDivider';
  el.style.left = gap.x + '%';
  var label = document.createElement('div');
  label.className = 'gapLabel';
  label.textContent = fmtGap(gap.ms);
  el.appendChild(label);
  layer.appendChild(el);
}

/* ---------------- hover (§10.1) ----------------
   highlightScene()/clearHighlight() live in wires.js (the shared cross-view hover+wire
   mechanism per §10.1) since redrawing the wire on hover is the whole point of moving
   it out of this file — chron.js and manuscript.js both call highlightScene() directly. */

/* ---------------- selection (§10.2) ----------------
   renderInspectorSelection(sceneId) is defined in inspector.js (M6): the scene-editing
   form when a scene is selected, or the project-level lists when sceneId is null. */

function selectScene(sceneId, opts) {
  _chronSelectedSceneId = sceneId;
  document.querySelectorAll('.scene, .msCard, .braidNode').forEach(function (el) {
    el.classList.toggle('sel', el.getAttribute('data-scene-id') === sceneId);
  });
  if (typeof renderInspectorSelection === 'function') renderInspectorSelection(sceneId, opts);
  if (sceneId && typeof scrollCounterpartIntoView === 'function') scrollCounterpartIntoView(sceneId);
}

/* Escape / empty-space deselect wiring lives in editor-init.js which calls selectScene(null). */

/* ---------------- markers (§7.4) ---------------- */

function chronMarkerX(marker, xMap) {
  var order = P.chronOrder;
  if (!marker.beforeSceneId) {
    // end marker
    var lastId = order[order.length - 1];
    var lx = xMap.get(lastId);
    return lx === undefined ? 100 : Math.min(100, lx + (100 - lx) / 2 + 5);
  }
  var idx = order.indexOf(marker.beforeSceneId);
  if (idx === -1) return 0;
  var afterX = xMap.get(marker.beforeSceneId);
  if (idx === 0) {
    return afterX === undefined ? 0 : Math.max(0, afterX / 2);
  }
  var prevId = order[idx - 1];
  var beforeX = xMap.get(prevId);
  if (beforeX === undefined || afterX === undefined) return 0;
  return (beforeX + afterX) / 2;
}

function renderChronMarkers(layer, xMap) {
  layer.textContent = '';
  (P.markers || []).forEach(function (m) {
    var x = chronMarkerX(m, xMap);
    var line = document.createElement('div');
    line.className = 'markerLine';
    line.style.left = x + '%';
    line.style.pointerEvents = 'auto';
    line.dataset.markerId = m.id;

    var label = document.createElement('div');
    label.className = 'markerLabel';
    label.textContent = m.label;
    label.style.pointerEvents = 'auto';
    label.addEventListener('click', function (e) {
      e.stopPropagation();
      openMarkerPopover(m, label);
    });
    line.appendChild(label);
    layer.appendChild(line);
  });
}

function openMarkerPopover(marker, anchorEl) {
  closeMarkerPopover();
  _chronMarkerPopoverId = marker.id;
  var pop = document.createElement('div');
  pop.className = 'markerPopover';
  pop.id = 'markerPopover';

  var input = document.createElement('input');
  input.type = 'text';
  input.value = marker.label;
  pop.appendChild(input);

  var row = document.createElement('div');
  row.className = 'row';
  var delBtn = document.createElement('button');
  delBtn.className = 'btn danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', function () {
    commit('Delete marker', function (proj) {
      proj.markers = proj.markers.filter(function (mk) { return mk.id !== marker.id; });
    });
    closeMarkerPopover();
  });
  row.appendChild(delBtn);
  pop.appendChild(row);

  input.addEventListener('change', function () {
    var val = input.value.trim();
    if (!val) return;
    commit('Rename marker', function (proj) {
      var mk = proj.markers.find(function (x) { return x.id === marker.id; });
      if (mk) mk.label = val;
    });
  });

  document.body.appendChild(pop);
  var rect = anchorEl.getBoundingClientRect();
  pop.style.left = rect.left + 'px';
  pop.style.top = (rect.bottom + 4) + 'px';

  setTimeout(function () {
    document.addEventListener('click', _markerPopoverOutsideClick);
  }, 0);
}

function _markerPopoverOutsideClick(e) {
  var pop = document.getElementById('markerPopover');
  if (pop && !pop.contains(e.target)) closeMarkerPopover();
}

function closeMarkerPopover() {
  var pop = document.getElementById('markerPopover');
  if (pop) pop.remove();
  _chronMarkerPopoverId = null;
  document.removeEventListener('click', _markerPopoverOutsideClick);
}

function chronTrackContextMenu(e) {
  e.preventDefault();
  closeMarkerPopover();
  var track = document.getElementById('track');
  var rect = track.getBoundingClientRect();
  var clickX = ((e.clientX - rect.left) / rect.width) * 100;

  var menu = document.createElement('div');
  menu.className = 'markerPopover';
  menu.id = 'markerContextMenu';
  var addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.textContent = 'Add marker here';
  addBtn.addEventListener('click', function () {
    // find nearest scene to the right of clickX in chronOrder to anchor beforeSceneId
    var xMap = chronX(P, P.viewPrefs.axis);
    var beforeSceneId = null;
    for (var i = 0; i < P.chronOrder.length; i++) {
      var sx = xMap.get(P.chronOrder[i]);
      if (sx !== undefined && sx >= clickX) { beforeSceneId = P.chronOrder[i]; break; }
    }
    commit('Add marker', function (proj) {
      proj.markers.push({ id: newId('mk_'), label: 'New marker', beforeSceneId: beforeSceneId });
    });
    menu.remove();
  });
  menu.appendChild(addBtn);
  document.body.appendChild(menu);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  setTimeout(function () {
    document.addEventListener('click', _contextMenuOutsideClick);
  }, 0);
}

function _contextMenuOutsideClick(e) {
  var menu = document.getElementById('markerContextMenu');
  if (menu && !menu.contains(e.target)) {
    menu.remove();
    document.removeEventListener('click', _contextMenuOutsideClick);
  }
}

/* ---------------- character thread overlay (§7.3) ---------------- */

function renderChronThread(svg) {
  svg.textContent = '';
  if (!P.viewPrefs.threadCharId) return;
  var charId = P.viewPrefs.threadCharId;
  var track = document.getElementById('track');
  var trackRect = track.getBoundingClientRect();

  var pts = [];
  P.chronOrder.forEach(function (id) {
    var s = P.scenes.find(function (x) { return x.id === id; });
    if (!s || (s.characterIds || []).indexOf(charId) === -1) return;
    var cardEl = track.querySelector('.scene[data-scene-id="' + id + '"]');
    if (!cardEl) return;
    var r = cardEl.getBoundingClientRect();
    pts.push({
      x: r.left + r.width / 2 - trackRect.left,
      y: r.top + r.height / 2 - trackRect.top
    });
  });

  if (pts.length < 2) return;

  var ns = 'http://www.w3.org/2000/svg';
  var d = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (var i = 1; i < pts.length; i++) {
    var p = pts[i - 1], q = pts[i], mx = (p.x + q.x) / 2;
    d += ' C ' + mx + ' ' + p.y + ', ' + mx + ' ' + q.y + ', ' + q.x + ' ' + q.y;
  }
  var path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--thread)');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('opacity', '.8');
  svg.appendChild(path);

  pts.forEach(function (p) {
    var c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y);
    c.setAttribute('r', '4');
    c.setAttribute('fill', 'var(--thread)');
    c.setAttribute('stroke', 'var(--bg)');
    c.setAttribute('stroke-width', '2');
    svg.appendChild(c);
  });
}
