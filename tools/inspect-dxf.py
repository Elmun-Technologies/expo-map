#!/usr/bin/env python3
"""
DXF chizmani o'qib, bloklar va obyektlar haqida xom ma'lumot chiqarish.
(Tayyor layout yasamaydi — menga koordinatalarni tez aniqlash uchun yordamchi vosita.)

    python3 tools/inspect-dxf.py chizma.dxf [--min-area 4]

DXF ni avtomatik yasash mumkin: AutoCAD'da "Save As → DXF", LibreCAD/FreeCAD eksporti,
yoki DWG → DXF konvertor. Natijada layer bo'yicha to'rtburchak (LWPOLYLINE/LINE) ro'yxati chiqadi.
"""
import sys
import math
import ezdxf

path = sys.argv[1] if len(sys.argv) > 1 else None
if not path:
    print(__doc__)
    sys.exit(2)
min_area = 4.0
if '--min-area' in sys.argv:
    min_area = float(sys.argv[sys.argv.index('--min-area') + 1])

doc = ezdxf.readfile(path)
msp = doc.modelspace()
insunits = {0: "o'lchamsiz", 1: "dyuym", 4: "mm", 5: "sm", 6: "m"}.get(doc.header.get("$INSUNITS", 0), "?")
print(f"# Fayl: {path}")
print(f"# Birlik: {insunits} ($INSUNITS={doc.header.get('$INSUNITS', 0)})  Layerlar: {len(doc.layers)}")

# --- layer ro'yxati
counts = {}
for e in msp:
    counts[e.dxf.layer] = counts.get(e.dxf.layer, 0) + 1
print("\n## Layerlar (obyekt soni bilan)")
for layer, n in sorted(counts.items(), key=lambda kv: -kv[1]):
    print(f"   {n:5d}  {layer}")

# --- to'rtburchaklar (yopiq polylinelar / 4 ta chiziq / INSERT bloklari)
rects = []
for e in msp:
    t = e.dxftype()
    pts = []
    if t == "LWPOLYLINE" and e.closed:
        pts = [(p[0], p[1]) for p in e.get_points("xy")]
    elif t == "POLYLINE" and e.is_closed:
        pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
    if len(pts) >= 4:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if w * h >= min_area:
            rects.append((min(xs), min(ys), w, h, e.dxf.layer))

rects.sort(key=lambda r: (-r[2] * r[3]))
print(f"\n## To'rtburchaklar (maydoni {min_area}+ ): {len(rects)} ta")
for x, y, w, h, layer in rects:
    print(f"   x={x:9.2f} y={y:9.2f}  {w:7.2f} x {h:7.2f}  = {w*h:9.1f} m²   [{layer}]")

# --- matnlar (stend/blok nomlari bo'lishi mumkin)
texts = [(e.dxf.text if e.dxftype() == "TEXT" else e.text, (e.dxf.insert.x, e.dxf.insert.y))
         for e in msp if e.dxftype() in ("TEXT", "MTEXT")]
print(f"\n## Yozuvlar: {len(texts)} ta (birinchi 60)")
for txt, (x, y) in texts[:60]:
    print(f"   x={x:9.2f} y={y:9.2f}  {txt!r}")

# --- INSERT (blok havolalari) — chizma blok ko'rinishida chizilgan bo'lsa
inserts = [(e.dxf.name, (e.dxf.insert.x, e.dxf.insert.y), e.dxf.rotation) for e in msp if e.dxftype() == "INSERT"]
if inserts:
    names = {}
    for n, _, _ in inserts:
        names[n] = names.get(n, 0) + 1
    print(f"\n## INSERT bloklar: {len(inserts)} ta — {names}")
    for name, (x, y), rot in inserts[:40]:
        print(f"   {name}  x={x:9.2f} y={y:9.2f} rot={rot}")
print("\n# Maslahat: bloklar 6×12 m (2 ustun × 4 qator) bo'lsa, har blok = 8 stend × 9 m² = 72 m².")
