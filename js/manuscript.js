// manuscript.js — manuscript view rendering (M4: cards, dividers, cross-view hover/select)
// M5 adds drag: horizontal reorder of msOrder only (chronOrder untouched).
'use strict';

var _msDividerPopoverId = null;

/* ---------------- drag (§8.3) ----------------
   Same two-phase (candidate -> active) pattern as chron.js's _chronDrag, same
   threshold/self-heal/Escape rules (§7.5, reused for §8.3). msRow has no explicit
   `position:relative` in styles.css, so the ghost card and insertion line use
   `position:fixed` in viewport coordinates instead of track-relative coordinates. */
var _msDrag = null;
var _msDragOccurred = false;

/* Wired once — #msRow is a persistent DOM node reused across renderManuscript() calls. */
function initManuscriptRowListeners() {
  var row = document.getElementById('msRow');
  if (!row) return;
  row.addEventListener('click', function (e) {
    if (_msDragOccurred) { _msDragOccurred = false; return; } // drag dropped on empty row space
    if (e.target === row) selectScene(null);
  });
  row.addEventListener('contextmenu', manuscriptRowContextMenu);

  window.addEventListener('mousemove', function (e) {
    if (!_msDrag) return;
    if (e.buttons === 0) { _msDragCancel(); return; } // self-heal (§7.5/§8.3, §16.4)
    if (!_msDrag.active) {
      var dx = e.clientX - _msDrag.startX, dy = e.clientY - _msDrag.startY;
      if (Math.hypot(dx, dy) < 4) return;
      _msDragBegin(e);
    }
    _msDragMove(e);
  });
  window.addEventListener('mouseup', function () {
    if (!_msDrag) return;
    if (!_msDrag.active) { _msDrag = null; return; }
    _msDragFinish();
  });
}

/* Called from editor-init.js's Escape handler at the highest priority (§10.3),
   alongside isChronDragActive()/cancelChronDrag(). */
function isMsDragActive() {
  return !!(_msDrag && _msDrag.active);
}

function cancelMsDrag() {
  if (_msDrag) _msDragCancel();
}

function _msDragBegin(e) {
  var d = _msDrag;
  d.active = true;
  setDragActive(true);
  clearHighlight(); // see chron.js's _chronDragBegin for why this can't rely on mouseleave

  var row = document.getElementById('msRow');
  var srcEl = row.querySelector('.msCard[data-scene-id="' + d.sceneId + '"]');
  var width = 140;
  if (srcEl) { srcEl.classList.add('dragSource'); width = srcEl.getBoundingClientRect().width; }

  var scene = P.scenes.find(function (x) { return x.id === d.sceneId; });
  if (!scene) { _msDragCancel(); return; }

  var storylineById = {};
  P.storylines.forEach(function (st) { storylineById[st.id] = st; });
  var st = storylineById[scene.storylineId];

  var ghost = document.createElement('div');
  ghost.className = 'msCard msGhost';
  ghost.style.width = width + 'px';
  ghost.style.setProperty('--c', st ? slColor(st.paletteIndex) : 'var(--faint)');
  var t = document.createElement('div');
  t.className = 't';
  t.textContent = scene.title;
  ghost.appendChild(t);
  document.body.appendChild(ghost);
  d.ghostEl = ghost;

  var line = document.createElement('div');
  line.className = 'msInsertLine';
  document.body.appendChild(line);
  d.insertLineEl = line;
}

/* "Insertion line in the gap nearest the cursor" (§8.3), aware of the wrapping-grid
   row layout: if the cursor is above a card's row, insert before that card (start of
   its row); if it's within the card's row, use the left/right-of-midpoint test that
   manuscriptRowContextMenu already uses for "Add divider here" (§8.2), extended with
   the row check so it degrades gracefully across wraps. */
function _msFindDropBeforeId(clientX, clientY, excludeId) {
  var row = document.getElementById('msRow');
  var cards = Array.prototype.slice.call(row.querySelectorAll('.msCard:not(.msGhost)'));
  for (var i = 0; i < cards.length; i++) {
    var id = cards[i].dataset.sceneId;
    if (id === excludeId) continue;
    var r = cards[i].getBoundingClientRect();
    if (clientY < r.top - 2) return id; // cursor is above this card's row entirely
    if (clientY >= r.top && clientY <= r.bottom && clientX <= r.left + r.width / 2) return id;
  }
  return null; // insert at the end of msOrder
}

