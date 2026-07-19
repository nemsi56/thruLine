// inspector.js — right panel: scene field editing (M6) + project-level lists (M6)
'use strict';

/* ==================================================================
   Entry point — called by chron.js/manuscript.js's selectScene().
   opts = { focusTitle:true } used by "+ Scene" (§10.4) to focus/select the new
   scene's title input right after it's created.
   ================================================================== */

function renderInspectorSelection(sceneId, opts) {
  var body = document.getElementById('panelBody');
  if (!body) return;
  body.textContent = '';
  if (!sceneId || !P) {
    renderProjectLists(body);
    return;
  }
  var s = P.scenes.find(function (x) { return x.id === sceneId; });
  if (!s) { renderProjectLists(body); return; }
  renderSceneInspector(body, s, opts);
}

/* ==================================================================
   Small shared DOM helpers
   ================================================================== */

function _field(labelText, contentEl) {
  var wrap = document.createElement('div');
  wrap.className = 'inspField';
  if (labelText) {
    var lab = document.createElement('label');
    lab.className = 'inspLabel';
    lab.textContent = labelText;
    wrap.appendChild(lab);
  }
  wrap.appendChild(contentEl);
  return wrap;
}

function _row(children) {
  var r = document.createElement('div');
  r.className = 'inspRow';
  children.forEach(function (c) { r.appendChild(c); });
  return r;
}

/* Generic confirm dialog, reusing the .modalOverlay/.modal styling already defined
   for index.html's project-delete modal (§14) rather than inventing a new modal
   system. Built dynamically since editor.html carries no static modal markup. */
function showConfirm(opts) {
  var overlay = document.createElement('div');
  overlay.className = 'modalOverlay';
  var modal = document.createElement('div');
  modal.className = 'modal';

  var h3 = document.createElement('h3');
  h3.textContent = opts.title;
  modal.appendChild(h3);

  var p = document.createElement('p');
  p.textContent = opts.message; // textContent only — no user text ever gets injected raw
  modal.appendChild(p);

  var row = document.createElement('div');
  row.className = 'row';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);
  var okBtn = document.createElement('button');
  okBtn.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
  okBtn.textContent = opts.confirmLabel || 'OK';
  okBtn.addEventListener('click', function () {
    close();
    opts.onConfirm && opts.onConfirm();
  });
  row.appendChild(cancelBtn);
  row.appendChild(okBtn);
  modal.appendChild(row);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.code === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
}

/* ==================================================================
   Scene form (§11, fields 1-10)
   ================================================================== */

