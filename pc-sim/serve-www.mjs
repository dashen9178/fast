// 给回归测试用的静态服务（单独一个脚本，避免依赖 run-ui-test.ps1 里的 Start-Job）。
// 用法：ELECTRON_RUN_AS_NODE=1 "DSH Desktop.exe" pc-sim\serve-www.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'assets', 'www');
const PORT = Number(process.argv[2] || process.env.PORT || 8931);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.gif': 'image/gif', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.cur': 'image/x-icon', '.json': 'application/json; charset=utf-8'
};

http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  if (!rel) rel = 'editor.html';
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store'
  });
  fs.createReadStream(full).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT + '/');
});
