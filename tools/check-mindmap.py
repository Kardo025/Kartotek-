"""Checks the files of one Kartotek mind map against MINDMAP-RULES.md.

Usage:  python tools/check-mindmap.py mindmaps/<map-id>
Checks map.json, turns/*.json, grades/*.json and reference.json. Exit code 1 when there are errors.
Needs only the standard library. It compares view sizes with the JPEG/PNG photos (EXIF orientation applied);
with Pillow installed it uses Pillow for that instead. No install is needed.
"""
import json, os, re, sys

E = {
    'role': {'overview', 'center', 'right', 'left', 'detail', 'other'},
    'issue': {'small_text', 'blur', 'glare', 'cut_off', 'perspective', 'occlusion', 'low_light', 'rotation', 'other'},
    'okind': {'text', 'node', 'line', 'arrowhead', 'junction', 'group_boundary', 'symbol', 'emphasis', 'possible_deletion'},
    'text_role': {'concept', 'heading', 'question', 'answer', 'annotation', 'example', 'label', 'unknown'},
    'odir': {'forward', 'bidirectional', 'none', 'unknown'},
    'udim': {'text', 'endpoints', 'direction', 'junction', 'group', 'symbol_meaning', 'emphasis_meaning', 'image_coverage'},
    'impact': {'blocking', 'local_only', 'noncritical'},
    'verif': {'provisional', 'visually_supported', 'unresolved'},
    'corr': {'candidate', 'visually_supported', 'rejected'},
    'vkind': {'table', 'chart', 'schematic', 'timeline', 'code_or_notation', 'question', 'annotation', 'matrix', 'hierarchy'},
    'vstatus': {'provisional', 'partially_read', 'reviewed'},
    'rdir': {'forward', 'bidirectional', 'undirected', 'unknown'},
    'shape': {'arrow', 'line', 'branch', 'bracket', 'other'},
    'rtype': {'causes', 'influences', 'requires', 'precedes', 'part_of', 'example_of', 'contrasts_with', 'associated_with',
              'supports', 'inhibits', 'explains', 'custom'},
    'rstatus': {'supported_by_source', 'contradicted_by_source', 'unresolved', 'conflicting_sources'},
    'emph': {'backbone', 'secondary', 'detail'},
    'qkind': {'text', 'direction', 'endpoints', 'junction', 'group', 'deletion', 'color', 'coverage', 'role'},
    'qimpact': {'blocking', 'local_only'},
    'scope': {'partial', 'ready_for_requested_scope', 'needs_better_input'},
    'mode': {'coach', 'diagnose', 'worked_example', 'reference', 'retrieval', 'capture'},
    'state': {'INTERPRETATION_REVIEW', 'TARGETED_CONFIRMATION', 'GOAL_AND_BASELINE', 'DRAFT', 'GROUP', 'RELATE', 'INTEGRATE',
              'COMPARE_ALTERNATIVES', 'EMPHASIZE_AND_COMPRESS', 'EXPLAIN', 'RETRIEVE_OR_APPLY', 'REVIEW_PLAN', 'HELP', 'PAUSED', 'COMPLETE'},
    'dim': {'accuracy', 'grouping', 'relational_clarity', 'integration', 'compression_fidelity', 'emphasis',
            'alternative_evaluation', 'independent_retrieval', 'transfer', 'representation'},
    'dstatus': {'not_observed', 'needs_support', 'developing', 'demonstrated'},
    'action': {'answer_question', 'confirm_reading', 'add_closeup', 'name_criterion', 'explain_relation', 'label_connection',
               'compare_frame', 'choose_backbone', 'explain_backbone', 'retrieval_check', 'try_example', 'reduce_scope', 'pause', 'none'},
    'tkind': {'definition', 'relation', 'group_rationale', 'backbone_explanation', 'application'},
    'tvalid': {'draft', 'source_checked'},
    'outcome': {'correct', 'partial', 'incorrect', 'uncertain'},
    'op': {'add_concept', 'update_concept', 'remove_concept', 'add_group', 'update_group', 'set_members', 'remove_group',
           'add_relation', 'update_relation', 'remove_relation', 'add_open_question', 'resolve_open_question'},
}
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$')


