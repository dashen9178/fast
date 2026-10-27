const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
const out=await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');
  if(!b)return 'no if block';
  return b.inputList.map(function(inp){
    return {name:inp.name, ctor:inp.constructor.name,
      fields:inp.fieldRow.map(function(f){return f.getText();}),
      hasStatement:!!inp.connection,
      connType:inp.connection?inp.connection.type:null};
  });
})()`);
console.log(JSON.stringify(out,null,1));
// 检查空字符串 label 是否生成零宽 field：临时把 ELSE label 置空并重渲染，量脊柱宽度
const probe=await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');
  var elseInp=b.getInput('ELSE');
  var f=elseInp.fieldRow[0];
  var before=b.getHeightWidth().width;
  f.setValue('');
  b.render();
  var after=b.getHeightWidth().width;
  // info rows: statement input x
  var info=b.renderer_.makeRenderInfo_(b);
  info.measure();
  var rows=info.rows.map(function(r){return {els:r.elements.map(function(e){return e.type;}), x:r.xPos, y:r.yPos, h:r.height, w:r.width, stmtEdge:e_sth(r)};});
  function e_sth(r){var s=r.elements.find(function(e){return Blockly.blockRendering.Types.isStatementInput(e)});return s?{x:s.xPos,w:s.width,h:s.height,shapeW:s.shape.width}:null;}
  return JSON.stringify({before:before,after:after,fieldText:f.getText(),fieldW:f.size_.width,rows:rows});
})()`);
console.log(probe);
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
