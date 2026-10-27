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
await ev(`(function(){var B=Blockly;
 var xml='<xml xmlns="https://developers.google.com/blockly/xml">'
 +'<block type="ev_start" x="120" y="60"><next><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">a</field></block></value>'
 +'<next><block type="act_vibrate"><next><block type="act_exit"></block></next></block></next></block></next></block>'
 +'<block type="act_toast" x="500" y="120"><value name="MSG"><block type="text"><field name="TEXT">独立</field></block></value></block>'
 +'</xml>';
 B.Xml.domToWorkspace(B.utils.xml.textToDom(xml),blocklyWs);
 return 1;})()`);
await sleep(500);
function snap(){return ev(`(function(){
 var out={};blocklyWs.getAllBlocks(false).forEach(function(b){
  var p=b.getRelativeToSurfaceXY();
  out[b.id]={t:b.type,x:Math.round(p.x),y:Math.round(p.y),
   prev:b.previousConnection&&b.previousConnection.targetConnection?b.previousConnection.targetBlock().type:null,
   next:b.nextConnection&&b.nextConnection.targetConnection?b.nextConnection.targetBlock().type:null};
 });
 return out;})()`);}
const before=await snap();
// 真实删除路径：分组 + dispose(true)
await ev(`(function(){var B=Blockly;
 var b=blocklyWs.getBlocksByType('act_vibrate')[0];
 B.Events.setGroup('del_test_1');
 try{b.dispose(true);}finally{B.Events.setGroup(false);}
 return 1;})()`);
await sleep(300);
// 愈合检查：toast.next 应直接连到 exit
const healed=await ev(`(function(){var t=blocklyWs.getBlocksByType('act_toast').filter(function(b){var f=b.getField('MSG');return f&&f.getFieldLabel&&true;})[0];
 var top=blocklyWs.getBlocksByType('act_toast')[0];
 return {toastNext:top.nextConnection.targetBlock()?top.nextConnection.targetBlock().type:null};})()`);
console.log('删除后愈合 toast->',healed.toastNext,'(应 act_exit)');
// 撤销
await ev(`blocklyWs.undo(false);1`);await sleep(400);
const afterUndo=await snap();
let mm=[];
for(const k in before){const a=before[k],b=afterUndo[k];
 if(!b){mm.push(a.t+' 丢失');continue;}
 if(a.x!==b.x||a.y!==b.y)mm.push(a.t+' 坐标 '+a.x+','+a.y+'->'+b.x+','+b.y);
 if(a.prev!==b.prev)mm.push(a.t+' prev '+a.prev+'->'+b.prev);
 if(a.next!==b.next)mm.push(a.t+' next '+a.next+'->'+b.next);}
console.log('撤销后',Object.keys(afterUndo).length+'/'+Object.keys(before).length,'不一致:',JSON.stringify(mm));
// 再删独立 toast 并撤销
await ev(`(function(){var B=Blockly;
 var bs=blocklyWs.getTopBlocks(true).filter(function(b){return b.type==='act_toast';});
 B.Events.setGroup('del_test_2');
 try{bs[0].dispose(true);}finally{B.Events.setGroup(false);}
 return 1;})()`);
await sleep(200);
await ev(`blocklyWs.undo(false);1`);await sleep(400);
const afterUndo2=await snap();
let mm2=[];
for(const k in before){const a=before[k],b=afterUndo2[k];
 if(!b){mm2.push(a.t+' 丢失');continue;}
 if(a.x!==b.x||a.y!==b.y)mm2.push(a.t+' 坐标');
 if(a.prev!==b.prev||a.next!==b.next)mm2.push(a.t+' 连接');}
console.log('独立块删除撤销 不一致:',JSON.stringify(mm2));
await ev(`blocklyWs.zoomToFit&&blocklyWs.zoomToFit();1`);await sleep(400);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/undo_ok.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
