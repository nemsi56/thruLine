// editor-init.js — editor.html event wiring (runs last)
'use strict';

(function () {
  var uid = getProjectUidFromUrl();
  if (!uid) { redirectToProjects(); return; }

  var loaded = loadProject(uid);
  if (!loaded) { alert('Project not found.'); redirectToProjects(); return; }

  P = loaded;
  resetUndoStacks();

  // theme
  document.documentElement.setAttribute('data-theme', getPrefs().theme === 'light' ? 'light' : 'dark');
  document.getElementById('themeToggle').textContent = getPrefs().theme === 'light' ? '☀' : '☾';

  var prefs = getPrefs();
  prefs.lastOpenedProjectUid = uid;
  savePrefs(prefs);

  initDividerDrag();
  if (typeof initChronTrackListeners === 'function') initChronTrackListeners();
  refreshAll();

  // view switcher
  document.getElementById('viewSwitcher').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    setViewMode(btn.dataset.mode);
  });

  // axis switcher (visual only in M2 — chronX computation is M6/M7)
  document.getElementById('axisSwitcher').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-axis]');
    if (!btn) return;
    document.querySelectorAll('#axisSwitcher button').forEach(function (b) { b.classList.toggle('on', b === btn); });
    P.viewPrefs.axis = btn.dataset.axis === 'true' ? 'true' : 'ordinal';
    saveProject();
  });

  document.getElementById('threadPicker').addEventListener('change', function (e) {
    P.viewPrefs.threadCharId = e.target.value || null;
    saveProject();
  });

  document.getElementById('themeToggle').addEventListener('click', function () {
    var pr = getPrefs();
    pr.theme = (pr.theme === 'light') ? 'dark' : 'light';
    savePrefs(pr);
    document.documentElement.setAttribute('data-theme', pr.theme);
    document.getElementById('themeToggle').textContent = pr.theme === 'light' ? '☀' : '☾';
  });

  // panel tabs
  document.querySelector('.panelTabs').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    document.querySelectorAll('.panelTabs button').forEach(function (b) { b.classList.toggle('on', b === btn); });
    P.viewPrefs.panelTab = btn.dataset.tab;
    saveProject();
  });

  // overflow menu
  document.getElementById('overflowBtn').addEventListener('click', function () {
    document.getElementById('overflowMenu').hidden = false;
  });
  document.getElementById('overflowMenu').addEventListener('click', function (e) {
    if (e.target.id === 'overflowMenu') document.getElementById('overflowMenu').hidden = true;
  });
  document.getElementById('menuExport').addEventListener('click', exportCurrentProject);
  document.getElementById('menuImport').addEventListener('click', function () {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', function () {
      // Full import-with-conflict-resolution flow lives on the projects page (§13.2);
      // from the editor we just hand off there per spec's ⋯ menu entry.
      alert('Import JSON from the editor opens the Projects page import flow.');
      redirectToProjects();
    });
    input.click();
  });

  // keyboard shortcuts (§10.3), guarded per §5.3/§16.9
  document.addEventListener('keydown', function (e) {
    var overflowOpen = !document.getElementById('overflowMenu').hidden;
    if (overflowOpen && e.code === 'Escape') { document.getElementById('overflowMenu').hidden = true; return; }
    if (overflowOpen) return;

    // Escape priority (§10.3): cancel drag (M5) -> close popover/modal -> clear selection.
    if (e.code === 'Escape') {
      if (document.getElementById('markerPopover') || document.getElementById('markerContextMenu')) {
        if (typeof closeMarkerPopover === 'function') closeMarkerPopover();
        var ctxMenu = document.getElementById('markerContextMenu');
        if (ctxMenu) ctxMenu.remove();
        return;
      }
      if (typeof selectScene === 'function') selectScene(null);
      return;
    }

    var mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); redo(e); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); redo(e); return; }
    if (mod && e.code === 'KeyZ') { e.preventDefault(); undo(e); return; }
    if (mod && e.code === 'KeyE') { e.preventDefault(); exportCurrentProject(); return; }
  });

  function exportCurrentProject() {
    document.getElementById('overflowMenu').hidden = true;
    var blob = new Blob([JSON.stringify(P, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = P.name.replace(/[\\/:*?"<>|]/g, '_') + '.thruline.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
})();
