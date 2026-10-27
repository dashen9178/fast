const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
let id=0;(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const oldXml='<xml xmlns="https://developers.google.com/blockly/xml"><block type="ev_start" x="600" y="80"><statement name="DO"><block type="text_print"><next><block type="act_show"></block></next></block></statement></block></xml>';
const r=await send('Runtime.evaluate',{expression:`(function(){
  var dom=Blockly.utils.xml.textToDom(${JSON.stringify(oldXml)});
  migrateEventHatXml(dom);
  var ser=Blockly.utils.xml.domToText(dom);
  var ws2=new Blockly.Workspace();
  Blockly.Xml.domToWorkspace(dom,ws2);
  var h=ws2.getTopBlocks(true)[0];var chain=[];var c=h;while(c){chain.push(c.type);c=c.getNextBlock();}
  var code=window.generateEventCode(ws2).replace(/\\s+/g,' ').trim();
  ws2.dispose();
  return JSON.stringify({ser:ser,chain:chain,code:code});
})()`,returnByValue:true});
console.log(r.result.value);process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
