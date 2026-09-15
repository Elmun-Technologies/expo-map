#!/usr/bin/env python3
"""
SVG -> bir varaqli PDF (A3 landscape) — mijozga yuborish uchun tayyor fayl.

Ishlatish:
    python3 tools/export-pdf.py exports/foodera-2026/01-xarita.svg exports/foodera-2026/01-xarita.pdf
    python3 tools/export-pdf.py kirish.svg chiqish.pdf --page A2 --margin 6

Nega shunday: brauzerdagi "Save as PDF" ko'p varaqqa bo'lib tashlaydi va
yozuvlar ustma-ust tushadi. Bu skript SVG'ni BITTA varaqqa (A3 landscape)
to'liq sig'diradi, shriftlarni (kirill + o'zbek harflari) PDF ichiga joylaydi.
"""
import argparse
import os
import re
import sys
import tempfile

FONT_DIR = '/usr/share/fonts/truetype/dejavu'
FONT_FILES = {
    # имя шрифта в SVG -> файл TTF
    'DejaVuSans': 'DejaVuSans.ttf',
    'DejaVuSansBold': 'DejaVuSans-Bold.ttf',
    'DejaVuSans-Bold': 'DejaVuSans-Bold.ttf',
    'Helvetica': 'DejaVuSans.ttf',
    'Helvetica-Bold': 'DejaVuSans-Bold.ttf',
    'Helvetica-Oblique': 'DejaVuSans.ttf',
    'Times-Roman': 'DejaVuSerif.ttf',
}


def register_fonts():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    ok = []
    for name, fname in FONT_FILES.items():
        path = os.path.join(FONT_DIR, fname)
        if not os.path.exists(path):
            continue
        try:
            pdfmetrics.registerFont(TTFont(name, path))
            ok.append(name)
        except Exception:
            pass
    return ok


def inline_font_family(svg):
    """svglib ota-elementdagi font-family'ni meros olmaydi -> har bir <text> ga yozamiz."""
    def fix(m):
        tag = m.group(0)
        if 'font-family=' in tag:
            return tag
        return tag[:-1] + ' font-family="DejaVuSans">'
    return re.sub(r'<text\b[^>]*>', fix, svg)


# svglib в этой версии не находит bold-шрифт и подменяет его на 'Helvetica'.
# Поэтому имена шрифтов внутри SVG правим сами.
FONT_MAP = {
    'Helvetica': 'DejaVuSans-Bold',      # сюда попадает весь жирный текст
    'Helvetica-Bold': 'DejaVuSans-Bold',
    'Helvetica-Oblique': 'DejaVuSans',
    'DejaVuSansBold': 'DejaVuSans-Bold',
    'DejaVuSans-Bold': 'DejaVuSans-Bold',
    'DejaVuSans': 'DejaVuSans',
    'Arial': 'DejaVuSans',
    'Times-Roman': 'DejaVuSerif',
}


def remap_fonts(drawing):
    """Chizmadagi matnlar shriftini ro'yxatdan o'tgan TTF'larga bog'laydi (kirill ishlashi uchun)."""
    used = set()

    def walk(node):
        for c in getattr(node, 'contents', []) or []:
            fn = getattr(c, 'fontName', None)
            if fn:
                new = FONT_MAP.get(fn, 'DejaVuSans')
                c.fontName = new
                used.add(new)
            walk(c)

    walk(drawing)
    return used


def convert(src, dst, page='A3', margin_mm=8.0, title=None):
    from reportlab.lib.pagesizes import A2, A3, A4, landscape  # noqa
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    from svglib.svglib import svg2rlg

    pages = {'A4': A4, 'A3': A3, 'A2': A2}
    pw, ph = landscape(pages[str(page).upper()])

    fonts = register_fonts()
    svg = inline_font_family(open(src, encoding='utf-8').read())
    tmp = tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False, encoding='utf-8')
    tmp.write(svg)
    tmp.close()
    try:
        drawing = svg2rlg(tmp.name)
    finally:
        os.unlink(tmp.name)
    if drawing is None or not drawing.width or not drawing.height:
        raise SystemExit('✗ SVG o‘qib bo‘lmadi: %s' % src)
    used = remap_fonts(drawing)
    missing = [f for f in used if f not in fonts]

    m = margin_mm * mm
    k = min((pw - 2 * m) / drawing.width, (ph - 2 * m) / drawing.height)
    w, h = drawing.width * k, drawing.height * k

    c = canvas.Canvas(dst, pagesize=(pw, ph))
    if title:
        c.setTitle(title)
    c.setAuthor('FOODERA EXPO 2026')
    c.translate((pw - w) / 2.0, (ph - h) / 2.0)
    c.scale(k, k)
    drawing.drawOn(c, 0, 0)
    c.showPage()
    c.save()
    return dict(page=page.upper(), px=round(w, 1), py=round(h, 1), k=round(k, 4),
                fonts=fonts, used=used, missing=missing)


def main():
    ap = argparse.ArgumentParser(description='SVG -> bir varaqli PDF (A3 landscape)')
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--page', default='A3', help='A4 | A3 | A2 (default: A3)')
    ap.add_argument('--margin', type=float, default=8.0, help='hoshiya, mm (default: 8)')
    ap.add_argument('--title', default=None)
    a = ap.parse_args()
    info = convert(a.src, a.dst, a.page, a.margin, a.title)
    print('✓ %s — %s varaq (%s landscape, %.0f×%.0f pt, shrift: %s%s)'
          % (a.dst, 1, info['page'], info['px'], info['py'],
             ', '.join(sorted(info['used'])) or '—',
             (' | YO\'Q: ' + ', '.join(info['missing'])) if info['missing'] else ''))


if __name__ == '__main__':
    main()