function _msInsertionRect(beforeId, excludeId) {
  var row = document.getElementById('msRow');
  if (beforeId) {
    var el = row.querySelector('.msCard[data-scene-id="' + beforeId + '"]');
    if (el) { var r = el.getBoundingClientRect(); return { x: r.left - 4, top: r.top, bottom: r.bottom }; }
  }
  var cards = Array.prototype.slice.call(row.querySelectorAll('.msCard:not(.msGhost)'));
  var last = null;
  cards.forEach(function (el) { if (el.dataset.sceneId !== excludeId) last = el; });
  if (last) { var lr = last.getBoundingClientRect(); return { x: lr.right + 4, top: lr.top, bottom: lr.bottom }; }
  var rr = row.getBoundingClientRect();
  return { x: rr.left, top: rr.top, bottom: rr.bottom };
}

function _msDragMove(e) {
  var d = _msDrag;
  d.ghostEl.style.left = e.clientX + 'px';
  d.ghostEl.style.top = e.clientY + 'px';

  var beforeId = _msFindDropBeforeId(e.clientX, e.clientY, d.sceneId);
  d.targetBeforeId = beforeId;
  var ins = _msInsertionRect(beforeId, d.sceneId);
  d.insertLineEl.style.left = ins.x + 'px';
  d.insertLineEl.style.top = ins.top + 'px';
  d.insertLineEl.style.height = (ins.bottom - ins.top) + 'px';
}

function _msDragCleanupVisual() {
  if (_msDrag) {
    if (_msDrag.ghostEl) _msDrag.ghostEl.remove();
    if (_msDrag.insertLineEl) _msDrag.insertLineEl.remove();
    var srcEl = document.querySelector('.msCard[data-scene-id="' + _msDrag.sceneId + '"]');
    if (srcEl) srcEl.classList.remove('dragSource');
  }
}

function _msDragCancel() {
  _msDragCleanupVisual();
  setDragActive(false);
  _msDrag = null;
}

function _msDragFinish() {
  var d = _msDrag;
  _msDragCleanupVisual();
  setDragActive(false);
  _msDrag = null;
  _msDragOccurred = true;

  var scene = P.scenes.find(function (x) { return x.id === d.sceneId; });
  if (!scene) return;

  var without = P.msOrder.filter(function (id) { return id !== d.sceneId; });
  var idx = d.targetBeforeId ? without.indexOf(d.targetBeforeId) : -1;
  if (idx === -1) idx = without.length;
  var candidate = without.slice();
  candidate.splice(idx, 0, d.sceneId);
  var same = candidate.length === P.msOrder.length &&
    candidate.every(function (id, i) { return id === P.msOrder[i]; });
  if (same) return; // no-op drag: nothing moved, no commit

  // commit() -> saveProject() -> refreshAll() re-renders + redraws wires last; chronOrder
  // is untouched (§8.3).
  commit('Move scene (manuscript)', function (proj) {
    proj.msOrder = candidate;
  });
}

/* §7.6/§8.1: real horizontal scroll container, matching chronology's chronTrackWidth()
   approach — row width = max(container width, N * pxPerScene + padding), cards fixed
   width (never shrink below 110px, per §7.6's "cards never drop below readable size"). */
function msRowWidth(rowEl) {
  var scrollEl = rowEl.parentElement;
  var containerW = (scrollEl && scrollEl.clientWidth) || rowEl.clientWidth || 0;
  var n = (P && P.msOrder && P.msOrder.length) || 0;
  var pxPerScene = (P && P.viewPrefs && P.viewPrefs.pxPerScene) || 110;
  var PADDING = 20;
  var needed = n * pxPerScene + PADDING;
  return Math.max(containerW, needed);
}