function renderSceneInspector(body, s, opts) {
  var storylineById = {};
  P.storylines.forEach(function (st) { storylineById[st.id] = st; });

  // 1. Title
  var titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'inspTitleInput';
  titleInput.value = s.title;
  titleInput.maxLength = 200;
  var prevTitle = s.title;
  titleInput.addEventListener('blur', function () {
    var val = titleInput.value.trim();
    if (!val) {
      titleInput.value = prevTitle;
      titleInput.classList.add('shakeField');
      setTimeout(function () { titleInput.classList.remove('shakeField'); }, 320);
      return;
    }
    if (val === prevTitle) return;
    prevTitle = val;
    commit('Rename scene', function (proj) {
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (sc) sc.title = val;
    });
  });
  titleInput.addEventListener('keydown', function (e) { if (e.code === 'Enter') titleInput.blur(); });
  body.appendChild(_field('Title', titleInput));

  // 2. Summary
  var summaryInput = document.createElement('textarea');
  summaryInput.rows = 3;
  summaryInput.className = 'inspTextarea';
  summaryInput.value = s.summary || '';
  summaryInput.addEventListener('blur', function () {
    var val = summaryInput.value;
    if (val === (s.summary || '')) return;
    commit('Edit summary', function (proj) {
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (sc) sc.summary = val;
    });
  });
  body.appendChild(_field('Summary', summaryInput));

  // 3. Storyline (home) + Also part of
  var stSelect = document.createElement('select');
  P.storylines.forEach(function (st) {
    var opt = document.createElement('option');
    opt.value = st.id;
    opt.textContent = st.name;
    if (st.id === s.storylineId) opt.selected = true;
    stSelect.appendChild(opt);
  });
  stSelect.addEventListener('change', function () {
    var val = stSelect.value;
    if (val === s.storylineId) return;
    commit('Change storyline', function (proj) {
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (sc) {
        sc.storylineId = val;
        sc.alsoStorylineIds = (sc.alsoStorylineIds || []).filter(function (id) { return id !== val; });
      }
    });
  });
  body.appendChild(_field('Storyline', stSelect));

  var alsoWrap = document.createElement('div');
  alsoWrap.className = 'checkList';
  P.storylines.forEach(function (st) {
    if (st.id === s.storylineId) return; // home storyline is not listed (§11.3)
    var row = document.createElement('label');
    row.className = 'checkRow';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = (s.alsoStorylineIds || []).indexOf(st.id) !== -1;
    cb.addEventListener('change', function () {
      var checked = cb.checked;
      commit('Change also-part-of', function (proj) {
        var sc = proj.scenes.find(function (x) { return x.id === s.id; });
        if (!sc) return;
        var arr = sc.alsoStorylineIds || (sc.alsoStorylineIds = []);
        var idx = arr.indexOf(st.id);
        if (checked && idx === -1) arr.push(st.id);
        if (!checked && idx !== -1) arr.splice(idx, 1);
      });
    });
    var sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = slColor(st.paletteIndex);
    row.appendChild(cb);
    row.appendChild(sw);
    var nm = document.createElement('span');
    nm.textContent = st.name;
    row.appendChild(nm);
    alsoWrap.appendChild(row);
  });
  body.appendChild(_field('Also part of', alsoWrap));

  // 4. Characters
  var charWrap = document.createElement('div');
  charWrap.className = 'checkList';
  P.characters.forEach(function (c) {
    var row = document.createElement('label');
    row.className = 'checkRow';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = (s.characterIds || []).indexOf(c.id) !== -1;
    cb.addEventListener('change', function () {
      var checked = cb.checked;
      commit('Change characters', function (proj) {
        var sc = proj.scenes.find(function (x) { return x.id === s.id; });
        if (!sc) return;
        var arr = sc.characterIds || (sc.characterIds = []);
        var idx = arr.indexOf(c.id);
        if (checked && idx === -1) arr.push(c.id);
        if (!checked && idx !== -1) arr.splice(idx, 1);
      });
    });
    row.appendChild(cb);
    var nm = document.createElement('span');
    nm.textContent = c.name;
    row.appendChild(nm);
    charWrap.appendChild(row);
  });
  var newCharRow = _buildInlineAddRow('New character…', function (name) {
    commit('Add character', function (proj) {
      var ch = { id: newId('ch_'), name: name };
      proj.characters.push(ch);
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (sc) (sc.characterIds || (sc.characterIds = [])).push(ch.id);
    });
  });
  charWrap.appendChild(newCharRow);
  body.appendChild(_field('Characters', charWrap));

  // 5. Location
  var locSelect = document.createElement('select');
  var noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'None';
  locSelect.appendChild(noneOpt);
  P.locations.forEach(function (l) {
    var opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    locSelect.appendChild(opt);
  });
  var NEW_LOC_VALUE = '__new__';
  var newLocOpt = document.createElement('option');
  newLocOpt.value = NEW_LOC_VALUE;
  newLocOpt.textContent = 'New location…';
  locSelect.appendChild(newLocOpt);
  locSelect.value = s.locationId || '';

  var locWrap = document.createElement('div');
  locWrap.appendChild(locSelect);
  var locAddRow = _buildInlineAddRow('New location name…', function (name) {
    commit('Add location', function (proj) {
      var loc = { id: newId('lo_'), name: name };
      proj.locations.push(loc);
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (sc) sc.locationId = loc.id;
    });
  });
  locAddRow.style.display = 'none';
  locWrap.appendChild(locAddRow);

  locSelect.addEventListener('change', function () {
    if (locSelect.value === NEW_LOC_VALUE) {
      locSelect.value = s.locationId || '';
      locAddRow.style.display = '';
      locAddRow.querySelector('input').focus();
      return;
    }
    var val = locSelect.value || null;
    if (val === s.locationId) return;
    commit('Change location', function (proj) {
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (sc) sc.locationId = val;
    });
  });
  body.appendChild(_field('Location', locWrap));

  // 6. Offscreen
  var offLabel = document.createElement('label');
  offLabel.className = 'toggleRow';
  var offCb = document.createElement('input');
  offCb.type = 'checkbox';
  offCb.checked = !!s.offscreen;
  offCb.addEventListener('change', function () {
    var val = offCb.checked;
    commit('Toggle offscreen', function (proj) { toggleOffscreen(proj, s.id, val); });
  });
  offLabel.appendChild(offCb);
  var offText = document.createElement('span');
  offText.textContent = 'Offscreen — happens in the world, never on the page';
  offLabel.appendChild(offText);
  body.appendChild(_field(null, offLabel));

  // 7. When
  body.appendChild(_buildWhenGroup(s));

  // 8. Constraints
  body.appendChild(_buildConstraintsGroup(s));

  // 9. Reveals / Requires
  body.appendChild(_buildRevealChips('Reveals', s, 'reveals'));
  body.appendChild(_buildRevealChips('Requires', s, 'requires'));

  // 10. Danger row
  var dangerRow = document.createElement('div');
  dangerRow.className = 'dangerRow';
  var dupBtn = document.createElement('button');
  dupBtn.className = 'btn';
  dupBtn.textContent = 'Duplicate scene';
  dupBtn.addEventListener('click', function () {
    var newIdVal = null;
    commit('Duplicate scene', function (proj) { newIdVal = duplicateSceneInPlace(proj, s.id); });
    if (newIdVal) selectScene(newIdVal);
  });
  var delBtn = document.createElement('button');
  delBtn.className = 'btn danger';
  delBtn.textContent = 'Delete scene';
  delBtn.addEventListener('click', function () {
    showConfirm({
      title: 'Delete scene',
      message: 'Delete "' + s.title + '"? This removes it from both the chronology and the manuscript, and deletes any constraints that reference it. This cannot be undone from here (but Ctrl/Cmd+Z will still work).',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: function () {
        commit('Delete scene', function (proj) { deleteScene(proj, s.id); });
        selectScene(null);
      }
    });
  });
  dangerRow.appendChild(dupBtn);
  dangerRow.appendChild(delBtn);
  body.appendChild(dangerRow);

  if (opts && opts.focusTitle) {
    setTimeout(function () { titleInput.focus(); titleInput.select(); }, 0);
  }
}

