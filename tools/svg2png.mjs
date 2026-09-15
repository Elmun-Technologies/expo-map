import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const [inp, outp, w] = process.argv.slice(2);
const svg = fs.readFileSync(inp, 'utf8');
const r = new Resvg(svg, { fitTo: { mode: 'width', value: Number(w || 2400) }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } });
fs.writeFileSync(outp, r.render().asPng());
console.log('✓', outp, r.width + 'x' + r.height);
