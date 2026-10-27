// verify-crop.mjs —— 验证「选图后能裁剪」（2026-10-28 新功能）
//
// 走真人路径：打开导出弹窗 → 给隐藏的 #iconFile 塞一张 400×200 的 PNG →
// 触发 change（等同用户从相册选完）→ 必须弹出裁剪框 → 拖动右下角圆点缩小 →
// 点「完成」→ 图标预览必须变成裁剪后的图（尺寸比例跟着框走、且 ≤256）。
// 另外验一次「取消」：不回调、原图不变。
//
// 旧代码（没有裁剪）在这一步不会出现 #cropMask，用例如直接失败。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || process.env.TEMP || '.';
const CDP = `http://127.0.0.1:${process.env.CDP_PORT || 9222}`;
mkdirSync(OUT, { recursive: true });

let ws = null, closed = true, seq = 0;
const pending = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pickTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const l = await (await fetch(CDP + '/json/list')).json();
      const t = l.find(x => x.type === 'page' && x.url.includes('editor.html'));
      if (t) return t;
    } catch { }
    await sleep(300);
  }
  throw new Error('找不到 editor.html');
}
async function open(url) {
  await new Promise((res, rej) => {
    const s = new WebSocket(url);
    const to = setTimeout(() => rej(new Error('WS 超时')), 10000);
    s.onopen = () => { clearTimeout(to); ws = s; closed = false; res(); };
    s.onerror = () => { clearTimeout(to); rej(new Error('WS 失败')); };
    s.onclose = () => { closed = true; for (const p of pending.values()) p.rej(new Error('CDP 断开')); pending.clear(); };
    s.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
  });
}
function send(method, params = {}, timeoutMs = 20000) {
  if (closed || !ws) return Promise.reject(new Error('CDP 未连接'));
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP 超时: ' + method)); }, timeoutMs);
    pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0]);
  return r.result?.value;
}
async function waitFor(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await js(expr)) return true; } catch { } await sleep(150); }
  return false;
}

// 造一张 400×200 的 PNG（左红右蓝，方便肉眼看出裁的是哪块），塞进 #iconFile 并触发 change
const 选一张图 = `(function(){
  return new Promise(function (resolve) {
    var cv = document.createElement('canvas'); cv.width = 400; cv.height = 200;
    var g = cv.getContext('2d');
    g.fillStyle = '#ff0000'; g.fillRect(0, 0, 200, 200);
    g.fillStyle = '#0000ff'; g.fillRect(200, 0, 200, 200);
    cv.toBlob(function (blob) {
      var f = new File([blob], 'pick.png', { type: 'image/png' });
      var dt = new DataTransfer(); dt.items.add(f);
      var inp = document.getElementById('iconFile');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      resolve(1);
    }, 'image/png');
  });
})()`;

const 读裁剪框 = `(function(){
  var m = document.getElementById('cropMask');
  if (!m) return null;
  var sel = m.querySelector('.crop-sel');
  var img = m.querySelector('.crop-stage img');
  if (!sel || !img) return { 异常: '缺元素' };
  var sr = sel.getBoundingClientRect(), ir = img.getBoundingClientRect();
  return {
    图片: { w: Math.round(ir.width), h: Math.round(ir.height) },
    框: { w: Math.round(sr.width), h: Math.round(sr.height), x: Math.round(sr.left - ir.left), y: Math.round(sr.top - ir.top) },
    角: m.querySelectorAll('.crop-h').length
  };
})()`;

// 拖动右下角圆点（PointerEvent 走的是真实事件，和手指一样）
const 拖右下角 = `(function(){
  var m = document.getElementById('cropMask');
  var img = m.querySelector('.crop-stage img');
  var h = m.querySelector('.crop-h.se');
  var ir = img.getBoundingClientRect(), hr = h.getBoundingClientRect();
  function ev(type, x, y) {
    var e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true });
    (type === 'pointerdown' ? h : document).dispatchEvent(e);
  }
  ev('pointerdown', hr.left + hr.width / 2, hr.top + hr.height / 2);
  ev('pointermove', hr.left + hr.width / 2 - ir.width * 0.35, hr.top + hr.height / 2 - ir.height * 0.35);
  ev('pointerup', hr.left + hr.width / 2 - ir.width * 0.35, hr.top + hr.height / 2 - ir.height * 0.35);
  return 1;
})()`;

