// Copies Phosphor (MIT) icons into web/vendor/icons.svg as <symbol>s. Usage: node add-icons.mjs name1 name2 ...
import fs from 'node:fs';
const sprite = new URL('../../web/vendor/icons.svg', import.meta.url);
let s = fs.readFileSync(sprite, 'utf8');
for (const name of process.argv.slice(2)) {
  if (s.includes(`id="${name}"`)) continue;
  const svg = fs.readFileSync(new URL(`./node_modules/@phosphor-icons/core/assets/regular/${name}.svg`, import.meta.url), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  s = s.replace('</svg>', `<symbol id="${name}" viewBox="0 0 256 256" fill="currentColor">${inner}</symbol></svg>`);
}
fs.writeFileSync(sprite, s);
