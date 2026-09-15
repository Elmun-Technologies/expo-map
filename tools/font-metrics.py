#!/usr/bin/env python3
"""Точные ширины текста (DejaVu Sans / DejaVu Sans Bold) → JSON для проверки чистоты листа.

    python3 tools/font-metrics.py > /tmp/dejavu-metrics.json
"""
import json
import os
import sys

FONTS = {
    'bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'regular': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
}


def main() -> int:
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print('нет fonttools: pip install fonttools', file=sys.stderr)
        return 3

    # только нужные знаки: латиница, кириллица, цифры, типографика — файл выходит компактным
    keep = set()
    keep.update(range(0x20, 0x7F))        # латиница, цифры, знаки
    keep.update(range(0x401, 0x460))      # кириллица + Ё
    keep.update(range(0x2010, 0x2016))    # дефисы и тире
    keep.update(range(0x2018, 0x201E))    # кавычки
    keep.update([0x00A0, 0x00AB, 0x00BB, 0x00B2, 0x00B3, 0x00D7, 0x2022, 0x2026,
                 0x2116, 0x02BB, 0x02BC, 0x2039, 0x203A, 0x2212, 0x00B0])

    out = {'unitsPerEm': 2048, 'fonts': {}}
    for name, path in FONTS.items():
        if not os.path.exists(path):
            print(f'нет файла шрифта: {path}', file=sys.stderr)
            return 4
        font = TTFont(path, fontNumber=0, lazy=True)
        upem = font['head'].unitsPerEm
        cmap = font.getBestCmap()
        hmtx = font['hmtx']
        table = {}
        for code, glyph in cmap.items():
            if code not in keep:
                continue
            adv = hmtx[glyph][0]
            table[chr(code)] = round(adv / upem, 6)
        out['unitsPerEm'] = upem
        out['fonts'][name] = table
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == '__main__':
    sys.exit(main())
