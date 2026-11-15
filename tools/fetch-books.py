#!/usr/bin/env python3
"""Downloads OpenStax book PDFs into tools/cache/ (skips books already there).

  python tools/fetch-books.py calc1 calc3 cp
"""
import os, sys, urllib.request
BASE = 'https://assets.openstax.org/oscms-prodcms/media/documents/'
BOOKS = {
    'calc1': 'calculus-volume-1_-_WEB.pdf', 'calc2': 'calculus-volume-2_-_WEB.pdf', 'calc3': 'calculus-volume-3_-_WEB.pdf',
    'cp': 'college-physics-2e_-_WEB.pdf', 'up1': 'university-physics-volume-1_-_WEB.pdf', 'up2': 'university-physics-volume-2_-_WEB.pdf',
    'at': 'algebra-and-trigonometry-2e_-_WEB.pdf', 'ph': 'Physics_-_WEB.pdf', 'cm': 'contemporary-mathematics_-_WEB.pdf',
    'is': 'introductory-statistics-2e_-_WEB.pdf', 'cb': 'Concepts-Biology_-_WEB.pdf', 'b2': 'Biology-2e_-_WEB.pdf', 'ch': 'chemistry-2e_-_WEB.pdf',
}
cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')
os.makedirs(cache, exist_ok=True)
failed = []
for key in sys.argv[1:] or list(BOOKS):
    name = BOOKS.get(key, key)
    p = os.path.join(cache, name)
    if os.path.exists(p):
        print('have', name); continue
    print('downloading', name, '...', flush=True)
    try:
        req = urllib.request.Request(BASE + name, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=120) as r, open(p + '.part', 'wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b: break
                f.write(b)
        os.replace(p + '.part', p)
        print('  ok', os.path.getsize(p) // (1 << 20), 'MB')
    except Exception as e:
        failed.append(name); print('  FAILED:', e)
print('done' if not failed else 'failed: ' + ', '.join(failed))