/* ---------------- inline "add" row shared by Characters/project lists ---------------- */

function _buildInlineAddRow(placeholder, onAdd) {
  var row = document.createElement('div');
  row.className = 'inlineAddRow';
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  var btn = document.createElement('button');
  btn.className = 'btn small';
  btn.textContent = 'Add';
  function submit() {
    var val = input.value.trim();
    if (!val) return;
    input.value = '';
    onAdd(val);
  }
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', function (e) { if (e.code === 'Enter') { e.preventDefault(); submit(); } });
  row.appendChild(input);
  row.appendChild(btn);
  return row;
}

/* ==================================================================
   7. When group (§11.7)
   ================================================================== */

function _buildWhenGroup(s) {
  var group = document.createElement('div');
  group.className = 'whenGroup';

  var lab = document.createElement('div');
  lab.className = 'inspLabel';
  lab.textContent = 'When';
  group.appendChild(lab);

  var dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = (s.anchor && s.anchor.date) || '';

  var timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = (s.anchor && s.anchor.time) || '';

  dateInput.addEventListener('change', function () {
    var val = dateInput.value || '';
    commit('Set anchor date', function (proj) {
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (!sc) return;
      if (!val) { sc.anchor = null; return; }
      sc.anchor = { date: val, time: (sc.anchor && sc.anchor.time) || null };
    });
  });
  timeInput.addEventListener('change', function () {
    var val = timeInput.value || null;
    commit('Set anchor time', function (proj) {
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (!sc) return;
      if (!sc.anchor) {
        if (!val) return; // no date yet — ignore a time-only edit
        sc.anchor = { date: new Date().toISOString().slice(0, 10), time: val };
        // reflect the auto-filled date back into the date input
        dateInput.value = sc.anchor.date;
      } else {
        sc.anchor.time = val;
      }
    });
  });

  group.appendChild(_row([_field('Date', dateInput), _field('Time', timeInput)]));

  var durVal = document.createElement('input');
  durVal.type = 'number';
  durVal.min = '1';
  durVal.step = '1';
  var durUnit = document.createElement('select');
  ['min', 'hr', 'days'].forEach(function (u) {
    var opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    durUnit.appendChild(opt);
  });
  // Pick the largest whole unit that reproduces durationMin exactly, so round-tripping
  // an "hr"/"days" entry doesn't silently redisplay it in minutes.
  if (s.durationMin) {
    if (s.durationMin % 1440 === 0) { durVal.value = s.durationMin / 1440; durUnit.value = 'days'; }
    else if (s.durationMin % 60 === 0) { durVal.value = s.durationMin / 60; durUnit.value = 'hr'; }
    else { durVal.value = s.durationMin; durUnit.value = 'min'; }
  } else {
    durVal.value = '';
    durUnit.value = 'min';
  }
  function commitDuration() {
    var n = parseInt(durVal.value, 10);
    var mult = durUnit.value === 'hr' ? 60 : durUnit.value === 'days' ? 1440 : 1;
    var minutes = (Number.isInteger(n) && n > 0) ? n * mult : null;
    if (minutes === (s.durationMin || null)) return;
    commit('Set duration', function (proj) {
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (sc) sc.durationMin = minutes;
    });
  }
  durVal.addEventListener('blur', commitDuration);
  durUnit.addEventListener('change', commitDuration);
  group.appendChild(_row([_field('Duration', durVal), _field('Unit', durUnit)]));

  var clearLink = document.createElement('button');
  clearLink.className = 'btn link';
  clearLink.textContent = 'Clear anchor';
  clearLink.addEventListener('click', function () {
    if (!s.anchor) return;
    commit('Clear anchor', function (proj) {
      var sc = proj.scenes.find(function (x) { return x.id === s.id; });
      if (sc) sc.anchor = null;
    });
  });
  group.appendChild(clearLink);

  var posText = document.createElement('div');
  posText.className = 'positionText';
  posText.textContent = _positionLabel(s);
  group.appendChild(posText);

  return group;
}

