#!/usr/bin/env python3
"""Audit Kartotek study packages (STUDY-RULES.md, section "Study v2", v2.12).

Usage (from the Kartotek folder):
    python tools\\audit-study.py studies\\<id>            one study (folder or etut.json)
    python tools\\audit-study.py studies\\a studies\\b     several
    python tools\\audit-study.py --all                     every etut.json in the content folder (kartotek.config.json), else samples\\studies
    python tools\\audit-study.py --samples                 the synthetic studies in samples\\studies

For a Study v2 package (schema_version 2, workflow "cycle-v2") it runs the same checks as the app
(src/study-v2.js: KCycle.validate + KCycle.audit + validateExtra):
  - structure: ids, formats, keys, rubrics, references            -> blockers
  - coverage ledger: units -> outcomes -> criteria -> lesson, practice and final items -> blockers / warnings
  - topic cycles (v2.12): topic priming / feynman, part connect blocks, connecting items (integrates) -> blockers / warnings
  - extras (studies\\<id>\\extras\\*.json, schema kstudy-extra-1)  -> errors
For a legacy (v1) package it reports the correct-option position balance of quiz + final_test.
Animation expressions (anim blocks) are checked by the app when the package is imported (#etut), not here.

Exit code 1 when any package has a blocker, an extras error or cannot be read. Standard library only.
"""
import json
import os
import re
import sys

FORMATS = ['mcq_single', 'mcq_multi', 'typed', 'numeric']
ORIGINS = ['imported', 'adapted', 'generated']
VALIDATION = ['verified', 'unverified', 'disputed']
DISPOSITIONS = ['included', 'duplicate', 'out_of_scope', 'unresolved']
BLOCK_TYPES = ['text', 'analogy', 'example', 'keypoints', 'callout', 'steps', 'compare', 'tree', 'svg', 'worked', 'anim']
KINDS = ['olgu', 'kavram', 'problem', 'yazma', 'uygulama']
ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$')
ETUT_ID_RE = re.compile(r'^[A-Za-z0-9_.~:@+-]{1,120}$')


def is_v2(pkg):
    return isinstance(pkg, dict) and pkg.get('schema_version') == 2 and pkg.get('workflow') == 'cycle-v2'


def lst(x):
    return x if isinstance(x, list) else []


def by_id(items, key='id'):
    out = {}
    for x in lst(items):
        if isinstance(x, dict) and x.get(key) is not None:
            out[x[key]] = x
    return out


def text(x):
    return '' if x is None else str(x)


def sentences(md):
    parts = re.split(r'[.!?](\s|$)', text(md).replace('**', ''))
    return len([p for p in parts if p and len(p.strip()) > 2])


def kazanimlar_of(pkg):
    out = []
    for p in lst(pkg.get('parts')):
        if not isinstance(p, dict):
            continue
        for k in lst(p.get('kazanimlar')):
            if isinstance(k, dict):
                out.append(k)
    return out


def topic_pos(pkg):
    """Every objective in study order: kazanim_id -> {'n': position, 'part_id': ...} (KCycle.topicPos)."""
    out, n = {}, 0
    for p in lst(pkg.get('parts')):
        if not isinstance(p, dict):
            continue
        for k in lst(p.get('kazanimlar')):
            if isinstance(k, dict) and k.get('kazanim_id'):
                out[k['kazanim_id']] = {'n': n, 'part_id': p.get('part_id')}
                n += 1
    return out


def is_connecting(it):
    return isinstance(it, dict) and isinstance(it.get('integrates'), list) and len(it['integrates']) >= 2


def check_blocks(blocks, at, units, err):
    for bi, b in enumerate(lst(blocks)):
        if not isinstance(b, dict) or b.get('type') not in BLOCK_TYPES:
            err.append('%s: block %d has an unknown type.' % (at, bi + 1))
            continue
        for u in lst(b.get('refs')):
            if u not in units:
                err.append('%s: block %d refers to unknown unit %s.' % (at, bi + 1, u))


