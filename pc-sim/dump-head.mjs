// dump-head.mjs -- write git HEAD's copy of a file to disk as real UTF-8.
// (Doing this with PowerShell's redirection mangles it: git emits UTF-8 bytes, PowerShell
//  decodes them with the ANSI codepage, and Out-File re-encodes the mojibake.)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [repo, spec, out] = process.argv.slice(2);
const buf = execFileSync('git', ['-C', repo, 'show', spec], { maxBuffer: 64 * 1024 * 1024 });
fs.writeFileSync(out, buf);
console.log('wrote ' + out + '  ' + buf.length + ' bytes');
