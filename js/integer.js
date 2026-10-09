/* =========================================================
   Overflow Lab — Lesson 2: integer / arithmetic overflow
   ---------------------------------------------------------
   All arithmetic is done with BigInt so that 64-bit values
   are exact, then deliberately truncated to the chosen
   width to show what a fixed-width C type would store.
   ========================================================= */
(function (global) {
  'use strict';

  var $ = Util.$;
  var el = Util.el;
  var clear = Util.clear;
  var Int = Util.Int;

  var SLIDER_STEPS = 1000;
  var MAX_LOST_BITS = 48;          // keep the bit strip readable
  var DST_CAPACITY = 256n;         // char dst[256] in scenario D

  var S = {
    bits: 32,
    signed: true,
    scenario: 'explore',
    a: 2000000000n,
    b: 2000000000n,
    op: '+',
    odo: { value: 0n, step: 1n, wraps: 0, timer: null },
    alloc: { count: 16n, elem: 16n },
    su: { len: -1n },
    syncing: false
  };

  /* ---------- slider <-> BigInt mapping ---------- */

  function posToValue(pos, lo, hi) {
    return lo + ((hi - lo) * BigInt(pos)) / BigInt(SLIDER_STEPS);
  }

  function valueToPos(value, lo, hi) {
    if (hi === lo) { return 0; }
    var v = Int.clamp(value, lo, hi);
    return Number(((v - lo) * BigInt(SLIDER_STEPS)) / (hi - lo));
  }

  function typeName() { return Int.typeName(S.bits, S.signed); }
  function lo() { return Int.min(S.bits, S.signed); }
  function hi() { return Int.max(S.bits, S.signed); }

  /* =========================================================
     Scenario A — explore
     ========================================================= */

  function bitLength(value) {
    if (value === 0n) { return 1; }
    var v = value < 0n ? -value : value;
    return v.toString(2).length;
  }

  /** How many extra bits to draw above the type width so the overflow is visible. */
  function extraBitsFor(exact, bits, overflowed) {
    if (!overflowed) { return 0; }
    var need = bitLength(exact) + 1 - bits;      // +1 leaves room for a sign bit
    return Math.min(MAX_LOST_BITS, Math.max(8, need));
  }

  function shiftAmount(b) {
    if (b < 0n) { return 0n; }
    return b > 128n ? 128n : b;
  }

  function updateExplore() {
    var a = S.a, b = S.b, op = S.op;
    var effB = op === '<<' ? shiftAmount(b) : b;
    var exact = Int.exact(a, op, effB);
    var stored = Int.wrap(exact, S.bits, S.signed);
    var other = Int.wrap(exact, S.bits, !S.signed);
    var overflowed = exact !== stored;

    $('int-true').textContent = Util.commas(exact);
    $('int-stored').textContent = Util.commas(stored);
    $('int-other-label').textContent = S.signed ? 'unsigned' : 'signed';
    $('int-other').textContent = Util.commas(other) + '  (' + Util.hexN(stored, S.bits) + ')';

    var extra = extraBitsFor(exact, S.bits, overflowed);
    var discarded = exact >= 0n ? exact >> BigInt(S.bits) : -1n;
    var lostText;
    if (!overflowed) {
      lostText = 'none';
    } else if (exact < 0n) {
      lostText = 'nothing discarded — the value borrowed below 0 and re-entered from the top';
    } else if (discarded > 0n) {
      lostText = bitLength(exact) - S.bits + ' high bit' + (bitLength(exact) - S.bits === 1 ? '' : 's') +
        ' thrown away (' + Util.hexN(discarded, 16) + ')';
    } else {
      lostText = 'no bits discarded — the top bit is now read as the sign bit';
    }
    $('int-lost').textContent = lostText;

    /* bit strip — every row gets the same number of columns so the bits line up */
    var total = S.bits + extra;
    var box = clear($('int-bits'));
    Util.renderBitRow(box, { label: 'a', valueText: Util.commas(a), value: a, bits: S.bits, totalBits: total, markSign: S.signed });
    if (op !== '<<') {
      Util.renderBitRow(box, { label: 'b', valueText: Util.commas(b), value: b, bits: S.bits, totalBits: total, markSign: S.signed });
    }
    Util.renderBitRow(box, {
      label: 'a ' + op + ' b — the true result',
      valueText: Util.commas(exact),
      value: exact, bits: S.bits, totalBits: total, markSign: S.signed, highlightLost: true
    });
    Util.renderBitRow(box, {
      label: 'what ' + typeName() + ' actually stores',
      valueText: Util.commas(stored),
      value: stored, bits: S.bits, totalBits: total, markSign: S.signed
    });

    /* banner */
    var banner = $('int-banner');
    banner.className = 'banner ' + (overflowed ? 'bad' : 'ok');
    if (!overflowed) {
      banner.innerHTML = 'No overflow. ' + Util.commas(exact) + ' fits comfortably inside <code>' + typeName() + '</code>.';
    } else if (S.signed) {
      banner.innerHTML = '<b>Signed overflow.</b> The true answer ' + Util.commas(exact) +
        ' does not fit, so the stored value is ' + Util.commas(stored) +
        '. In C this is <b>undefined behaviour</b> — the compiler is allowed to assume it never happens, which is why checks like <code>if (a + b &lt; a)</code> can be optimised away.';
    } else {
      banner.innerHTML = '<b>Unsigned wraparound.</b> The result is reduced modulo 2<sup>' + S.bits + '</sup>, giving ' +
        Util.commas(stored) + '. This is well-defined in C — and still a bug whenever the code assumed the number could only grow.';
    }

    drawDial(a, exact, stored);
  }

  /* ---------- the wrap-around dial ---------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function polar(cx, cy, r, deg) {
    var rad = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  function angleOf(value) {
    var span = 1n << BigInt(S.bits);
    var pattern = Int.pattern(value, S.bits);
    // Use floating point only for drawing; precision here is cosmetic.
    return Number(pattern * 100000n / span) / 100000 * 360;
  }

  function arcPath(cx, cy, r, a0, a1) {
    var sweep = a1 >= a0 ? 1 : 0;
    var delta = Math.abs(a1 - a0);
    var large = delta > 180 ? 1 : 0;
    var p0 = polar(cx, cy, r, a0);
    var p1 = polar(cx, cy, r, a1);
    return 'M ' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
      ' A ' + r + ' ' + r + ' 0 ' + large + ' ' + sweep + ' ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }

  function dialLabel(root, cx, cy, r, deg, text, cls) {
    var pt = polar(cx, cy, r, deg);
    var t = svg('text', {
      x: pt[0].toFixed(1), y: pt[1].toFixed(1),
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': '10', 'font-family': 'monospace',
      fill: cls === 'danger' ? '#ff9aa6' : '#9aa8c4'
    });
    t.textContent = text;
    root.appendChild(t);
  }

  function drawDial(a, exact, stored) {
    var root = clear($('int-dial'));
    var cx = 160, cy = 160, r = 100;

    root.appendChild(svg('circle', { cx: cx, cy: cy, r: r, fill: 'none', stroke: '#2c3a5c', 'stroke-width': '14' }));

    // The seam: where the bit pattern rolls over and the value jumps.
    var seam = S.signed ? 180 : 0;
    var seamPath = svg('path', {
      d: arcPath(cx, cy, r, seam - 4, seam + 4),
      fill: 'none', stroke: '#ef5a6b', 'stroke-width': '14'
    });
    root.appendChild(seamPath);

    // travel arc
    var aAng = angleOf(a);
    var rAng = angleOf(stored);
    var clockwise = exact >= a;
    var sweepAng = clockwise
      ? (rAng >= aAng ? rAng : rAng + 360)
      : (rAng <= aAng ? rAng : rAng - 360);
    root.appendChild(svg('path', {
      d: arcPath(cx, cy, r - 22, aAng, sweepAng),
      fill: 'none', stroke: '#7bd8ff', 'stroke-width': '3',
      'stroke-linecap': 'round', 'stroke-dasharray': '5 4', opacity: '.85'
    }));

    // markers
    var aPt = polar(cx, cy, r, aAng);
    root.appendChild(svg('circle', { cx: aPt[0].toFixed(2), cy: aPt[1].toFixed(2), r: '6', fill: '#4da3ff', stroke: '#0b101c', 'stroke-width': '2' }));
    var rPt = polar(cx, cy, r, rAng);
    root.appendChild(svg('circle', {
      cx: rPt[0].toFixed(2), cy: rPt[1].toFixed(2), r: '7',
      fill: exact === stored ? '#3fbf7f' : '#ef5a6b', stroke: '#0b101c', 'stroke-width': '2'
    }));

    // labels and ticks around the rim
    var marks = S.signed
      ? [[0, '0', ''], [90, 'MAX/2', ''], [180, 'MAX ⇄ MIN', 'danger'], [270, 'MIN/2', '']]
      : [[0, '0 ⇄ UMAX', 'danger'], [90, 'UMAX/4', ''], [180, 'UMAX/2', ''], [270, '3·UMAX/4', '']];

    marks.forEach(function (m) {
      var p0 = polar(cx, cy, r - 9, m[0]);
      var p1 = polar(cx, cy, r + 9, m[0]);
      root.appendChild(svg('line', {
        x1: p0[0].toFixed(2), y1: p0[1].toFixed(2), x2: p1[0].toFixed(2), y2: p1[1].toFixed(2),
        stroke: m[2] === 'danger' ? '#ef5a6b' : '#55658c', 'stroke-width': '2'
      }));
      dialLabel(root, cx, cy, r + 24, m[0], m[1], m[2]);
    });

    // centre readout
    var c1 = svg('text', { x: cx, y: cy - 8, 'text-anchor': 'middle', 'font-size': '13', 'font-family': 'monospace', fill: '#9aa8c4' });
    c1.textContent = 'result';
    root.appendChild(c1);
    var storedText = Util.commas(stored);
    var c2 = svg('text', {
      x: cx, y: cy + 14, 'text-anchor': 'middle',
      'font-size': storedText.length > 16 ? '11' : storedText.length > 11 ? '13' : '16',
      'font-family': 'monospace', fill: exact === stored ? '#3fbf7f' : '#ef5a6b'
    });
    c2.textContent = storedText;
    root.appendChild(c2);

    var note = svg('text', { x: cx, y: cy + 36, 'text-anchor': 'middle', 'font-size': '10', 'font-family': 'monospace', fill: '#6b7897' });
    note.textContent = exact === stored ? 'stayed on the dial' : 'crossed the red seam';
    root.appendChild(note);
  }

  /* =========================================================
     Scenario B — odometer
     ========================================================= */

  function odoStop() {
    if (S.odo.timer) { clearInterval(S.odo.timer); S.odo.timer = null; }
    $('odo-play').textContent = '▶ Auto-count';
  }

  function odoTick() {
    var before = S.odo.value;
    var next = before + S.odo.step;
    var stored = Int.wrap(next, S.bits, S.signed);
    if (stored !== next) { S.odo.wraps++; }
    S.odo.value = stored;
    updateOdometer(stored !== next);
  }

  function updateOdometer(justWrapped) {
    var v = S.odo.value;
    var max = hi();

    var valueNode = $('odo-value');
    valueNode.textContent = Util.commas(v);
    valueNode.classList.toggle('wrapped', !!justWrapped);

    var span = (1n << BigInt(S.bits));
    var pct = Number(Int.pattern(v, S.bits) * 10000n / span) / 100;
    $('odo-fill').style.width = pct.toFixed(2) + '%';

    $('odo-wraps').textContent = String(S.odo.wraps);
    var remaining = max - v;
    $('odo-remaining').textContent = remaining >= 0n
      ? Util.commas(remaining) + ' more'
      : 'past the top';

    $('odo-step-code').textContent = S.odo.step.toString();
    $('odo-type-code').textContent = typeName();
    $('odo-step-label').textContent = '+' + S.odo.step.toString();

    var banner = $('odo-banner');
    if (justWrapped) {
      banner.className = 'banner bad';
      banner.innerHTML = S.signed
        ? '<b>It wrapped.</b> The counter passed ' + Util.commas(max) + ' and reappeared at ' + Util.commas(v) +
          ' — a <b>negative</b> number. Any later <code>if (counter &gt; 0)</code> check now fails.'
        : '<b>It wrapped.</b> The counter passed ' + Util.commas(max) + ' and restarted near ' + Util.commas(v) +
          '. Modulo 2<sup>' + S.bits + '</sup> arithmetic, exactly as the C standard says.';
    } else if (remaining >= 0n && remaining < (S.odo.step * 8n)) {
      banner.className = 'banner warn';
      banner.innerHTML = 'Close to the edge: only ' + Util.commas(remaining) + ' left before <code>' + typeName() + '</code> runs out of room.';
    } else {
      banner.className = 'banner';
      banner.textContent = 'Counting normally.';
    }

    var box = clear($('odo-bits'));
    var nextValue = Int.wrap(v + S.odo.step, S.bits, S.signed);
    Util.renderBitRow(box, { label: typeName() + ' counter', valueText: Util.hexN(v, S.bits), value: v, bits: S.bits, markSign: S.signed });
    Util.renderBitRow(box, { label: 'after one more step (+' + S.odo.step + ')', valueText: Util.commas(nextValue), value: nextValue, bits: S.bits, markSign: S.signed });
  }

  /* =========================================================
     Scenario C — allocation size overflow
     ========================================================= */

  function updateAlloc() {
    var bits = S.bits;
    var elem = S.alloc.elem;
    var count = Int.clamp(S.alloc.count, 0n, Int.max(bits, false));

    var exact = count * elem;                       // what the programmer meant
    var passed = Int.wrap(exact, bits, false);      // what size_t actually holds
    var written = exact;                            // the loop writes count items
    var spill = written > passed ? written - passed : 0n;

    $('alloc-count-code').textContent = count.toString();
    $('alloc-elem-code').textContent = elem.toString();
    $('alloc-elem-label').textContent = elem.toString();
    $('alloc-type-code').textContent = 'uint' + bits + '_t';
    $('alloc-type-code2').textContent = 'uint' + bits + '_t';

    $('alloc-exact').textContent = Util.commas(exact) + '  (' + Util.bytes(exact) + ')';
    $('alloc-passed').textContent = Util.commas(passed) + '  (' + Util.bytes(passed) + ')';
    $('alloc-written').textContent = Util.commas(written) + '  (' + Util.bytes(written) + ')';
    $('alloc-overflow').textContent = spill > 0n ? Util.commas(spill) + '  (' + Util.bytes(spill) + ')' : '0';

    var banner = $('alloc-banner');
    if (spill > 0n) {
      banner.className = 'banner bad';
      banner.innerHTML = '<b>Heap overflow.</b> <code>count * sizeof(Item)</code> needed ' + (exact.toString(2).length) +
        ' bits but <code>size_t</code> here is ' + bits + ' bits, so <code>malloc</code> was handed ' + Util.commas(passed) +
        ' instead of ' + Util.commas(exact) + '. The allocation succeeds, looks fine, and then the loop writes ' +
        Util.bytes(spill) + ' past the end of the chunk.';
    } else if (count === 0n) {
      banner.className = 'banner warn';
      banner.innerHTML = 'A count of 0 asks <code>malloc(0)</code>, which may legally return a non-NULL pointer to zero usable bytes. Another classic footgun.';
    } else {
      banner.className = 'banner ok';
      banner.innerHTML = 'No overflow: ' + Util.commas(count) + ' × ' + elem + ' = ' + Util.commas(exact) +
        ' bytes, which fits in a ' + bits + '-bit <code>size_t</code>. The allocation matches what the loop writes.';
    }

    // heap strip: allocated vs spill, proportional but always visible
    var totalBar = written > 0n ? written : 1n;
    var allocPct = Number(passed * 1000n / totalBar) / 10;
    allocPct = Math.max(1, Math.min(100, allocPct));
    $('alloc-block').style.width = allocPct + '%';
    $('alloc-spill').style.width = (100 - allocPct) + '%';
    $('alloc-block').firstChild.textContent = Util.bytes(passed) + ' allocated';
    $('alloc-spill').firstChild.textContent = spill > 0n ? Util.bytes(spill) + ' written past the end' : '';
  }

  function allocSliderBounds() {
    // Let the slider sweep a bit past the point where count * elem wraps.
    var umax = Int.max(S.bits, false);
    var wrapPoint = (umax + 1n) / S.alloc.elem;
    var top = wrapPoint + wrapPoint / 5n + 8n;
    return top > umax ? umax : top;
  }

  /* =========================================================
     Scenario D — signed/unsigned confusion
     ========================================================= */

  function updateSigned() {
    var len = Int.wrap(S.su.len, S.bits, true);
    var asSizeT = Int.pattern(len, 64);          // size_t is 64-bit here

    $('su-type').textContent = Int.typeName(S.bits, true);

    var trace = clear($('su-trace'));
    function step(html, cls) {
      var li = el('li', cls || '');
      li.innerHTML = html;
      trace.appendChild(li);
    }

    step('The caller hands in <b>len = ' + Util.commas(len) + '</b>, a signed <code>' + Int.typeName(S.bits, true) + '</code>.');

    var rejected = len > DST_CAPACITY;
    if (rejected) {
      step('<code>len &gt; 256</code> is <b>true</b> → the function returns early.', 't-ok');
      step('Nothing is copied. The check did its job.', 't-ok');
    } else {
      step('<code>len &gt; 256</code> is <b>false</b> (signed comparison), so the check is passed.', len < 0n ? 't-bad' : '');
      step('<code>memcpy(dst, src, len)</code> converts <code>len</code> to <code>size_t</code>, which is <b>unsigned</b>.');
      step('As a <code>size_t</code> those same bits read as <b>' + Util.commas(asSizeT) + '</b> bytes.', len < 0n ? 't-bad' : '');
    }

    var banner = $('su-banner');
    if (rejected) {
      banner.className = 'banner ok';
      banner.innerHTML = 'Rejected — this is the path the programmer was thinking about.';
    } else if (len < 0n) {
      banner.className = 'banner bad';
      banner.innerHTML = '<b>The check was bypassed.</b> A negative length looked "small" to a signed comparison and then became ' +
        Util.bytes(asSizeT) + ' to <code>memcpy</code>. The copy walks off the end of a 256-byte buffer and keeps going until it hits an unmapped page.';
    } else {
      banner.className = 'banner ok';
      banner.innerHTML = 'Copies ' + Util.commas(len) + ' bytes into a 256-byte buffer. Fine — for now.';
    }

    var box = clear($('su-bits'));
    Util.renderBitRow(box, {
      label: 'as ' + Int.typeName(S.bits, true) + ' (signed)', valueText: Util.commas(len),
      value: len, bits: S.bits, markSign: true
    });
    Util.renderBitRow(box, {
      label: 'same bits as ' + Int.typeName(S.bits, false), valueText: Util.commas(Int.wrap(len, S.bits, false)),
      value: len, bits: S.bits
    });
    Util.renderBitRow(box, {
      label: 'widened to size_t (64-bit)', valueText: Util.commas(asSizeT),
      value: asSizeT, bits: 64
    });
  }

  /* =========================================================
     shared refresh
     ========================================================= */

  function syncRangeInputs() {
    S.syncing = true;

    $('int-a-range').min = 0; $('int-a-range').max = SLIDER_STEPS; $('int-a-range').step = 1;
    $('int-b-range').min = 0; $('int-b-range').max = SLIDER_STEPS; $('int-b-range').step = 1;
    $('int-a-range').value = valueToPos(S.a, lo(), hi());
    $('int-b-range').value = valueToPos(S.b, lo(), hi());
    $('int-a').value = S.a.toString();
    $('int-b').value = S.b.toString();

    var sMin = Int.min(S.bits, true), sMax = Int.max(S.bits, true);
    $('su-len-range').min = 0; $('su-len-range').max = SLIDER_STEPS; $('su-len-range').step = 1;
    $('su-len-range').value = valueToPos(S.su.len, sMin, sMax);
    $('su-len').value = S.su.len.toString();

    $('alloc-count-range').min = 0; $('alloc-count-range').max = SLIDER_STEPS; $('alloc-count-range').step = 1;
    $('alloc-count-range').value = valueToPos(S.alloc.count, 0n, allocSliderBounds());
    $('alloc-count').value = S.alloc.count.toString();
    $('alloc-elem').value = S.alloc.elem.toString();

    S.syncing = false;
  }

  function refresh() {
    // Scenarios C and D pin their own signedness, so the toggle only applies to A and B.
    var fixedSign = S.scenario === 'alloc' || S.scenario === 'signed';
    $('int-signedness').style.display = fixedSign ? 'none' : '';
    if (S.scenario === 'alloc') {
      $('int-range').textContent = 'size_t here is ' + Int.typeName(S.bits, false) + ':  0  …  ' + Util.commas(Int.max(S.bits, false));
    } else if (S.scenario === 'signed') {
      $('int-range').textContent = 'len is ' + Int.typeName(S.bits, true) + ':  ' +
        Util.commas(Int.min(S.bits, true)) + '  …  ' + Util.commas(Int.max(S.bits, true));
    } else {
      $('int-range').textContent = typeName() + ':  ' + Util.commas(lo()) + '  …  ' + Util.commas(hi());
    }

    S.a = Int.clamp(S.a, lo(), hi());
    S.b = Int.clamp(S.b, lo(), hi());
    S.odo.value = Int.wrap(S.odo.value, S.bits, S.signed);
    S.su.len = Int.clamp(S.su.len, Int.min(S.bits, true), Int.max(S.bits, true));
    S.alloc.count = Int.clamp(S.alloc.count, 0n, Int.max(S.bits, false));

    syncRangeInputs();
    updateExplore();
    updateOdometer(false);
    updateAlloc();
    updateSigned();
  }

  function showScenario(name) {
    S.scenario = name;
    odoStop();
    [['explore', 'sc-explore'], ['odometer', 'sc-odometer'], ['alloc', 'sc-alloc'], ['signed', 'sc-signed']]
      .forEach(function (pair) { $(pair[1]).hidden = pair[0] !== name; });
    refresh();
  }

  /* =========================================================
     wiring
     ========================================================= */

  function bindNumber(textId, rangeId, getBounds, apply) {
    var text = $(textId), range = $(rangeId);

    text.addEventListener('change', function () {
      var parsed = Int.parse(text.value);
      if (parsed === null) { refresh(); return; }
      var b = getBounds();
      apply(Int.clamp(parsed, b[0], b[1]));
      refresh();
    });
    text.addEventListener('keydown', function (e) { if (e.key === 'Enter') { text.blur(); } });

    range.addEventListener('input', function () {
      if (S.syncing) { return; }
      var b = getBounds();
      apply(posToValue(Number(range.value), b[0], b[1]));
      refresh();
    });
  }

  function init() {
    /* shared controls */
    $('int-width').addEventListener('change', function () {
      S.bits = Number(this.value);
      S.odo.wraps = 0;
      refresh();
    });

    [$('int-signed'), $('int-unsigned')].forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.signed = this.dataset.mode === 'signed';
        $('int-signed').classList.toggle('seg-active', S.signed);
        $('int-unsigned').classList.toggle('seg-active', !S.signed);
        S.odo.wraps = 0;
        refresh();
      });
    });

    $('int-scenario').addEventListener('change', function () { showScenario(this.value); });

    /* scenario A */
    bindNumber('int-a', 'int-a-range', function () { return [lo(), hi()]; }, function (v) { S.a = v; });
    bindNumber('int-b', 'int-b-range', function () { return [lo(), hi()]; }, function (v) { S.b = v; });
    $('int-op').addEventListener('change', function () { S.op = this.value; refresh(); });

    document.querySelectorAll('#sc-explore [data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var which = this.dataset.preset;
        if (which === 'int-max') { S.a = hi(); S.b = 1n; S.op = '+'; }
        else if (which === 'int-min') { S.a = lo(); S.b = 1n; S.op = '-'; }
        else { S.a = Int.max(S.bits, S.signed) / 3n; S.b = 5n; S.op = '*'; }
        $('int-op').value = S.op;
        refresh();
      });
    });

    /* scenario B */
    $('odo-step').addEventListener('input', function () {
      S.odo.step = BigInt(this.value);
      updateOdometer(false);
    });
    $('odo-tick').addEventListener('click', function () { odoStop(); odoTick(); });
    $('odo-reset').addEventListener('click', function () {
      odoStop(); S.odo.value = 0n; S.odo.wraps = 0; updateOdometer(false);
    });
    $('odo-near').addEventListener('click', function () {
      odoStop();
      S.odo.value = Int.wrap(hi() - S.odo.step * 3n, S.bits, S.signed);
      updateOdometer(false);
    });
    $('odo-play').addEventListener('click', function () {
      if (S.odo.timer) { odoStop(); return; }
      this.textContent = '❚❚ Pause';
      S.odo.timer = setInterval(odoTick, 220);
    });

    /* scenario C */
    bindNumber('alloc-count', 'alloc-count-range',
      function () { return [0n, allocSliderBounds()]; },
      function (v) { S.alloc.count = v; });

    $('alloc-elem').addEventListener('input', function () {
      S.alloc.elem = BigInt(this.value);
      refresh();
    });
    $('alloc-safe-preset').addEventListener('click', function () {
      S.alloc.count = 16n; refresh();
    });
    $('alloc-bad-preset').addEventListener('click', function () {
      var umax = Int.max(S.bits, false);
      S.alloc.count = (umax + 1n) / S.alloc.elem + 1n;
      refresh();
    });

    /* scenario D */
    bindNumber('su-len', 'su-len-range',
      function () { return [Int.min(S.bits, true), Int.max(S.bits, true)]; },
      function (v) { S.su.len = v; });

    $('su-ok').addEventListener('click', function () { S.su.len = 64n; refresh(); });
    $('su-big').addEventListener('click', function () { S.su.len = 4096n; refresh(); });
    $('su-neg').addEventListener('click', function () { S.su.len = -1n; refresh(); });

    showScenario('explore');
    refresh();
  }

  /** Deep-link support: #lesson=2&scenario=alloc&width=32&sign=unsigned (see README). */
  function applyParams(params) {
    if (params.width && [8, 16, 32, 64].indexOf(Number(params.width)) >= 0) {
      S.bits = Number(params.width);
      $('int-width').value = String(S.bits);
    }
    if (params.sign === 'signed' || params.sign === 'unsigned') {
      S.signed = params.sign === 'signed';
      $('int-signed').classList.toggle('seg-active', S.signed);
      $('int-unsigned').classList.toggle('seg-active', !S.signed);
    }
    var a = Int.parse(params.a || '');
    var b = Int.parse(params.b || '');
    if (a !== null) { S.a = a; }
    if (b !== null) { S.b = b; }
    if (['+', '-', '*', '<<'].indexOf(params.op) >= 0) { S.op = params.op; $('int-op').value = S.op; }

    var sc = params.scenario;
    if (['explore', 'odometer', 'alloc', 'signed'].indexOf(sc) >= 0) {
      $('int-scenario').value = sc;
      showScenario(sc);
    } else {
      refresh();
    }
  }

  global.IntegerLesson = { init: init, stop: odoStop, applyParams: applyParams };
})(window);
