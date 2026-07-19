// projects.js — project list page logic (index.html only)
'use strict';

var _pendingImport = null; // {clean, file info} awaiting conflict resolution
var _pendingDeleteUid = null;

function fmtDate(iso) {
  try {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) { return iso; }
}

function showToast(msg) {
  var box = document.getElementById('toasts');
  if (!box) return;
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(function () { el.remove(); }, 3500);
}

function renderProjectGrid() {
  var grid = document.getElementById('projGrid');
  var empty = document.getElementById('projEmpty');
  var index = getIndex().slice().sort(function (a, b) { return (b.modifiedAt || '').localeCompare(a.modifiedAt || ''); });
  grid.textContent = '';
  if (!index.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  index.forEach(function (entry) {
    grid.appendChild(buildProjectCard(entry));
  });
}

function buildProjectCard(entry) {
  var card = document.createElement('div');
  card.className = 'projCard';
  card.dataset.uid = entry.projectUid;

  var h3 = document.createElement('h3');
  h3.textContent = entry.name;
  card.appendChild(h3);

  var meta = document.createElement('div');
  meta.className = 'meta';
  var chapters = entry.chapterCount || 1;
  meta.textContent = (entry.sceneCount || 0) + ' scenes · ' + chapters + ' chapters';
  card.appendChild(meta);

  var meta2 = document.createElement('div');
  meta2.className = 'meta';
  meta2.textContent = 'Modified ' + fmtDate(entry.modifiedAt);
  card.appendChild(meta2);

  var actions = document.createElement('div');
  actions.className = 'cardActions';

  var openBtn = mkActionBtn('Open', 'open');
  var renameBtn = mkActionBtn('Rename', 'rename');
  var dupBtn = mkActionBtn('Duplicate', 'duplicate');
  var exportBtn = mkActionBtn('Export', 'export');
  var deleteBtn = mkActionBtn('Delete', 'delete');
  deleteBtn.classList.add('danger');

  actions.appendChild(openBtn);
  actions.appendChild(renameBtn);
  actions.appendChild(dupBtn);
  actions.appendChild(exportBtn);
  actions.appendChild(deleteBtn);
  card.appendChild(actions);

  return card;
}

function mkActionBtn(label, action) {
  var b = document.createElement('button');
  b.textContent = label;
  b.dataset.action = action;
  return b;
}

/* ---------------- actions ---------------- */

function openProject(uid) {
  window.location.href = 'editor.html?p=' + encodeURIComponent(uid);
}

function createProject(name) {
  var proj = makeEmptyProject(name && name.trim() ? name.trim() : 'Untitled project');
  P = proj;
  saveProject();
  P = null;
  return proj.projectUid;
}

function renameProject(uid, newName) {
  var proj = loadProject(uid);
  if (!proj) return;
  proj.name = newName;
  P = proj;
  saveProject();
  P = null;
  renderProjectGrid();
}

function duplicateProject(uid) {
  var proj = loadProject(uid);
  if (!proj) return;
  var copy = JSON.parse(JSON.stringify(proj));
  copy.projectUid = newId('pr_');
  copy.name = proj.name + ' (copy)';
  copy.createdAt = new Date().toISOString();
  copy.revision = 0;
  P = copy;
  saveProject();
  P = null;
  renderProjectGrid();
}

function exportProject(uid) {
  var proj = loadProject(uid);
  if (!proj) return;
  var blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = proj.name.replace(/[\\/:*?"<>|]/g, '_') + '.thruline.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function deleteProjectByUid(uid) {
  removeIndexEntry(uid);
  renderProjectGrid();
}

/* ---------------- import (§13.2) ---------------- */

function handleImportFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      showImportError('The file is not valid JSON.');
      return;
    }
    var result = validateProject(parsed);
    if (!result.ok) {
      showImportError('This file could not be imported:\n' + result.errors.slice(0, 6).join('\n'));
      return;
    }
    var clean = sanitizeImportedProject(parsed);
    var existing = loadProject(clean.projectUid);
    if (existing) {
      _pendingImport = { clean: clean, existing: existing };
      var msg = 'A project named "' + existing.name + '" (revision ' + existing.revision +
        ') already exists with this id. The file has revision ' + clean.revision + '.';
      if (existing.modifiedAt > clean.modifiedAt) {
        msg += ' Warning: your local copy was modified more recently than the file — updating may lose unexported changes.';
      }
      document.getElementById('importConflictMsg').textContent = msg;
      openModal('modalImportConflict');
    } else {
      finishImport(clean);
    }
  };
  reader.onerror = function () { showImportError('Could not read the file.'); };
  reader.readAsText(file);
}

function finishImport(clean) {
  P = clean;
  saveProject();
  P = null;
  renderProjectGrid();
  showToast('Imported "' + clean.name + '".');
}

function showImportError(msg) {
  document.getElementById('importErrorMsg').textContent = msg;
  openModal('modalImportError');
}

function openModal(id) { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }

/* ---------------- sample seeding (§14) ---------------- */

var SAMPLE_SEED_LOCK_MS = 10000; // a lock older than this is considered stale/abandoned

function seedSampleProjectIfNeeded(cb) {
  var prefs = getPrefs();
  if (prefs.samplesSeeded) { cb && cb(); return; }
  var lockAge = prefs.samplesSeedingAt ? (Date.now() - prefs.samplesSeedingAt) : Infinity;
  if (lockAge < SAMPLE_SEED_LOCK_MS) { cb && cb(); return; } // another concurrent load is seeding
  // claim a short-lived lock SYNCHRONOUSLY before the fetch starts, so two tabs/loads
  // racing to seed don't both do it — but do NOT mark permanently seeded until the
  // fetch actually succeeds, so a failed attempt (e.g. blocked fetch) retries later
  prefs.samplesSeedingAt = Date.now();
  savePrefs(prefs);
  fetch('data/sample-glass-harbor.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var result = validateProject(data);
      if (!result.ok) { cb && cb(); return; }
      var clean = sanitizeImportedProject(data);
      P = clean;
      saveProject();
      P = null;
      var p = getPrefs();
      p.samplesSeeded = true;
      delete p.samplesSeedingAt;
      savePrefs(p);
      cb && cb();
    })
    .catch(function () {
      // leave samplesSeeded false so the next visit (after the lock goes stale) retries
      cb && cb();
    });
}
