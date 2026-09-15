#!/usr/bin/env python3
"""
DXF-чертёж → JSON-схема (карта вручную не рисуется).

    python3 tools/dxf-to-layout.py chertezh.dxf --block-layer BLOK --out layout/foodera-2026.json \
            --hall "Крытый павильон" --project "FOODERA EXPO 2026" --price 1250000 [--hall-layer ZAL] [--label-layer YOZUV]

Что делает:
  1. Читает из чертежа прямоугольники (замкнутые polylines);
  2. Блоками считает прямоугольники площадью 72 м² (единицы должны быть метрами: $INSUNITS=6);
  3. **Переворачивает ось Y** — в DXF Y идёт снизу вверх, в нашей схеме сверху вниз
     (самая частая ошибка сопоставления — «карта вышла перевёрнутой»);
  4. Выравнивает координаты по сетке 3 м, присваивает блокам ID (A, B, …);
  5. Выводит списком прямоугольники не по 72 м², узкие проходы и наложения;
  6. Oxirida `node tools/validate-layout.mjs` ni ishga tushirib natijani tasdiqlaydi.
"""
import sys, os, json, math, subprocess, argparse

try:
    import ezdxf
except ImportError:
    print("✗ нужен ezdxf:  pip install ezdxf")
    sys.exit(1)

ap = argparse.ArgumentParser(add_help=False)
ap.add_argument("dxf")
ap.add_argument("--block-layer", default=None)
ap.add_argument("--hall-layer", default=None)
ap.add_argument("--label-layer", default=None)
ap.add_argument("--out", default="layout/imported.json")
ap.add_argument("--hall", default="Крытый павильон")
ap.add_argument("--project", default="Ekspo Markazi")
ap.add_argument("--version", default="1.0.0")
ap.add_argument("--price", type=float, default=0)
ap.add_argument("--stand", default="3x3")
ap.add_argument("--grid", type=float, default=3.0)
ap.add_argument("--block-area", type=float, default=72.0)
ap.add_argument("--min-aisle", type=float, default=2.0)
ap.add_argument("--prefix", default="A")
ap.add_argument("--feature", action="append", default=[], metavar="LAYER:TYPE",
                help="Obyekt layeri: turi (masalan XONA:room, USTUN:column, SAHNA:stage, WC:wc, FOOD:food)")
ap.add_argument("-h", "--help", action="help")
A = ap.parse_args()

sw, sh = (float(v) for v in A.stand.lower().split("x"))

doc = ezdxf.readfile(A.dxf)
msp = doc.modelspace()
units = doc.header.get("$INSUNITS", 0)
if units not in (5, 6):  # 5=sm, 6=m
    print(f"⚠ $INSUNITS={units} (не метры). Сохраните чертёж в метрах или выберите единицы в конверторе.")

# ---------------------------------------------------------------- прямоугольники
def rects_of(layer=None):
    out = []
    for e in msp:
        t = e.dxftype()
        pts = None
        if t == "LWPOLYLINE" and e.closed:
            pts = [(p[0], p[1]) for p in e.get_points("xy")]
        elif t == "POLYLINE" and e.is_closed:
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
        if not pts or len(pts) < 4:
            continue
        if layer and e.dxf.layer.upper() != layer.upper():
            continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        out.append({"x": min(xs), "y": min(ys), "w": max(xs) - min(xs), "h": max(ys) - min(ys),
                    "layer": e.dxf.layer, "points": pts})
    return out

texts = []
for e in msp:
    if e.dxftype() == "TEXT":
        texts.append((e.dxf.text.strip(), e.dxf.insert.x, e.dxf.insert.y, e.dxf.layer))
    elif e.dxftype() == "MTEXT":
        texts.append((e.text.strip(), e.dxf.insert.x, e.dxf.insert.y, e.dxf.layer))
if A.label_layer:
    texts = [t for t in texts if t[3].upper() == A.label_layer.upper()]

all_rects = rects_of()
if not all_rects:
    print("✗ В чертеже не найдено замкнутых прямоугольников (LWPOLYLINE, closed).")
    print("  Maslahat: bloklarni yopiq polyline qilib chizib, alohida layer'ga qo'ying (masalan BLOK).")
    sys.exit(1)

