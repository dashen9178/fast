const BASE='http://127.0.0.1:8931/editor.html?z='+Date.now();
const PORT=9333;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let failures=0;
function check(n,c,x){console.log((c?'  OK  ':'  FAIL')+' '+n+(x?'  '+x:''));if(!c)failures++;}
(async()=>{
  const list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;
  function cdp(m,p={}){return new Promise((res,rej)=>{const id=++seq;const h=(ev)=>{const d=JSON.parse(ev.data);if(d.id===id){ws.removeEventListener('message',h);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method:m,params:p}));});}
  async function ev(e){const r=await cdp('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;}
  await cdp('Page.enable');
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='v113b';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  async function load(xml){ await ev(`blocklyWs.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);'ok'`); await sleep(250); }
  async function geom(){ return ev(`(function(){
    var ren=blocklyWs.getRenderer();
    var out=[];
    blocklyWs.getTopBlocks(true)[0].getDescendants(false).forEach(function(b){
      if(b.type!=='controls_if')return;
      var info=ren.makeRenderInfo_(b); info.measure(); var dr=ren.makeDrawer_(b,info); dr.drawOutline_&&dr.drawOutline_();
      var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      var pockets=[];
      info.rows.forEach(function(r){ if(r.hasStatement){var inp=r.getLastInput(); var c=inp&&inp.connectedBlock;
        pockets.push({name:inp.input.name, edge:+info.__ifRowEdge.get(r).toFixed(1), childW:c?+c.getHeightWidth().width.toFixed(1):0});}});
      out.push({id:b.id,w:+b.getHeightWidth().width.toFixed(1),pathL:+bb.x.toFixed(2),pockets:pockets});
    });
    return JSON.stringify(out);
  })()`); }

  // T10: outer if -> inner if -> wide toast (nested C child wider than 160)
  console.log('T10 nested if with wide grandchild:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40">
      <statement name="DO0"><block type="controls_if">
        <statement name="DO0"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">嵌套里的超长提示内容哈哈哈哈哈哈哈哈</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block></statement>
      </block></statement>
    </block></xml>`);
  const g10=JSON.parse(await geom());
  console.log(JSON.stringify(g10,null,1));
  check('T10 both if pathL=0', g10.every(x=>Math.abs(x.pathL)<0.1));
  const inner=g10[1]||g10.find(x=>x.pockets.some(p=>p.childW>0));
  check('T10 inner pocket wraps toast', inner.pockets[0].edge >= 16+inner.pockets[0].childW+8-0.1);
  const outer=g10[0];
  const innerW=inner.w;
  check('T10 outer pocket wraps inner if', outer.pockets[0].edge >= 16+innerW+8-0.1, 'outerEdge='+outer.pockets[0].edge+' innerW='+innerW);

  // T11: connect then disconnect -> pocket shrinks back
  console.log('T11 disconnect remeasure:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40">
      <statement name="DO0"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">很长的提示哈哈哈哈哈哈哈哈</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block></statement>
    </block></xml>`);
  const before=JSON.parse(await geom())[0];
  console.log('before',JSON.stringify(before.pockets));
  await ev(`(function(){ var b=blocklyWs.getTopBlocks(true)[0]; var c=b.getInput('DO0').connection.targetBlock();
     c.unplug(false); b.getInput('DO0').connection.disconnect(); return 1; })()`);
  await sleep(300);
  const after=JSON.parse(await geom())[0];
  console.log('after',JSON.stringify(after.pockets));
  check('T11 wide while connected', before.pockets[0].edge>160, ''+before.pockets[0].edge);
  check('T11 back to 160 after disconnect', after.pockets[0].edge===160, ''+after.pockets[0].edge);
  check('T11 pathL=0 after', Math.abs(after.pathL)<0.1);

  // reconnect (drag-equivalent: connect manually)
  await ev(`(function(){ var ws=blocklyWs; var b=ws.getTopBlocks(true)[0];
     var loose=ws.getTopBlocks(true).find(function(x){return x!==b;});
     b.getInput('DO0').connection.connect(loose.previousConnection); return 1; })()`);
  await sleep(300);
  const re=JSON.parse(await geom())[0];
  check('T11 wide again after reconnect', re.pockets[0].edge>160, ''+re.pockets[0].edge);

  console.log(failures===0?'\nALL PASSED':'\n'+failures+' FAILED');
  ws.close(); process.exit(failures?2:0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
