// fc-deploy-sdk.mjs —— 用阿里云官方 SDK 部署云函数。
//
// 为什么不用 serverless-devs：本机的 `s` CLI 突然卡死（连 `s -v` 都不返回，删锁/删组件缓存都没用），
// 而它又是发版的唯一通道。官方 SDK 走标准签名，稳定、可控，还能顺手把环境变量一起设上。
//
// 做三件事：
//   1) 把 code/ 目录（index.py + fast.apk）打成一个 zip（store 不压缩，FC 认）
//   2) 拉线上函数配置，**只改代码和环境变量**，其余原样带回去
//      （绝不能整个对象回写：runtime/层/超时/最小实例这些一旦被冲掉，函数就废了）
//   3) 回读配置确认 + 打印关键信息
//
// 用法：node pc-sim/fc-deploy-sdk.mjs   （需要 ALI_AK / ALI_SK 环境变量）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const req = createRequire('D:/DSH工作/tools/fc-sdk/package.json');
const FC = req('@alicloud/fc20230330');
const Client = FC.default || FC;
const { UpdateFunctionInput, InputCodeLocation, GetFunctionRequest, UpdateFunctionRequest } = FC;
let Config = null;
for (const m of ['@alicloud/openapi-core', '@alicloud/openapi-client']) {
  try { const x = req(m); Config = x.Config || (x.default && x.default.Config) || Config; } catch (e) { }
}
if (!Config) { console.error('cannot find Config class'); process.exit(1); }

const AK = process.env.ALI_AK;
const SK = process.env.ALI_SK;
const REGION = 'cn-hangzhou';
const FN = 'fast-mail-code';
const CODE_DIR = 'D:/DSH工作/Fast/fast_project_v2/fc-deploy/fast-mail-deploy/code';
// 额外要写进去的环境变量（不想动线上已有的，所以是"合并"而不是"覆盖全部"）
// ⚠️ 凭据**只能**从环境变量来：仓库是公开的，别再把 token 写死在源码里。
//   用法：$env:SEATABLE_TOKEN_UPDATE='…'; node pc-sim/fc-deploy-sdk.mjs
const NEW_ENV = {};
if (process.env.SEATABLE_TOKEN_UPDATE) NEW_ENV.SEATABLE_TOKEN_UPDATE = process.env.SEATABLE_TOKEN_UPDATE;

// ---- 最小 ZIP 写入器（store 不压缩）----
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, e.data);
    central.push({ nameBuf, crc, size: e.data.length, offset });
    offset += lh.length + nameBuf.length + e.data.length;
  }
  const cd = []; let cdSize = 0;
  for (const c of central) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(c.crc, 16); ch.writeUInt32LE(c.size, 20); ch.writeUInt32LE(c.size, 24);
    ch.writeUInt16LE(c.nameBuf.length, 28); ch.writeUInt32LE(c.offset, 42);
    cd.push(ch, c.nameBuf); cdSize += ch.length + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...cd, eocd]);
}

const files = fs.readdirSync(CODE_DIR).filter(f => fs.statSync(path.join(CODE_DIR, f)).isFile());
console.log('zip entries: ' + files.map(f => `${f}(${fs.statSync(path.join(CODE_DIR, f)).size})`).join(', '));
const zip = zipStore(files.map(f => ({ name: f, data: fs.readFileSync(path.join(CODE_DIR, f)) })));
console.log('zip size = ' + zip.length);

const client = new Client(new Config({
  accessKeyId: AK, accessKeySecret: SK, regionId: REGION, endpoint: `fcv3.${REGION}.aliyuncs.com`,
}));

// 只保留可写字段；读回来的只读字段（codeChecksum/codeSize/functionArn/state/createdTime…）一律不往回带
const WRITABLE = ['runtime', 'handler', 'memorySize', 'timeout', 'instanceConcurrency', 'diskSize',
  'internetAccess', 'instanceIsolationMode', 'sessionAffinity', 'disableOndemand', 'description',
  'environmentVariables', 'layers', 'customRuntimeConfig', 'logConfig', 'tracingConfig',
  'vpcConfig', 'nasConfig', 'ossMountConfig', 'role', 'cpu', 'gpuConfig'];

(async () => {
  const cur = await client.getFunction(FN, new GetFunctionRequest({}));
  const f = cur.body || {};
  console.log('\nBEFORE runtime=' + f.runtime + ' handler=' + f.handler + ' codeSize=' + f.codeSize +
    ' layers=' + JSON.stringify(f.layers || []));
  const env = Object.assign({}, f.environmentVariables || {}, NEW_ENV);
  // 注意：UpdateFunctionRequest.body 要的是 **UpdateFunctionInput**，不是 Function（读模型）。
  // 一开始我给的是 Function，结果 API 200 了但**代码根本没换**（codeChecksum 一点没变），
  // 因为 Function.code 的类型/序列化跟输入模型对不上。而且 UpdateFunctionInput.layers 本身就是
  // 字符串数组，不用再折腾对象转换。functionName 不在这两个模型里（名字在 URL 上），别带。
  const props = {};
  for (const k of WRITABLE) if (f[k] !== undefined && f[k] !== null) props[k] = f[k];
  props.layers = (f.layers || []).map(l => (typeof l === 'string' ? l : l.arn)).filter(Boolean);
  props.environmentVariables = env;
  props.code = new InputCodeLocation({ zipFile: zip.toString('base64') });

  console.log('env keys to write: ' + Object.keys(env).join(', '));
  console.log('layers to write: ' + JSON.stringify(props.layers));
  console.log('code zip bytes (base64) = ' + props.code.zipFile.length);
  let ok = false, lastErr = null;
  for (const withLayers of [true, false]) {
    const p2 = Object.assign({}, props);
    if (!withLayers) delete p2.layers;
    try {
      const r = await client.updateFunction(FN, new UpdateFunctionRequest({ body: new UpdateFunctionInput(p2) }));
      console.log('updateFunction status=' + (r.statusCode || '?') + (withLayers ? ' (带 layers)' : ' (不带 layers)'));
      ok = true;
      break;
    } catch (e) {
      lastErr = e;
      console.log('试' + (withLayers ? '带' : '不带') + ' layers 失败：' + String(e.message || e).slice(0, 140));
    }
  }
  if (!ok) throw lastErr || new Error('updateFunction 两次都失败');

  await new Promise(res => setTimeout(res, 4000));
  const after = await client.getFunction(FN, new GetFunctionRequest({}));
  const g = after.body || {};
  console.log('\nAFTER codeSize=' + g.codeSize + ' codeChecksum=' + g.codeChecksum +
    ' runtime=' + g.runtime + ' handler=' + g.handler + ' layers=' + JSON.stringify(g.layers || []));
  console.log('env keys: ' + Object.keys(g.environmentVariables || {}).join(', '));
  console.log('has SEATABLE_TOKEN_UPDATE = ' + ('SEATABLE_TOKEN_UPDATE' in (g.environmentVariables || {})));
  console.log('has SMTP_USER = ' + (!!(g.environmentVariables || {}).SMTP_USER));
  console.log('customRuntimeConfig = ' + JSON.stringify(g.customRuntimeConfig));
})().catch(e => {
  console.error('DEPLOY FAILED: ' + (e.message || e));
  if (e.data) console.error(JSON.stringify(e.data).slice(0, 600));
  process.exit(1);
});
