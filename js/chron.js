// chron.js — chronology view rendering (M3: ordinal lanes/cards/markers/selection/hover)
// Drag (M5) and true-scale gap compression (M7) are not implemented here.
'use strict';

var _chronSelectedSceneId = null;
var _chronMarkerPopoverId = null;

/* Track width computation stays isolated here so M7's zoom/scroll can replace it later
   without touching the rest of the renderer. For M3 the track just fills its container. */
function chronTrackWidth(trackEl) {
  return trackEl.clientWidth;
}

/* Wired once (not per-render) since #track is a persistent DOM node reused across
   renderChron() calls — attaching inside renderChron would stack duplicate listeners. */
function initChronTrackListeners() {
  var track = document.getElementById('track');
  if (!track) return;
  track.addEventListener('click', function (e) {
    if (e.target === track) selectScene(null);
  });
  track.addEventListener('contextmenu', chronTrackContextMenu);
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

    // convergence dots
    if (s.alsoStorylineIds && s.alsoStorylineIds.length) {
      var dots = document.createElement('div');
      dots.className = 'convDots';
      var shown = s.alsoStorylineIds.slice(0, 4);
      shown.forEach(function (stId) {
        var st = storylineById[stId];
        if (!st) return;
        var d = document.createElement('span');
        d.className = 'convDot';
        d.style.background = slColor(st.paletteIndex);
        d.title = st.name;
        dots.appendChild(d);
      });
      if (s.alsoStorylineIds.length > 4) {
        var more = document.createElement('span');
        more.className = 'convMore';
        more.textContent = '+' + (s.alsoStorylineIds.length - 4);
        dots.appendChild(more);
      }
      card.appendChild(dots);
    }

    card.addEventListener('mouseenter', function () { chronHoverScene(s.id, true); });
    card.addEventListener('mouseleave', function () { chronHoverScene(s.id, false); });
    card.addEventListener('click', function (e) { e.stopPropagation(); selectScene(s.id); });

    track.appendChild(card);
  });

  renderChronMarkers(markersLayer, xMap);
  renderChronThread(threadSvg);
}

/* ---------------- hover (§10.1) ---------------- */

function chronHoverScene(sceneId, on) {
  if (_dragActive) return;
  document.body.classList.toggle('hovering', on);
  document.querySelectorAll('[data-scene-id="' + sceneId + '"]').forEach(function (el) {
    el.classList.toggle('hi', on);
  });
  if (typeof redrawWires === 'function') redrawWires();
}

/* ---------------- selection (§10.2) ----------------
   Full field editing is M6; for now selecting just shows the title in the Inspector
   with a note that full editing arrives later. */

function selectScene(sceneId) {
  _chronSelectedSceneId = sceneId;
  document.querySelectorAll('.scene, .msCard').forEach(function (el) {
    el.classList.toggle('sel', el.dataset.sceneId === sceneId);
  });
  renderInspectorSelection(sceneId);
}

function renderInspectorSelection(sceneId) {
  var body = document.getElementById('panelBody');
  if (!body) return;
  if (!sceneId || !P) {
    body.textContent = '';
    var empty = document.createElement('div');
    empty.className = 'panelEmpty';
    empty.textContent = 'Select a scene to edit it here. Project-level lists and the conflict engine arrive in later milestones.';
    body.appendChild(empty);
    return;
  }
  var s = P.scenes.find(function (x) { return x.id === sceneId; });
  if (!s) return;
  body.textContent = '';
  var h = document.createElement('div');
  h.className = 'inspectorSceneTitle';
  h.textContent = s.title;
  var note = document.createElement('div');
  note.className = 'panelEmpty';
  note.textContent = 'Full editing arrives in a later milestone.';
  body.appendChild(h);
  body.appendChild(note);
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