class Check:
    def __init__(self, where):
        self.where, self.errors, self.warnings = where, [], []

    def err(self, msg): self.errors.append('%s: %s' % (self.where, msg))
    def warn(self, msg): self.warnings.append('%s: %s' % (self.where, msg))

    def enum(self, v, key, path, allow_none=False):
        if v is None and allow_none: return
        if v not in E[key]: self.err('%s = %r is not one of %s' % (path, v, '|'.join(sorted(E[key]))))

    def ids(self, items, path):
        seen = set()
        for i, x in enumerate(items or []):
            if not isinstance(x, dict): self.err('%s[%d] is not an object' % (path, i)); continue
            v = x.get('id')
            if not isinstance(v, str) or not ID.match(v): self.err('%s[%d].id %r is not a valid id' % (path, i, v))
            elif v in seen: self.err('%s: duplicate id %s' % (path, v))
            seen.add(v)
        return seen

    def refs(self, lst, known, path, nonempty=False):
        if lst is None: lst = []
        if not isinstance(lst, list): self.err('%s must be a list' % path); return
        if nonempty and not lst: self.err('%s must not be empty' % path)
        for r in lst:
            if r not in known: self.err('%s: unknown id %r' % (path, r))


def words(s): return len(str(s or '').split())


def image_size(fp):
    """Upright (width, height) of a JPEG or PNG with the standard library only (EXIF orientation 5-8 swaps). None if unknown."""
    import struct
    try:
        with open(fp, 'rb') as f: data = f.read()
    except OSError:
        return None
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', data[16:24])
    if data[:2] != b'\xff\xd8':
        return None
    i, size, orient = 2, None, 1
    while i + 4 <= len(data):
        if data[i] != 0xFF: i += 1; continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7: i += 2; continue
        seg = struct.unpack('>H', data[i + 2:i + 4])[0]
        body = data[i + 4:i + 2 + seg]
        if marker == 0xE1 and body[:6] == b'Exif\x00\x00':
            t = body[6:]
            end = '<' if t[:2] == b'II' else '>'
            try:
                ifd = struct.unpack(end + 'I', t[4:8])[0]
                for k in range(struct.unpack(end + 'H', t[ifd:ifd + 2])[0]):
                    e = t[ifd + 2 + 12 * k: ifd + 14 + 12 * k]
                    if struct.unpack(end + 'H', e[:2])[0] == 0x0112: orient = struct.unpack(end + 'H', e[8:10])[0]
            except struct.error:
                pass
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack('>HH', body[1:5]); size = (w, h); break
        i += 2 + seg
    if size and orient in (5, 6, 7, 8): size = (size[1], size[0])
    return size


def check_evidence(c, ev, path, sources=None):
    for j, e in enumerate(ev or []):
        if not isinstance(e, dict) or not e.get('source') or not str(e.get('quote') or '').strip():
            c.err('%s[%d] needs source and quote' % (path, j)); continue
        if words(e.get('quote')) > 25: c.warn('%s[%d].quote is longer than 25 words' % (path, j))
        if sources is not None and e['source'] not in sources: c.warn('%s[%d].source %r is not a source of this map' % (path, j, e['source']))