function _positionLabel(s) {
  var chronIdx = P.chronOrder.indexOf(s.id);
  var chronN = P.chronOrder.length;
  var chronPart = (chronIdx === -1) ? '?' : _ordinal(chronIdx + 1) + ' of ' + chronN + ' in chronology';
  var msPart;
  if (s.offscreen) {
    msPart = 'offscreen (no manuscript position)';
  } else {
    var msIdx = P.msOrder.indexOf(s.id);
    msPart = (msIdx === -1) ? 'not in manuscript' : 'Ch ' + (msIdx + 1) + ' of ' + P.msOrder.length;
  }
  return chronPart + ' · ' + msPart;
}

function _ordinal(n) {
  var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ==================================================================
   8. Constraints group (§11.8, §4.4)
   ================================================================== */

function _constraintSentence(c, thisId) {
  var otherId = (c.a === thisId) ? c.b : c.a;
  var other = P.scenes.find(function (x) { return x.id === otherId; });
  var otherTitle = other ? other.title : '(deleted scene)';
  if (c.type === 'same-time') return 'same time as ‘' + otherTitle + '’';
  if (c.type === 'before') {
    return (c.a === thisId ? 'before ‘' : 'after ‘') + otherTitle + '’';
  }
  // offset: b = a + offsetMin. thisId===a => "N before other"; thisId===b => "N after other".
  var label = _fmtOffsetValue(c.offsetMin);
  return label + ' ' + (c.a === thisId ? 'before ‘' : 'after ‘') + otherTitle + '’';
}

function _fmtOffsetValue(min) {
  if (min % 1440 === 0) { var d = min / 1440; return d + (d === 1 ? ' day' : ' days'); }
  if (min % 60 === 0) { var h = min / 60; return h + (h === 1 ? ' hr' : ' hrs'); }
  return min + ' min';
}

function _buildConstraintsGroup(s) {
  var group = document.createElement('div');
  group.className = 'constraintsGroup';
  var lab = document.createElement('div');
  lab.className = 'inspLabel';
  lab.textContent = 'Constraints';
  group.appendChild(lab);

  var list = document.createElement('div');
  list.className = 'constraintList';
  var mine = P.constraints.filter(function (c) { return c.a === s.id || c.b === s.id; });
  mine.forEach(function (c) {
    var row = document.createElement('div');
    row.className = 'constraintRow';
    var text = document.createElement('span');
    text.textContent = _constraintSentence(c, s.id);
    row.appendChild(text);
    var x = document.createElement('button');
    x.className = 'chipX';
    x.textContent = '✕';
    x.title = 'Remove constraint';
    x.addEventListener('click', function () {
      commit('Delete constraint', function (proj) {
        proj.constraints = proj.constraints.filter(function (cc) { return cc.id !== c.id; });
      });
    });
    row.appendChild(x);
    list.appendChild(row);
  });
  group.appendChild(list);

  var addBtn = document.createElement('button');
  addBtn.className = 'btn small';
  addBtn.textContent = 'Add constraint…';
  var addRowHolder = document.createElement('div');
  addBtn.addEventListener('click', function () {
    addRowHolder.textContent = '';
    addRowHolder.appendChild(_buildConstraintAddRow(s, function () { addRowHolder.textContent = ''; }));
  });
  group.appendChild(addBtn);
  group.appendChild(addRowHolder);

  return group;
}

function _buildConstraintAddRow(s, onDone) {
  var row = document.createElement('div');
  row.className = 'constraintAddRow';

  var typeSelect = document.createElement('select');
  [['before', 'before'], ['same-time', 'same time as'], ['after', 'after'], ['n-after', 'N after']].forEach(function (pair) {
    var opt = document.createElement('option');
    opt.value = pair[0];
    opt.textContent = pair[1];
    typeSelect.appendChild(opt);
  });

  var sceneSelect = document.createElement('select');
  // "all other scenes" (§11.8) — this scene itself must never appear as a candidate.
  P.scenes.forEach(function (other) {
    if (other.id === s.id) return;
    var opt = document.createElement('option');
    opt.value = other.id;
    opt.textContent = other.title;
    sceneSelect.appendChild(opt);
  });

  var offsetVal = document.createElement('input');
  offsetVal.type = 'number';
  offsetVal.min = '1';
  offsetVal.step = '1';
  offsetVal.value = '1';
  offsetVal.className = 'offsetVal';
  var offsetUnit = document.createElement('select');
  ['min', 'hr', 'days'].forEach(function (u) {
    var opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    offsetUnit.appendChild(opt);
  });

  function syncOffsetVisibility() {
    var show = typeSelect.value === 'n-after';
    offsetVal.style.display = show ? '' : 'none';
    offsetUnit.style.display = show ? '' : 'none';
  }
  typeSelect.addEventListener('change', syncOffsetVisibility);
  syncOffsetVisibility();

  var addBtn = document.createElement('button');
  addBtn.className = 'btn small primary';
  addBtn.textContent = 'Add';
  addBtn.addEventListener('click', function () {
    if (!sceneSelect.value) return;
    var otherId = sceneSelect.value;
    var kind = typeSelect.value;
    commit('Add constraint', function (proj) {
      var c = { id: newId('cn_') };
      if (kind === 'before') { c.type = 'before'; c.a = s.id; c.b = otherId; }
      else if (kind === 'after') { c.type = 'before'; c.a = otherId; c.b = s.id; }
      else if (kind === 'same-time') { c.type = 'same-time'; c.a = s.id; c.b = otherId; }
      else { // n-after: "after X" stores as {type:'before', a:X, b:this} + offset
        var n = parseInt(offsetVal.value, 10);
        var mult = offsetUnit.value === 'hr' ? 60 : offsetUnit.value === 'days' ? 1440 : 1;
        c.type = 'offset';
        c.a = otherId;
        c.b = s.id;
        c.offsetMin = (Number.isInteger(n) && n > 0) ? n * mult : 1;
      }
      proj.constraints.push(c);
    });
    onDone();
  });

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn small';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', onDone);

  row.appendChild(typeSelect);
  row.appendChild(sceneSelect);
  row.appendChild(offsetVal);
  row.appendChild(offsetUnit);
  row.appendChild(addBtn);
  row.appendChild(cancelBtn);
  return row;
}

