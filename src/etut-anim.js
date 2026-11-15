/*
 * Kartotek animation blocks ({type:"anim"}), timing model inspired by Remotion's interpolate and Easing API; no Remotion code is included:
 * - motion is a pure function of the current frame: variables are interpolated over explicit keyframes in seconds,
 *   clamped at both ends, with bezier or spring easing (Remotion's interpolate + Easing.bezier / Easing.spring);
 * - time is sampled at the block's fps, so every frame is reproducible and can be scrubbed;
 * - scenes are sequenced captions with from/to in seconds (Remotion's <Series>/<Sequence>);
 * - like the Remotion Player, the learner controls the timeline: play, pause, scrub, restart. Nothing autoplays.
 * The SVG binds attributes and text to small safe expressions (no eval): data-a="attr: expr; attr2: expr", data-t="expr".
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ easing
  function bezier(x1, y1, x2, y2) {
    function a(p1, p2) { return 1 - 3 * p2 + 3 * p1; }
    function b(p1, p2) { return 3 * p2 - 6 * p1; }
    function c(p1) { return 3 * p1; }
    function calc(t, p1, p2) { return ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t; }
    function slope(t, p1, p2) { return 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1); }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) {
        var s = slope(t, x1, x2);
        if (Math.abs(s) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / s;
      }
      var lo = 0, hi = 1;
      for (var j = 0; j < 20 && Math.abs(calc(t, x1, x2) - x) > 1e-6; j++) {
        if (calc(t, x1, x2) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return calc(t, y1, y2);
    };
  }
  // A critically damped spring normalised to reach 1 at the end of the segment (no bounce, like damping: 200)
  function spring(x) { if (x <= 0) return 0; if (x >= 1) return 1; var k = 8; return (1 - (1 + k * x) * Math.exp(-k * x)) / (1 - (1 + k) * Math.exp(-k)); }
  var EASE = {
    linear: function (x) { return x; },
    out: bezier(0.16, 1, 0.3, 1),
    inOut: bezier(0.65, 0, 0.35, 1),
    'in': bezier(0.5, 0, 0.75, 0),
    spring: spring
  };

  // interpolate(time, keyframes) with clamped extrapolation; ease is one name or one per segment
  function interpolate(t, kf, ease) {
    if (!kf || !kf.length) return 0;
    if (t <= kf[0][0]) return kf[0][1];
    for (var i = 1; i < kf.length; i++) {
      if (t <= kf[i][0]) {
        var t0 = kf[i - 1][0], t1 = kf[i][0], v0 = kf[i - 1][1], v1 = kf[i][1];
        var name = Array.isArray(ease) ? ease[i - 1] : ease;
        var f = EASE[name] || EASE.inOut;
        var x = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * f(x);
      }
    }
    return kf[kf.length - 1][1];
  }

  // ------------------------------------------------------------------ safe expressions
  // numbers, 'strings', variables, + - * / ^ % unary -, comparisons < > <= >=, ternary ?:, function calls
  function fix(x, d) { return Number(x).toFixed(d == null ? 2 : d).replace(/^-(0(\.0+)?)$/, '$1').replace('-', '−'); }
  function pt(cx, cy, r, a) { return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; }
  var FN = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, min: Math.min, max: Math.max,
    round: Math.round, floor: Math.floor, atan2: Math.atan2,
    fix: fix,
    clamp: function (x, a, b) { return Math.min(b, Math.max(a, x)); },
    step: function (x) { return x >= 0 ? 1 : 0; },
    sgn: function (x) { return Math.abs(x) < 1e-9 ? '0' : x > 0 ? '+' : '−'; },
    // SVG path of the arc from angle a0 to a1 (radians, counterclockwise, maths orientation) on a circle
    arc: function (cx, cy, r, a0, a1) {
      if (Math.abs(a1 - a0) < 1e-6) return 'M ' + pt(cx, cy, r, a0).join(' ');
      if (Math.abs(a1 - a0) >= 2 * Math.PI - 1e-6) { var q = pt(cx, cy, r, a0), o = pt(cx, cy, r, a0 + Math.PI); return 'M ' + q.join(' ') + ' A ' + r + ' ' + r + ' 0 1 0 ' + o.join(' ') + ' A ' + r + ' ' + r + ' 0 1 0 ' + q.join(' '); }
      var p0 = pt(cx, cy, r, a0), p1 = pt(cx, cy, r, a1), large = Math.abs(a1 - a0) > Math.PI ? 1 : 0, sweep = a1 > a0 ? 0 : 1;
      return 'M ' + p0.join(' ') + ' A ' + r + ' ' + r + ' 0 ' + large + ' ' + sweep + ' ' + p1.join(' ');
    },
    // filled wedge from the centre
    sector: function (cx, cy, r, a0, a1) { return FN.arc(cx, cy, r, a0, a1).replace(/^M ([^A]+)/, 'M ' + cx + ' ' + cy + ' L $1') + ' Z'; }
  };
  var CONST = { pi: Math.PI };

  function tokenize(s) {
    var out = [], i = 0, m;
    var re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|'([^']*)'|(<=|>=|[-+*\/^%(),?:<>]))/y;
    while (i < s.length) {
      re.lastIndex = i;
      m = re.exec(s);
      if (!m) { if (/^\s*$/.test(s.slice(i))) break; throw new Error('Bad expression: ' + s); }
      i = re.lastIndex;
      if (m[1] != null) out.push({ k: 'n', v: parseFloat(m[1]) });
      else if (m[2] != null) out.push({ k: 'id', v: m[2] });
      else if (m[3] != null) out.push({ k: 's', v: m[3] });
      else out.push({ k: 'op', v: m[4] });
    }
    return out;
  }
  // Pratt parser → closure (env) => value
  function compile(src) {
    var tk = tokenize(src), p = 0;
    function peek() { return tk[p]; }
    function take(v) { var t = tk[p]; if (!t || (v && t.v !== v)) throw new Error('Expected ' + v + ' in ' + src); p++; return t; }
    var BP = { '?': 1, '<': 2, '>': 2, '<=': 2, '>=': 2, '+': 3, '-': 3, '*': 4, '/': 4, '%': 4, '^': 6 };
    function nud(t) {
      if (t.k === 'n' || t.k === 's') { var v = t.v; return function () { return v; }; }
      if (t.k === 'op' && t.v === '(') { var e = expr(0); take(')'); return e; }
      if (t.k === 'op' && t.v === '-') { var u = expr(5); return function (env) { return -u(env); }; }
      if (t.k === 'id') {
        var name = t.v;
        if (peek() && peek().v === '(') {
          take('(');
          var args = [];
          if (peek() && peek().v !== ')') { do { args.push(expr(0)); } while (peek() && peek().v === ',' && take(',')); }
          take(')');
          var f = FN[name];
          if (!f) throw new Error('Unknown function ' + name);
          return function (env) { return f.apply(null, args.map(function (a) { return a(env); })); };
        }
        if (CONST.hasOwnProperty(name)) { var c = CONST[name]; return function () { return c; }; }
        return function (env) { return env.hasOwnProperty(name) ? env[name] : 0; };
      }
      throw new Error('Unexpected token in ' + src);
    }
    function expr(rbp) {
      var left = nud(take());
      while (peek() && peek().k === 'op' && BP[peek().v] > rbp) {
        var op = take().v;
        if (op === '?') {
          var cond = left, a = expr(0); take(':'); var b = expr(0);
          left = (function (c, x, y) { return function (env) { return c(env) ? x(env) : y(env); }; })(cond, a, b);
          continue;
        }
        var right = expr(op === '^' ? BP[op] - 1 : BP[op]);
        left = (function (l, r, o) {
          return function (env) {
            var x = l(env), y = r(env);
            switch (o) {
              case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return x / y;
              case '%': return x % y; case '^': return Math.pow(x, y);
              case '<': return x < y; case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y;
            }
          };
        })(left, right, op);
      }
      return left;
    }
    var fn = expr(0);
    if (p < tk.length) throw new Error('Unexpected input in ' + src);
    return fn;
  }
  var cache = {};
  function evaluate(src, env) { var f = cache[src] || (cache[src] = compile(src)); return f(env); }

  // Values of every variable at time t (seconds); t itself is also available
  function stateAt(spec, t) {
    var env = { t: t, T: spec.duration };
    Object.keys(spec.vars || {}).forEach(function (k) { var v = spec.vars[k]; env[k] = interpolate(t, v.kf, v.ease); });
    return env;
  }

  // Checks a spec and every expression of its SVG; returns a list of problems (used by the package validator)
  function check(spec) {
    var errs = [];
    if (!spec || typeof spec !== 'object') return ['not an object'];
    if (!(spec.duration > 0)) errs.push('duration (seconds) must be positive');
    if (spec.fps != null && !(spec.fps >= 1 && spec.fps <= 60)) errs.push('fps must be between 1 and 60');
    if (typeof spec.svg !== 'string' || spec.svg.indexOf('<svg') < 0) errs.push('svg is required');
    Object.keys(spec.vars || {}).forEach(function (k) {
      var v = spec.vars[k];
      if (!v || !Array.isArray(v.kf) || !v.kf.length || !v.kf.every(function (p) { return Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1]); })) errs.push('var ' + k + ': kf must be [[seconds, value], …]');
    });
    (spec.scenes || []).forEach(function (s, i) { if (!s || !(s.to > s.from) || !s.md) errs.push('scene ' + (i + 1) + ': needs from < to and md'); });
    var env = stateAt(spec, 0);
    String(spec.svg || '').replace(/data-(a|t)="([^"]*)"|data-(a|t)='([^']*)'/g, function (_, k1, v1, k2, v2) {
      var kind = k1 || k2, val = (v1 != null ? v1 : v2).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      var exprs = kind === 't' ? [val] : val.split(';').map(function (s) { return s.slice(s.indexOf(':') + 1); }).filter(function (s) { return s.trim(); });
      exprs.forEach(function (e) { try { evaluate(e, env); } catch (x) { errs.push(x.message); } });
      return '';
    });
    return errs;
  }

  // ------------------------------------------------------------------ player
  function parseBindings(svg) {
    var list = [];
    svg.querySelectorAll('[data-a],[data-t]').forEach(function (el) {
      var a = el.getAttribute('data-a'), t = el.getAttribute('data-t');
      if (a) a.split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i > 0) list.push({ el: el, attr: pair.slice(0, i).trim(), src: pair.slice(i + 1).trim() });
      });
      if (t) list.push({ el: el, text: true, src: t });
    });
    return list;
  }

  function hydrate(root) {
    if (root.getAttribute('data-ready')) return;
    root.setAttribute('data-ready', '1');
    var spec;
    try { spec = JSON.parse(root.getAttribute('data-anim')); } catch (e) { return; }
    var fps = spec.fps || 30, frames = Math.max(1, Math.round(spec.duration * fps));
    var svg = root.querySelector('svg'), binds = svg ? parseBindings(svg) : [];
    var btn = root.querySelector('.kt-anim-play'), range = root.querySelector('.kt-anim-range'), clock = root.querySelector('.kt-anim-time');
    var scenes = Array.prototype.slice.call(root.querySelectorAll('.kt-anim-scene'));
    range.max = String(frames);
    var frame = 0, playing = false, last = 0, acc = 0;

    function draw(f) {
      frame = Math.max(0, Math.min(frames, f));
      var t = frame / fps, env = stateAt(spec, t);
      binds.forEach(function (b) {
        var v;
        try { v = evaluate(b.src, env); } catch (e) { return; }
        if (b.text) b.el.textContent = String(v);
        else b.el.setAttribute(b.attr, typeof v === 'number' ? (Math.round(v * 100) / 100) : v);
      });
      range.value = String(frame);
      clock.textContent = t.toFixed(1) + ' / ' + spec.duration.toFixed(1) + ' s';
      var shown = false;
      scenes.forEach(function (s) {
        var on = t >= Number(s.dataset.from) && (t < Number(s.dataset.to) || (t >= spec.duration && Number(s.dataset.to) >= spec.duration));
        if (on && shown) on = false;
        if (on) shown = true;
        s.toggleAttribute('data-on', on);
      });
    }
    function setPlaying(on) {
      playing = on;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Pause the animation' : 'Play the animation');
      btn.querySelector('span').textContent = on ? 'Pause' : (frame >= frames ? 'Replay' : 'Play');
      root.toggleAttribute('data-playing', on);
      if (on) { last = performance.now(); acc = 0; requestAnimationFrame(loop); }
    }
    function loop(now) {
      if (!playing) return;
      if (!root.isConnected) { playing = false; return; }
      acc += (now - last) / 1000; last = now;
      var step = Math.floor(acc * fps);
      if (step > 0) { acc -= step / fps; draw(frame + step); }
      if (frame >= frames) { setPlaying(false); return; }
      requestAnimationFrame(loop);
    }
    btn.addEventListener('click', function () {
      if (playing) { setPlaying(false); return; }
      if (frame >= frames) draw(0);
      setPlaying(true);
    });
    range.addEventListener('input', function () { if (playing) setPlaying(false); draw(Number(range.value)); btn.querySelector('span').textContent = 'Play'; });
    root.querySelectorAll('.kt-anim-jump').forEach(function (j) {
      j.addEventListener('click', function () { if (playing) setPlaying(false); draw(Math.round(Number(j.dataset.from) * fps)); btn.querySelector('span').textContent = 'Play'; });
    });
    draw(0);
  }

  function scan(node) {
    if (!node || !node.querySelectorAll) return;
    if (node.matches && node.matches('.kt-anim')) hydrate(node);
    node.querySelectorAll('.kt-anim:not([data-ready])').forEach(hydrate);
  }
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    var start = function () {
      scan(document.body);
      new MutationObserver(function (muts) { muts.forEach(function (m) { m.addedNodes.forEach(scan); }); }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  global.KAnim = { interpolate: interpolate, evaluate: evaluate, stateAt: stateAt, check: check, EASE: EASE, FN: FN };
})(typeof window !== 'undefined' ? window : globalThis);