function renderManuscript() {
  var row = document.getElementById('msRow');
  if (!row || !P) return;
  row.textContent = '';

  var storylineById = {};
  P.storylines.forEach(function (st) { storylineById[st.id] = st; });

  // Era tag rule (§8.1 v1 simplification): show the anchor's year when it differs
  // from the baseline reading-order year (the first anchored card's year) — this is
  // the judgment call that makes only the flashback scenes (not the "return" scene
  // right after one) carry a tag; see the M4 build report for why a literal
  // previous-card comparison over-tags the scene that comes back from a flashback.
  var baselineYear = null;
  for (var bi = 0; bi < P.msOrder.length; bi++) {
    var bs = P.scenes.find(function (x) { return x.id === P.msOrder[bi]; });
    if (bs && bs.anchor && bs.anchor.date) { baselineYear = bs.anchor.date.slice(0, 4); break; }
  }

  var dividersBySceneId = {};
  var endDividers = [];
  (P.dividers || []).forEach(function (d) {
    if (d.beforeSceneId === null) endDividers.push(d);
    else (dividersBySceneId[d.beforeSceneId] = dividersBySceneId[d.beforeSceneId] || []).push(d);
  });

  P.msOrder.forEach(function (sceneId, i) {
    (dividersBySceneId[sceneId] || []).forEach(function (d) { row.appendChild(buildDividerEl(d)); });

    var s = P.scenes.find(function (x) { return x.id === sceneId; });
    if (!s) return;
    row.appendChild(buildMsCard(s, i, storylineById, baselineYear));
  });

  endDividers.forEach(function (d) { row.appendChild(buildDividerEl(d)); });

  // Size the row (px) after content is built, and give each card a fixed width driven
  // by the shared zoom setting — no wrap, so the row scrolls in #msScroll instead.
  row.style.width = msRowWidth(row) + 'px';
  var cardW = Math.max(110, ((P.viewPrefs && P.viewPrefs.pxPerScene) || 110) - 8);
  row.querySelectorAll('.msCard').forEach(function (el) { el.style.width = cardW + 'px'; });
}

function buildMsCard(s, index, storylineById, baselineYear) {
  var card = document.createElement('div');
  card.className = 'msCard';
  card.dataset.sceneId = s.id;
  var st = storylineById[s.storylineId];
  card.style.setProperty('--c', st ? slColor(st.paletteIndex) : 'var(--faint)');
  if (s.id === _chronSelectedSceneId) card.classList.add('sel');
  if (typeof sceneHasWarning === 'function' && sceneHasWarning(s.id)) card.classList.add('warn');
  // buildMsCard() runs on every renderManuscript() rebuild (any commit) -- if flag mode
  // is active at that moment, .flag must be re-applied here (setFlagMode() only touches
  // DOM elements that exist at the moment it runs, not ones built later).
  if (typeof getFlaggedSceneIds === 'function') {
    var flaggedIds = getFlaggedSceneIds() || [];
    if (flaggedIds.indexOf(s.id) !== -1) card.classList.add('flag');
  }

  var warnDot = document.createElement('div');
  warnDot.className = 'warnDot';
  card.appendChild(warnDot);

  var ch = document.createElement('div');
  ch.className = 'ch';
  ch.textContent = 'CH ' + (index + 1);
  card.appendChild(ch);

  var title = document.createElement('div');
  title.className = 't';
  title.textContent = s.title;
  card.appendChild(title);

  if (s.anchor && s.anchor.date) {
    var year = s.anchor.date.slice(0, 4);
    if (baselineYear !== null && year !== baselineYear) {
      var tag = document.createElement('div');
      tag.className = 'eraTag';
      tag.textContent = year;
      card.appendChild(tag);
    }
  }

  var convDots = renderConvDots(s, storylineById);
  if (convDots) card.appendChild(convDots);

  card.addEventListener('mouseenter', function () { highlightScene(s.id, true); });
  card.addEventListener('mouseleave', function () { highlightScene(s.id, false); });
  card.addEventListener('click', function (e) {
    e.stopPropagation();
    if (_msDragOccurred) { _msDragOccurred = false; return; }
    selectScene(s.id);
  });
  card.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    _msDrag = {
      sceneId: s.id, active: false, startX: e.clientX, startY: e.clientY,
      ghostEl: null, insertLineEl: null, targetBeforeId: undefined
    };
  });

  return card;
}