hall_rects = rects_of(A.hall_layer) if A.hall_layer else all_rects
hx = min(r["x"] for r in hall_rects); hy = min(r["y"] for r in hall_rects)
hx2 = max(r["x"] + r["w"] for r in hall_rects); hy2 = max(r["y"] + r["h"] for r in hall_rects)
hall_w, hall_h = hx2 - hx, hy2 - hy

# ---------------------------------------------------------------- выбор названий блоков
cand = [r for r in all_rects if (A.block_layer is None or r["layer"].upper() == A.block_layer.upper())]
blocks, wrong = [], []
for r in cand:
    area = r["w"] * r["h"]
    if abs(area - A.block_area) <= max(0.5, A.block_area * 0.02):
        blocks.append(r)
    elif area > sw * sh * 1.05:
        wrong.append(r)

if not blocks:
    print(f"✗ блок площадью {A.block_area:.0f} м² не найден. Прямоугольники в чертеже:")
    seen = {}
    for r in sorted(cand, key=lambda r: -(r["w"] * r["h"]))[:15]:
        key = f'{r["w"]:.1f}x{r["h"]:.1f}'
        seen[key] = seen.get(key, 0) + 1
        print(f'   {key} m = {r["w"]*r["h"]:7.1f} m²  [{r["layer"]}]')
    if wrong:
        print(f"  ⚠ {len(wrong)} больших прямоугольников не по 72 м² — проверьте форму блока "
              f"(masalan {wrong[0]['w']:.1f}×{wrong[0]['h']:.1f} m = {wrong[0]['w']*wrong[0]['h']:.0f} m²)")
    sys.exit(1)

# ---------------------------------------------------------------- ID и порядок
def label_for(r):
    cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
    best = None
    for txt, tx, ty, _ in texts:
        if r["x"] - 1 <= tx <= r["x"] + r["w"] + 1 and r["y"] - 2.5 <= ty <= r["y"] + r["h"] + 2.5:
            d = math.hypot(tx - cx, ty - cy)
            if best is None or d < best[0]:
                best = (d, txt)
    if best and 0 < len(best[1]) <= 24:
        return best[1]
    return None

# o'qish tartibi: yuqoridan pastga, chapdan o'ngga (DXF'da Y katta = tepa)
blocks.sort(key=lambda r: (-(r["y"] + r["h"]), r["x"]))
by_row, rows = [], []
for b in blocks:
    if rows and abs((b["y"] + b["h"]) - (rows[-1][0]["y"] + rows[-1][0]["h"])) < A.grid * 0.6:
        rows[-1].append(b)
    else:
        rows.append([b])
for row in rows:
    by_row.extend(sorted(row, key=lambda r: r["x"]))

out_blocks = []
problems = []
for i, r in enumerate(by_row):
    name = label_for(r) or f"{A.prefix}-{i+1:02d}"
    x = r["x"] - hx
    y = hall_h - (r["y"] - hy) - r["h"]      # Y o'qini teskari qilish (DXF pastdan tepaga)
    sx, sy = round(x / A.grid) * A.grid, round(y / A.grid) * A.grid
    if abs(sx - x) > 0.4 or abs(sy - y) > 0.4:
        problems.append(f"{name}: koordinata 3 m to'rga to'g'ri kelmadi (x={x:.2f}→{sx:.2f}, y={y:.2f}→{sy:.2f}) — chizmani tekshiring")
    cols = max(1, round(r["w"] / sw))
    rows_n = max(1, round(r["h"] / sh))
    if abs(r["w"] - cols * sw) > 0.3 or abs(r["h"] - rows_n * sh) > 0.3:
        problems.append(f"{name}: размер {r['w']:.2f}×{r['h']:.2f} м — не совпадает с {cols}×{rows_n} стендов")
    if cols * rows_n != 8:
        problems.append(f"{name}: {cols}×{rows_n} = {cols*rows_n} стендов (должно быть 8 — правило 72 м²)")
    out_blocks.append({"id": name, "x": sx, "y": sy, "cols": cols, "rows": rows_n, "sourceLayer": r["layer"]})

