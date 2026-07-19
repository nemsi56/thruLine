// wires.js — SVG mapping overlay between chronology and manuscript (§9), plus the
// shared cross-view hover mechanism (§10.1) since redrawing the hovered scene's wire
// is the reason hover needs to be shared in the first place.
'use strict';

var SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------------- cross-view hover linking (§10.1) ----------------
   mouseenter on a card (either view) adds .hi to BOTH of that scene's cards, sets
   `hovering` on <body> (dims non-.hi cards via CSS already in styles.css from M3),
   and redraws wires so the hovered scene's wire highlights too. Called by chron.js's
   card listeners and manuscript.js's card listeners — logic lives in exactly one place. */
function highlightScene(sceneId, on) {
  if (_dragActive) return;
  document.body.classList.toggle('hovering', on);
  document.querySelectorAll('[data-scene-id="' + sceneId + '"]').forEach(function (el) {
    el.classList.toggle('hi', on);
  });
  redrawWires();
}

function clearHighlight() {
  document.body.classList.remove('hovering');
  document.querySelectorAll('.hi').forEach(function (el) { el.classList.remove('hi'); });
  redrawWires();
}

/* ---------------- mapping wires (§9) ---------------- */

function redrawWires() {
  var svg = document.getElementById('wires');
  var stage = document.getElementById('stage');
  if (!svg || !stage || !P) return;

  // CRITICAL: <svg> is a CSS replaced element — position:absolute;inset:0 alone does
  // NOT stretch it to fill the stage; without explicit sizing it falls back to the
  // browser's 300x150 default and silently clips everything beyond that (hit once
  // already in M3's chronThreadSvg). Set explicit attributes on every redraw so the
  // SVG's own coordinate system always matches the stage's actual rendered size,
  // robust against divider drags / panel collapse / window resize.
  svg.setAttribute('width', stage.clientWidth);
  svg.setAttribute('height', stage.clientHeight);

  svg.textContent = '';
  if (!stage.clientWidth || !stage.clientHeight) return;

  var stageRect = stage.getBoundingClientRect();
  var hoveredEl = document.querySelector('.scene.hi, .msCard.hi');
  var hoveredId = hoveredEl ? hoveredEl.dataset.sceneId : null;
  var hovering = document.body.classList.contains('hovering');

  var storylineById = {};
  P.storylines.forEach(function (st) { storylineById[st.id] = st; });

  P.scenes.forEach(function (s) {
    if (s.offscreen) return; // offscreen scenes have no manuscript position (§4.3)
    var chronEl = document.querySelector('.scene[data-scene-id="' + s.id + '"]');
    var msEl = document.querySelector('.msCard[data-scene-id="' + s.id + '"]');
    if (!chronEl || !msEl) return;

    var ar = chronEl.getBoundingClientRect();
    var br = msEl.getBoundingClientRect();
    var ax = ar.left + ar.width / 2 - stageRect.left;
    var ay = ar.bottom - stageRect.top;
    var bx = br.left + br.width / 2 - stageRect.left;
    var by = br.top - stageRect.top;
    var dy = Math.max(40, (by - ay) / 2);

    var st = storylineById[s.storylineId];
    var color = st ? slColor(st.paletteIndex) : 'var(--faint)';
    var isHi = hovering && s.id === hoveredId;
    var opacity = 0.5, width = 1.6;
    if (hovering) opacity = isHi ? 1 : 0.08;
    if (isHi) width = 2.6;
    // Conflict flag-mode dimming (§9's --red / opacity .06 branch) is a later
    // milestone — conflicts.js doesn't exist yet, so only the hover branch is built.

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d',
      'M ' + ax + ' ' + ay +
      ' C ' + ax + ' ' + (ay + dy) + ', ' + bx + ' ' + (by - dy) + ', ' + bx + ' ' + by);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', width);
    path.setAttribute('opacity', opacity);
    svg.appendChild(path);
  });
}

window.addEventListener('resize', redrawWires);

/* §7.6: both strips' scroll events must trigger redrawWires(), throttled via
   requestAnimationFrame (same pattern as the ResizeObserver throttle on #stage in
   editor-init.js, but rAF instead of a timeout since scroll fires much more often). */
var _wiresScrollRafPending = false;
function _onStripScroll() {
  if (_wiresScrollRafPending) return;
  _wiresScrollRafPending = true;
  requestAnimationFrame(function () {
    _wiresScrollRafPending = false;
    redrawWires();
  });
}
function initWireScrollListeners() {
  var chronScroll = document.getElementById('chronScroll');
  var msScroll = document.getElementById('msScroll');
  if (chronScroll) chronScroll.addEventListener('scroll', _onStripScroll);
  if (msScroll) msScroll.addEventListener('scroll', _onStripScroll);
}

/* §7.6 counterpart auto-scroll: when a scene is selected, if its card in a strip is
   outside that strip's viewport, smooth-scroll that strip to center it. Checked for
   BOTH strips (not just "the other one") since selectScene() doesn't know which strip
   originated the click — the originating card is normally already in view, so this is
   a no-op there and only the actual counterpart moves. */
function scrollCounterpartIntoView(sceneId) {
  _scrollCardIntoView(document.getElementById('chronScroll'),
    document.querySelector('.scene[data-scene-id="' + sceneId + '"]'));
  _scrollCardIntoView(document.getElementById('msScroll'),
    document.querySelector('.msCard[data-scene-id="' + sceneId + '"]'));
}

function _scrollCardIntoView(scrollEl, cardEl) {
  if (!scrollEl || !cardEl) return;
  var sr = scrollEl.getBoundingClientRect();
  var cr = cardEl.getBoundingClientRect();
  if (cr.left >= sr.left && cr.right <= sr.right) return; // already fully in view
  var cardCenter = cardEl.offsetLeft + cardEl.offsetWidth / 2;
  var target = cardCenter - scrollEl.clientWidth / 2;
  var maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
  target = Math.max(0, Math.min(maxScroll, target));
  scrollEl.scrollTo({ left: target, behavior: 'smooth' });
}
