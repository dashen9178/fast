const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
await ev(`(function(){var B=Blockly;
 var xml='<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="120" y="80"><mutation elseif="2" else="1"></mutation>'
 +'<value name="IF1"><block type="logic_compare"><field name="OP">EQ</field></block></value>'
 +'<statement name="ELSE"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>'
 +'</block></xml>';
 B.Xml.domToWorkspace(B.utils.xml.textToDom(xml),blocklyWs);
 var b=blocklyWs.getBlocksByType('controls_if')[0];
 var ren=blocklyWs.getRenderer();
 var d0=ren.makeDrawer_(b,ren.makeRenderInfo_(b));
 var FD=Object.getPrototypeOf(d0);
 var orig=FD.draw;
 window.__draws=[];
 FD.draw=function(){window.__draws.push({t:this.block_&&this.block_.type,R:this.info_.__ifUnitEdges?this.info_.__ifUnitEdges.slice():null});return orig.apply(this,arguments);};
 b.render();
 return 1;})()`);
await sleep(800);
const out=await ev(`(function(){
 var info=window.__lastInfo;
 var b=blocklyWs.getBlocksByType('controls_if')[0];
 return {draws:window.__draws,
   d:b.getSvgRoot().querySelector('.blocklyPath').getAttribute('d')};})()`);
console.log('draws=',JSON.stringify(out.draws));
console.log('d=',out.d);
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
