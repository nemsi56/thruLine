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
  if (typeof initManuscriptRowListeners === 'function') initManuscriptRowListeners();
  if (typeof initWireScrollListeners === 'function') initWireScrollListeners();
  if (typeof initBraidScrollListeners === 'function') initBraidScrollListeners();
  refreshAll();

  // zoom slider (§7.6) — pxPerScene, 70-200, persisted in viewPrefs; re-render both
  // strips (widths + collision pass all depend on it) then redraw wires.
  var chronZoomEl = document.getElementById('chronZoom');
  if (chronZoomEl) {
    chronZoomEl.value = (P.viewPrefs && P.viewPrefs.pxPerScene) || 110;
    chronZoomEl.addEventListener('input', function () {
      P.viewPrefs.pxPerScene = parseInt(chronZoomEl.value, 10) || 110;
      if (typeof renderChron === 'function') renderChron();
      if (typeof renderManuscript === 'function') renderManuscript();
      if (typeof redrawWires === 'function') redrawWires();
    });
    chronZoomEl.addEventListener('change', function () {
      saveProject(); // commits the final value to localStorage without a full undo entry
    });
  }

  // wires read card positions via getBoundingClientRect; a ResizeObserver on the stage
  // catches divider drags / panel collapse that a plain window resize would miss.
  if (typeof redrawWires === 'function' && typeof ResizeObserver !== 'undefined') {
    var stageEl = document.getElementById('stage');
    if (stageEl) {
      var _wiresRO = new ResizeObserver(function () {
        clearTimeout(_wiresRO._t);
        _wiresRO._t = setTimeout(function () {
          redrawWires();
          // Braid's rowH is derived from the stage/scroll-container height (§9.5), so it
          // needs the same resize-triggered redraw as wires — plain window `resize`
          // alone misses divider drags / panel collapse (§3's ResizeObserver pitfall).
          if (typeof renderBraid === 'function') renderBraid();
        }, 150);
      });
      _wiresRO.observe(stageEl);
    }
  }

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
    // §3.3: "switching themes triggers a full refreshAll() so every card, wire,
    // thread, and braid node repaints" — storyline colors (slColor()) and the braid's
    // literal flashback-accent hex are baked into inline styles/SVG attributes at
    // render time, so anything already on screen would otherwise stay stale until some
    // OTHER action happened to re-render it.
    if (typeof refreshAll === 'function') refreshAll();
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
  // "+ Scene" (§10.4) — same action wired from both section headers.
  if (typeof addSceneAndFocus === 'function') {
    var addChronBtn = document.getElementById('addSceneChron');
    var addMsBtn = document.getElementById('addSceneMs');
    if (addChronBtn) addChronBtn.addEventListener('click', addSceneAndFocus);
    if (addMsBtn) addMsBtn.addEventListener('click', addSceneAndFocus);
  }

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

    // Escape priority (§10.3): cancel drag -> close popover/modal -> clear selection.
    // Drag-cancel is checked FIRST, ahead of the marker/divider popover branches below.
    if (e.code === 'Escape') {
      var chronDragging = typeof isChronDragActive === 'function' && isChronDragActive();
      var msDragging = typeof isMsDragActive === 'function' && isMsDragActive();
      if (chronDragging || msDragging) {
        if (chronDragging && typeof cancelChronDrag === 'function') cancelChronDrag();
        if (msDragging && typeof cancelMsDrag === 'function') cancelMsDrag();
        return;
      }
      if (document.getElementById('markerPopover') || document.getElementById('markerContextMenu')) {
        if (typeof closeMarkerPopover === 'function') closeMarkerPopover();
        var ctxMenu = document.getElementById('markerContextMenu');
        if (ctxMenu) ctxMenu.remove();
        return;
      }
      if (document.getElementById('dividerPopover') || document.getElementById('dividerContextMenu')) {
        if (typeof closeDividerPopover === 'function') closeDividerPopover();
        var dCtxMenu = document.getElementById('dividerContextMenu');
        if (dCtxMenu) dCtxMenu.remove();
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