def check_map(folder, m):
    c = Check('map.json')
    if m.get('schema') != 'kmind-map-1': c.err('schema must be "kmind-map-1"')
    mid = m.get('map_id')
    if mid != os.path.basename(os.path.normpath(folder)): c.err('map_id %r must equal the folder name' % mid)
    if not isinstance(m.get('parse_rev'), int) or m['parse_rev'] < 1: c.err('parse_rev must be an integer >= 1')
    for k in ('parsed_at', 'title'):
        if not m.get(k): c.err('%s is missing' % k)
    views = m.get('views') or []
    if not views: c.err('views is empty')
    vids = c.ids(views, 'views')
    for i, v in enumerate(views):
        p = 'views[%d]' % i
        c.enum(v.get('role'), 'role', p + '.role')
        if v.get('role_source') not in ('learner', 'inferred'): c.err(p + '.role_source must be learner|inferred')
        for k in ('width', 'height'):
            if not isinstance(v.get(k), int) or v[k] <= 0: c.err('%s.%s must be a positive integer' % (p, k))
        f = v.get('file') or ''
        fp = os.path.join(folder, f)
        if not f.startswith('views/'): c.err(p + '.file must be inside views/')
        elif not os.path.exists(fp): c.warn(p + '.file %s not found' % f)
        else:
            try:
                from PIL import Image, ImageOps
                im = ImageOps.exif_transpose(Image.open(fp))
                size = (im.width, im.height)
            except ImportError:
                size = image_size(fp)
            if size and tuple(size) != (v.get('width'), v.get('height')):
                c.err('%s: width/height %sx%s differ from the upright photo %dx%d' % (p, v.get('width'), v.get('height'), size[0], size[1]))
            elif not size: c.warn(p + ': could not read the photo size to compare')
        cv = v.get('covers')
        if cv is not None:
            b = (cv or {}).get('box')
            if not isinstance(cv, dict) or cv.get('view') == v.get('id'): c.err(p + '.covers must name another view')
            elif not (isinstance(b, list) and len(b) == 4 and all(isinstance(x, (int, float)) for x in b)) or b[2] <= 0 or b[3] <= 0 or b[0] < 0 or b[1] < 0 or b[0] + b[2] > 1.001 or b[1] + b[3] > 1.001:
                c.err(p + '.covers.box must be [x, y, w, h] inside 0..1')
        q = v.get('quality') or {}
        if not isinstance(q.get('usable'), bool): c.err(p + '.quality.usable must be true/false')
        for j, iss in enumerate(q.get('issues') or []): c.enum(iss.get('kind'), 'issue', '%s.quality.issues[%d].kind' % (p, j))
    regions = m.get('regions') or []
    rids = c.ids(regions, 'regions')
    rview = {}
    for i, r in enumerate(regions):
        p = 'regions[%d]' % i
        if r.get('view') not in vids: c.err(p + '.view %r is not a view id' % r.get('view'))
        rview[r.get('id')] = r.get('view')
        b = r.get('box')
        if not (isinstance(b, list) and len(b) == 4 and all(isinstance(x, (int, float)) for x in b)):
            c.err(p + '.box must be [x, y, w, h]'); continue
        x, y, w, h = b
        if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > 1.001 or y + h > 1.001: c.err(p + '.box %r is outside 0..1' % b)
    obs = m.get('observations') or []
    oids = c.ids(obs, 'observations')
    for i, o in enumerate(obs):
        p = 'observations[%d] (%s)' % (i, o.get('id'))
        c.enum(o.get('kind'), 'okind', p + '.kind')
        c.refs(o.get('regions'), rids, p + '.regions', nonempty=True)
        c.enum(o.get('verification', 'provisional'), 'verif', p + '.verification')
        if o.get('kind') == 'text':
            if o.get('raw') is None and o.get('verification') != 'unresolved' and not o.get('candidates'):
                c.err(p + ': text without raw reading must be unresolved or have candidates')
            c.enum(o.get('text_role', 'unknown'), 'text_role', p + '.text_role')
        if len(o.get('candidates') or []) > 3: c.warn(p + ': more than 3 candidates')
        if o.get('kind') == 'line':
            c.refs(o.get('from'), oids | set(x.get('id') for x in obs), p + '.from')
            c.refs(o.get('to'), oids | set(x.get('id') for x in obs), p + '.to')
            c.enum(o.get('direction'), 'odir', p + '.direction')
            if o.get('direction') in ('forward', 'bidirectional') and not o.get('from'):
                c.warn(p + ': a directed line without endpoint candidates')
        for j, u in enumerate(o.get('uncertainty') or []):
            c.enum(u.get('dim'), 'udim', '%s.uncertainty[%d].dim' % (p, j))
            c.enum(u.get('impact'), 'impact', '%s.uncertainty[%d].impact' % (p, j))
            if not u.get('reason'): c.err('%s.uncertainty[%d].reason is missing' % (p, j))
        st = o.get('style') or {}
        for bad in ('meaning', 'group', 'correct', 'mood'):
            if bad in st: c.err(p + '.style.%s: colors and styles carry no meaning (MINDMAP-RULES §2.4)' % bad)
    for i, x in enumerate(m.get('correspondences') or []):
        p = 'correspondences[%d]' % i
        c.refs(x.get('regions'), rids, p + '.regions', nonempty=True)
        if len(set(rview.get(r) for r in x.get('regions') or [])) < 2: c.err(p + ': regions must be in at least two views')
        if x.get('observation') is not None and x.get('observation') not in oids: c.err(p + '.observation unknown')
        c.enum(x.get('status'), 'corr', p + '.status')
        if not x.get('basis'): c.err(p + '.basis is missing')
    objs = m.get('objects') or []
    c.ids(objs, 'objects')
    for i, v in enumerate(objs):
        p = 'objects[%d] (%s)' % (i, v.get('id'))
        c.enum(v.get('kind'), 'vkind', p + '.kind')
        c.refs(v.get('regions'), rids, p + '.regions', nonempty=True)
        c.refs(v.get('observations'), oids, p + '.observations')
        c.enum(v.get('status'), 'vstatus', p + '.status')
        if not isinstance(v.get('payload'), dict): c.err(p + '.payload must be an object')
        elif v.get('kind') == 'table':
            pl = v['payload']
            if not isinstance(pl.get('rows'), list): c.err(p + '.payload.rows must be a list')
    lm = m.get('learner_map') or {}
    if not isinstance(m.get('learner_map'), dict): c.err('learner_map is missing')
    kids = c.ids(lm.get('concepts'), 'learner_map.concepts')
    gids = c.ids(lm.get('groups'), 'learner_map.groups')
    eids = c.ids(lm.get('relations'), 'learner_map.relations')
    if kids & gids or kids & eids or gids & eids: c.err('learner_map: concept, group and relation ids must not overlap')
    for i, k in enumerate(lm.get('concepts') or []):
        p = 'learner_map.concepts[%d] (%s)' % (i, k.get('id'))
        if not str(k.get('label') or '').strip(): c.err(p + '.label is empty')
        c.refs(k.get('observations'), oids, p + '.observations', nonempty=True)
    for i, g in enumerate(lm.get('groups') or []):
        p = 'learner_map.groups[%d] (%s)' % (i, g.get('id'))
        c.refs(g.get('members'), kids, p + '.members')
        c.refs(g.get('observations'), oids, p + '.observations', nonempty=True)
    for i, e in enumerate(lm.get('relations') or []):
        p = 'learner_map.relations[%d] (%s)' % (i, e.get('id'))
        for k in ('from', 'to'):
            if e.get(k) not in kids: c.err('%s.%s %r is not a concept' % (p, k, e.get(k)))
        c.enum(e.get('type', 'custom'), 'rtype', p + '.type')
        c.enum(e.get('direction'), 'rdir', p + '.direction')
        c.enum(e.get('shape', 'other'), 'shape', p + '.shape')
        c.refs(e.get('observations'), oids, p + '.observations', nonempty=True)
    qs = m.get('questions') or []
    c.ids(qs, 'questions')
    if len(qs) > 8: c.warn('more than 8 questions: ask only the consequential ones')
    for i, q in enumerate(qs):
        p = 'questions[%d] (%s)' % (i, q.get('id'))
        # A coverage question may point only at an unreviewed area (scope.unreviewed[area]); every other question needs observations
        c.refs(q.get('about'), oids, p + '.about', nonempty=q.get('kind') != 'coverage')
        if q.get('area') is not None:
            un = (m.get('scope') or {}).get('unreviewed') or []
            if not isinstance(q.get('area'), int) or not 0 <= q['area'] < len(un): c.err(p + '.area must be an index of scope.unreviewed')
        if q.get('areas') is not None:
            un = (m.get('scope') or {}).get('unreviewed') or []
            if not isinstance(q.get('areas'), list) or any(not isinstance(x, int) or not 0 <= x < len(un) for x in q['areas']): c.err(p + '.areas must list indexes of scope.unreviewed')
        if q.get('kind') == 'coverage' and not q.get('about') and q.get('area') is None and not q.get('areas') and q.get('region') is None:
            c.err(p + ': a coverage question needs about, area or region')
        if q.get('region') is not None and q.get('region') not in rids: c.err(p + '.region unknown')
        c.enum(q.get('kind'), 'qkind', p + '.kind')
        c.enum(q.get('impact'), 'qimpact', p + '.impact')
        if not q.get('text'): c.err(p + '.text is missing')
        if q.get('kind') == 'color' and re.search(r'legend|every color|all colou?rs', q.get('text', ''), re.I):
            c.err(p + ': no global color legend for this learner (MINDMAP-RULES §2.4)')
    sc = m.get('scope') or {}
    c.enum(sc.get('status'), 'scope', 'scope.status')
    if not isinstance(sc.get('possible_unseen'), bool): c.err('scope.possible_unseen must be true/false')
    for i, u in enumerate(sc.get('unreviewed') or []):
        if u.get('region') is None and u.get('view') not in vids: c.err('scope.unreviewed[%d] needs a region or a view' % i)
    hw = m.get('handwriting')
    if hw is not None:
        if not isinstance(hw, list): c.err('handwriting must be a list')
        else:
            c.ids(hw, 'handwriting')
            for i, x in enumerate(hw):
                if not str((x or {}).get('text') or '').strip(): c.err('handwriting[%d].text is missing' % i)
                if re.search(r'colou?r', str((x or {}).get('text') or ''), re.I): c.err('handwriting[%d]: not for colors (they carry no meaning)' % i)
                c.refs((x or {}).get('regions'), rids, 'handwriting[%d].regions' % i)
    if not str(m.get('report') or '').strip(): c.err('report is missing')
    elif words(m['report']) > 300: c.warn('report is longer than 250 words')
    return c, {'concepts': kids, 'groups': gids, 'relations': eids, 'observations': oids}


