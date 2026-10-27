const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 构造：帽块 → toast → 震动 → 退出（next 链），再加一个独立块
await ev(`(function(){var B=Blockly;
 var xml='<xml xmlns="https://developers.google.com/blockly/xml">'
 +'<block type="ev_start" x="120" y="60"><next><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">a</field></block></value>'
 +'<next><block type="act_vibrate"><next><block type="act_exit"></block></next></block></next></block></next></block>'
 +'<block type="act_toast" x="120" y="420"><value name="MSG"><block type="text"><field name="TEXT">独立</field></block></value></block>'
 +'</xml>';
 B.Xml.domToWorkspace(B.utils.xml.textToDom(xml),blocklyWs);
 return 1;})()`);
await sleep(500);
function pos(){return ev(`(function(){
 var out={};blocklyWs.getAllBlocks(false).forEach(function(b){
  var p=b.getRelativeToSurfaceXY();out[b.id]={t:b.type,x:Math.round(p.x),y:Math.round(p.y),
   top:!b.getParent(),next:b.nextConnection&&b.nextConnection.targetConnection?b.nextConnection.targetBlock().type:null};
 });
 return out;})()`);}
const before=await pos();
// 删除中间的震动块（真实 API：block.delete 模拟菜单删除）
const del=await ev(`(function(){var b=blocklyWs.getBlocksByType('act_vibrate')[0];
 var p=b.getRelativeToSurfaceXY();b.dispose(false);return JSON.stringify({x:Math.round(p.x),y:Math.round(p.y)});})()`);
console.log('删除震动块, 原坐标',del);
await sleep(300);
const afterDel=await pos();
// 撤销
await ev(`blocklyWs.undo(false);1`);await sleep(400);
const afterUndo=await pos();
// 检查：所有块坐标应与删除前一致（无叠块）
let mismatch=[];
for(const k in before){const a=before[k],b=afterUndo[k];
 if(!b){mismatch.push(a.t+' 丢失');continue;}
 if(a.x!==b.x||a.y!==b.y)mismatch.push(a.t+' 坐标 '+a.x+','+a.y+' -> '+b.x+','+b.y);
 if(a.next!==b.next)mismatch.push(a.t+' next '+a.next+'->'+b.next);
}
console.log('撤销后块数',Object.keys(afterUndo).length,'/',Object.keys(before).length);
console.log('不一致:',JSON.stringify(mismatch));
// 截图
await ev(`blocklyWs.zoomToFit&&blocklyWs.zoomToFit();1`);await sleep(400);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/undo_reg.png',Buffer.from(s.data,'base64'));
// 帽块几何：圆钮 r30、凸出
const hat=await ev(`(function(){var b=blocklyWs.getBlocksByType('ev_start')[0];
 var p=b.getSvgRoot().querySelector('.blocklyPath').getAttribute('d');
 var hw=b.getHeightWidth();
 return {w:Math.round(hw.width),h:Math.round(hw.height),path:p.slice(0,200)};})()`);
console.log('帽块:',JSON.stringify(hat));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