def item_index(pkg):
    """q_ids the app uses: one recall item per objective, practice items, final items."""
    ids = {}
    for p in lst(pkg.get('parts')):
        if not isinstance(p, dict):
            continue
        for k in lst(p.get('kazanimlar')):
            if isinstance(k, dict) and isinstance(k.get('recall'), dict) and k['recall'].get('prompt'):
                ids['recall:' + text(k.get('kazanim_id'))] = True
        for it in lst(p.get('items')):
            if isinstance(it, dict) and it.get('q_id'):
                ids[it['q_id']] = True
    for it in lst(pkg.get('final_test')):
        if isinstance(it, dict) and it.get('q_id'):
            ids[it['q_id']] = True
    return ids


def criteria_index(pkg):
    out = {}
    for lo in lst(pkg.get('outcomes')):
        if not isinstance(lo, dict):
            continue
        for c in lst(lo.get('criteria')):
            if isinstance(c, dict) and c.get('id'):
                out[c['id']] = lo
    return out


def truthy(x):
    """JavaScript truthiness (an empty object or list is true), so both audits agree."""
    if isinstance(x, (dict, list)):
        return True
    return bool(x) and x == x


def number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def check_item(it, at, ctx, err, warn):
    if not isinstance(it, dict):
        err.append(at + ': not an item object.')
        return
    q = it.get('q_id')
    if not isinstance(q, str) or not ID_RE.match(q) or q in ctx['qids']:
        err.append('%s: q_id is missing, invalid or repeated (%s).' % (at, q))
    else:
        ctx['qids'][q] = True
    tag = '%s (%s)' % (at, q)
    fmt = it.get('format')
    if fmt not in FORMATS:
        err.append('%s: format must be one of %s.' % (tag, ', '.join(FORMATS)))
        return
    if it.get('kazanim_id') not in ctx['kids']:
        err.append(tag + ': kazanim_id must name an objective.')
    if not text(it.get('stem')).strip():
        err.append(tag + ': stem is required.')
    if it.get('origin') is not None and it.get('origin') not in ORIGINS:
        err.append(tag + ': origin must be imported, adapted or generated.')
    if it.get('validation') is not None and it.get('validation') not in VALIDATION:
        err.append(tag + ': validation must be verified, unverified or disputed.')
    if fmt in ('mcq_single', 'mcq_multi'):
        opts = lst(it.get('options'))
        ids, dup = {}, False
        for o in opts:
            if not isinstance(o, dict) or not o.get('id') or o['id'] in ids:
                dup = True
            else:
                ids[o['id']] = True
        if len(opts) < 2 or len(opts) > 6 or dup:
            err.append(tag + ': 2–6 options with unique ids are required.')
        key = lst(it.get('key'))
        if not key or any(k not in ids for k in key):
            err.append(tag + ': key must list option ids.')
        if fmt == 'mcq_single' and len(key) != 1:
            err.append(tag + ': a single-answer item needs exactly one key.')
        if fmt == 'mcq_multi' and (len(key) < 2 or len(key) >= len(opts)):
            err.append(tag + ': a select-all item needs at least 2 keys and at least one option that is not a key.')
        notes = it.get('option_notes')
        if isinstance(notes, dict):
            missing = [i for i in ids if not text(notes.get(i)).strip()]
            if missing:
                warn.append(tag + ': option_notes has no note for ' + ', '.join(missing) + '.')
        else:
            warn.append(tag + ': no option_notes (one note per option id).')
    elif fmt == 'typed':
        rub = it.get('rubric') if isinstance(it.get('rubric'), dict) else {}
        rc = lst(rub.get('criteria'))
        if not rc or not any(isinstance(c, dict) and c.get('required') is not False for c in rc):
            err.append(tag + ': a written item needs rubric.criteria with at least one required criterion.')
    elif fmt == 'numeric':
        n = it.get('numeric') if isinstance(it.get('numeric'), dict) else {}
        if not number(n.get('value')) or not (number(n.get('tol')) and n.get('tol') >= 0):
            err.append(tag + ': numeric.value and numeric.tol are required.')
    rub = it.get('rubric') if isinstance(it.get('rubric'), dict) else {}
    if not it.get('solution') and not rub.get('model'):
        warn.append(tag + ': no solution text to show after the answer.')
    for o in lst(it.get('outcomes')):
        if o not in ctx['outcomes']:
            err.append('%s: unknown outcome %s.' % (tag, o))
    for c in lst(it.get('criteria')):
        if c not in ctx['criteria']:
            err.append('%s: unknown criterion %s.' % (tag, c))
    for u in lst(it.get('units')):
        if u not in ctx['units']:
            err.append('%s: unknown unit %s.' % (tag, u))
    if it.get('integrates') is not None:
        ig = it.get('integrates')
        bad = not isinstance(ig, list)
        seen = {}
        for k in lst(ig):
            if not isinstance(k, str) or k not in ctx['kids']:
                bad = True
            elif k not in seen:
                seen[k] = True
        if bad or len(seen) < 2 or len(seen) != len(lst(ig)) or it.get('kazanim_id') not in seen:
            err.append(tag + ': integrates must list 2 or more different objectives, including its own kazanim_id.')
        elif ctx.get('part_id') and ctx.get('pos'):
            pos = ctx['pos']
            last = lst(ig)[0]
            for k in lst(ig)[1:]:
                if pos[k]['n'] > pos[last]['n']:
                    last = k
            if pos[last]['part_id'] != ctx['part_id']:
                err.append('%s: a connecting item belongs to the part of its latest topic (%s, %s).' % (tag, last, pos[last]['part_id']))