/* ==================================================================
   9. Reveals / Requires chip lists (§11.9)
   ================================================================== */

function _buildRevealChips(labelText, s, field) {
  var group = document.createElement('div');
  group.className = 'chipGroup';
  var lab = document.createElement('div');
  lab.className = 'inspLabel';
  lab.textContent = labelText;
  group.appendChild(lab);

  var chipsWrap = document.createElement('div');
  chipsWrap.className = 'chipList';
  (s[field] || []).forEach(function (rvId) {
    var rv = P.reveals.find(function (r) { return r.id === rvId; });
    var chip = document.createElement('span');
    chip.className = 'chip revealChip';
    var txt = document.createElement('span');
    txt.textContent = rv ? rv.label : '(deleted)';
    chip.appendChild(txt);
    var x = document.createElement('button');
    x.className = 'chipX';
    x.textContent = '✕';
    x.addEventListener('click', function () {
      commit('Remove ' + labelText.toLowerCase() + ' chip', function (proj) {
        var sc = proj.scenes.find(function (x2) { return x2.id === s.id; });
        if (sc) sc[field] = (sc[field] || []).filter(function (id) { return id !== rvId; });
      });
    });
    chip.appendChild(x);
    chipsWrap.appendChild(chip);
  });
  group.appendChild(chipsWrap);

  var comboWrap = document.createElement('div');
  comboWrap.className = 'revealCombo';
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add ' + labelText.toLowerCase().replace(/s$/, '') + '…';
  var dropdown = document.createElement('div');
  dropdown.className = 'revealDropdown';
  dropdown.hidden = true;

  function closeDropdown() { dropdown.hidden = true; dropdown.textContent = ''; }

  function addRevealById(rvId) {
    commit('Add ' + labelText.toLowerCase() + ' chip', function (proj) {
      var sc = proj.scenes.find(function (x2) { return x2.id === s.id; });
      if (!sc) return;
      var arr = sc[field] || (sc[field] = []);
      if (arr.indexOf(rvId) === -1) arr.push(rvId);
    });
    input.value = '';
    closeDropdown();
  }

  function createAndAdd(label) {
    var newRvId = null;
    commit('Create reveal', function (proj) {
      var rv = { id: newId('rv_'), label: label };
      proj.reveals.push(rv);
      newRvId = rv.id;
      var sc = proj.scenes.find(function (x2) { return x2.id === s.id; });
      if (sc) (sc[field] || (sc[field] = [])).push(rv.id);
    });
    input.value = '';
    closeDropdown();
  }

  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    dropdown.textContent = '';
    if (!q) { closeDropdown(); return; }
    var matches = P.reveals.filter(function (r) { return r.label.toLowerCase().indexOf(q) !== -1; }).slice(0, 6);
    if (!matches.length) { closeDropdown(); return; }
    matches.forEach(function (r) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'revealDropdownItem';
      item.textContent = r.label;
      item.addEventListener('mousedown', function (e) { e.preventDefault(); addRevealById(r.id); });
      dropdown.appendChild(item);
    });
    dropdown.hidden = false;
  });
  input.addEventListener('keydown', function (e) {
    if (e.code !== 'Enter') return;
    e.preventDefault();
    var val = input.value.trim();
    if (!val) return;
    var exact = P.reveals.find(function (r) { return r.label.toLowerCase() === val.toLowerCase(); });
    if (exact) addRevealById(exact.id); else createAndAdd(val);
  });
  input.addEventListener('blur', function () { setTimeout(closeDropdown, 150); });

  comboWrap.appendChild(input);
  comboWrap.appendChild(dropdown);
  group.appendChild(comboWrap);

  return group;
}

