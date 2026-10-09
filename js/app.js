/* =========================================================
   Overflow Lab — tab switching and bootstrap
   ========================================================= */
(function () {
  'use strict';

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));

  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.dataset.panel).hidden = !on;
    });
    if (window.IntegerLesson && tab.dataset.panel !== 'panel-int') {
      window.IntegerLesson.stop();          // don't leave the odometer running
    }
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { select(tab); });
    tab.addEventListener('keydown', function (e) {
      var next = null;
      if (e.key === 'ArrowRight') { next = tabs[(i + 1) % tabs.length]; }
      if (e.key === 'ArrowLeft') { next = tabs[(i - 1 + tabs.length) % tabs.length]; }
      if (next) { e.preventDefault(); select(next); next.focus(); }
    });
  });

  window.StackLesson.init();
  window.IntegerLesson.init();

  function applyHash() {
    var params = Util.hashParams();
    if (params.lesson === '2' || params.scenario) { select(document.getElementById('tab-int')); }
    else if (params.lesson === '1' || params.preset) { select(document.getElementById('tab-stack')); }
    window.StackLesson.applyParams(params);
    window.IntegerLesson.applyParams(params);
  }

  applyHash();
  window.addEventListener('hashchange', applyHash);
})();
