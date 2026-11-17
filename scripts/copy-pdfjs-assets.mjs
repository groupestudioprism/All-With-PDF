// Copie les polices standard et CMaps de pdf.js vers public/ (rendu fidèle, y compris CJK).
import { cpSync, mkdirSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
mkdirSync('public/pdfjs', { recursive: true });
for (const d of ['standard_fonts', 'cmaps']) cpSync(`${src}/${d}`, `public/pdfjs/${d}`, { recursive: true });
console.log('pdf.js assets copiés dans public/pdfjs');