def check_ops(c, ops, ids, path):
    known = {k: set(v) for k, v in ids.items() if k in ('concepts', 'groups', 'relations')}
    for i, op in enumerate(ops or []):
        p = '%s[%d]' % (path, i)
        c.enum(op.get('op'), 'op', p + '.op')
        o = op.get('op') or ''
        if o == 'add_concept':
            k = op.get('concept') or {}
            if not ID.match(str(k.get('id') or '')) or not str(k.get('label') or '').strip(): c.err(p + ': concept needs id and label')
            else: known['concepts'].add(k['id'])
        elif o == 'add_group':
            g = op.get('group') or {}
            if not ID.match(str(g.get('id') or '')): c.err(p + ': group needs an id')
            else: known['groups'].add(g['id'])
            c.refs(g.get('members'), known['concepts'], p + '.group.members')
        elif o == 'add_relation':
            e = op.get('relation') or {}
            for k in ('from', 'to'):
                if e.get(k) not in known['concepts']: c.err('%s: relation.%s %r is not a concept' % (p, k, e.get(k)))
            c.enum(e.get('type', 'custom'), 'rtype', p + '.relation.type')
            c.enum(e.get('direction', 'unknown'), 'rdir', p + '.relation.direction')
            if e.get('status') is not None: c.enum(e.get('status'), 'rstatus', p + '.relation.status')
            if e.get('emphasis') is not None: c.enum(e.get('emphasis'), 'emph', p + '.relation.emphasis')
            if ID.match(str(e.get('id') or '')): known['relations'].add(e['id'])
            else: c.err(p + ': relation needs an id')
        elif o in ('update_concept', 'remove_concept'):
            if op.get('id') not in known['concepts']: c.err(p + ': unknown concept %r' % op.get('id'))
        elif o in ('update_group', 'set_members', 'remove_group'):
            if op.get('id') not in known['groups']: c.err(p + ': unknown group %r' % op.get('id'))
            if o == 'set_members': c.refs(op.get('members'), known['concepts'], p + '.members')
        elif o in ('update_relation', 'remove_relation'):
            if op.get('id') not in known['relations']: c.err(p + ': unknown relation %r' % op.get('id'))
            s = op.get('set') or {}
            if 'type' in s: c.enum(s['type'], 'rtype', p + '.set.type')
            if 'direction' in s: c.enum(s['direction'], 'rdir', p + '.set.direction')
            if 'status' in s: c.enum(s['status'], 'rstatus', p + '.set.status')
            if 'emphasis' in s: c.enum(s['emphasis'], 'emph', p + '.set.emphasis')
        elif o in ('add_open_question', 'resolve_open_question'):
            if not str(op.get('text') or '').strip(): c.err(p + '.text is missing')


