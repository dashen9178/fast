// unit-comp-spec.mjs -- 守卫控件注册表（assets/www/comp-spec.js）
// 为什么要有：控件元数据以前散在 5 处（TYPE_META / COMPONENT_DEFAULTS / naturalSize /
// defaultSize / runtime defaultBox），已经跑偏过两次（audio 44 vs 40、
// container/table/chart 运行时缺项）。这份测试确保：
//   ① 注册表本身完整（字段齐全、尺寸是正整数）；
//   ② 编辑器/运行时的尺寸来源真的接到了注册表上；
//   ③ 两个页面与打包脚本都带上了 comp-spec.js —— 漏一处，真机就白屏。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WWW = path.join(ROOT, 'assets', 'www');
const read = (p) => fs.readFileSync(p, 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  [OK]   ' + name + (extra ? ' :: ' + extra : '')); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? ' :: ' + extra : '')); }
};

// ---------- ① 执行真文件（不是副本）拿到注册表 ----------
const sandbox = {};
new Function('window', read(path.join(WWW, 'comp-spec.js')))(sandbox);
const C = sandbox.FAST_COMPONENTS;
const API = sandbox.FAST_COMP;

console.log('===== 控件注册表 comp-spec.js =====');
ok('导出 FAST_COMPONENTS', C && typeof C === 'object');
ok('导出 FAST_COMP 工具方法', API && typeof API.sizeOf === 'function'
  && typeof API.defaultsOf === 'function' && typeof API.naturalOf === 'function');

const types = Object.keys(C || {});
ok('控件类型数量为 33', types.length === 33, '实际 ' + types.length + '：' + types.join(','));

// 每个条目的字段完整性
const bad = [];
for (const t of types) {
  const s = C[t];
  const why = [];
  if (!s || typeof s !== 'object') { bad.push(t + ':不是对象'); continue; }
  if (typeof s.label !== 'string' || !s.label) why.push('label');
  if (typeof s.ico !== 'string' || !s.ico) why.push('ico');
  if (typeof s.desc !== 'string' || !s.desc) why.push('desc');
  if (!s.size || !Number.isInteger(s.size.w) || s.size.w <= 0) why.push('size.w');
  if (!s.size || !Number.isInteger(s.size.h) || s.size.h <= 0) why.push('size.h');
  if (!s.nat || typeof s.nat !== 'object') why.push('nat');
  else if (s.nat.mode === 'text') {
    if (typeof s.nat.field !== 'string' || !s.nat.field) why.push('nat.field');
    if (!(s.nat.fs > 0)) why.push('nat.fs');
    if (!(s.nat.pad >= 0)) why.push('nat.pad');
    if (!(s.nat.minW > 0)) why.push('nat.minW');
  } else {
    if (!Number.isInteger(s.nat.w) || s.nat.w <= 0) why.push('nat.w');
    if (!Number.isInteger(s.nat.h) || s.nat.h <= 0) why.push('nat.h');
  }
  if (typeof s.def !== 'object' || s.def === null || Array.isArray(s.def)) why.push('def');
  if (why.length) bad.push(t + ':' + why.join('/'));
}
ok('每个条目字段齐全且尺寸为正整数', bad.length === 0, bad.join(' | '));

// 兜底行为（决定"旧数据里缺尺寸的控件"怎么显示）
ok('sizeOf 未知类型兜底 200×44', (() => {
  const d = API.sizeOf('__nope__'); return d.w === 200 && d.h === 44;
})());
ok('defaultsOf 未知类型兜底空对象', Object.keys(API.defaultsOf('__nope__')).length === 0);
ok('naturalOf 未知类型返回 null', API.naturalOf('__nope__') === null);
ok('types() 与键一致', API.types().length === types.length);

// ---------- ② 编辑器 / 运行时真的从注册表取数 ----------
const editor = read(path.join(WWW, 'editor.js'));
const runtime = read(path.join(WWW, 'runtime.js'));

console.log('\n===== 尺寸来源已收敛 =====');
ok('editor.js 不再有字面量 TYPE_META 表', !/var\s+TYPE_META\s*=\s*\{/.test(editor));
ok('editor.js TYPE_META 由 FAST_COMPONENTS 派生', /TYPE_META[\s\S]{0,220}FAST_COMPONENTS/.test(editor));
ok('editor.js COMPONENT_DEFAULTS 由压平函数生成', /var\s+COMPONENT_DEFAULTS\s*=\s*\(function/.test(editor)
  && /FAST_COMPONENTS\[k\]\.def/.test(editor));
ok('editor.js defaultSize 走 FAST_COMP.sizeOf', /function\s+defaultSize\s*\(c\)\s*\{\s*return\s+FAST_COMP\.sizeOf\(c\.type\)/.test(editor));
ok('runtime.js defaultBox 走 FAST_COMP.sizeOf', /function\s+defaultBox\s*\(c\)\s*\{\s*return\s+FAST_COMP\.sizeOf\(c\.type\)/.test(runtime));
ok('editor.js naturalSize 走 FAST_COMP.naturalOf', /function\s+naturalSize[\s\S]{0,160}FAST_COMP\.naturalOf\(type\)/.test(editor));

// 每个控件类型都应在这两份文件里被提到（新增控件必须补渲染分支）
const missingRuntime = types.filter((t) => runtime.indexOf("'" + t + "'") < 0);
const missingEditor = types.filter((t) => editor.indexOf("'" + t + "'") < 0);
ok('每个类型都在 runtime.js 出现（渲染分支齐全）', missingRuntime.length === 0, missingRuntime.join(','));
ok('每个类型都在 editor.js 出现（属性面板/渲染齐全）', missingEditor.length === 0, missingEditor.join(','));

// ---------- ③ 加载顺序与打包清单 ----------
console.log('\n===== 引用与打包 =====');
const editorHtml = read(path.join(WWW, 'editor.html'));
const runtimeHtml = read(path.join(WWW, 'runtime.html'));
const idxEdSpec = editorHtml.indexOf('src="comp-spec.js');
const idxEdBlocks = editorHtml.indexOf('src="blocks.js');
const idxRtSpec = runtimeHtml.indexOf('src="comp-spec.js');
const idxRt = runtimeHtml.indexOf('src="runtime.js');
ok('editor.html 先加载 comp-spec.js 再 blocks.js', idxEdSpec >= 0 && idxEdBlocks >= 0 && idxEdSpec < idxEdBlocks);
ok('runtime.html 先加载 comp-spec.js 再 runtime.js', idxRtSpec >= 0 && idxRt >= 0 && idxRtSpec < idxRt);

const buildPs1 = read(path.join(ROOT, 'build.ps1'));
ok('build.ps1 把 comp-spec.js 复制进导出壳', /assets\\www\\comp-spec\.js/.test(buildPs1));

console.log('\n===== 结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项 =====');
process.exit(fail ? 1 : 0);
