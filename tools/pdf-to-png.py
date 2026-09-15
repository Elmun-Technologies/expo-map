#!/usr/bin/env python3
"""PDF → PNG: первая страница в картинке (предпросмотр плана прямо в панели).

Нужен pypdfium2 (+ Pillow). Используется сервером в /api/export/png,
чтобы PDF можно было посмотреть даже там, где браузер запрещает
встроенный просмотрщик PDF (песочница предпросмотра).

Запуск:
    python3 tools/pdf-to-png.py plan.pdf plan.png 1.8
"""
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print('использование: pdf-to-png.py <файл.pdf> <файл.png> [масштаб]', file=sys.stderr)
        return 2

    pdf_path, png_path = sys.argv[1], sys.argv[2]
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

    try:
        import pypdfium2 as pdfium
    except ImportError:
        print('нет pypdfium2: pip install pypdfium2 Pillow', file=sys.stderr)
        return 3

    doc = pdfium.PdfDocument(pdf_path)
    if len(doc) == 0:
        print('в PDF нет страниц', file=sys.stderr)
        return 1

    bitmap = doc[0].render(scale=scale)
    bitmap.to_pil().save(png_path, optimize=True)
    print(f'✓ {png_path} — {bitmap.width}×{bitmap.height} px (масштаб {scale})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
