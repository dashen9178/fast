const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,500));return r.result.value;};
const out=await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');
  var g=b.getSvgRoot();
  var layer=g.querySelector('.if-slot-labels');
  var texts=layer?[].slice.call(layer.querySelectorAll('text')).map(function(t){return {txt:t.textContent,x:t.getAttribute('x'),y:t.getAttribute('y'),fill:t.getAttribute('fill'),fs:t.getAttribute('font-size')};}):null;
  // 从 info 拿 statement rows 几何
  var info=b.renderer_.makeRenderInfo_(b); info.measure();
  var rows=[];
  info.rows.forEach(function(r){
    r.elements.forEach(function(e){
      if(Blockly.blockRendering.Types.isStatementInput(e)){
        var nm='';try{nm=e.connection.getParentInput().name;}catch(err){}
        rows.push({name:nm,x:e.xPos,notch:e.notchOffset,shapeW:e.shape.width,h:r.height,ry:r.yPos,connected:!!e.connectedBlock});
      }
    });
  });
  return JSON.stringify({texts:texts,rows:rows,fontSize:b.renderer_.getConstants().FIELD_TEXT_FONTSIZE});
})()`);
console.log(out);
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