# наложение блоков
for i in range(len(out_blocks)):
    for j in range(i + 1, len(out_blocks)):
        a, b = out_blocks[i], out_blocks[j]
        aw, ah = a["cols"] * sw, a["rows"] * sh
        bw, bh = b["cols"] * sw, b["rows"] * sh
        ox = min(a["x"] + aw, b["x"] + bw) - max(a["x"], b["x"])
        oy = min(a["y"] + ah, b["y"] + bh) - max(a["y"], b["y"])
        if ox > 0.05 and oy > 0.05:
            problems.append(f'{a["id"]} va {b["id"]} ustma-ust tushadi ({ox:.1f}×{oy:.1f} m)')

# yo'lak tor
for i in range(len(out_blocks)):
    for j in range(i + 1, len(out_blocks)):
        a, b = out_blocks[i], out_blocks[j]
        aw, ah = a["cols"] * sw, a["rows"] * sh
        bw, bh = b["cols"] * sw, b["rows"] * sh
        ox = min(a["x"] + aw, b["x"] + bw) - max(a["x"], b["x"])
        oy = min(a["y"] + ah, b["y"] + bh) - max(a["y"], b["y"])
        gap = None
        if oy > 0 and ox <= 0: gap = abs(ox)
        elif ox > 0 and oy <= 0: gap = abs(oy)
        if gap is not None and gap < A.min_aisle - 0.05:
            problems.append(f'{a["id"]}–{b["id"]} orasidagi yo\'lak {gap:.2f} m (minimum {A.min_aisle} m)')

# ---------------------------------------------------------------- obyektlar (features)
features = []
for spec in A.feature:
    if ":" not in spec:
        continue
    layer, ftype = spec.split(":", 1)
    for r in rects_of(layer):
        lbl = None
        for txt, tx, ty, _ in texts:
            if r["x"] - 1 <= tx <= r["x"] + r["w"] + 1 and r["y"] - 2 <= ty <= r["y"] + r["h"] + 2:
                lbl = txt
                break
        features.append({
            "type": ftype, "label": lbl or ftype.capitalize(),
            "x": round(r["x"] - hx, 3),
            "y": round(hall_h - (r["y"] - hy) - r["h"], 3),
            "w": round(r["w"], 3), "h": round(r["h"], 3),
        })
    print(f"  obyekt: {layer} → {ftype} ({sum(1 for f in features if f['type'] == ftype)} ta)")

layout = {
    "schemaVersion": 1,
    "meta": {
        "project": A.project, "hall": A.hall, "version": A.version,
        "updatedAt": __import__("datetime").date.today().isoformat(),
        "units": "meters",
        "stand": {"w": sw, "h": sh, "areaM2": sw * sh},
        "block": {"stands": 8, "areaM2": 72, "cols": 2, "rows": 4},
        "minAisleM": A.min_aisle,
        "currency": "UZS", "pricePerM2": A.price, "reserveTtlHours": 72,
        "source": os.path.basename(A.dxf),
    },
    "hall": {"width": round(hall_w, 3), "height": round(hall_h, 3)},
    "features": features,
    "blocks": out_blocks,
}

os.makedirs(os.path.dirname(os.path.abspath(A.out)), exist_ok=True)
with open(A.out, "w") as f:
    json.dump(layout, f, ensure_ascii=False, indent=2)

print(f'✓ {A.out}: блоков {len(out_blocks)} · зал {hall_w:.1f}×{hall_h:.1f} м · ось Y перевёрнута (DXF→схема)')
if wrong:
    print(f'\n⚠ {len(wrong)} прямоугольников не по 72 м² (возможно блоки, но другой формы):')
    for r in sorted(wrong, key=lambda r: -(r["w"] * r["h"]))[:10]:
        print(f'   {r["w"]:.1f}×{r["h"]:.1f} m = {r["w"]*r["h"]:.0f} m²  [{r["layer"]}]')
if problems:
    print(f"\n⚠ мест, требующих внимания: {len(problems)}")
    for p in problems:
        print("   • " + p)
else:
    print("\n✓ Видимых проблем не найдено.")

sys.stdout.flush()
val = os.path.join(os.path.dirname(os.path.abspath(__file__)), "validate-layout.mjs")
if os.path.exists(val):
    print("\n# node tools/validate-layout.mjs:")
    subprocess.run(["node", val, A.out])
