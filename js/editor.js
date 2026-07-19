// editor.js — editor.html shell logic (M2): load, save plumbing, view switching, divider drag
'use strict';

function getProjectUidFromUrl() {
  var params = new URLSearchParams(window.location.search);
  return params.get('p');
}

function redirectToProjects() {
  window.location.href = 'index.html';
}

/* refreshAll() is the central re-render hook that saveProject()/undo/redo call.
   In this milestone there is no chron/manuscript/wires content to render yet,
   so it just refreshes the shell chrome (project name, view mode, conflicts badge stub). */
function refreshAll() {
  if (!P) return;
  var nameEl = document.getElementById('projName');
  if (nameEl) nameEl.textContent = P.name;
  applyViewMode(P.viewPrefs.mode);
  refreshThreadPicker();
  if (typeof renderChron === 'function') renderChron();
  if (typeof renderManuscript === 'function') renderManuscript();
  if (typeof renderBraid === 'function') renderBraid();
  // Re-render the inspector for whatever is currently selected (§5.2: saveProject()'s
  // refreshAll() re-renders "both views, wires, conflicts, inspector") — every field
  // edit funnels through commit()->saveProject()->refreshAll(), so without this the
  // panel would go stale after its own edits (e.g. a new chip/constraint added but
  // never redrawn).
  if (typeof renderInspectorSelection === 'function') {
    renderInspectorSelection(typeof _chronSelectedSceneId !== 'undefined' ? _chronSelectedSceneId : null);
  }
  // wires read card positions via getBoundingClientRect, so it must render last.
  if (typeof redrawWires === 'function') redrawWires();
}

function refreshThreadPicker() {
  var sel = document.getElementById('threadPicker');
  if (!sel || !P) return;
  var current = P.viewPrefs.threadCharId || '';
  sel.textContent = '';
  var noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'Thread: None';
  sel.appendChild(noneOpt);
  P.characters.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = 'Thread: ' + c.name;
    sel.appendChild(opt);
  });
  sel.value = current;
}

function applyViewMode(mode) {
  document.querySelectorAll('.viewMode').forEach(function (el) {
    var views = (el.dataset.view || '').split(' ');
    el.classList.toggle('active', views.indexOf(mode) !== -1);
  });
  document.querySelectorAll('#viewSwitcher button').forEach(function (b) {
    b.classList.toggle('on', b.dataset.mode === mode);
  });
  var axisSwitcher = document.getElementById('axisSwitcher');
  if (axisSwitcher) axisSwitcher.style.visibility = (mode === 'braid') ? 'hidden' : 'visible';
  var threadPicker = document.getElementById('threadPicker');
  if (threadPicker) threadPicker.style.visibility = (mode === 'braid') ? 'hidden' : 'visible';
}

function setViewMode(mode) {
  if (!P) return;
  P.viewPrefs.mode = mode;
  applyViewMode(mode);
  saveProject();
}

/* ---------------- divider drag (persists chronHeightPx) ---------------- */

function initDividerDrag() {
  var divider = document.getElementById('divider');
  var chronSection = document.getElementById('chronSection');
  if (!divider || !chronSection) return;
  var dragging = false;
  var startY = 0;
  var startHeight = 0;

  function applyHeight(px) {
    chronSection.style.flexBasis = px + 'px';
    chronSection.style.flex = '0 0 ' + px + 'px';
  }

  applyHeight((P && P.viewPrefs.chronHeightPx) || 260);

  divider.addEventListener('mousedown', function (e) {
    dragging = true;
    setDragActive(true);
    divider.classList.add('dragging');
    startY = e.clientY;
    startHeight = chronSection.getBoundingClientRect().height;
    e.preventDefault();
  });

  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    if (e.buttons === 0) { // self-heal: mouse released outside window
      dragging = false;
      setDragActive(false);
      divider.classList.remove('dragging');
      return;
    }
    var dy = e.clientY - startY;
    var newHeight = Math.max(80, Math.min(window.innerHeight - 200, startHeight + dy));
    applyHeight(newHeight);
  });

  window.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    setDragActive(false);
    divider.classList.remove('dragging');
    if (P) {
      P.viewPrefs.chronHeightPx = Math.round(chronSection.getBoundingClientRect().height);
      saveProject();
    }
  });

  window.addEventListener('keydown', function (e) {
    if (dragging && e.code === 'Escape') {
      dragging = false;
      setDragActive(false);
      divider.classList.remove('dragging');
      applyHeight((P && P.viewPrefs.chronHeightPx) || 260);
    }
  });
}
