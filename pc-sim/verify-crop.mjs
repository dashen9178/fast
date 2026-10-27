// verify-crop.mjs —— 验证「选图后能裁剪」（2026-10-28 新功能）
//
// 规格（用户定）：裁剪框是**固定大小的正方形**，不许改形状/大小；
// 只能拖动、缩放图片来调整方块里露出的那块。
//
// 走真人路径：打开导出弹窗 → 给隐藏的 #iconFile 塞一张 400×200 的 PNG →
// 触发 change（等同用户从相册选完）→ 必须弹出裁剪框 →
// ① 方块宽=高、尺寸固定（拖图片时不变）；② 拖图片位置会变；③ 滚轮放大；
// ④ 点「完成」→ 预览图必须是正方形、≤256，且放大后裁出来的更小；
// ⑤ 再选一次点「取消」→ 预览图不能变。
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
  var sq = m.querySelector('.crop-sq'), img = m.querySelector('.crop-stage img');
  var st = m.querySelector('.crop-stage');
  if (!sq || !img || !st) return { 异常: '缺元素' };
  var sr = sq.getBoundingClientRect(), ir = img.getBoundingClientRect(), tr = st.getBoundingClientRect();
  return {
    方块: { w: Math.round(sr.width), h: Math.round(sr.height), left: Math.round(sr.left), top: Math.round(sr.top) },
    图片: { w: Math.round(ir.width), h: Math.round(ir.height), left: Math.round(ir.left), top: Math.round(ir.top) },
    舞台: { w: Math.round(tr.width), h: Math.round(tr.height) },
    圆点: m.querySelectorAll('.crop-h').length
  };
})()`;

// 按住舞台中间拖 60,40 —— 应该只移动图片，方块纹丝不动
const 拖图 = `(function(){
  var st = document.getElementById('cropMask').querySelector('.crop-stage');
  var r = st.getBoundingClientRect();
  var x = r.left + r.width / 2, y = r.top + r.height / 2;
  function ev(type, cx, cy, target) {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
      clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', isPrimary: true }));
  }
  ev('pointerdown', x, y, st);
  ev('pointermove', x + 60, y + 40, document);
  ev('pointerup', x + 60, y + 40, document);
  return 1;
})()`;

// 滚轮放大（桌面/手机外接鼠标都能用；手机上是双指）
const 放大 = `(function(){
  var st = document.getElementById('cropMask').querySelector('.crop-stage');
  st.dispatchEvent(new WheelEvent('wheel', { deltaY: -560, bubbles: true, cancelable: true }));
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

const 点完成 = `(function(){ document.getElementById('cropMask').querySelector('.tb.primary').click(); return 1; })()`;
const 点取消 = `(function(){
  var m = document.getElementById('cropMask'), bs = m.querySelectorAll('.tb');
  for (var i = 0; i < bs.length; i++) if (bs[i].textContent.trim() === '取消') { bs[i].click(); return 1; }
  return 0;
})()`;

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

  // ① 选图 → 必须弹裁剪框，且方块是正方形、大小固定
  await js(选一张图);
  const 弹了 = await waitFor(`!!document.getElementById('cropMask')`, 8000);
  await sleep(400);                       // 等 pop 动画结束再量（动画期间 getBoundingClientRect 是被缩放过的）
  const 框1 = await js(读裁剪框);
  if (!弹了 || !框1) {
    console.log(JSON.stringify({ 失败: '选完图没有出现裁剪框', 框: 框1 }, null, 2));
    process.exit(1);
  }
  const 是方的 = 框1.方块.w === 框1.方块.h;
  const 固定比例 = Math.abs(框1.方块.w - Math.round(Math.min(框1.舞台.w, 框1.舞台.h) * 0.82)) <= 2;

  // ② 拖图片：方块不许动，图片要动
  await js(拖图);
  await sleep(200);
  const 框2 = await js(读裁剪框);
  const 方块没动 = 框2 && 框2.方块.w === 框1.方块.w && 框2.方块.h === 框1.方块.h &&
    框2.方块.left === 框1.方块.left && 框2.方块.top === 框1.方块.top;
  const 图动了 = 框2 && (框2.图片.left !== 框1.图片.left || 框2.图片.top !== 框1.图片.top);

  // ③ 点「完成」→ 预览必须是正方形
  await js(点完成);
  const 消失了 = await waitFor(`!document.getElementById('cropMask')`, 5000);
  const 预览1 = await js(预览尺寸);
  const 预览1长度 = await js(`String(document.getElementById('iconPreview').style.backgroundImage || '').length`);
  const 预览是方的 = 预览1 && 预览1.w === 预览1.h && 预览1.w <= 256 && 预览1.w > 0;

  // ④ 再选一次：放大后有变化的图（裁得更小），证明缩放真的进了计算
  await js(选一张图);
  await waitFor(`!!document.getElementById('cropMask')`, 8000);
  await sleep(400);
  await js(放大);
  await sleep(200);
  const 框3 = await js(读裁剪框);
  await js(点完成);
  await waitFor(`!document.getElementById('cropMask')`, 5000);
  await sleep(200);
  const 预览2 = await js(预览尺寸);
  const 预览2长度 = await js(`String(document.getElementById('iconPreview').style.backgroundImage || '').length`);
  const 放大生效 = 框3 && 框3.图片.w > 框2.图片.w;
  const 裁得更小 = 预览2 && 预览1 && 预览2.w === 预览2.h && 预览2.w < 预览1.w;

  // ⑤ 再选一次、点「取消」→ 预览图不能被改
  await js(选一张图);
  await waitFor(`!!document.getElementById('cropMask')`, 8000);
  await js(点取消);
  await waitFor(`!document.getElementById('cropMask')`, 5000);
  const 预览3 = await js(预览尺寸);
  const 取消没改 = 预览2 && 预览3 && 预览2.w === 预览3.w && 预览2.h === 预览3.h;

  const ok = 弹了 && 框1.圆点 === 0 && 是方的 && 固定比例 && 方块没动 && 图动了 && 消失了 &&
    预览是方的 && 放大生效 && 裁得更小 && 取消没改;
  console.log(JSON.stringify({
    弹出裁剪框: 弹了, 角手柄数: 框1.圆点, 方块: 框1.方块, 舞台: 框1.舞台,
    正方形: 是方的, 尺寸固定: 固定比例, 拖图时方块不动: 方块没动, 图片动了: 图动了,
    完成关闭: 消失了, 预览像素1: 预览1, 预览1长度, 预览是正方形: 预览是方的,
    放大后方块: 框3 && 框3.方块, 放大后图片显示: 框3 && 框3.图片, 放大生效: 放大生效,
    放大后裁得更小: 裁得更小, 预览像素2: 预览2, 预览2长度,
    取消后预览: 预览3, 取消不改图: 取消没改
  }, null, 2));
  console.log(ok ? '\n[OK] 固定正方形裁剪 ✓' : '\n[FAIL] 裁剪流程不符合预期');

  try {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, 'crop.png'), Buffer.from(s.data, 'base64'));
  } catch (e) { }
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
