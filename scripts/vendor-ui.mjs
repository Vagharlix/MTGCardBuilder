// Copies UI fonts and keyrune set-symbol SVGs from node_modules into web/.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const nm = path.join(root, 'node_modules');
const web = path.join(root, 'web');

function copyTo(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// UI fonts (latin subset only).
const fonts = [
  ['@fontsource/poppins/files', /^poppins-latin-(400|500|600|700)-(normal|italic)\.woff2$/],
  ['@fontsource/roboto/files', /^roboto-latin-(400|500|700)-normal\.woff2$/],
];
let n = 0;
for (const [dir, re] of fonts) {
  for (const f of fs.readdirSync(path.join(nm, dir))) {
    if (re.test(f)) { copyTo(path.join(nm, dir, f), path.join(web, 'fonts/ui', f)); n++; }
  }
}
console.log('ui fonts:', n);

// Keyrune set symbols, used for "watermark from set code".
const kr = path.join(nm, 'keyrune/svg');
const svgs = fs.readdirSync(kr).filter((f) => f.endsWith('.svg'));
for (const f of svgs) copyTo(path.join(kr, f), path.join(web, 'img/keyrune', f));
console.log('keyrune svgs:', svgs.length);
