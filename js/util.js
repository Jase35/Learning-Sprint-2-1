/* =========================================================
   Overflow Lab — shared helpers
   Plain ES5-compatible-ish ES2020. No modules, so the file
   works when index.html is opened directly from disk.
   ========================================================= */
(function (global) {
  'use strict';

  var Util = {};

  /* ---------- DOM ---------- */

  Util.$ = function (id) { return document.getElementById(id); };

  Util.el = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  };

  Util.clear = function (node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
    return node;
  };

  /* ---------- formatting ---------- */

  Util.hex2 = function (n) {
    return (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
  };

  /** Format a BigInt as 0x… with `bits/4` digits. */
  Util.hexN = function (value, bits) {
    var mask = (1n << BigInt(bits)) - 1n;
    var v = ((value % (1n << BigInt(bits))) + (1n << BigInt(bits))) % (1n << BigInt(bits));
    return '0x' + (v & mask).toString(16).toUpperCase().padStart(bits / 4, '0');
  };

  /** Group digits with thin separators: 1234567 -> "1,234,567". */
  Util.commas = function (value) {
    var s = value.toString();
    var neg = s.charAt(0) === '-';
    if (neg) { s = s.slice(1); }
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  };

  /** Printable ASCII, or a dot for everything else. */
  Util.printable = function (byteValue) {
    if (byteValue === 0) { return '\u00b7'; }
    if (byteValue >= 0x20 && byteValue <= 0x7e) { return String.fromCharCode(byteValue); }
    return '\u00b7';
  };

  /**
   * Parse the URL fragment as `key=value&key=value`, so a lesson can be
   * linked directly: index.html#lesson=1&preset=smash&run=1
   */
  Util.hashParams = function () {
    var out = {};
    var raw = (global.location.hash || '').replace(/^#/, '');
    if (!raw) { return out; }
    raw.split('&').forEach(function (pair) {
      if (!pair) { return; }
      var i = pair.indexOf('=');
      var key = i < 0 ? pair : pair.slice(0, i);
      var value = i < 0 ? '' : pair.slice(i + 1);
      try { out[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' ')); }
      catch (e) { out[key] = value; }
    });
    return out;
  };

  /** Human-readable byte count. */
  Util.bytes = function (value) {
    var v = BigInt(value);
    var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
    var i = 0;
    while (v >= 1024n && i < units.length - 1) { v /= 1024n; i++; }
    return Util.commas(v) + ' ' + units[i];
  };

  /* ---------- fixed-width integer maths (BigInt based) ---------- */

  var Int = {};

  Int.mask = function (bits) { return (1n << BigInt(bits)) - 1n; };

  Int.min = function (bits, signed) {
    return signed ? -(1n << BigInt(bits - 1)) : 0n;
  };

  Int.max = function (bits, signed) {
    return signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
  };

  /** Truncate an arbitrary BigInt into `bits`, interpreting the result per `signed`. */
  Int.wrap = function (value, bits, signed) {
    var m = Int.mask(bits);
    var raw = ((value & m) + (m + 1n)) & m;     // two's-complement bit pattern
    if (signed && raw > Int.max(bits, true)) {
      raw -= (1n << BigInt(bits));
    }
    return raw;
  };

  /** Raw unsigned bit pattern of a value stored in `bits` bits. */
  Int.pattern = function (value, bits) {
    var m = Int.mask(bits);
    return ((value & m) + (m + 1n)) & m;
  };

  /** Exact (unbounded) result of an operation. */
  Int.exact = function (a, op, b) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '<<': return b < 0n ? a : a * (1n << b);
      default: return 0n;
    }
  };

  /** Parse a decimal / 0x hex string into a BigInt, or null. */
  Int.parse = function (text) {
    if (typeof text !== 'string') { return null; }
    var s = text.trim().replace(/[,_\s]/g, '');
    if (!s) { return null; }
    try {
      if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(s)) {
        var neg = s.charAt(0) === '-';
        var body = s.replace(/^[-+]/, '');
        var v = BigInt(body);
        return neg ? -v : v;
      }
      if (!/^[-+]?\d+$/.test(s)) { return null; }
      return BigInt(s);
    } catch (e) {
      return null;
    }
  };

  Int.clamp = function (value, lo, hi) {
    if (value < lo) { return lo; }
    if (value > hi) { return hi; }
    return value;
  };

  /** C type name for a width/signedness pair. */
  Int.typeName = function (bits, signed) {
    return (signed ? 'int' : 'uint') + bits + '_t';
  };

  Util.Int = Int;

  /* ---------- bit-row rendering ---------- */

  /**
   * Render one labelled row of bits.
   * opts: { label, valueText, value (BigInt), bits (width of the C type),
   *         totalBits (columns to draw, >= bits), markSign, highlightLost }
   * Columns above `bits` are drawn as "outside the type"; when `highlightLost`
   * is set they are drawn in red, because that row is the one losing them.
   */
  Util.renderBitRow = function (container, opts) {
    var wrap = Util.el('div', 'bitrow');

    var head = Util.el('div', 'bitrow-label');
    head.appendChild(Util.el('span', 'brl-name', opts.label));
    if (opts.valueText) { head.appendChild(Util.el('span', 'brl-val', opts.valueText)); }
    wrap.appendChild(head);

    var bitsBox = Util.el('div', 'bits');
    var total = Math.max(opts.totalBits || opts.bits, opts.bits);
    var pattern = Util.Int.pattern(opts.value, Math.max(total, 1));

    for (var i = total - 1; i >= 0; i--) {
      var on = ((pattern >> BigInt(i)) & 1n) === 1n;
      var cls = 'bit' + (on ? ' on' : '');
      if (i >= opts.bits) { cls += ' outside' + (opts.highlightLost ? ' lost' : ''); }
      else if (opts.markSign && i === opts.bits - 1) { cls += ' sign'; }
      bitsBox.appendChild(Util.el('div', cls, on ? '1' : '0'));
      if (i > 0 && i % 8 === 0) { bitsBox.appendChild(Util.el('div', 'bit-gap')); }
    }

    wrap.appendChild(bitsBox);
    container.appendChild(wrap);
    return wrap;
  };

  global.Util = Util;
})(window);
