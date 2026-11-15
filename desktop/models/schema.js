'use strict';
// A small JSON Schema checker for the subset Kartotek's prompt schemas use (ARCHITECTURE.md section 5.1/5.2: the strictest common
// subset, the one Anthropic's structured outputs accept): type (incl. arrays of types), properties, required, additionalProperties,
// items, enum, const, anyOf, allOf, $ref to #/$defs or #/definitions, minItems. Returns a list of readable errors ([] = valid).
// Written for Kartotek; no dependency.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v; // string, number, boolean, object
}

function typeMatches(want, v) {
  const t = typeOf(v);
  if (want === t) return true;
  if (want === 'number' && t === 'integer') return true;
  return false;
}

function resolveRef(root, ref) {
  const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref || '');
  if (!m) return null;
  return (root[m[1]] || {})[m[2]] || null;
}

function check(schema, value, path, root, errors, depth) {
  if (errors.length > 50 || depth > 40) return;
  if (schema === true || schema == null) return;
  if (schema === false) { errors.push(path + ': not allowed'); return; }
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) { errors.push(path + ': unknown $ref ' + schema.$ref); return; }
    check(target, value, path, root, errors, depth + 1);
    return;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, value))) { errors.push(path + ': expected ' + types.join(' or ') + ', got ' + typeOf(value)); return; }
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(path + ': must be ' + JSON.stringify(schema.const));
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push(path + ': must be one of ' + schema.enum.map((e) => JSON.stringify(e)).join(', '));
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((s) => check(s, value, path, root, errors, depth + 1));
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((s) => { const e = []; check(s, value, path, root, e, depth + 1); return e.length === 0; });
    if (!ok) errors.push(path + ': matches none of the allowed shapes');
  }
  const t = typeOf(value);
  if (t === 'object') {
    const props = schema.properties || {};
    (schema.required || []).forEach((k) => { if (!Object.prototype.hasOwnProperty.call(value, k)) errors.push(path + ': missing "' + k + '"'); });
    Object.keys(value).forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(props, k)) check(props[k], value[k], path + '.' + k, root, errors, depth + 1);
      else if (schema.additionalProperties === false) errors.push(path + ': unexpected "' + k + '"');
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(schema.additionalProperties, value[k], path + '.' + k, root, errors, depth + 1);
    });
  } else if (t === 'array') {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(path + ': needs at least ' + schema.minItems + ' item(s)');
    if (schema.items) value.forEach((v, i) => check(schema.items, v, path + '[' + i + ']', root, errors, depth + 1));
  }
}

function validate(schema, value) {
  const errors = [];
  check(schema, value, '$', schema || {}, errors, 0);
  return errors;
}

// Parses the JSON a model returned: plain JSON, or JSON inside a ```json fence, or the first {...} block in the text
function parseJsonLoose(text) {
  if (text == null) return { ok: false, error: 'No text to read.' };
  const s = String(text).trim();
  const tries = [s];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) tries.push(fence[1].trim());
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
  for (const x of tries) { try { return { ok: true, value: JSON.parse(x) }; } catch (e) { /* next */ } }
  return { ok: false, error: 'The reply is not valid JSON.' };
}

module.exports = { validate, parseJsonLoose };