/* ---------------- dividers (§8.2) ----------------
   Same {id, label, beforeSceneId} mechanism as chronology markers (§7.4); mirrors
   chron.js's exact interaction pattern (right-click row -> add, click label -> popover
   with rename/delete) rather than inventing a different one. */

function buildDividerEl(divider) {
  var el = document.createElement('div');
  el.className = 'msDivider';
  el.dataset.dividerId = divider.id;

  var label = document.createElement('div');
  label.className = 'msDividerLabel';
  label.textContent = divider.label;
  label.addEventListener('click', function (e) {
    e.stopPropagation();
    openDividerPopover(divider, label);
  });
  el.appendChild(label);
  return el;
}

function openDividerPopover(divider, anchorEl) {
  closeDividerPopover();
  _msDividerPopoverId = divider.id;
  var pop = document.createElement('div');
  pop.className = 'markerPopover'; // reuse the exact popover styling from M3's markers
  pop.id = 'dividerPopover';

  var input = document.createElement('input');
  input.type = 'text';
  input.value = divider.label;
  pop.appendChild(input);

  var row = document.createElement('div');
  row.className = 'row';
  var delBtn = document.createElement('button');
  delBtn.className = 'btn danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', function () {
    commit('Delete divider', function (proj) {
      proj.dividers = proj.dividers.filter(function (d) { return d.id !== divider.id; });
    });
    closeDividerPopover();
  });
  row.appendChild(delBtn);
  pop.appendChild(row);

  input.addEventListener('change', function () {
    var val = input.value.trim();
    if (!val) return;
    commit('Rename divider', function (proj) {
      var d = proj.dividers.find(function (x) { return x.id === divider.id; });
      if (d) d.label = val;
    });
  });

  document.body.appendChild(pop);
  var rect = anchorEl.getBoundingClientRect();
  pop.style.left = rect.left + 'px';
  pop.style.top = (rect.bottom + 4) + 'px';

  setTimeout(function () {
    document.addEventListener('click', _dividerPopoverOutsideClick);
  }, 0);
}

function _dividerPopoverOutsideClick(e) {
  var pop = document.getElementById('dividerPopover');
  if (pop && !pop.contains(e.target)) closeDividerPopover();
}

function closeDividerPopover() {
  var pop = document.getElementById('dividerPopover');
  if (pop) pop.remove();
  _msDividerPopoverId = null;
  document.removeEventListener('click', _dividerPopoverOutsideClick);
}

function closeDividerContextMenu() {
  var menu = document.getElementById('dividerContextMenu');
  if (menu) menu.remove();
  document.removeEventListener('click', _dividerContextMenuOutsideClick);
}

function manuscriptRowContextMenu(e) {
  e.preventDefault();
  closeDividerPopover();
  closeDividerContextMenu(); // see chron.js's closeMarkerContextMenu — same accumulation risk
  var row = document.getElementById('msRow');

  // Find the card nearest to the right of the click point (in flex/DOM order,
  // mirroring chron.js's "nearest scene to the right" rule but by rendered
  // position rather than percentage x since msRow is a normal flex flow).
  var cards = Array.prototype.slice.call(row.querySelectorAll('.msCard:not(.msGhost)'));
  var beforeSceneId = null;
  for (var i = 0; i < cards.length; i++) {
    var r = cards[i].getBoundingClientRect();
    if (e.clientX <= r.left + r.width / 2) { beforeSceneId = cards[i].dataset.sceneId; break; }
  }

  var menu = document.createElement('div');
  menu.className = 'markerPopover';
  menu.id = 'dividerContextMenu';
  var addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.textContent = 'Add divider here';
  addBtn.addEventListener('click', function () {
    commit('Add divider', function (proj) {
      proj.dividers.push({ id: newId('dv_'), label: 'New divider', beforeSceneId: beforeSceneId });
    });
    closeDividerContextMenu();
  });
  menu.appendChild(addBtn);
  document.body.appendChild(menu);
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  setTimeout(function () {
    document.addEventListener('click', _dividerContextMenuOutsideClick);
  }, 0);
}

function _dividerContextMenuOutsideClick(e) {
  var menu = document.getElementById('dividerContextMenu');
  if (menu && !menu.contains(e.target)) {
    menu.remove();
    document.removeEventListener('click', _dividerContextMenuOutsideClick);
  }
}
