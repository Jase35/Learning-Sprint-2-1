/* =========================================================
   Overflow Lab — Lesson 1: stack-frame buffer overflow
   ---------------------------------------------------------
   Everything below is a *simulation*. `mem` is a plain
   JavaScript array of numbers; no real memory is touched.
   ========================================================= */
(function (global) {
  'use strict';

  var $ = Util.$;
  var el = Util.el;
  var clear = Util.clear;

  /* ---------- constants ---------- */

  var BUF_BASE   = 0x7ffca3b0;          // pretend address of buf[0]
  var WORD       = 8;                   // 64-bit machine
  var ORIG_RET   = 0x401196;            // "call site" in main()
  var ORIG_RBP   = 0x7ffca3f0;          // caller's frame pointer
  var SPEEDS     = [600, 340, 190, 100, 45, 0];
  var SPEED_TEXT = ['very slow', 'slow', 'relaxed', 'normal', 'fast', 'instant'];

  var PRESETS = {
    safe: {
      input: 'hello', buf: 16, fn: 'strcpy', canary: true,
      hint: 'A short string drops neatly inside the buffer. This is the "everything is fine" baseline.'
    },
    exact: {
      input: 'AAAABBBBCCCCDDDD', buf: 16, fn: 'strcpy', canary: true,
      hint: '16 characters in a 16-byte buffer sounds exact — but strcpy also writes a NUL terminator, so 17 bytes leave the buffer.'
    },
    offbyone: {
      input: 'AAAABBBBCCCCDDDDEEEE', buf: 16, fn: 'loop', canary: true,
      hint: 'The loop uses i <= n instead of i < n. One single stray byte is enough to be a security bug.'
    },
    canary: {
      input: 'AAAAAAAAAAAAAAAAAAAA', buf: 16, fn: 'strcpy', canary: true,
      hint: 'A long string marches past the buffer. The canary is a tripwire placed there by the compiler.'
    },
    smash: {
      input: 'AAAAAAAAAAAAAAAAAAAAAAAABBBBBBB', buf: 16, fn: 'strcpy', canary: false,
      hint: 'With the canary switched off, 24 filler bytes reach the saved RBP and the next 7 land squarely on the return address.'
    },
    custom: {
      hint: 'Type anything you like. Watch the "bytes past buf" counter on the right.'
    }
  };

  /* ---------- state ---------- */

  var S = {
    bufSize: 16,
    canaryOn: true,
    copyFn: 'strcpy',
    input: 'hello',
    regions: [],        // [{key, off, size, title, note, cls}]
    mem: [],            // current byte values
    orig: [],           // pristine byte values
    meta: [],           // per-byte {region, index}
    rows: [],           // per-byte DOM row
    writes: [],         // [{off, value}]
    cursor: 0,          // how many writes applied
    timer: null,
    syncing: false
  };

  /* ---------- building the frame ---------- */

  function randomCanary() {
    // glibc uses a "terminator canary": the lowest byte is 0x00 on purpose,
    // so that str*() functions cannot copy a canary value forward.
    var b = [0x00];
    for (var i = 0; i < 7; i++) { b.push(1 + Math.floor(Math.random() * 254)); }
    return b;
  }

  var canaryBytes = randomCanary();

  function leBytes(value, n) {
    var out = [];
    var v = BigInt(value);
    for (var i = 0; i < n; i++) { out.push(Number((v >> BigInt(8 * i)) & 0xffn)); }
    return out;
  }

  function inputBytes() {
    var out = [];
    for (var i = 0; i < S.input.length; i++) {
      var c = S.input.charCodeAt(i);
      out.push(c > 0xff ? 0x3f : c);   // keep the simulation to single bytes
    }
    return out;
  }

  /** The byte-by-byte write plan for the selected copy function. */
  function buildWrites() {
    var src = inputBytes();
    var len = src.length;
    var w = [];
    var i;

    if (S.copyFn === 'strcpy') {
      // strcpy copies until it finds the NUL — and copies that too.
      for (i = 0; i < len; i++) { w.push({ off: i, value: src[i] }); }
      w.push({ off: len, value: 0 });

    } else if (S.copyFn === 'loop') {
      // for (i = 0; i <= n; i++)  — the classic off-by-one.
      var n = Math.min(len, S.bufSize);
      for (i = 0; i <= n; i++) { w.push({ off: i, value: i < len ? src[i] : 0 }); }

    } else {                                   // strncpy, bounded
      var k = Math.min(len, S.bufSize - 1);
      for (i = 0; i < k; i++) { w.push({ off: i, value: src[i] }); }
      w.push({ off: k, value: 0 });
    }
    return w;
  }

  function buildFrame() {
    S.writes = buildWrites();

    var canarySize = S.canaryOn ? WORD : 0;
    var framed = S.bufSize + canarySize + WORD + WORD;      // buf + canary + rbp + ret
    var spill = Math.max(0, S.writes.length - framed);
    var callerSize = Math.max(8, Math.ceil(spill / 8) * 8 + 8);

    var regions = [];
    var off = 0;

    regions.push({ key: 'buf', off: off, size: S.bufSize, cls: 'region-buf',
      title: 'char buf[' + S.bufSize + ']', note: 'the local buffer' });
    off += S.bufSize;

    if (S.canaryOn) {
      regions.push({ key: 'canary', off: off, size: WORD, cls: 'region-canary',
        title: 'stack canary', note: 'compiler tripwire' });
      off += WORD;
    }

    regions.push({ key: 'sfp', off: off, size: WORD, cls: 'region-sfp',
      title: 'saved RBP', note: "caller's frame pointer" });
    off += WORD;

    regions.push({ key: 'ret', off: off, size: WORD, cls: 'region-ret',
      title: 'return address', note: 'where the CPU goes next' });
    off += WORD;

    regions.push({ key: 'caller', off: off, size: callerSize, cls: '',
      title: "caller's stack frame", note: 'other functions live here' });
    off += callerSize;

    S.regions = regions;

    var total = off;
    S.orig = new Array(total);
    S.meta = new Array(total);

    regions.forEach(function (r) {
      var init;
      if (r.key === 'canary')   { init = canaryBytes.slice(); }
      else if (r.key === 'sfp') { init = leBytes(ORIG_RBP, WORD); }
      else if (r.key === 'ret') { init = leBytes(ORIG_RET, WORD); }
      else { init = new Array(r.size).fill(0); }

      for (var i = 0; i < r.size; i++) {
        S.orig[r.off + i] = init[i] === undefined ? 0 : init[i];
        S.meta[r.off + i] = { region: r, index: i };
      }
    });

    S.mem = S.orig.slice();
    S.cursor = 0;
  }

  /* ---------- rendering ---------- */

  function byteLabel(m) {
    switch (m.region.key) {
      case 'buf':    return 'buf[' + m.index + ']';
      case 'canary': return 'canary[' + m.index + ']' + (m.index === 0 ? '  (NUL on purpose)' : '');
      case 'sfp':    return 'saved RBP byte ' + m.index;
      case 'ret':    return 'ret byte ' + m.index;
      default:       return 'caller frame';
    }
  }

  function renderFrame() {
    var box = clear($('st-stack'));
    S.rows = new Array(S.mem.length);

    // Highest address first: walk regions backwards, bytes backwards.
    for (var r = S.regions.length - 1; r >= 0; r--) {
      var region = S.regions[r];
      var wrap = el('div', 'region ' + region.cls);

      var title = el('div', 'region-title');
      title.appendChild(el('span', 'rt-name', region.title));
      title.appendChild(el('span', 'rt-note', region.note));
      wrap.appendChild(title);

      for (var i = region.size - 1; i >= 0; i--) {
        var idx = region.off + i;
        var row = el('div', 'byte-row');
        row.appendChild(el('span', 'b-addr', '0x' + (BUF_BASE + idx).toString(16).padStart(12, '0')));
        row.appendChild(el('span', 'b-hex', Util.hex2(S.mem[idx])));
        row.appendChild(el('span', 'b-label', byteLabel(S.meta[idx])));
        row.appendChild(el('span', 'b-char', Util.printable(S.mem[idx])));
        wrap.appendChild(row);
        S.rows[idx] = row;
      }
      box.appendChild(wrap);
    }
    paintAll();
  }

  function paintByte(idx, active) {
    var row = S.rows[idx];
    if (!row) { return; }
    var v = S.mem[idx];
    row.children[1].textContent = Util.hex2(v);
    row.children[3].textContent = Util.printable(v);

    var cls = 'byte-row';
    var touched = idx < S.cursorHighWater;
    var changed = v !== S.orig[idx];
    var key = S.meta[idx].region.key;

    if (touched && key === 'buf') { cls += ' written'; }
    else if (changed && key === 'canary') { cls += ' corrupt-canary'; }
    else if (changed) { cls += ' corrupt'; }
    else if (touched) { cls += ' written'; }

    if (v === 0 && touched) { cls += ' nul'; }
    if (active) { cls += ' active'; }
    row.className = cls;
  }

  function paintAll(activeIdx) {
    // high-water mark = the highest offset written so far, +1
    S.cursorHighWater = 0;
    for (var w = 0; w < S.cursor; w++) {
      S.cursorHighWater = Math.max(S.cursorHighWater, S.writes[w].off + 1);
    }
    for (var i = 0; i < S.mem.length; i++) { paintByte(i, i === activeIdx); }
  }

  /* ---------- analysis ---------- */

  function regionOf(key) {
    for (var i = 0; i < S.regions.length; i++) {
      if (S.regions[i].key === key) { return S.regions[i]; }
    }
    return null;
  }

  function regionValue(key) {
    var r = regionOf(key);
    if (!r) { return null; }
    var v = 0n;
    for (var i = r.size - 1; i >= 0; i--) { v = (v << 8n) | BigInt(S.mem[r.off + i]); }
    return v;
  }

  function regionChanged(key) {
    var r = regionOf(key);
    if (!r) { return false; }
    for (var i = 0; i < r.size; i++) {
      if (S.mem[r.off + i] !== S.orig[r.off + i]) { return true; }
    }
    return false;
  }

  function bytesPastBuf() {
    var past = 0;
    for (var w = 0; w < S.cursor; w++) {
      if (S.writes[w].off >= S.bufSize) { past++; }
    }
    return past;
  }

  function analyse() {
    var done = S.cursor >= S.writes.length;
    var past = bytesPastBuf();
    var canaryHit = S.canaryOn && regionChanged('canary');
    var sfpHit = regionChanged('sfp');
    var retHit = regionChanged('ret');
    var callerHit = regionChanged('caller');

    var a = {
      done: done, past: past, written: S.cursor,
      canaryHit: canaryHit, sfpHit: sfpHit, retHit: retHit, callerHit: callerHit,
      ret: regionValue('ret'), sfp: regionValue('sfp'), canary: regionValue('canary')
    };

    if (retHit || callerHit) { a.severity = 'bad'; }
    else if (canaryHit || sfpHit) { a.severity = 'warn'; }
    else if (past > 0) { a.severity = 'warn'; }
    else { a.severity = 'ok'; }

    // A tripped canary aborts the program before `ret` is ever executed.
    if (canaryHit) { a.severity = 'warn'; }
    if (retHit && canaryHit) { a.severity = 'warn'; }

    return a;
  }

  /* ---------- status panels ---------- */

  function setReg(id, text, cls) {
    var node = $(id);
    node.textContent = text;
    node.className = 'mono' + (cls ? ' ' + cls : '');
  }

  function updateStatus() {
    var a = analyse();

    $('st-reg-written').textContent = S.cursor + ' / ' + S.writes.length;
    var pastNode = $('st-reg-past');
    pastNode.textContent = String(a.past);
    pastNode.className = a.past > 0 ? 'bad' : 'good';

    setReg('st-reg-sfp', Util.hexN(a.sfp, 64), a.sfpHit ? 'bad' : '');
    setReg('st-reg-ret', Util.hexN(a.ret, 64), a.retHit ? 'bad' : '');
    if (S.canaryOn) {
      setReg('st-reg-canary', Util.hexN(a.canary, 64), a.canaryHit ? 'warn' : 'good');
    } else {
      setReg('st-reg-canary', 'disabled', '');
    }

    renderVerdict(a);
    renderExplain(a);
  }

  function p(text, cls) {
    var node = el('p', cls || '');
    node.innerHTML = text;
    return node;
  }

  function renderVerdict(a) {
    var card = $('st-verdict');
    var body = clear($('st-verdict-body'));
    card.className = 'card verdict';

    if (S.cursor === 0) {
      body.appendChild(el('p', 'verdict-state state-idle', 'Idle — press Run the copy.'));
      return;
    }

    var state, head, detail;

    if (a.past === 0) {
      state = 'ok';
      head = a.done ? '✔ Safe — the string fit' : '✔ So far, so good';
      detail = 'All ' + S.cursor + ' bytes landed inside <code>buf</code>. The saved frame pointer and return address are untouched.';
    } else if (a.canaryHit) {
      state = 'warn';
      head = '⚠ Stack smashing detected';
      detail = 'The overflow changed the canary to <code>' + Util.hexN(a.canary, 64) + '</code>. On <code>return</code>, the epilogue compares the canary against its saved copy, sees the mismatch, and calls <code>__stack_chk_fail()</code>:<br><code>*** stack smashing detected ***: terminated</code><br>The program dies — a crash instead of a hijack. The defence worked, but the bug is still a denial of service.';
    } else if (a.retHit) {
      state = 'bad';
      head = '✖ Return address overwritten';
      detail = 'The return address went from <code>' + Util.hexN(BigInt(ORIG_RET), 64) + '</code> to <code>' + Util.hexN(a.ret, 64) + '</code>. When <code>vulnerable()</code> executes <code>ret</code>, the CPU pops that value into RIP and jumps there. In a real program this is almost always an instant crash — and it is exactly the foothold that control-flow hijacking attacks aim for.';
    } else if (a.sfpHit) {
      state = 'bad';
      head = '✖ Saved frame pointer corrupted';
      detail = 'The saved RBP is now <code>' + Util.hexN(a.sfp, 64) + '</code>. The return address survived, but when the caller restores RBP it will read its own locals from the wrong place — subtly wrong behaviour that can be just as exploitable.';
    } else {
      state = 'warn';
      head = '⚠ Silent overflow';
      detail = a.past + ' byte' + (a.past === 1 ? '' : 's') + ' landed outside <code>buf</code>, but happened to write the same value that was already there, so nothing visibly changed. The bug is still real — change the input by one character and it will not be harmless any more.';
    }

    card.className = 'card verdict is-' + state;
    body.appendChild(el('p', 'verdict-state state-' + state, head));
    body.appendChild(p(detail, 'detail'));
  }

  function renderExplain(a) {
    var list = clear($('st-explain'));
    var items = [];

    var total = S.writes.length;
    var fnName = S.copyFn === 'strcpy' ? '<b>strcpy()</b>'
      : S.copyFn === 'loop' ? '<b>the copy loop</b>' : '<b>strncpy()</b>';

    items.push(fnName + ' plans to write <b>' + total + '</b> bytes into a <b>' + S.bufSize + '</b>-byte buffer.');

    if (S.copyFn === 'strcpy') {
      items.push('<code>strcpy</code> has no idea how big <code>buf</code> is — it only stops at the NUL byte in the <i>source</i>.');
    } else if (S.copyFn === 'loop') {
      items.push('The loop condition is <code>i &lt;= n</code>, so it runs <b>n + 1</b> times and writes one byte more than it should.');
    } else {
      items.push('<code>strncpy</code> is told <code>sizeof buf - 1</code>, so it physically cannot leave the buffer.');
    }

    if (a.past === 0) {
      items.push('Every byte stayed inside the buffer. <b>No corruption.</b>');
    } else {
      items.push('<b>' + a.past + '</b> byte' + (a.past === 1 ? '' : 's') + ' spilled past <code>buf[' + (S.bufSize - 1) + ']</code> into whatever sits at the next address.');
    }

    if (S.canaryOn && a.past > 0 && !a.canaryHit) {
      items.push('The first byte past the buffer landed on <code>canary[0]</code>, which is already <code>0x00</code>. Writing another <code>0x00</code> there changes nothing — this is why a single NUL-byte overflow can slip past a terminator canary.');
    }
    if (a.canaryHit) {
      items.push('The canary no longer matches its saved copy, so the function <b>aborts instead of returning</b>.');
    }
    if (a.sfpHit) {
      items.push('Bytes reached the <b>saved RBP</b> — the caller\'s frame pointer.');
    }
    if (a.retHit) {
      items.push('Bytes reached the <b>return address</b>. Whatever sits there is where the CPU goes when the function ends.');
      if (S.canaryOn) {
        items.push('Note the ordering: the canary sits <i>below</i> RBP and the return address, so it is corrupted first and the abort happens before the hijack can take effect.');
      }
    }
    if (a.callerHit) {
      items.push('The write ran off the end of this frame entirely and into the caller\'s frame.');
    }

    items.forEach(function (html) {
      var li = document.createElement('li');
      li.innerHTML = html;
      list.appendChild(li);
    });
  }

  /* ---------- code listing ---------- */

  function renderCode() {
    var n = S.bufSize;
    var lines = [];

    lines.push('<span class="cm">/* compiled ' + (S.canaryOn
      ? 'with <span class="good">-fstack-protector-strong</span>' : 'with <span class="bad">-fno-stack-protector</span>') + ' */</span>');
    lines.push('<span class="kw">void</span> <span class="fn">vulnerable</span>(<span class="kw">const char</span> *src)');
    lines.push('{');
    lines.push('    <span class="kw">char</span> buf[<b>' + n + '</b>];');
    lines.push('');

    if (S.copyFn === 'strcpy') {
      lines.push('    <span class="cm">// no length check anywhere</span>');
      lines.push('    <span class="fn bad">strcpy</span>(buf, src);');
    } else if (S.copyFn === 'loop') {
      lines.push('    <span class="kw">size_t</span> n = <span class="fn">strlen</span>(src);');
      lines.push('    <span class="kw">if</span> (n &gt; <span class="kw">sizeof</span> buf) n = <span class="kw">sizeof</span> buf;');
      lines.push('');
      lines.push('    <span class="cm">// off-by-one: <span class="bad">&lt;=</span> runs one extra time</span>');
      lines.push('    <span class="kw">for</span> (<span class="kw">size_t</span> i = 0; i <span class="bad">&lt;=</span> n; i++)');
      lines.push('        buf[i] = src[i];');
    } else {
      lines.push('    <span class="cm">// bounded, and room reserved for the terminator</span>');
      lines.push('    <span class="fn good">strncpy</span>(buf, src, <span class="kw">sizeof</span> buf - 1);');
      lines.push('    buf[<span class="kw">sizeof</span> buf - 1] = <span class="str">\'\\0\'</span>;');
    }

    lines.push('');
    lines.push('    <span class="fn">use</span>(buf);');
    lines.push('}  <span class="cm">// &lt;- epilogue: '
      + (S.canaryOn ? 'check canary, then ' : '') + 'pop RBP, then <span class="kw">ret</span></span>');

    $('st-code').innerHTML = lines.join('\n');
  }

  /* ---------- the simulation driver ---------- */

  function stepOnce() {
    if (S.cursor >= S.writes.length) { return false; }
    var w = S.writes[S.cursor];
    S.mem[w.off] = w.value;
    S.cursor++;
    paintAll(w.off);
    var row = S.rows[w.off];
    if (row && row.scrollIntoView) { row.scrollIntoView({ block: 'nearest' }); }
    updateStatus();
    return true;
  }

  function stop() {
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    $('st-run').textContent = '▶ Run the copy';
  }

  function run() {
    if (S.timer) { stop(); return; }
    if (S.cursor >= S.writes.length) { reset(); }

    var delay = SPEEDS[Number($('st-speed').value)];

    if (delay === 0) {
      while (stepOnce()) { /* instant */ }
      paintAll();
      updateStatus();
      return;
    }

    $('st-run').textContent = '❚❚ Pause';
    var tick = function () {
      if (!stepOnce()) { stop(); paintAll(); updateStatus(); return; }
      S.timer = setTimeout(tick, delay);
    };
    tick();
  }

  function reset() {
    stop();
    buildFrame();
    renderFrame();
    renderCode();
    updateStatus();
  }

  /* ---------- wiring ---------- */

  function readControls() {
    S.input = $('st-input').value;
    S.bufSize = Number($('st-bufsize').value);
    S.copyFn = $('st-copyfn').value;
    S.canaryOn = $('st-canary').checked;

    $('st-bufsize-label').textContent = String(S.bufSize);
    $('st-input-len').textContent = String(S.input.length);
    $('st-write-len').textContent = String(buildWrites().length);
    $('st-speed-label').textContent = SPEED_TEXT[Number($('st-speed').value)];
  }

  function onControlChange(markCustom) {
    if (markCustom && !S.syncing) { $('st-preset').value = 'custom'; $('st-preset-hint').textContent = PRESETS.custom.hint; }
    readControls();
    reset();
  }

  function applyPreset(name) {
    var pre = PRESETS[name];
    $('st-preset-hint').textContent = pre.hint;
    if (name === 'custom') { return; }

    S.syncing = true;
    $('st-input').value = pre.input;
    $('st-bufsize').value = String(pre.buf);
    $('st-copyfn').value = pre.fn;
    $('st-canary').checked = pre.canary;
    S.syncing = false;

    canaryBytes = randomCanary();
    readControls();
    reset();
  }

  function init() {
    $('st-preset').addEventListener('change', function () { applyPreset(this.value); });

    $('st-input').addEventListener('input', function () { onControlChange(true); });
    $('st-bufsize').addEventListener('input', function () { onControlChange(true); });
    $('st-copyfn').addEventListener('change', function () { onControlChange(true); });
    $('st-canary').addEventListener('change', function () { onControlChange(true); });

    $('st-speed').addEventListener('input', function () {
      $('st-speed-label').textContent = SPEED_TEXT[Number(this.value)];
    });

    $('st-ascii').addEventListener('change', function () {
      document.body.classList.toggle('no-ascii', !this.checked);
    });

    $('st-run').addEventListener('click', run);
    $('st-step').addEventListener('click', function () {
      stop();
      if (S.cursor >= S.writes.length) { reset(); }
      stepOnce();
    });
    $('st-reset').addEventListener('click', function () { canaryBytes = randomCanary(); reset(); });

    applyPreset('safe');
  }

  /** Deep-link support: #lesson=1&preset=smash&run=1 (see README). */
  function applyParams(params) {
    if (params.preset && PRESETS[params.preset]) {
      $('st-preset').value = params.preset;
      applyPreset(params.preset);
    }

    var custom = false;
    if (typeof params.input === 'string') { $('st-input').value = params.input.slice(0, 48); custom = true; }
    if (params.buf && [8, 16, 24, 32].indexOf(Number(params.buf)) >= 0) { $('st-bufsize').value = String(Number(params.buf)); custom = true; }
    if (params.fn && ['strcpy', 'loop', 'strncpy'].indexOf(params.fn) >= 0) { $('st-copyfn').value = params.fn; custom = true; }
    if (params.canary === '0' || params.canary === '1') { $('st-canary').checked = params.canary === '1'; custom = true; }
    if (custom) { onControlChange(!params.preset); }

    if (params.run === '1') {
      $('st-speed').value = '5';
      readControls();
      run();
    }
  }

  global.StackLesson = { init: init, applyParams: applyParams };
})(window);
