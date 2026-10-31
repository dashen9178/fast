// 云端双库一致性检查 / 校准（阿里云 OSS 主库 + GitHub 备份）
//
// 用法（PowerShell）：
//   $env:FAST_TOKEN='<APP_TOKEN>'
//   node fast-cloud-fc/reconcile.mjs            # 只检查
//   node fast-cloud-fc/reconcile.mjs --apply    # 按检查结果校准（OSS 为准）
//   node fast-cloud-fc/reconcile.mjs --apply --prefer=github   # 用 GitHub 覆盖 OSS（应急）
const BASE = process.env.FAST_BASE || 'https://fast-mail-code-uzzxqcntro.cn-hangzhou.fcapp.run';
const TOKEN = process.env.FAST_TOKEN || '';
if (!TOKEN) {
  console.error('缺少 FAST_TOKEN 环境变量');
  process.exit(2);
}
const qs = [];
if (process.argv.includes('--apply')) qs.push('apply=1');
const prefer = process.argv.find(a => a.startsWith('--prefer='));
if (prefer) qs.push('prefer=' + prefer.split('=')[1]);
const url = BASE.replace(/\/+$/, '') + '/api/admin/reconcile' + (qs.length ? '?' + qs.join('&') : '');

const res = await fetch(url, { headers: { 'X-App-Token': TOKEN } });
const body = await res.json().catch(() => null);
if (!res.ok) {
  console.error('请求失败 HTTP ' + res.status, body);
  process.exit(1);
}
for (const it of body.items || []) {
  const mark = it.consistent ? '一致' : '不一致';
  console.log(`[${it.table}] ${mark}  OSS ${it.oss.rows} 行 / GitHub ${it.github.rows} 行` +
    (it.oss.last ? `  最后修改 ${it.oss.last}` : '') +
    (it.action ? `  → ${it.action}` : ''));
  if (it.oss.error) console.log('  OSS 错误：' + it.oss.error);
  if (it.github.error) console.log('  GitHub 错误：' + it.github.error);
}
if (!qs.length) console.log('\n（只检查，未写入任何数据；加 --apply 才会校准）');