/* ==================================================================
   Duplicate scene (§11.10, §4.3) — inserts the copy directly after the original in
   BOTH orders. Constraints reference scene ids and are intentionally NOT copied
   (the spec's "copies everything" is about the scene's own fields).
   ================================================================== */

function duplicateSceneInPlace(proj, sceneId) {
  var orig = proj.scenes.find(function (x) { return x.id === sceneId; });
  if (!orig) return null;
  var copy = JSON.parse(JSON.stringify(orig));
  copy.id = newId('sc_');
  copy.title = orig.title + ' (copy)';
  proj.scenes.push(copy);

  var ci = proj.chronOrder.indexOf(sceneId);
  proj.chronOrder.splice(ci === -1 ? proj.chronOrder.length : ci + 1, 0, copy.id);

  if (!copy.offscreen) {
    var mi = proj.msOrder.indexOf(sceneId);
    proj.msOrder.splice(mi === -1 ? proj.msOrder.length : mi + 1, 0, copy.id);
  }
  return copy.id;
}

/* ==================================================================
   "+ Scene" (§10.4) — creates at the END of both orders, storyline = first storyline,
   title = "Untitled scene"; caller then selects it with focusTitle:true.
   ================================================================== */

function addSceneAtEnd() {
  if (!P || !P.storylines.length) return null;
  var newIdVal = null;
  commit('Add scene', function (proj) {
    var sc = makeScene({ storylineId: proj.storylines[0].id });
    proj.scenes.push(sc);
    proj.chronOrder.push(sc.id);
    proj.msOrder.push(sc.id);
    newIdVal = sc.id;
  });
  return newIdVal;
}

