#!/usr/bin/env python3
"""Downloads the open-licence physics/maths textbooks into tools/cache/open-books/.
Skips files already present. Tries known direct links first, then scrapes the
book's web page for PDF links. Run:  python tools/fetch-open-books.py [key ...]
"""
import os, re, sys, urllib.request, urllib.parse

UA = {'User-Agent': 'Mozilla/5.0'}
# key: (output file, [direct urls], [(page url, regex that the pdf link must match)])
BOOKS = {
 'clp1':   ('CLP-1-differential-calculus.pdf', ['https://personal.math.ubc.ca/~CLP/CLP1/clp_1_dc_text.pdf'], [('https://personal.math.ubc.ca/~CLP/CLP1/', r'text.*\.pdf$')]),
 'clp1p':  ('CLP-1-problems.pdf', ['https://personal.math.ubc.ca/~CLP/CLP1/clp_1_dc_problems.pdf'], [('https://personal.math.ubc.ca/~CLP/CLP1/', r'problem.*\.pdf$')]),
 'clp2':   ('CLP-2-integral-calculus.pdf', ['https://personal.math.ubc.ca/~CLP/CLP2/clp_2_ic_text.pdf'], [('https://personal.math.ubc.ca/~CLP/CLP2/', r'text.*\.pdf$')]),
 'clp2p':  ('CLP-2-problems.pdf', ['https://personal.math.ubc.ca/~CLP/CLP2/clp_2_ic_problems.pdf'], [('https://personal.math.ubc.ca/~CLP/CLP2/', r'problem.*\.pdf$')]),
 'clp3':   ('CLP-3-multivariable-calculus.pdf', ['https://personal.math.ubc.ca/~CLP/CLP3/clp_3_mc_text.pdf'], [('https://personal.math.ubc.ca/~CLP/CLP3/', r'text.*\.pdf$')]),
 'clp3p':  ('CLP-3-problems.pdf', ['https://personal.math.ubc.ca/~CLP/CLP3/clp_3_mc_problems.pdf'], [('https://personal.math.ubc.ca/~CLP/CLP3/', r'problem.*\.pdf$')]),
 'clp4':   ('CLP-4-vector-calculus.pdf', ['https://personal.math.ubc.ca/~CLP/CLP4/clp_4_vc_text.pdf'], [('https://personal.math.ubc.ca/~CLP/CLP4/', r'text.*\.pdf$')]),
 'clp4p':  ('CLP-4-problems.pdf', ['https://personal.math.ubc.ca/~CLP/CLP4/clp_4_vc_problems.pdf'], [('https://personal.math.ubc.ca/~CLP/CLP4/', r'problem.*\.pdf$')]),
 'apex':   ('APEX-Calculus.pdf', [], [('https://www.apexcalculus.com/downloads/', r'\.pdf$'), ('https://www.apexcalculus.com/', r'\.pdf$')]),
 'sz':     ('Stitz-Zeager-Precalculus.pdf', ['https://www.stitz-zeager.com/szprecalculus07042013.pdf'], [('https://www.stitz-zeager.com/', r'precalc.*\.pdf$')]),
 'hef':    ('Hefferon-Linear-Algebra.pdf', ['https://hefferon.net/linearalgebra/book.pdf'], [('https://hefferon.net/linearalgebra/', r'\.pdf$')]),
 'schnick':('Schnick-Calculus-Based-Physics.pdf', ['https://batch.libretexts.org/print/Letter/Finished/phys-1949/Full.pdf'], [('https://phys.libretexts.org/Bookshelves/University_Physics/Book%3A_Calculus-Based_Physics_(Schnick)/', r'\.pdf$')]),
 'lm':     ('Crowell-Light-and-Matter.pdf', ['https://www.lightandmatter.com/lm.pdf'], [('https://www.lightandmatter.com/books.html', r'lm.*\.pdf$')]),
 'mech':   ('Crowell-Mechanics.pdf', [], [('https://www.lightandmatter.com/books.html', r'mech.*\.pdf$')]),
 'fc':     ('Crowell-Fields-and-Circuits.pdf', [], [('https://www.lightandmatter.com/books.html', r'(fields|circuits|fc).*\.pdf$')]),
 'conc':   ('Crowell-Conceptual-Physics.pdf', [], [('https://www.lightandmatter.com/books.html', r'conceptual.*\.pdf$')]),
 'dyn':    ('Steeneken-Introductory-Dynamics.pdf', [], [('https://books.open.tudelft.nl/home/catalog/category/textbooks', r'dynamics')]),
 'perf':   ('Ruijgrok-Elements-of-Airplane-Performance.pdf', [], [('https://books.open.tudelft.nl/home/catalog/category/textbooks', r'airplane')]),
 'optics': ('TUDelft-BSc-Optics-2e.pdf', [], [('https://books.open.tudelft.nl/home/catalog/category/textbooks', r'optics')]),
}

def get(url, timeout=120):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)

def save_pdf(url, path):
    with get(url) as r:
        head = r.read(5)
        if head != b'%PDF-':
            raise ValueError('not a PDF')
        with open(path + '.part', 'wb') as f:
            f.write(head)
            while True:
                b = r.read(1 << 20)
                if not b: break
                f.write(b)
    if os.path.getsize(path + '.part') < 200_000:
        os.remove(path + '.part'); raise ValueError('file too small')
    os.replace(path + '.part', path)

def hrefs(page):
    html = get(page, 60).read().decode('utf-8', 'ignore')
    return [urllib.parse.urljoin(page, h) for h in re.findall(r'href=["\']([^"\']+)["\']', html, re.I)]

def candidates(page, rx):
    out = []
    for h in hrefs(page):
        if re.search(rx, h, re.I): out.append(h)
    return out

def tudelft_download(link):
    """TU Delft OPEN: book page -> '/view/<id>' / '/download/<id>/<file>' PDF links."""
    res = []
    for h in hrefs(link):
        if '/download/' in h or h.lower().endswith('.pdf'): res.append(h)
        elif '/view/' in h: 
            try: res += [x.replace('/view/', '/download/') for x in [h]]
            except Exception: pass
    return res

cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache', 'open-books')
os.makedirs(cache, exist_ok=True)
failed = []
for key in sys.argv[1:] or list(BOOKS):
    name, direct, pages = BOOKS[key]
    p = os.path.join(cache, name)
    if os.path.exists(p):
        print('have', name); continue
    print('downloading', name, '...', flush=True)
    urls = list(direct)
    for page, rx in pages:
        try:
            for c in candidates(page, rx):
                if 'tudelft' in page and not c.lower().endswith('.pdf'):
                    # book page link -> look for its PDF download
                    try: urls += tudelft_download(c)
                    except Exception: pass
                else:
                    urls.append(c)
        except Exception as e:
            print('  page failed:', page, e)
    done = False
    for u in dict.fromkeys(urls):
        try:
            save_pdf(u, p); done = True
            print('  ok', os.path.getsize(p) // (1 << 20), 'MB  <-', u); break
        except Exception as e:
            print('  skip', u, '-', e)
    if not done:
        failed.append(name)
        print('  FAILED:', name, '(download it by hand from', pages[0][0] if pages else '?', 'and save into', cache, ')')
print('done' if not failed else 'failed: ' + ', '.join(failed))