def validate(pkg):
    err, warn = [], []
    if not isinstance(pkg, dict):
        return ['The package is not a JSON object.'], []
    if not isinstance(pkg.get('etut_id'), str) or not ETUT_ID_RE.match(pkg['etut_id']):
        err.append('etut_id is missing or invalid.')
    if not text(pkg.get('title')).strip():
        err.append('title is missing.')
    parts = pkg.get('parts')
    if not isinstance(parts, list) or not parts:
        err.append('parts must contain at least one part.')
    conv = pkg.get('conventions')
    if conv is not None and not (isinstance(conv, list) and all(isinstance(c, str) and c.strip() for c in conv)):
        err.append('conventions must be a list of sentences.')
    src = pkg.get('source') if isinstance(pkg.get('source'), dict) else {}
    off = src.get('page_offset')
    if off is not None and not (isinstance(off, int) and not isinstance(off, bool)):
        err.append('source.page_offset must be a whole number (PDF page = printed page + offset).')
    kids, pids, crit = {}, {}, {}
    units, outcomes = by_id(pkg.get('units')), by_id(pkg.get('outcomes'))
    for i, lo in enumerate(lst(pkg.get('outcomes'))):
        if not isinstance(lo, dict) or not isinstance(lo.get('id'), str) or not ID_RE.match(lo['id']):
            err.append('outcomes[%d]: id is missing or invalid.' % i)
        for c in lst(lo.get('criteria') if isinstance(lo, dict) else None):
            if not isinstance(c, dict) or not isinstance(c.get('id'), str) or not ID_RE.match(c['id']) or c['id'] in crit:
                err.append('outcome %s: criterion ids must be unique.' % (lo.get('id') if isinstance(lo, dict) else '?'))
            else:
                crit[c['id']] = True
    for pi, part in enumerate(lst(parts)):
        at = 'Part %d' % (pi + 1)
        if not isinstance(part, dict) or not part.get('part_id') or not part.get('title'):
            err.append(at + ': part_id and title are required.')
            continue
        if part['part_id'] in pids:
            err.append(at + ': part_id repeated.')
        pids[part['part_id']] = True
        ks = part.get('kazanimlar')
        if not isinstance(ks, list) or not ks:
            err.append(at + ': at least one objective is required.')
        for ki, k in enumerate(lst(ks)):
            kat = '%s / objective %d' % (at, ki + 1)
            if not isinstance(k, dict) or not k.get('kazanim_id') or k['kazanim_id'] in kids:
                err.append(kat + ': kazanim_id is missing or repeated.')
                continue
            kids[k['kazanim_id']] = True
            if not k.get('title'):
                err.append(kat + ': title is required.')
            blocks = k.get('blocks')
            if not isinstance(blocks, list) or not blocks:
                err.append(kat + ': blocks is empty.')
            check_blocks(blocks, kat, units, err)
            rc = k.get('recall') if isinstance(k.get('recall'), dict) else {}
            if not (rc.get('prompt') and rc.get('model_answer')):
                err.append(kat + ': recall.prompt and recall.model_answer are required (the objective card).')
            if k.get('kind') is not None and k.get('kind') not in KINDS:
                err.append(kat + ': invalid kind.')
            for o in lst(k.get('outcomes')):
                if o not in outcomes:
                    err.append('%s: unknown outcome %s.' % (kat, o))
            pm = k.get('priming')
            if pm is not None and not (isinstance(pm, dict) and text(pm.get('summary_md')).strip()):
                err.append(kat + ' / priming: summary_md is required.')
            if isinstance(pm, dict) and pm.get('summary_md') and pm.get('keywords') is not None and not (
                    isinstance(pm['keywords'], list) and all(isinstance(w, dict) and w.get('term') and w.get('definition') for w in pm['keywords'])):
                err.append(kat + ' / priming: keywords need term and definition.')
            fy = k.get('feynman')
            if fy is not None and not (isinstance(fy, dict) and fy.get('prompt')):
                err.append(kat + ' / feynman: prompt is required.')
            for c in lst(fy.get('criteria') if isinstance(fy, dict) else None):
                if c not in crit:
                    err.append('%s / feynman: unknown criterion %s.' % (kat, c))
        if 'summary' in part and part['summary'] is not None and not (isinstance(part['summary'], dict) and text(part['summary'].get('md')).strip()):
            err.append(at + ' / summary: md is required.')
        if 'feynman' in part and part['feynman'] is not None and not (isinstance(part['feynman'], dict) and part['feynman'].get('prompt')):
            err.append(at + ' / feynman: prompt is required.')
        if part.get('connect') is not None:
            cn = part['connect']
            if not (isinstance(cn, dict) and isinstance(cn.get('blocks'), list) and cn['blocks']):
                err.append(at + ' / connect: blocks is required.')
            else:
                check_blocks(cn['blocks'], at + ' / connect', units, err)
    ctx = {'qids': {}, 'kids': kids, 'outcomes': outcomes, 'criteria': crit, 'units': units, 'pos': topic_pos(pkg)}
    for pi, part in enumerate(lst(parts)):
        if not isinstance(part, dict):
            continue
        if part.get('items') is not None and not isinstance(part.get('items'), list):
            err.append('Part %d: items must be an array.' % (pi + 1))
        ctx['part_id'] = part.get('part_id')
        for ii, it in enumerate(lst(part.get('items'))):
            check_item(it, 'Part %d / item %d' % (pi + 1, ii + 1), ctx, err, warn)
    ctx['part_id'] = None
    if not isinstance(pkg.get('final_test'), list) or not pkg['final_test']:
        err.append('final_test must contain at least one item.')
    for i, it in enumerate(lst(pkg.get('final_test'))):
        check_item(it, 'Final %d' % (i + 1), ctx, err, warn)
    for lo in lst(pkg.get('outcomes')):
        if not isinstance(lo, dict):
            continue
        if lo.get('part_id') and lo['part_id'] not in pids:
            err.append('outcome %s: unknown part %s.' % (lo.get('id'), lo['part_id']))
        if lo.get('kazanim_id') and lo['kazanim_id'] not in kids:
            err.append('outcome %s: unknown objective %s.' % (lo.get('id'), lo['kazanim_id']))
        for u in lst(lo.get('units')):
            if u not in units:
                err.append('outcome %s: unknown unit %s.' % (lo.get('id'), u))
    for i, u in enumerate(lst(pkg.get('units'))):
        if not isinstance(u, dict) or not isinstance(u.get('id'), str) or not ID_RE.match(u['id']):
            err.append('units[%d]: id is missing or invalid.' % i)
        elif u.get('disposition') not in DISPOSITIONS:
            err.append('unit %s: disposition must be %s.' % (u['id'], ', '.join(DISPOSITIONS)))
    return err, warn