function addSceneAndFocus() {
  var id = addSceneAtEnd();
  if (id) selectScene(id, { focusTitle: true });
}

/* ==================================================================
   Project-level lists (no selection) — storylines / characters / locations / reveals,
   each add/rename/delete. Storyline reordering uses simple up/down buttons rather than
   drag: bolting a second, independently-scoped drag system (lane reorder, distinct from
   the existing chron/manuscript scene drag in chron.js/manuscript.js) onto this
   milestone risked exactly the kind of stray-class/no-dataset bug flagged from M5,
   for a reorder action used rarely enough that buttons are a fine trade.
   ================================================================== */

function renderProjectLists(body) {
  body.appendChild(_buildStorylineList());
  body.appendChild(_buildSimpleList('Characters', P.characters, deleteCharacterCascade, 'New character…', function (name) { return { id: newId('ch_'), name: name }; }, 'name'));
  body.appendChild(_buildSimpleList('Locations', P.locations, deleteLocationCascade, 'New location…', function (name) { return { id: newId('lo_'), name: name }; }, 'name'));
  body.appendChild(_buildSimpleList('Reveals', P.reveals, deleteRevealCascade, 'New reveal…', function (name) { return { id: newId('rv_'), label: name }; }, 'label'));
}

function _buildStorylineList() {
  var group = document.createElement('div');
  group.className = 'projListGroup';
  var lab = document.createElement('div');
  lab.className = 'inspLabel';
  lab.textContent = 'Storylines';
  group.appendChild(lab);

  var list = document.createElement('div');
  list.className = 'projList';
  P.storylines.forEach(function (st, i) {
    var row = document.createElement('div');
    row.className = 'projListRow';

    var sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = slColor(st.paletteIndex);
    row.appendChild(sw);

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = st.name;
    nameInput.addEventListener('blur', function () {
      var val = nameInput.value.trim();
      if (!val || val === st.name) { nameInput.value = st.name; return; }
      commit('Rename storyline', function (proj) {
        var s2 = proj.storylines.find(function (x) { return x.id === st.id; });
        if (s2) s2.name = val;
      });
    });
    row.appendChild(nameInput);

    var upBtn = document.createElement('button');
    upBtn.className = 'iconbtn small';
    upBtn.textContent = '↑';
    upBtn.disabled = (i === 0);
    upBtn.addEventListener('click', function () {
      commit('Reorder storylines', function (proj) {
        var arr = proj.storylines;
        var idx = arr.findIndex(function (x) { return x.id === st.id; });
        if (idx > 0) { var tmp = arr[idx - 1]; arr[idx - 1] = arr[idx]; arr[idx] = tmp; }
      });
    });
    row.appendChild(upBtn);

    var downBtn = document.createElement('button');
    downBtn.className = 'iconbtn small';
    downBtn.textContent = '↓';
    downBtn.disabled = (i === P.storylines.length - 1);
    downBtn.addEventListener('click', function () {
      commit('Reorder storylines', function (proj) {
        var arr = proj.storylines;
        var idx = arr.findIndex(function (x) { return x.id === st.id; });
        if (idx !== -1 && idx < arr.length - 1) { var tmp = arr[idx + 1]; arr[idx + 1] = arr[idx]; arr[idx] = tmp; }
      });
    });
    row.appendChild(downBtn);

    var delBtn = document.createElement('button');
    delBtn.className = 'chipX';
    delBtn.textContent = '✕';
    delBtn.disabled = P.storylines.length < 2;
    delBtn.title = P.storylines.length < 2 ? 'At least one storyline is required' : 'Delete storyline';
    delBtn.addEventListener('click', function () {
      if (P.storylines.length < 2) return;
      var remaining = P.storylines.filter(function (x) { return x.id !== st.id; });
      var newHome = remaining[0];
      showConfirm({
        title: 'Delete storyline',
        message: 'Delete "' + st.name + '"? Its scenes will be reassigned to "' + newHome.name + '", and it will be removed from every scene’s "Also part of" list.',
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: function () {
          commit('Delete storyline', function (proj) { deleteStorylineCascade(proj, st.id); });
        }
      });
    });
    row.appendChild(delBtn);

    list.appendChild(row);
  });
  group.appendChild(list);

  var addBtn = document.createElement('button');
  addBtn.className = 'btn small';
  addBtn.textContent = '+ Storyline';
  addBtn.addEventListener('click', function () {
    commit('Add storyline', function (proj) {
      proj.storylines.push({ id: newId('st_'), name: 'New storyline', paletteIndex: proj.storylines.length % 10 });
    });
  });
  group.appendChild(addBtn);

  return group;
}

