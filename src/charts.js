/* Kartotek chart helpers: library-free SVG charts drawn with theme tokens. */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function tr(x, d) { return global.DSR.trNum(x, d); }

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * p;
  }

  var tipEl = null;
  function tip(html, evt) {
    tipEl = tipEl || document.getElementById('chart-tip');
    if (!tipEl) return;
    if (html == null) { tipEl.hidden = true; return; }
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    var x = evt.clientX + 12, y = evt.clientY - 34;
    var w = tipEl.offsetWidth;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - 12;
    tipEl.style.left = x + 'px';
    tipEl.style.top = Math.max(8, y) + 'px';
  }

  // Column with a 4px rounded top and a flat base
  function colPath(x, y, w, h) {
    if (h <= 0) return '';
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function frame(container, W, H, pad, yMax, ticks, label) {
    container.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': label || '' }, container);
    for (var i = 0; i <= ticks; i++) {
      var v = yMax * i / ticks;
      var y = pad.t + (H - pad.t - pad.b) * (1 - i / ticks);
      el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: i === 0 ? 'axis' : 'grid' }, svg);
      var t = el('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end' }, svg);
      t.textContent = Number.isInteger(v) ? String(v) : tr(v, 1);
    }
    return svg;
  }

  // series: [{key, label, color}], rows: [{label, values:{key:n}, tip}]
  function stackedColumns(container, rows, series, opts) {
    opts = opts || {};
    var W = 640, H = opts.height || 220, pad = { t: 10, r: 8, b: 28, l: 36 };
    var totals = rows.map(function (r) { return series.reduce(function (a, s) { return a + (r.values[s.key] || 0); }, 0); });
    var top = Math.max.apply(null, totals.concat([1]));
    var yMax = niceMax(top), ticks;
    if (yMax < 5) { yMax = Math.ceil(top); ticks = yMax; }
    else ticks = [4, 5].filter(function (t) { return Number.isInteger(yMax / t); })[0] || 5;
    var svg = frame(container, W, H, pad, yMax, ticks, opts.label);
    var band = (W - pad.l - pad.r) / rows.length;
    var bw = Math.min(24, band * 0.7);
    var ph = H - pad.t - pad.b;
    var every = Math.ceil(rows.length / 8);
    rows.forEach(function (r, i) {
      var x = pad.l + band * i + (band - bw) / 2;
      var base = H - pad.b;
      series.forEach(function (s, si) {
        var v = r.values[s.key] || 0;
        if (!v) return;
        var h = v / yMax * ph;
        var gap = si > 0 ? 2 : 0;
        var isTop = series.slice(si + 1).every(function (s2) { return !(r.values[s2.key]); });
        var y = base - h;
        var shape = isTop ? el('path', { d: colPath(x, y, bw, h - gap), fill: s.color }, svg)
          : el('rect', { x: x, y: y, width: bw, height: Math.max(0, h - gap), fill: s.color }, svg);
        shape.setAttribute('pointer-events', 'none');
        base = y;
      });
      var hit = el('rect', { x: pad.l + band * i, y: pad.t, width: band, height: ph, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', function (e) { tip(r.tip, e); });
      hit.addEventListener('mouseleave', function () { tip(null); });
      var pos = opts.labelFromEnd ? rows.length - 1 - i : i;
      if (pos % every === 0) {
        var t = el('text', { x: pad.l + band * i + band / 2, y: H - 8, 'text-anchor': 'middle' }, svg);
        t.textContent = r.label;
      }
    });
    if (opts.markIndex != null && rows[opts.markIndex]) {
      var mx = pad.l + band * opts.markIndex + band / 2;
      el('line', { x1: mx, x2: mx, y1: pad.t, y2: H - pad.b, stroke: 'var(--margin)', 'stroke-width': 1 }, svg);
    }
    return svg;
  }

  // Reliability (calibration) chart: x = predicted R, y = observed success
  function calibrationChart(container, bins, label) {
    var W = 360, H = 300, pad = { t: 12, r: 14, b: 36, l: 52 };
    container.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': label || '' }, container);
    var minV = Math.min.apply(null, bins.filter(function (b) { return b.n; }).map(function (b) { return Math.min(b.pred, b.obs); }).concat([0.4]));
    var lo = Math.max(0, Math.floor(minV * 10) / 10);
    var gridVals = [];
    for (var gv = lo; gv <= 1.0001; gv += (1 - lo) > 0.6 ? 0.2 : 0.1) gridVals.push(Math.round(gv * 10) / 10);
    var sx = function (v) { return pad.l + (v - lo) / (1 - lo) * (W - pad.l - pad.r); };
    var sy = function (v) { return pad.t + (1 - (v - lo) / (1 - lo)) * (H - pad.t - pad.b); };
    gridVals.forEach(function (v) {
      el('line', { x1: sx(lo), x2: sx(1), y1: sy(v), y2: sy(v), class: v === lo ? 'axis' : 'grid' }, svg);
      el('line', { x1: sx(v), x2: sx(v), y1: sy(lo), y2: sy(1), class: v === lo ? 'axis' : 'grid' }, svg);
      var ty = el('text', { x: pad.l - 6, y: sy(v) + 4, 'text-anchor': 'end' }, svg); ty.textContent = tr(v, 1);
      var tx = el('text', { x: sx(v), y: H - pad.b + 16, 'text-anchor': 'middle' }, svg); tx.textContent = tr(v, 1);
    });
    var xl = el('text', { x: (sx(lo) + sx(1)) / 2, y: H - 4, 'text-anchor': 'middle' }, svg); xl.textContent = 'predicted R';
    var yl = el('text', { x: 10, y: (sy(lo) + sy(1)) / 2, 'text-anchor': 'middle', transform: 'rotate(-90 10 ' + (sy(lo) + sy(1)) / 2 + ')' }, svg); yl.textContent = 'observed success';
    el('line', { x1: sx(lo), y1: sy(lo), x2: sx(1), y2: sy(1), stroke: 'var(--rule-strong)', 'stroke-width': 1.5 }, svg);
    var maxN = Math.max.apply(null, bins.map(function (b) { return b.n; }).concat([1]));
    bins.filter(function (b) { return b.n > 0; }).forEach(function (b) {
      var cx = sx(b.pred), cy = sy(b.obs);
      var r = 4 + 6 * Math.sqrt(b.n / maxN);
      el('circle', { cx: cx, cy: cy, r: r + 2, fill: 'var(--surface)' }, svg);
      var c = el('circle', { cx: cx, cy: cy, r: r, fill: 'var(--pen)' }, svg);
      var html = 'R ' + tr(b.lo, 2) + '–' + tr(b.hi, 2) + '<br>predicted ' + tr(b.pred * 100, 1) + '%<br>actual ' + tr(b.obs * 100, 1) + '%' + '<br>n = ' + b.n;
      c.addEventListener('mousemove', function (e) { tip(html, e); });
      c.addEventListener('mouseleave', function () { tip(null); });
    });
    return svg;
  }

  // Forgetting curves: series [{label, color, S}], R*, day range
  function forgettingChart(container, series, targetR, days, label) {
    var W = 640, H = 260, pad = { t: 12, r: 70, b: 30, l: 40 };
    container.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': label || '' }, container);
    var sx = function (d) { return pad.l + d / days * (W - pad.l - pad.r); };
    var sy = function (r) { return pad.t + (1 - r) * (H - pad.t - pad.b); };
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), class: v === 0 ? 'axis' : 'grid' }, svg);
      var t = el('text', { x: pad.l - 6, y: sy(v) + 4, 'text-anchor': 'end' }, svg); t.textContent = tr(v, 2);
    });
    var step = niceMax(days / 6);
    for (var d = 0; d <= days; d += step) {
      var t2 = el('text', { x: sx(d), y: H - 10, 'text-anchor': 'middle' }, svg); t2.textContent = d + ' d';
    }
    el('line', { x1: pad.l, x2: W - pad.r, y1: sy(targetR), y2: sy(targetR), stroke: 'var(--margin)', 'stroke-width': 1 }, svg);
    var tl = el('text', { x: W - pad.r + 6, y: sy(targetR) + 4 }, svg); tl.textContent = 'R* ' + tr(targetR, 2);
    series.forEach(function (s) {
      var pts = [];
      for (var i = 0; i <= 120; i++) { var dd = days * i / 120; pts.push(sx(dd).toFixed(1) + ',' + sy(global.DSR.retrievability(dd, s.S)).toFixed(1)); }
      el('polyline', { points: pts.join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      var I = global.DSR.intervalForRetention(s.S, targetR);
      if (I <= days) {
        el('circle', { cx: sx(I), cy: sy(targetR), r: 6, fill: 'var(--surface)' }, svg);
        var dot = el('circle', { cx: sx(I), cy: sy(targetR), r: 4, fill: s.color }, svg);
        var html = s.label + '<br>I = ' + tr(I, 1) + ' days';
        dot.addEventListener('mousemove', function (e) { tip(html, e); });
        dot.addEventListener('mouseleave', function () { tip(null); });
      }
    });
    var hit = el('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' }, svg);
    var cross = el('line', { y1: pad.t, y2: H - pad.b, stroke: 'var(--rule-strong)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    hit.addEventListener('mousemove', function (e) {
      var box = svg.getBoundingClientRect();
      var x = (e.clientX - box.left) / box.width * W;
      var dd = Math.max(0, Math.min(days, (x - pad.l) / (W - pad.l - pad.r) * days));
      cross.setAttribute('x1', sx(dd)); cross.setAttribute('x2', sx(dd)); cross.setAttribute('visibility', 'visible');
      tip('t = ' + tr(dd, 1) + ' days<br>' + series.map(function (s) {
        return s.label + ': R = ' + tr(global.DSR.retrievability(dd, s.S), 3);
      }).join('<br>'), e);
    });
    hit.addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); tip(null); });
    hit.parentNode.insertBefore(hit, svg.firstChild.nextSibling);
    return svg;
  }

  // Column with a flat base and a 4px rounded bottom tip (for negative values)
  function colPathDown(x, y, w, h) {
    if (h <= 0) return '';
    var r = Math.min(4, w / 2, h), b = y + h;
    return 'M' + x + ',' + y + 'V' + (b - r) + 'Q' + x + ',' + b + ' ' + (x + r) + ',' + b +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + b + ' ' + (x + w) + ',' + (b - r) + 'V' + y + 'Z';
  }

  // Diverging columns: prediction − actual gap (Rule 10). rows: [{label, gap, tip}]; ±band is the accurate zone
  function gapColumns(container, rows, opts) {
    opts = opts || {};
    var W = 640, H = opts.height || 220, pad = { t: 12, r: 10, b: 28, l: 44 };
    container.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': opts.label || '' }, container);
    var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.gap); }).concat([0.2]));
    var lim = Math.min(1, Math.ceil(maxAbs * 10) / 10);
    var ph = H - pad.t - pad.b;
    var sy = function (v) { return pad.t + (lim - v) / (2 * lim) * ph; };
    var band = opts.band == null ? 0.10 : opts.band;
    el('rect', { x: pad.l, y: sy(band), width: W - pad.l - pad.r, height: sy(-band) - sy(band), fill: 'var(--good-soft)' }, svg);
    [-lim, -lim / 2, 0, lim / 2, lim].forEach(function (v) {
      el('line', { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), class: v === 0 ? 'axis' : 'grid' }, svg);
      var t = el('text', { x: pad.l - 6, y: sy(v) + 4, 'text-anchor': 'end' }, svg);
      t.textContent = (v > 0 ? '+' : '') + Math.round(v * 100);
    });
    var bandW = (W - pad.l - pad.r) / Math.max(1, rows.length);
    var bw = Math.min(24, bandW * 0.6);
    var every = Math.ceil(rows.length / 8);
    rows.forEach(function (r, i) {
      var x = pad.l + bandW * i + (bandW - bw) / 2, y0 = sy(0), y1 = sy(r.gap);
      if (r.gap >= 0) el('path', { d: colPath(x, y1, bw, y0 - y1), fill: 'var(--s2)' }, svg);
      else el('path', { d: colPathDown(x, y0, bw, y1 - y0), fill: 'var(--s1)' }, svg);
      var hit = el('rect', { x: pad.l + bandW * i, y: pad.t, width: bandW, height: ph, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', function (e) { tip(r.tip, e); });
      hit.addEventListener('mouseleave', function () { tip(null); });
      if ((rows.length - 1 - i) % every === 0) {
        var t = el('text', { x: pad.l + bandW * i + bandW / 2, y: H - 8, 'text-anchor': 'middle' }, svg);
        t.textContent = r.label;
      }
    });
    return svg;
  }

  global.KCharts = { stackedColumns: stackedColumns, calibrationChart: calibrationChart, forgettingChart: forgettingChart, gapColumns: gapColumns, tip: tip };
})(window);
