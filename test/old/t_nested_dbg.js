const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const expr = `(function(){
  var b=blocklyWs.getAllBlocks(false).find(function(x){return x.getParent()&&x.getParent().type==='controls_if';});
  if(!b)return 'no nested';
  var renderer=b.workspace.getRenderer();
  var info=renderer.makeRenderInfo_(b);
  info.measure();
  var T=Blockly.blockRendering.Types;
  var rows=info.rows.map(function(r){
    var stmts=r.elements.filter(function(e){return T.isStatementInput(e);}).map(function(e){
      var nm='';try{nm=e.connectionModel.getParentInput().name;}catch(err){nm='ERR';}
      return nm+'@x'+e.xPos+' notch'+e.notchOffset;
    });
    return 'y'+r.yPos+' h'+r.height+(stmts.length?' STMT['+stmts.join(',')+']':'');
  });
  return JSON.stringify({hw:b.getHeightWidth(),startY:info.startY,rows:rows});
})()`;
const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,500));
console.log(r.result.value);process.exit(0);})().catch(e=>{console.error(e.message);process.exit(1);});