/* Shared builder for the three flat add/rename/delete lists (characters/locations/reveals).
   `nameField` is 'name' for characters/locations, 'label' for reveals. */
function _buildSimpleList(title, items, onDelete, placeholder, makeNew, nameField) {
  var group = document.createElement('div');
  group.className = 'projListGroup';
  var lab = document.createElement('div');
  lab.className = 'inspLabel';
  lab.textContent = title;
  group.appendChild(lab);

  var list = document.createElement('div');
  list.className = 'projList';
  items.forEach(function (item) {
    var row = document.createElement('div');
    row.className = 'projListRow';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item[nameField];
    nameInput.addEventListener('blur', function () {
      var val = nameInput.value.trim();
      if (!val || val === item[nameField]) { nameInput.value = item[nameField]; return; }
      commit('Rename ' + title.toLowerCase().replace(/s$/, ''), function (proj) {
        var arr = title === 'Characters' ? proj.characters : title === 'Locations' ? proj.locations : proj.reveals;
        var it = arr.find(function (x) { return x.id === item.id; });
        if (it) it[nameField] = val;
      });
    });
    row.appendChild(nameInput);

    var delBtn = document.createElement('button');
    delBtn.className = 'chipX';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', function () {
      showConfirm({
        title: 'Delete ' + title.toLowerCase().replace(/s$/, ''),
        message: 'Delete "' + item[nameField] + '"? It will be removed from every scene that references it.',
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: function () { onDelete(item.id); }
      });
    });
    row.appendChild(delBtn);

    list.appendChild(row);
  });
  group.appendChild(list);

  group.appendChild(_buildInlineAddRow(placeholder, function (name) {
    commit('Add ' + title.toLowerCase().replace(/s$/, ''), function (proj) {
      var arr = title === 'Characters' ? proj.characters : title === 'Locations' ? proj.locations : proj.reveals;
      arr.push(makeNew(name));
    });
  }));

  return group;
}

/* ---------------- delete cascades (§4.3) ----------------
   deleteStorylineCascade takes an explicit `proj` because its caller wraps it in its
   OWN commit() (it needs to run inside the same commit as the confirm-triggered
   mutation). The other three commit for themselves since nothing else needs to share
   their commit. */

function deleteStorylineCascade(proj, stId) {
  if (proj.storylines.length < 2) return;
  var remaining = proj.storylines.filter(function (x) { return x.id !== stId; });
  var newHomeId = remaining[0].id;
  proj.storylines = remaining;
  proj.scenes.forEach(function (sc) {
    if (sc.storylineId === stId) sc.storylineId = newHomeId;
    sc.alsoStorylineIds = (sc.alsoStorylineIds || []).filter(function (id) { return id !== stId; });
  });
}

function deleteCharacterCascade(chId) {
  commit('Delete character', function (proj) {
    proj.characters = proj.characters.filter(function (c) { return c.id !== chId; });
    proj.scenes.forEach(function (sc) {
      sc.characterIds = (sc.characterIds || []).filter(function (id) { return id !== chId; });
    });
  });
}

function deleteLocationCascade(loId) {
  commit('Delete location', function (proj) {
    proj.locations = proj.locations.filter(function (l) { return l.id !== loId; });
    proj.scenes.forEach(function (sc) { if (sc.locationId === loId) sc.locationId = null; });
  });
}

function deleteRevealCascade(rvId) {
  commit('Delete reveal', function (proj) {
    proj.reveals = proj.reveals.filter(function (r) { return r.id !== rvId; });
    proj.scenes.forEach(function (sc) {
      sc.reveals = (sc.reveals || []).filter(function (id) { return id !== rvId; });
      sc.requires = (sc.requires || []).filter(function (id) { return id !== rvId; });
    });
  });
}
