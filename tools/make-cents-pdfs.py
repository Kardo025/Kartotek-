#!/usr/bin/env python3
"""Cuts the page range of each CEnT-S syllabus item out of the big OpenStax PDFs.

  python tools/make-cents-pdfs.py            all items
  python tools/make-cents-pdfs.py cents-at1.1 [cents-c4 ...]   only these

Output: <content folder>/sources/<etut_id>.pdf (kartotek.config.json; else ./sources/) (cents-... and tud-... items) (only the pages of the item, in book order).
Each book PDF is downloaded once into tools/cache/ and reused. Needs: pip install pypdf
"""
import json, os, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kconfig

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
items = json.load(open(os.path.join(here, 'cents-items.json'), encoding='utf-8'))
cache = os.path.join(here, 'cache'); out_dir = kconfig.sources_dir()
os.makedirs(cache, exist_ok=True); os.makedirs(out_dir, exist_ok=True)

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    sys.exit('pypdf is missing. Run: pip install pypdf')

def book_path(url):
    p = os.path.join(cache, os.path.basename(url))
    if not os.path.exists(p):
        print('downloading', url)
        tmp = p + '.part'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as r, open(tmp, 'wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b: break
                f.write(b)
        os.replace(tmp, p)
    return p

want = sys.argv[1:] or list(items)
readers = {}
failed = []
for key in want:
    it = items.get(key)
    if not it or not it['pdf']:
        print('skip', key); continue
    out = os.path.join(out_dir, key + '.pdf')
    if os.path.exists(out):
        print('exists', key); continue
    try:
        path = book_path(it['pdf'])
        rd = readers.get(path) or readers.setdefault(path, PdfReader(path))
        w = PdfWriter()
        for a, b in it['ranges']:
            for n in range(a, b + 1):          # PDF page numbers are 1-based
                w.add_page(rd.pages[n - 1])
        with open(out, 'wb') as f: w.write(f)
        print('wrote', key, sum(b - a + 1 for a, b in it['ranges']), 'pages')
    except Exception as e:                  # one failed book must not stop the others
        failed.append(key); print('FAILED', key, e)
if failed: print('failed:', ' '.join(failed))