def check_turn(name, t, mid, ids):
    c = Check('turns/' + name)
    if t.get('schema') != 'kmind-turn-1': c.err('schema must be "kmind-turn-1"')
    if t.get('map_id') != mid: c.err('map_id must be %r' % mid)
    n = re.match(r'^(\d{3})\.json$', name)
    if not n: c.err('file name must be NNN.json')
    elif t.get('turn') != int(n.group(1)): c.err('turn %r does not match the file name' % t.get('turn'))
    if not t.get('request_id'): c.err('request_id is missing (copy it from the prompt)')
    c.enum(t.get('mode'), 'mode', 'mode')
    c.enum(t.get('state'), 'state', 'state')
    if not isinstance(t.get('based_on_version'), int): c.err('based_on_version must be an integer')
    msg = str(t.get('message') or '')
    if not msg.strip(): c.err('message is empty')
    elif words(msg) > 160: c.warn('message is longer than 120 words')
    sc = t.get('scope')
    if sc is not None:
        c.enum(sc.get('status'), 'scope', 'scope.status')
        c.refs(sc.get('included'), ids['observations'], 'scope.included')
        c.refs(sc.get('unresolved'), ids['observations'], 'scope.unresolved')
    ob = t.get('observation')
    if ob is not None:
        c.enum(ob.get('dimension'), 'dim', 'observation.dimension')
        c.enum(ob.get('status'), 'dstatus', 'observation.status')
        if not ob.get('basis'): c.err('observation.basis is missing')
        check_evidence(c, ob.get('evidence'), 'observation.evidence')
        c.refs(ob.get('visual_observation_ids'), ids['observations'], 'observation.visual_observation_ids')
    na = t.get('next_action') or {}
    c.enum(na.get('type'), 'action', 'next_action.type')
    if na.get('hint_level') not in (0, 1, 2, 3, 4): c.err('next_action.hint_level must be 0..4')
    if not isinstance(na.get('answer_exposed'), bool): c.err('next_action.answer_exposed must be true/false')
    if t.get('mode') == 'worked_example' and not na.get('answer_exposed'): c.warn('a worked example usually exposes an answer')
    pt = t.get('patch')
    if pt is not None:
        if not ID.match(str(pt.get('id') or '')): c.err('patch.id is missing')
        if not isinstance(pt.get('base_version'), int): c.err('patch.base_version must be an integer')
        if not pt.get('ops'): c.err('patch.ops is empty')
        check_ops(c, pt.get('ops'), ids, 'patch.ops')
    for i, tg in enumerate(t.get('targets') or []):
        p = 'targets[%d]' % i
        if not ID.match(str(tg.get('id') or '')): c.err(p + '.id is missing')
        if not isinstance(tg.get('version'), int): c.err(p + '.version must be an integer')
        c.enum(tg.get('kind'), 'tkind', p + '.kind')
        c.enum(tg.get('validation', 'draft'), 'tvalid', p + '.validation')
        if not tg.get('prompt') or not tg.get('rubric'): c.err(p + ': prompt and rubric are required')
    return c