def audit(pkg):
    errors, warnings = validate(pkg)
    blockers = list(errors)
    warnings = list(warnings)
    units = [u for u in lst(pkg.get('units')) if isinstance(u, dict)]
    outcomes = [o for o in lst(pkg.get('outcomes')) if isinstance(o, dict)]
    relations = [r for r in lst(pkg.get('relations')) if isinstance(r, dict)]
    practice = []
    for p in lst(pkg.get('parts')):
        if isinstance(p, dict):
            practice += [it for it in lst(p.get('items')) if isinstance(it, dict)]
    final = [it for it in lst(pkg.get('final_test')) if isinstance(it, dict)]
    practice_q = by_id(practice, 'q_id')
    ks = kazanimlar_of(pkg)
    unit_outcome, unit_taught = {}, {}
    for lo in outcomes:
        for u in lst(lo.get('units')):
            unit_outcome[u] = True
    for k in ks:
        for b in lst(k.get('blocks')):
            if isinstance(b, dict):
                for u in lst(b.get('refs')):
                    unit_taught[u] = True
    for p in lst(pkg.get('parts')):
        cn = p.get('connect') if isinstance(p, dict) else None
        for b in lst(cn.get('blocks') if isinstance(cn, dict) else None):
            if isinstance(b, dict):
                for u in lst(b.get('refs')):
                    unit_taught[u] = True
    # A source exercise is placed by the item that uses it, not by a lesson block
    ex_units = {}
    for it in practice + final:
        for u in lst(it.get('units')):
            ex_units[u] = True
    for u in units:
        if u.get('disposition') == 'included':
            if u.get('id') not in unit_outcome:
                blockers.append('Unit %s (%s) is included but no outcome covers it.' % (u.get('id'), text(u.get('loc'))))
            if u.get('id') not in unit_taught and not (u.get('type') == 'exercise' and u.get('id') in ex_units):
                warnings.append('Unit %s has no lesson block that cites it (refs)%s.' % (u.get('id'), ' and no item uses it' if u.get('type') == 'exercise' else ''))
        elif u.get('disposition') == 'unresolved':
            warnings.append('Unit %s is unresolved: %s.' % (u.get('id'), text(u.get('reason') or 'no reason given').rstrip('.')))
    rel_outcome = {}
    for lo in outcomes:
        for r in lst(lo.get('relations')):
            rel_outcome[r] = True
    for r in relations:
        if not r.get('unresolved') and r.get('id') not in rel_outcome:
            blockers.append('Relation %s (%s → %s) is in the ledger but no outcome covers it.' % (r.get('id'), r.get('from'), r.get('to')))
    taught = {}
    for k in ks:
        if lst(k.get('blocks')):
            for o in lst(k.get('outcomes')):
                taught[o] = True
    ledger = []
    for lo in outcomes:
        status = lo.get('status') or 'covered'
        row = {'id': lo.get('id'), 'status': status, 'taught': lo.get('id') in taught, 'criteria': []}
        for c in lst(lo.get('criteria')):
            if not isinstance(c, dict):
                continue
            pr = [it.get('q_id') for it in practice if c.get('id') in lst(it.get('criteria'))]
            fi = [it.get('q_id') for it in final if c.get('id') in lst(it.get('criteria'))]
            row['criteria'].append({'id': c.get('id'), 'practice': pr, 'final': fi})
        if status == 'covered':
            if not row['taught']:
                blockers.append('Outcome %s has no lesson (no objective with blocks lists it).' % lo.get('id'))
            if not row['criteria']:
                blockers.append('Outcome %s has no success criteria.' % lo.get('id'))
            for c in row['criteria']:
                if not c['practice']:
                    blockers.append('Criterion %s (%s) has no practice item.' % (c['id'], lo.get('id')))
                if not c['final']:
                    blockers.append('Criterion %s (%s) is not assessed in the final test.' % (c['id'], lo.get('id')))
        else:
            warnings.append('Outcome %s is %s%s.' % (lo.get('id'), status, (': ' + lo['reason']) if lo.get('reason') else ''))
        ledger.append(row)
    if not outcomes:
        blockers.append('There is no outcome ledger (outcomes).')
    fam_practice = {}
    for it in practice:
        if it.get('family'):
            fam_practice[it['family']] = it.get('q_id')
    for it in final:
        if it.get('q_id') in practice_q:
            blockers.append('Final item %s is also a practice item.' % it.get('q_id'))
        elif it.get('family') and it['family'] in fam_practice and not it.get('validation_note'):
            warnings.append('Final item %s shares family %s with practice item %s (disclose it in validation_note).' % (it.get('q_id'), it['family'], fam_practice[it['family']]))
    ci = criteria_index(pkg)
    for it in practice + final:
        if it.get('validation') and it['validation'] != 'verified':
            warnings.append('Item %s is %s%s — shown, but never sent to DSR.' % (it.get('q_id'), it['validation'], (': ' + it['validation_note']) if it.get('validation_note') else ''))
        for c in lst(it.get('criteria')):
            if c in ci and ci[c].get('id') not in lst(it.get('outcomes')):
                warnings.append('Item %s assesses %s but does not list its outcome %s.' % (it.get('q_id'), c, ci[c].get('id')))
    for b in lst(pkg.get('final_blueprint')):
        if not isinstance(b, dict):
            continue
        it = next((x for x in final if x.get('q_id') == b.get('item')), None)
        if not it or b.get('criterion') not in lst(it.get('criteria')):
            warnings.append('final_blueprint row %s → %s does not match the final items.' % (b.get('criterion'), b.get('item')))
    no_prim = no_fey = 0
    for pi, p in enumerate(lst(pkg.get('parts'))):
        if not isinstance(p, dict):
            continue
        kz = [k for k in lst(p.get('kazanimlar'))]
        n = len(kz)
        if n < 3 or n > 6:
            warnings.append('Part %d has %d objectives (3–6 is the preferred grouping, not a rule).' % (pi + 1, n))
        summ = p.get('summary')
        if isinstance(summ, dict):
            s = sentences(summ.get('md'))
            if s < 5 or s > 10:
                warnings.append('Part %d summary has about %d sentences (5–10 preferred; never pad).' % (pi + 1, s))
        kp = len([k for k in kz if isinstance(k, dict) and truthy(k.get('priming'))])
        kf = len([k for k in kz if isinstance(k, dict) and truthy(k.get('feynman'))])
        if not truthy(summ) and kp < n:
            warnings.append('Part %d has no Priming summary.' % (pi + 1))
        if not truthy(p.get('feynman')) and kf < n:
            warnings.append('Part %d has no Feynman prompt.' % (pi + 1))
        no_prim += n - kp
        no_fey += n - kf
        for k in kz:
            pm = k.get('priming') if isinstance(k, dict) else None
            ts = sentences(pm.get('summary_md')) if isinstance(pm, dict) else 0
            if ts > 6:
                warnings.append('Topic %s Priming has about %d sentences (a preview: 6 at most).' % (k.get('kazanim_id'), ts))
    if no_prim:
        warnings.append('%d of %d topics have no topic Priming (priming.summary_md); the part summary is shown instead.' % (no_prim, len(ks)))
    if no_fey:
        warnings.append('%d of %d topics have no topic Feynman prompt; the part prompt is shown instead.' % (no_fey, len(ks)))
    counts = {
        'units': len(units), 'included': len([u for u in units if u.get('disposition') == 'included']), 'outcomes': len(outcomes),
        'criteria': sum(len(r['criteria']) for r in ledger), 'practice': len(practice), 'final': len(final),
        'topics': len(ks), 'connecting': len([it for it in practice if is_connecting(it)]),
    }
    return blockers, warnings, counts