// 预览图上的 dataURL → 实际像素尺寸
const 预览尺寸 = `new Promise(function (resolve) {
  var bg = String(getComputedStyle(document.getElementById('iconPreview')).backgroundImage || '');
  var m = bg.match(/url\\("?(data:[^")]+)"?\\)/);
  if (!m) { resolve(null); return; }
  var im = new Image();
  im.onload = function () { resolve({ w: im.naturalWidth, h: im.naturalHeight }); };
  im.onerror = function () { resolve({ 坏图: true }); };
  im.src = m[1];
})`;

(async () => {
  const t = await pickTarget();
  await open(t.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000);
  await js(`(function(){ localStorage.clear(); return 1; })()`);
  await js(`location.href = 'editor.html?v=' + Date.now(); 1`);
  await waitFor(`document.readyState === 'complete' && !!window.EditorApp`, 20000);
  await sleep(500);

  // 建一个空工程并进入编辑器（按钮/输入框 id 与 editor.html 一致：btnNewApp / newAppName / createGo）
  await js(`document.getElementById('btnNewApp').click(); 1`);
  await waitFor(`(function(){var m=document.getElementById('createMask');return !!m && !m.classList.contains('hidden')})()`, 8000);
  await js(`(function(){var i=document.getElementById('newAppName'); i.value='裁剪测试App'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  await sleep(200);
  await js(`document.getElementById('createGo').click(); 1`);
  if (!await waitFor(`!document.getElementById('viewEditor').classList.contains('hidden')`, 20000)) {
    console.log(JSON.stringify({ 失败: '没进入编辑器' }, null, 2));
    process.exit(1);
  }
  await sleep(400);

  // 打开导出弹窗（图标选择器就挂在这里）
  await js(`document.getElementById('btnExport').click(); 1`);
  if (!await waitFor(`!document.getElementById('exportMask').classList.contains('hidden')`, 8000)) {
    console.log(JSON.stringify({ 失败: '导出弹窗没打开' }, null, 2));
    process.exit(1);
  }

  // ① 选图 → 必须弹裁剪框
  await js(选一张图);
  const 弹了 = await waitFor(`!!document.getElementById('cropMask')`, 8000);
  const 框1 = await js(读裁剪框);
  if (!弹了 || !框1) {
    console.log(JSON.stringify({ 失败: '选完图没有出现裁剪框', 框: 框1 }, null, 2));
    process.exit(1);
  }

  // ② 拖右下角把框缩小
  await js(拖右下角);
  await sleep(250);
  const 框2 = await js(读裁剪框);

  // ③ 点「完成」→ 框消失、预览图变成裁剪后的图
  await js(`(function(){ var b = document.getElementById('cropMask').querySelector('.tb.primary'); b.click(); return 1; })()`);
  const 消失了 = await waitFor(`!document.getElementById('cropMask')`, 5000);
  const 预览1 = await js(预览尺寸);

  // ④ 再选一次、点「取消」→ 预览图不能被改
  await js(选一张图);
  await waitFor(`!!document.getElementById('cropMask')`, 8000);
  await js(`(function(){ var m = document.getElementById('cropMask'); var bs = m.querySelectorAll('.tb'); for (var i=0;i<bs.length;i++){ if (bs[i].textContent.trim() === '取消') { bs[i].click(); return 1; } } bs[0].click(); return 1; })()`);
  await waitFor(`!document.getElementById('cropMask')`, 5000);
  const 预览2 = await js(预览尺寸);

  const 变小了 = 框2 && 框1 && 框2.框.w < 框1.框.w && 框2.框.h < 框1.框.h;
  const 图变了 = 预览1 && 预览1.w && 预览1.w <= 256 && 预览1.h <= 256;
  const 取消没改 = 预览1 && 预览2 && 预览1.w === 预览2.w && 预览1.h === 预览2.h;
  // 裁剪后的宽高比要跟框一致（裁掉的部分真的被切掉了）
  const 比例合 = 预览1 && 框2 && Math.abs((预览1.w / 预览1.h) - (框2.框.w / 框2.框.h)) < 0.12;

  const ok = 弹了 && 框1.角 === 4 && 变小了 && 消失了 && 图变了 && 比例合 && 取消没改;
  console.log(JSON.stringify({
    弹出裁剪框: 弹了, 四角手柄: 框1.角,
    框初始: 框1.框, 拖角后: 框2 && 框2.框, 拖角生效: 变小了,
    完成关闭: 消失了, 预览像素: 预览1, 宽高比一致: 比例合,
    取消后预览: 预览2, 取消不改图: 取消没改
  }, null, 2));
  console.log(ok ? '\n[OK] 选图后可裁剪 ✓' : '\n[FAIL] 裁剪流程不符合预期');

  try {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, 'crop.png'), Buffer.from(s.data, 'base64'));
  } catch (e) { }
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
