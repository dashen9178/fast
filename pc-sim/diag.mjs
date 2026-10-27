// diag.mjs -- show the parse the DP picks, char by char, for a short mojibake string.
import fs from 'node:fs';
const [src, tablePath] = process.argv.slice(2);
const S = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
const raw = JSON.parse(fs.readFileSync(tablePath, 'utf8').replace(/^\uFEFF/, ''));
const cand = new Map();
for (const [key, list] of Object.entries(raw)) {
  const ch = String.fromCodePoint(parseInt(key.slice(2), 16));
  const arr = (Array.isArray(list) ? list : [list]).map(h => {
    const b = [];
    for (let i = 0; i < h.length; i += 2) b.push(parseInt(h.slice(i, i + 2), 16));
    return Uint8Array.from(b);
  });
  arr.sort((a, b) => a.length - b.length);
  cand.set(ch, arr);
}
console.log('S =', JSON.stringify(S));
for (let i = 0; i < S.length; i++) {
  const list = cand.get(S[i]) || [];
  console.log(
    String(i).padStart(3),
    JSON.stringify(S[i]),
    'U+' + S.codePointAt(i).toString(16).toUpperCase().padStart(4, '0'),
    'cands=' + list.length,
    list.slice(0, 4).map(v => Buffer.from(v).toString('hex')).join(','),
    list.length > 4 ? '...' : '');
}