def validate_extra(x, pkg):
    if not isinstance(x, dict) or x.get('schema') != 'kstudy-extra-1':
        return ['schema must be kstudy-extra-1'], []
    err, warn = [], []
    if x.get('etut_id') != pkg.get('etut_id'):
        err.append('etut_id does not match')
    kids = {k.get('kazanim_id'): True for k in kazanimlar_of(pkg)}
    crit = {c: True for c in criteria_index(pkg)}
    ctx = {'qids': dict(item_index(pkg)), 'kids': kids, 'outcomes': by_id(pkg.get('outcomes')), 'criteria': crit, 'units': by_id(pkg.get('units'))}
    part_ids = {p.get('part_id') for p in lst(pkg.get('parts')) if isinstance(p, dict)}
    for i, it in enumerate(lst(x.get('items'))):
        check_item(it, 'extra item %d' % (i + 1), ctx, err, warn)
        if not isinstance(it, dict):
            continue
        if not it.get('followup_of'):
            err.append('extra item %d: followup_of is required' % (i + 1))
        if not it.get('part_id') or it.get('part_id') not in part_ids:
            err.append('extra item %d: part_id must name a part' % (i + 1))
    ex = x.get('explanation')
    if ex is not None and not (isinstance(ex, dict) and text(ex.get('md')).strip()):
        err.append('explanation must be null or have md')
    if ex is not None and not x.get('attempt_id'):
        err.append('attempt_id is required with an explanation')
    return err, warn