def check_grade(name, g, mid):
    c = Check('grades/' + name)
    if g.get('schema') != 'kmind-grade-1': c.err('schema must be "kmind-grade-1"')
    if g.get('map_id') != mid: c.err('map_id must be %r' % mid)
    if name != str(g.get('attempt_id')) + '.json': c.err('file name must be <attempt_id>.json')
    c.enum(g.get('outcome'), 'outcome', 'outcome')
    for k, v in (g.get('dimensions') or {}).items():
        c.enum(k, 'dim', 'dimensions key'); c.enum(v, 'dstatus', 'dimensions.' + k)
    if not str(g.get('feedback') or '').strip(): c.err('feedback is missing')
    check_evidence(c, g.get('evidence'), 'evidence')
    return c


def check_reference(r, mid):
    c = Check('reference.json')
    if r.get('schema') != 'kmind-reference-1': c.err('schema must be "kmind-reference-1"')
    if r.get('map_id') != mid: c.err('map_id must be %r' % mid)
    kids = c.ids(r.get('concepts'), 'concepts')
    c.ids(r.get('groups'), 'groups'); c.ids(r.get('relations'), 'relations')
    srcs = set(s.get('id') for s in r.get('sources') or [])
    for i, k in enumerate(r.get('concepts') or []): check_evidence(c, k.get('evidence'), 'concepts[%d].evidence' % i, srcs)
    for i, g in enumerate(r.get('groups') or []): c.refs(g.get('members'), kids, 'groups[%d].members' % i)
    for i, e in enumerate(r.get('relations') or []):
        for k in ('from', 'to'):
            if e.get(k) not in kids: c.err('relations[%d].%s is not a concept' % (i, k))
        c.enum(e.get('type', 'custom'), 'rtype', 'relations[%d].type' % i)
        check_evidence(c, e.get('evidence'), 'relations[%d].evidence' % i, srcs)
    return c


