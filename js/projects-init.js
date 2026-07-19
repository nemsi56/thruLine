// projects-init.js — index.html event wiring (runs last)
'use strict';

(function () {
  // theme (global pref) applied here even though the toggle UI is a later milestone
  document.documentElement.setAttribute('data-theme', getPrefs().theme === 'light' ? 'light' : 'dark');

  seedSampleProjectIfNeeded(function () {
    renderProjectGrid();
  });

  document.getElementById('btnNewProject').addEventListener('click', function () {
    document.getElementById('newProjectName').value = '';
    openModal('modalNewProject');
    document.getElementById('newProjectName').focus();
  });
  document.getElementById('newProjectCancel').addEventListener('click', function () {
    closeModal('modalNewProject');
  });
  document.getElementById('newProjectCreate').addEventListener('click', function () {
    var name = document.getElementById('newProjectName').value.trim();
    var uid = createProject(name);
    closeModal('modalNewProject');
    openProject(uid);
  });
  document.getElementById('newProjectName').addEventListener('keydown', function (e) {
    if (e.code === 'Enter') document.getElementById('newProjectCreate').click();
  });

  document.getElementById('btnImportProject').addEventListener('click', function () {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) handleImportFile(file);
    e.target.value = '';
  });

  document.getElementById('importCancel').addEventListener('click', function () {
    _pendingImport = null;
    closeModal('modalImportConflict');
  });
  document.getElementById('importKeepBoth').addEventListener('click', function () {
    if (!_pendingImport) return;
    var clean = _pendingImport.clean;
    clean.projectUid = newId('pr_');
    finishImport(clean);
    _pendingImport = null;
    closeModal('modalImportConflict');
  });
  document.getElementById('importUpdate').addEventListener('click', function () {
    if (!_pendingImport) return;
    finishImport(_pendingImport.clean);
    _pendingImport = null;
    closeModal('modalImportConflict');
  });
  document.getElementById('importErrorOk').addEventListener('click', function () {
    closeModal('modalImportError');
  });

  // card action delegation
  document.getElementById('projGrid').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var card = e.target.closest('.projCard');
    var uid = card.dataset.uid;
    var action = btn.dataset.action;
    if (action === 'open') openProject(uid);
    else if (action === 'export') exportProject(uid);
    else if (action === 'duplicate') duplicateProject(uid);
    else if (action === 'rename') {
      var entry = getIndex().find(function (x) { return x.projectUid === uid; });
      document.getElementById('renameInput').value = entry ? entry.name : '';
      document.getElementById('renameInput').dataset.uid = uid;
      openModal('modalRename');
      document.getElementById('renameInput').focus();
    } else if (action === 'delete') {
      var entry2 = getIndex().find(function (x) { return x.projectUid === uid; });
      _pendingDeleteUid = uid;
      document.getElementById('deleteProjectName').textContent = entry2 ? entry2.name : '';
      document.getElementById('deleteInput').value = '';
      document.getElementById('deleteInput').dataset.expected = entry2 ? entry2.name : '';
      document.getElementById('deleteConfirm').disabled = true;
      openModal('modalDelete');
      document.getElementById('deleteInput').focus();
    }
  });

  document.getElementById('renameCancel').addEventListener('click', function () { closeModal('modalRename'); });
  document.getElementById('renameConfirm').addEventListener('click', function () {
    var input = document.getElementById('renameInput');
    var uid = input.dataset.uid;
    var name = input.value.trim();
    if (!name) return;
    renameProject(uid, name);
    closeModal('modalRename');
  });

  document.getElementById('deleteInput').addEventListener('input', function (e) {
    var expected = e.target.dataset.expected;
    document.getElementById('deleteConfirm').disabled = (e.target.value !== expected);
  });
  document.getElementById('deleteCancel').addEventListener('click', function () {
    _pendingDeleteUid = null;
    closeModal('modalDelete');
  });
  document.getElementById('deleteConfirm').addEventListener('click', function () {
    if (!_pendingDeleteUid) return;
    deleteProjectByUid(_pendingDeleteUid);
    _pendingDeleteUid = null;
    closeModal('modalDelete');
  });

  // Escape closes any open modal
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Escape') return;
    ['modalNewProject', 'modalRename', 'modalDelete', 'modalImportConflict', 'modalImportError'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.hidden) el.hidden = true;
    });
  });
})();