def legacy_report(pkg):
    """Legacy v1: the app does not shuffle options, so the correct index must not be guessable."""
    qs = []
    for p in lst(pkg.get('parts')):
        if isinstance(p, dict):
            qs += [q for q in lst(p.get('quiz')) if isinstance(q, dict)]
    qs += [q for q in lst(pkg.get('final_test')) if isinstance(q, dict)]
    counts = [0, 0, 0, 0]
    for q in qs:
        c = q.get('correct')
        if isinstance(c, int) and 0 <= c <= 3:
            counts[c] += 1
    warn = []
    n = sum(counts)
    if n >= 8:
        share = [c / n for c in counts]
        if max(share) > 0.4 or min(share) < 0.1:
            warn.append('Correct-option positions are unbalanced: A %d · B %d · C %d · D %d of %d (each should be about a quarter).' % (counts[0], counts[1], counts[2], counts[3], n))
    return qs, counts, warn


def find_packages(args, root):
    if '--all' in args or '--samples' in args:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import kconfig
        base = os.path.join(kconfig.ROOT, 'samples', 'studies') if '--samples' in args else os.path.join(kconfig.content_root(), 'studies')
        return [os.path.join(base, d) for d in sorted(os.listdir(base)) if os.path.isfile(os.path.join(base, d, 'etut.json'))]
    return [a for a in args if not a.startswith('--')]


