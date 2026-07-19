// manuscript.js — manuscript view rendering (M4: cards, dividers, cross-view hover/select)
// Drag (M5) is not implemented here.
'use strict';

var _msDividerPopoverId = null;

/* Wired once — #msRow is a persistent DOM node reused across renderManuscript() calls. */
function initManuscriptRowListeners() {
  var row = document.getElementById('msRow');
  if (!row) return;
  row.addEventListener('click', function (e) {
    if (e.target === row) selectScene(null);
  });
  row.addEventListener('contextmenu', manuscriptRowContextMenu);
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
}

function buildMsCard(s, index, storylineById, baselineYear) {
  var card = document.createElement('div');
  card.className = 'msCard';
  card.dataset.sceneId = s.id;
  var st = storylineById[s.storylineId];
  card.style.setProperty('--c', st ? slColor(st.paletteIndex) : 'var(--faint)');
  if (s.id === _chronSelectedSceneId) card.classList.add('sel');

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
  card.addEventListener('click', function (e) { e.stopPropagation(); selectScene(s.id); });

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

function manuscriptRowContextMenu(e) {
  e.preventDefault();
  closeDividerPopover();
  var row = document.getElementById('msRow');

  // Find the card nearest to the right of the click point (in flex/DOM order,
  // mirroring chron.js's "nearest scene to the right" rule but by rendered
  // position rather than percentage x since msRow is a normal flex flow).
  var cards = Array.prototype.slice.call(row.querySelectorAll('.msCard'));
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
    menu.remove();
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
