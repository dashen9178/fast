const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,300));return r.result.value;};
const R={};
// 当前页面已有工程。清空，加按钮控件（用于 v_button_click）
await ev(`blocklyWs.clear();1`);
// 添加按钮控件
await ev(`document.getElementById('tabDesign').click();1`);await sleep(400);
await ev(`document.querySelector('[data-add="button"]').click();1`);await sleep(500);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(700);
// 打开事件分类看 flyout
await ev(`(function(){var tb=blocklyWs.getToolbox();var k=tb.getToolboxItems().find(i=>i.isSelectable&&i.getName()==='事件');tb.setSelectedItem(k);return 1;})()`);await sleep(900);
R.flyout=await ev(`(function(){var fl=blocklyWs.getFlyout();var fr=fl.svgGroup_.getBoundingClientRect();var wR=0;fl.getWorkspace().getTopBlocks(false).forEach(function(b){var r=b.getSvgRoot().getBoundingClientRect();wR=Math.max(wR,Math.round(r.right-fr.right));});
  var info=fl.getWorkspace().getTopBlocks(false).map(b=>b.type+':stmt='+b.statementInputCount+',next='+(!!b.nextConnection));
  return JSON.stringify({overlap:wR,info:info});})()`);
let s=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:60,width:320,height:420,scale:1.5}});
fs.writeFileSync('/tmp/t_flyout_events.png',Buffer.from(s.data,'base64'));
// 旧 if（elseif+else）兼容
await ev(`blocklyWs.getFlyout().hide();1`);await sleep(200);
await ev(`(function(){var xml=Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="260" y="120"><mutation elseif="1" else="1"></mutation></block></xml>');Blockly.Xml.domToWorkspace(xml,blocklyWs);return 1;})()`);await sleep(400);
R.oldIf=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');return JSON.stringify({ei:b.elseifCount_,el:b.elseCount_,labels:[].slice.call(b.getSvgRoot().querySelectorAll('text.blocklyText')).map(t=>t.textContent).filter(s=>s.indexOf('如果')>=0||s.indexOf('否则')>=0)});})()`);
s=await send('Page.captureScreenshot',{format:'png',clip:{x:200,y:140,width:330,height:420,scale:1.6}});
fs.writeFileSync('/tmp/t_old_if.png',Buffer.from(s.data,'base64'));
// v_button_click 新形态 + 代码生成
R.vclick=await ev(`(function(){
  var ws2=new Blockly.Workspace();
  var b=Blockly.Xml.domToBlock(Blockly.utils.xml.textToDom('<block type="v_button_click"><next><block type="act_show"></block></next></block>'),ws2);
  var shape={stmt:b.statementInputCount,next:!!b.nextConnection,hat:b.hat};
  var code=window.generateEventCode(ws2).replace(/\\s+/g,' ').trim();
  ws2.dispose();return JSON.stringify({shape:shape,code:code});
})()`);
console.log(JSON.stringify(R,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
