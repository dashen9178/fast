const fs=require('fs');
const BASE='http://127.0.0.1:8931/editor.html?z='+Date.now();
const PORT=9333;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let failures=0;
function check(name,cond,extra){ console.log((cond?'  OK  ':'  FAIL')+' '+name+(extra?'  '+extra:'')); if(!cond) failures++; }
(async()=>{
  const list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;
  function cdp(method,params={}){return new Promise((res,rej)=>{const id=++seq;const h=(ev)=>{const m=JSON.parse(ev.data);if(m.id===id){ws.removeEventListener('message',h);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method,params}));});}
  async function ev(e){const r=await cdp('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;}
  await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='v113';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);

  async function load(xml){ await ev(`blocklyWs.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);'ok'`); await sleep(250); }
  // Measure the top controls_if (or a given type) and return structured geometry.
  async function probe(type){ return ev(`(function(){
    var type='controls_if';    var b=blocklyWs.getTopBlocks(true).find(function(x){return x.type===type;});
    var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
    var dr=ren.makeDrawer_(b,info); dr.drawOutline_&&dr.drawOutline_();
    var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
    var C=Blockly.blockRendering.ConstantProvider.prototype?null:null;
    var NOTCH_OFF=ren.getConstants().NOTCH_OFFSET_LEFT, INSIDE=ren.getConstants().INSIDE_CORNERS.rightWidth||ren.getConstants().INSIDE_CORNERS.width;
    var units=[];
    // collect header/pocket edges from map
    var headers=[], pockets=[];
    info.rows.forEach(function(r){
      if(info.__ifRowEdge && info.__ifRowEdge.has(r)){
        var inp=(typeof r.getLastInput==='function')?r.getLastInput():null;
        var nm=inp&&inp.input?inp.input.name:null;
        if(r.hasStatement){ pockets.push({name:nm, edge:+info.__ifRowEdge.get(r).toFixed(2),
          childW: inp&&inp.connectedBlock?+inp.connectedBlock.getHeightWidth().width.toFixed(2):0}); }
        else headers.push({name:nm, edge:+info.__ifRowEdge.get(r).toFixed(2), w:+r.width.toFixed(2)});
      }
    });
    // next/prev connection offsets
    var prevX=null,nextX=null;
    if(b.previousConnection){ var o=b.previousConnection.getOffsetInBlock(); prevX=+o.x.toFixed(1); }
    if(b.nextConnection){ var o2=b.nextConnection.getOffsetInBlock(); nextX=+o2.x.toFixed(1); }
    return {edges:info.__ifEdges.map(function(x){return +x.toFixed(2)}),
      top:info.__ifTopEdge&&+info.__ifTopEdge.toFixed(2), bottom:info.__ifBottomEdge&&+info.__ifBottomEdge.toFixed(2),
      headers:headers, pockets:pockets, blockW:+b.getHeightWidth().width.toFixed(1),
      pathL:+bb.x.toFixed(2), pathR:+bb.x2&&+((bb.x+bb.width).toFixed(2)),
      prevX:prevX, nextX:nextX, NOTCH_OFF:NOTCH_OFF, INSIDE:INSIDE, path:dr.outlinePath_};
  })()`); }
  async function shot(name){ const r=await cdp('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(process.argv[2]+'\\'+name+'.png',Buffer.from(r.data,'base64')); }

  // ---------- T1: user scene ----------
  console.log('T1 user scene (wide IF1, repeat in DO1, brightness in ELSE):');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="controls_if" x="300" y="60"><mutation elseif="1" else="1"/>
     <value name="IF1"><block type="logic_operation"><field name="OP">AND</field>
       <value name="A"><block type="logic_operation"><field name="OP">AND</field></block></value></block></value>
     <statement name="DO1"><block type="controls_repeat_ext"><value name="TIMES"><block type="math_number"><field name="NUM">10</field></block></value></block></statement>
     <statement name="ELSE"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>
   </block></xml>`);
  const t1=await probe();
  console.log(JSON.stringify({edges:t1.edges,headers:t1.headers,pockets:t1.pockets,bottom:t1.bottom,blockW:t1.blockW,pathL:t1.pathL},null,0));
  check('T1 pathL=0', Math.abs(t1.pathL)<0.1, 'pathL='+t1.pathL);
  check('T1 header IF1 wide (432), others 160', t1.headers[0].edge===160 && Math.abs(t1.headers[1].edge-432)<0.1 && t1.headers[2].edge>=267);
  // pocket containment: edge >= NOTCH_OFF + childW + INSIDE
  t1.pockets.forEach(function(p){ if(p.childW>0) check('T1 pocket '+p.name+' wraps child '+p.childW, p.edge + 0.1 >= t1.NOTCH_OFF + p.childW + t1.INSIDE, 'edge='+p.edge); });
  check('T1 DO1 pocket ~184', Math.abs(t1.pockets[1].edge-184)<0.1, ''+t1.pockets[1].edge);
  check('T1 ELSE pocket ~267.9', Math.abs(t1.pockets[2].edge-267.94)<0.1, ''+t1.pockets[2].edge);
  check('T1 else label bridges to 267.9', Math.abs(t1.headers[2].edge-267.94)<0.1, ''+t1.headers[2].edge);
  check('T1 widening shelf present (H 424 before wide corner)', /H 424 a 8 8 0 0,1 8,8\s+V 126/.test(t1.path));
  check('T1 no up-retrace lip (no V 76)', !/V 76/.test(t1.path));
  await shot('t1_user');

  // ---------- T2: wide boolean only, no children ----------
  console.log('T2 wide boolean in IF2, no statement children:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><mutation elseif="2" else="1"/>
      <value name="IF2"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="math_number"><field name="NUM">123456</field></block></value><value name="B"><block type="math_number"><field name="NUM">654321</field></block></value></block></value>
    </block></xml>`);
  const t2=await probe();
  console.log(JSON.stringify({edges:t2.edges,headers:t2.headers.map(h=>h.edge),pockets:t2.pockets.map(p=>p.edge)},null,0));
  check('T2 pathL=0', Math.abs(t2.pathL)<0.1);
  check('T2 only unit2 header wide', t2.headers[0].edge===160 && t2.headers[1].edge===160 && t2.headers[2].edge>300 && t2.headers[3].edge===160);
  check('T2 all pockets stay 160', t2.pockets.every(p=>p.edge===160));
  await shot('t2_condonly');

  // ---------- T3: wide statement child in DO1, no else, narrow conditions ----------
  console.log('T3 wide toast in DO1 (no else):');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><mutation elseif="1"/>
      <statement name="DO1"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">这是一个很长的提示内容啦啦啦</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block></statement>
    </block></xml>`);
  const t3=await probe();
  console.log(JSON.stringify({edges:t3.edges,headers:t3.headers.map(h=>h.edge),pockets:t3.pockets.map(p=>({n:p.name,e:p.edge,c:p.childW})),bottom:t3.bottom,blockW:t3.blockW},null,0));
  check('T3 pathL=0', Math.abs(t3.pathL)<0.1);
  check('T3 condition headers stay 160', t3.headers.every(h=>h.edge===160));
  check('T3 DO1 pocket wraps toast', t3.pockets[1].edge >= t3.NOTCH_OFF+t3.pockets[1].childW+t3.INSIDE-0.1);
  check('T3 DO0 pocket stays 160', t3.pockets[0].edge===160);
  check('T3 bottom follows last pocket', Math.abs(t3.bottom-t3.pockets[1].edge)<0.1);
  await shot('t3_widechild');

  // ---------- T4: wide child in first pocket ----------
  console.log('T4 wide toast in DO0:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40">
      <statement name="DO0"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">很长很长的提示内容哈哈哈哈哈哈</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block></statement>
    </block></xml>`);
  const t4=await probe();
  console.log(JSON.stringify({edges:t4.edges,headers:t4.headers.map(h=>h.edge),pockets:t4.pockets.map(p=>({n:p.name,e:p.edge,c:p.childW})),top:t4.top,bottom:t4.bottom},null,0));
  check('T4 pathL=0', Math.abs(t4.pathL)<0.1);
  check('T4 IF0 header stays 160', t4.headers[0].edge===160);
  check('T4 DO0 pocket wraps toast', t4.pockets[0].edge >= t4.NOTCH_OFF+t4.pockets[0].childW+t4.INSIDE-0.1);
  check('T4 top stays 160, bottom wraps', t4.top===160 && Math.abs(t4.bottom-t4.pockets[0].edge)<0.1);
  await shot('t4_do0wide');

  // ---------- T5: empty if ----------
  console.log('T5 empty if:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"></block></xml>`);
  const t5=await probe();
  console.log(JSON.stringify({edges:t5.edges,bottom:t5.bottom,blockW:t5.blockW,pathL:t5.pathL,prevX:t5.prevX,nextX:t5.nextX},null,0));
  check('T5 pathL=0', Math.abs(t5.pathL)<0.1);
  check('T5 all edges 160', t5.edges.length===1 && t5.edges[0]===160 && t5.bottom===160);
  check('T5 connection x=12', t5.prevX===12 && t5.nextX===12, 'prev='+t5.prevX+' next='+t5.nextX);
  await shot('t5_empty');

  // ---------- T6: three-level nested if ----------
  console.log('T6 three-level nested if:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40">
      <statement name="DO0"><block type="controls_if">
        <statement name="DO0"><block type="controls_if">
          <statement name="DO0"><block type="act_vibrate"></block></statement>
        </block></statement>
      </block></statement>
    </block></xml>`);
  const t6=await ev(`(function(){
     var bs=blocklyWs.getAllBlocks ? blocklyWs.getAllBlocks() : blocklyWs.getTopBlocks(true)[0].getDescendants(false);
     var ren=blocklyWs.getRenderer(); var bad=[];
     bs.forEach(function(b){ if(b.type!=='controls_if')return;
       var info=ren.makeRenderInfo_(b); info.measure(); var dr=ren.makeDrawer_(b,info); dr.drawOutline_&&dr.drawOutline_();
       var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
       if(Math.abs(bb.x)>0.1) bad.push(b.id+' x='+bb.x);
     });
     return JSON.stringify({ifCount:bs.filter(function(b){return b.type==='controls_if';}).length, bad:bad});
  })()`);
  console.log(t6); const o6=JSON.parse(t6);
  check('T6 three nested if all pathL=0', o6.bad.length===0 && o6.ifCount===3, JSON.stringify(o6.bad));
  await shot('t6_nested');

  // ---------- T7: stacked if alignment ----------
  console.log('T7 two stacked if blocks:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><next><block type="controls_if"></block></next></block></xml>`);
  const t7=await ev(`(function(){
     var bs=blocklyWs.getTopBlocks(true)[0].getDescendants(false).filter(function(b){return b.type==='controls_if';});
     var p0=bs[0].getRelativeToSurfaceXY(), p1=bs[1].getRelativeToSurfaceXY();
     var dx=+(p1.x-p0.x).toFixed(2);
     var o0=bs[0].nextConnection.getOffsetInBlock(), o1=bs[1].previousConnection.getOffsetInBlock();
     return JSON.stringify({dx:dx, n0x:o0.x, p1x:o1.x});
  })()`);
  console.log(t7); const o7=JSON.parse(t7);
  check('T7 stacked x aligned (dx=0)', o7.dx===0, 'dx='+o7.dx);
  check('T7 connection x both 12', o7.n0x===12 && o7.p1x===12, JSON.stringify(o7));

  // ---------- T8: wide boolean AND wide child in same unit ----------
  console.log('T8 wide condition + wide child in unit1:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><mutation elseif="1" else="1"/>
      <value name="IF1"><block type="logic_operation"><field name="OP">AND</field><value name="A"><block type="logic_operation"><field name="OP">AND</field></block></value></block></value>
      <statement name="DO1"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">中等长度提示</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block></statement>
    </block></xml>`);
  const t8=await probe();
  console.log(JSON.stringify({edges:t8.edges,headers:t8.headers.map(h=>h.edge),pockets:t8.pockets.map(p=>({n:p.name,e:p.edge,c:p.childW}))},null,0));
  check('T8 pathL=0', Math.abs(t8.pathL)<0.1);
  check('T8 IF1 header 432', Math.abs(t8.headers[1].edge-432)<0.1);
  check('T8 DO1 pocket wraps child but stays below header', t8.pockets[1].edge >= t8.NOTCH_OFF+t8.pockets[1].childW+t8.INSIDE-0.1 && t8.pockets[1].edge < 432);
  await shot('t8_both');

  // ---------- T9: else wide child, no elseifs ----------
  console.log('T9 brightness in ELSE only:');
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><mutation else="1"/>
      <statement name="ELSE"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>
    </block></xml>`);
  const t9=await probe();
  console.log(JSON.stringify({edges:t9.edges,headers:t9.headers.map(h=>h.edge),pockets:t9.pockets.map(p=>({n:p.name,e:p.edge,c:p.childW})),bottom:t9.bottom},null,0));
  check('T9 pathL=0', Math.abs(t9.pathL)<0.1);
  check('T9 else label & pocket wrap, bottom wraps', Math.abs(t9.headers[1].edge-t9.pockets[1].edge)<0.1 && Math.abs(t9.bottom-t9.pockets[1].edge)<0.1);
  await shot('t9_else');

  console.log(failures===0 ? '\nALL CHECKS PASSED' : '\n'+failures+' CHECK(S) FAILED');
  ws.close(); process.exit(failures===0?0:2);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
