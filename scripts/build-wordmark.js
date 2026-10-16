import { writeFile } from 'node:fs/promises';

// Original block lettering for PRESCRIPTRIS, drawn as vectors at a 5×7 module grid.
const glyphs = {
  P:['11110','11011','11011','11110','11000','11000','11000'],
  R:['11110','11011','11011','11110','11100','11010','11001'],
  E:['11111','11000','11000','11110','11000','11000','11111'],
  S:['01111','11000','11000','01110','00011','00011','11110'],
  C:['01111','11000','11000','11000','11000','11000','01111'],
  I:['11111','01100','01100','01100','01100','01100','11111'],
  T:['11111','11111','01100','01100','01100','01100','01100'],
};
const title = 'PRESCRIPTRIS', unit = 10, margin = 10;
let path = '', highlights = '';
for (const [index,letter] of [...title].entries()) {
  const glyph = glyphs[letter];
  for (let y=0;y<7;y++) for (let x=0;x<5;x++) {
    if (glyph[y][x] !== '1') continue;
    const px = margin + index * unit * 6 + x * unit, py = margin + y * unit;
    path += `M${px} ${py}h${unit}v${unit}h-${unit}z`;
    if (y === 0 || glyph[y-1][x] !== '1') highlights += `M${px} ${py+1}h${unit}`;
  }
}
const width = title.length * unit * 6 - unit + margin * 2 + 8;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="98" viewBox="0 0 ${width} 98" role="img" aria-labelledby="title desc" shape-rendering="crispEdges">
  <title id="title">PRESCRIPTRIS</title>
  <desc id="desc">Original arcade block lettering with a golden face, coral lower edge and blue extruded shadow.</desc>
  <defs>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff4be"/><stop offset=".25" stop-color="#ffd76c"/><stop offset=".6" stop-color="#f5a348"/><stop offset="1" stop-color="#e56c52"/></linearGradient>
    <filter id="edge" x="-5%" y="-30%" width="110%" height="160%"><feMorphology in="SourceAlpha" operator="dilate" radius="2" result="spread"/><feFlood flood-color="#c1d6ef"/><feComposite in2="spread" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <path id="letters" d="${path}"/>
  </defs>
  <use href="#letters" transform="translate(7 7)" fill="#1e4e80" stroke="#081326" stroke-width="3"/>
  <use href="#letters" fill="url(#face)" filter="url(#edge)"/>
  <path d="${highlights}" fill="none" stroke="#fff9da" stroke-width="1" opacity=".8"/>
</svg>\n`;
await writeFile(new URL('../assets/v2/prescriptris-wordmark.svg',import.meta.url),svg);
console.log(`Built PRESCRIPTRIS wordmark (${width} × 98).`);