def main(argv):
    # Windows pipes default to the ANSI code page, which has no arrows or dashes: print UTF-8 instead of failing
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    root = os.getcwd()
    targets = find_packages(argv, root)
    if not targets:
        print(__doc__)
        return 2
    failed = False
    for t in targets:
        path = t if t.lower().endswith('.json') else os.path.join(t, 'etut.json')
        folder = os.path.dirname(os.path.abspath(path))
        try:
            with open(path, encoding='utf-8-sig') as f:
                pkg = json.load(f)
        except Exception as e:  # unreadable or invalid JSON
            print('%s: cannot read (%s)' % (path, e))
            failed = True
            continue
        name = pkg.get('etut_id', '?') if isinstance(pkg, dict) else '?'
        if not is_v2(pkg):
            qs, counts, warn = legacy_report(pkg)
            print('%s · legacy v1 · %d quiz/final questions · correct positions A %d · B %d · C %d · D %d' % (name, len(qs), counts[0], counts[1], counts[2], counts[3]))
            for w in warn:
                print('  warning: ' + w)
            continue
        blockers, warnings, c = audit(pkg)
        state = 'certified' if not blockers else 'DRAFT (not certified)'
        print('%s · Study v2 · %s · %d blocker(s), %d warning(s)' % (name, state, len(blockers), len(warnings)))
        print('  ledger: %d units (%d included) · %d outcomes · %d criteria · %d practice items · %d final items' % (c['units'], c['included'], c['outcomes'], c['criteria'], c['practice'], c['final']))
        print('  topics: %d (each runs its own cycle) · %d connecting practice item(s)' % (c['topics'], c['connecting']))
        for b in blockers:
            print('  BLOCKER: ' + b)
        for w in warnings:
            print('  warning: ' + w)
        xdir = os.path.join(folder, 'extras')
        if os.path.isdir(xdir):
            seen = {}
            for fn in sorted(os.listdir(xdir)):
                if not fn.lower().endswith('.json'):
                    continue
                try:
                    with open(os.path.join(xdir, fn), encoding='utf-8-sig') as f:
                        x = json.load(f)
                except Exception as e:
                    print('  EXTRAS ERROR %s: cannot read (%s)' % (fn, e))
                    failed = True
                    continue
                errs, warns = validate_extra(x, pkg)
                for e in errs:
                    print('  EXTRAS ERROR %s: %s' % (fn, e))
                for w in warns:
                    print('  extras warning %s: %s' % (fn, w))
                for it in lst(x.get('items') if isinstance(x, dict) else None):
                    q = it.get('q_id') if isinstance(it, dict) else None
                    if q in seen:
                        print('  extras warning %s: q_id %s is also in %s (the app keeps the last one).' % (fn, q, seen[q]))
                    elif q:
                        seen[q] = fn
                if errs:
                    failed = True
                else:
                    print('  extras %s: ok (%s%d follow-up item(s))' % (fn, 'explanation, ' if isinstance(x, dict) and x.get('explanation') else '', len(lst(x.get('items')))))
        if blockers:
            failed = True
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