def load(path, c_list):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except Exception as e:
        c = Check(os.path.basename(path)); c.err('invalid JSON: %s' % e); c_list.append(c); return None


def main(folder):
    checks = []
    mp = os.path.join(folder, 'map.json')
    ids = {'concepts': set(), 'groups': set(), 'relations': set(), 'observations': set()}
    mid = os.path.basename(os.path.normpath(folder))
    if os.path.exists(mp):
        m = load(mp, checks)
        if m is not None:
            c, ids = check_map(folder, m); checks.append(c)
    else:
        c = Check('map.json'); c.warn('no map.json yet'); checks.append(c)
    td = os.path.join(folder, 'turns')
    for n in sorted(os.listdir(td)) if os.path.isdir(td) else []:
        if n.endswith('.json'):
            t = load(os.path.join(td, n), checks)
            if t is not None: checks.append(check_turn(n, t, mid, ids))
    gd = os.path.join(folder, 'grades')
    for n in sorted(os.listdir(gd)) if os.path.isdir(gd) else []:
        if n.endswith('.json'):
            g = load(os.path.join(gd, n), checks)
            if g is not None: checks.append(check_grade(n, g, mid))
    rp = os.path.join(folder, 'reference.json')
    if os.path.exists(rp):
        r = load(rp, checks)
        if r is not None: checks.append(check_reference(r, mid))
    errs = [e for c in checks for e in c.errors]
    warns = [w for c in checks for w in c.warnings]
    for w in warns: print('warning:', w)
    for e in errs: print('ERROR:', e)
    print('%s: %d error(s), %d warning(s)' % (folder, len(errs), len(warns)))
    return 1 if errs else 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(2)
    sys.exit(main(sys.argv[1]))
