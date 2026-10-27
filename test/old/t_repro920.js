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
// 图二精确结构：n=3，IF1 宽比较块，ELSE 宽亮度块；另放两个帽块
await ev(`(function(){var B=Blockly;
 var xml='<xml xmlns="https://developers.google.com/blockly/xml">'
 +'<block type="ev_first_start" x="80" y="40"></block>'
 +'<block type="ev_start" x="80" y="200"></block>'
 +'<block type="controls_if" x="80" y="360"><mutation elseif="2" else="1"></mutation>'
 +'<value name="IF1"><block type="logic_compare"><field name="OP">EQ</field></block></value>'
 +'<statement name="ELSE"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>'
 +'</block>'
 +'</xml>';
 B.Xml.domToWorkspace(B.utils.xml.textToDom(xml),blocklyWs);
 return 1;})()`);
await sleep(700);
// dump 标签顺序与几何
const info=await ev(`(function(){
 var b=blocklyWs.getBlocksByType('controls_if')[0];
 var labels=b.inputList.map(function(i){return (i.fieldRow||[]).map(function(f){return f.getText?f.getText():'';}).join('')+(i.name?'['+i.name+']':'');});
 var hw=b.getHeightWidth();
 var ren=blocklyWs.getRenderer();
 var drawer=ren.makeDrawer_(b,ren.makeRenderInfo_(b));
 window.__d=Object.getPrototypeOf(drawer);
 var info2=ren.makeRenderInfo_(b);
 return {labels:labels,hw:{w:Math.round(hw.width),h:Math.round(hw.height)},
   R:(function(){info2.measure();info2.alignRowElements_();if(info2.finalize_)info2.finalize_();return info2.__ifUnitEdges;})()};
})()`);
console.log(JSON.stringify(info,null,1));
await ev(`blocklyWs.centerOnBlock(blocklyWs.getBlocksByType('controls_if')[0].id);1`);
await sleep(400);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/repro_if.png',Buffer.from(s.data,'base64'));
// 帽块单独截图
await ev(`blocklyWs.centerOnBlock(blocklyWs.getBlocksByType('ev_first_start')[0].id);1`);
await sleep(400);
s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/repro_hat.png',Buffer.from(s.data,'base64'));
// 帽块 path 与圆钮几何
const hat=await ev(`(function(){var b=blocklyWs.getBlocksByType('ev_first_start')[0];
 var p=b.getSvgRoot().querySelector('.blocklyPath').getAttribute('d');
 var knob=b.getSvgRoot().querySelector('.hat-knob-outer');
 var kb=knob?knob.getBoundingClientRect():null;
 var pr=b.getSvgRoot().querySelector('.blocklyPath').getBoundingClientRect();
 return {path:p,knob:kb?{x:Math.round(kb.x),y:Math.round(kb.y),w:Math.round(kb.width),h:Math.round(kb.height)}:null,
  pathBox:{x:Math.round(pr.x),y:Math.round(pr.y),w:Math.round(pr.width),h:Math.round(pr.height)}};})()`);
console.log('帽块:',JSON.stringify(hat,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
