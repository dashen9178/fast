/* 通过编辑器自身 UI 搭建“FAST 积木大全”演示工程：
   1) UI 建应用、加页面、加组件、改属性；
   2) 积木 XML 注入活主工作区（等同拖拽产出），切视图走编辑器自身保存；
   3) 输出 project JSON 到 /tmp/demo_project.json，并校验每页生成代码语法。 */
const WebSocket = require('ws');
const fs = require('fs');
const HTTP = 'http://127.0.0.1:' + (process.env.CDP_PORT || '9223');
function get(p) { return new Promise((res, rej) => { require('http').get(HTTP + p, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
function conn(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u, { perMessageDeflate: false }); const pend = {};
    ws.on('open', () => res({
      send: (m, p = {}) => new Promise((r, j) => { const i = ++id; pend[i] = { r, j }; ws.send(JSON.stringify({ id: i, method: m, params: p })); })
    }));
    ws.on('message', d => { const o = JSON.parse(d); if (o.id && pend[o.id]) o.error ? pend[o.id].j(new Error(JSON.stringify(o.error))) : pend[o.id].r(o.result); });
    ws.on('error', rej);
  });
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------- Blockly XML DSL ---------------- */
const num = n => `<block type="math_number"><field name="NUM">${n}</field></block>`;
const txt = s => `<block type="text"><field name="TEXT">${esc(s)}</field></block>`;
const bool = v => `<block type="logic_boolean"><field name="BOOL">${v ? 'TRUE' : 'FALSE'}</field></block>`;
const picker = h => `<block type="colour_picker"><field name="COLOUR">${h}</field></block>`;
const vget = (vid, name) => `<block type="variables_get"><field name="VAR" id="${vid}">${esc(name)}</field></block>`;
const vset = (vid, name, valXml) => `<block type="variables_set"><field name="VAR" id="${vid}">${esc(name)}</field><value name="VALUE">${valXml}</value></block>`;
const arith = (op, a, b) => `<block type="math_arithmetic"><field name="OP">${op}</field><value name="A">${a}</value><value name="B">${b}</value></block>`;
const single = (op, a) => `<block type="math_single"><field name="OP">${op}</field><value name="NUM">${a}</value></block>`;
const randInt = (a, b) => `<block type="val_random_int"><value name="MIN">${a}</value><value name="MAX">${b}</value></block>`;
const randFrac = () => `<block type="val_random_frac"/>`;
const cmp = (op, a, b) => `<block type="logic_compare"><field name="OP">${op}</field><value name="A">${a}</value><value name="B">${b}</value></block>`;
const logic = (op, a, b) => `<block type="logic_operation"><field name="OP">${op}</field><value name="A">${a}</value><value name="B">${b}</value></block>`;
const not = a => `<block type="logic_negate"><value name="BOOL">${a}</value></block>`;
const rgb = (r, g, b) => `<block type="colour_rgb"><value name="RED">${r}</value><value name="GREEN">${g}</value><value name="BLUE">${b}</value></block>`;
const tlen = a => `<block type="text_length"><value name="VALUE">${a}</value></block>`;
const llen = a => `<block type="lists_length"><value name="VALUE">${a}</value></block>`;
const listCreate = items => `<block type="lists_create_with"><mutation items="${items.length}"/>` +
  items.map((x, i) => `<value name="ADD${i}">${x}</value>`).join('') + `</block>`;
function join(items) {
  return `<block type="text_join"><mutation items="${items.length}"/>` + items.map((x, i) => `<value name="ADD${i}">${x}</value>`).join('') + `</block>`;
}
// 动作
const toast = m => `<block type="act_toast"><value name="MSG">${m}</value></block>`;
const gotoP = pid => `<block type="act_goto"><field name="PAGE">${pid}</field></block>`;
const back = () => `<block type="act_back"/>`;
const exitApp = () => `<block type="act_exit"/>`;
const wait = s => `<block type="act_wait"><value name="SECS">${s}</value></block>`;
const vibrate = ms => `<block type="act_vibrate"><value name="MS">${ms}</value></block>`;
const setText = (cid, v) => `<block type="act_set_text"><field name="COMP">${cid}</field><value name="VALUE">${v}</value></block>`;
const setHint = (cid, v) => `<block type="act_set_hint"><field name="COMP">${cid}</field><value name="VALUE">${v}</value></block>`;
const setBg = (cid, v) => `<block type="act_set_bg"><field name="COMP">${cid}</field><value name="COLOR">${v}</value></block>`;
const setFg = (cid, v) => `<block type="act_set_color"><field name="COMP">${cid}</field><value name="COLOR">${v}</value></block>`;
const show = cid => `<block type="act_show"><field name="COMP">${cid}</field></block>`;
const hide = cid => `<block type="act_hide"><field name="COMP">${cid}</field></block>`;
const opacity = (cid, v) => `<block type="act_opacity"><field name="COMP">${cid}</field><value name="V">${v}</value></block>`;
const listAdd = (cid, v) => `<block type="act_list_add"><field name="COMP">${cid}</field><value name="VALUE">${v}</value></block>`;
const listSet = (cid, v) => `<block type="act_list_set"><field name="COMP">${cid}</field><value name="LIST">${v}</value></block>`;
const listClear = cid => `<block type="act_list_clear"><field name="COMP">${cid}</field></block>`;
const setChecked = (cid, v) => `<block type="act_set_checked"><field name="COMP">${cid}</field><value name="VALUE">${v}</value></block>`;
const getChecked = cid => `<block type="val_get_checked"><field name="COMP">${cid}</field></block>`;
const setSlider = (cid, v) => `<block type="act_set_slider"><field name="COMP">${cid}</field><value name="VALUE">${v}</value></block>`;
const getSlider = cid => `<block type="val_get_slider"><field name="COMP">${cid}</field></block>`;
const setProgress = (cid, v) => `<block type="act_set_progress"><field name="COMP">${cid}</field><value name="VALUE">${v}</value></block>`;
const getProgress = cid => `<block type="val_get_progress"><field name="COMP">${cid}</field></block>`;
const getText = cid => `<block type="val_get_text"><field name="COMP">${cid}</field></block>`;
const selItem = cid => `<block type="val_selected_item"><field name="COMP">${cid}</field></block>`;
const selIndex = cid => `<block type="val_selected_index"><field name="COMP">${cid}</field></block>`;
// 云
const CLOUD = 'c1';
const clTables = () => `<block type="cloud_tables"><field name="CLOUD">${CLOUD}</field></block>`;
const clRows = t => `<block type="cloud_rows"><field name="CLOUD">${CLOUD}</field><value name="TABLE">${t}</value></block>`;
const clSql = s => `<block type="cloud_sql"><field name="CLOUD">${CLOUD}</field><value name="SQL">${s}</value></block>`;
const clCount = t => `<block type="cloud_count"><field name="CLOUD">${CLOUD}</field><value name="TABLE">${t}</value></block>`;
const clRowById = (t, rid) => `<block type="cloud_row_by_id"><field name="CLOUD">${CLOUD}</field><value name="TABLE">${t}</value><value name="ROWID">${rid}</value></block>`;
const clField = (k, v) => `<block type="cloud_field"><value name="KEY">${k}</value><value name="VAL">${v}</value></block>`;
const clAdd = (t, fieldsXml) => `<block type="cloud_add"><field name="CLOUD">${CLOUD}</field><value name="TABLE">${t}</value><statement name="FIELDS">${fieldsXml}</statement></block>`;
const clUpdate = (t, rid, fieldsXml) => `<block type="cloud_update"><field name="CLOUD">${CLOUD}</field><value name="TABLE">${t}</value><value name="ROWID">${rid}</value><statement name="FIELDS">${fieldsXml}</statement></block>`;
const clDelete = (t, rid) => `<block type="cloud_delete"><field name="CLOUD">${CLOUD}</field><value name="TABLE">${t}</value><value name="ROWID">${rid}</value></block>`;
const jsonGet = (o, k) => `<block type="val_json_get"><value name="OBJ">${o}</value><value name="KEY">${k}</value></block>`;
// 控制
function chain(blocks) { // 纵向串联
  if (!blocks.length) return '';
  const [h, ...rest] = blocks;
  return rest.length ? h.replace(/<\/block>$/, `<next>${chain(rest)}</next></block>`) : h;
}
function hat(type, fields, bodyBlocks) {
  return `<block type="${type}">${fields || ''}<statement name="DO">${chain(bodyBlocks)}</statement></block>`;
}
const ifBlock = (cond, thenBlocks, elseBlocks) =>
  `<block type="controls_if"><mutation ${elseBlocks ? 'else="1" ' : ''}/><value name="IF0">${cond}</value><statement name="DO0">${chain(thenBlocks)}</statement>` +
  (elseBlocks ? `<statement name="ELSE">${chain(elseBlocks)}</statement>` : '') + `</block>`;
const repeat = (times, body) => `<block type="controls_repeat_ext"><value name="TIMES">${times}</value><statement name="DO">${chain(body)}</statement></block>`;
const forLoop = (vid, name, from, to, by, body) =>
  `<block type="controls_for"><field name="VAR" id="${vid}">${esc(name)}</field><value name="FROM">${from}</value><value name="TO">${to}</value><value name="BY">${by}</value><statement name="DO">${chain(body)}</statement></block>`;
const whileLoop = (mode, cond, body) =>
  `<block type="controls_whileUntil"><field name="MODE">${mode}</field><value name="BOOL">${cond}</value><statement name="DO">${chain(body)}</statement></block>`;
const brk = () => `<block type="controls_flow_statements"><field name="FLOW">BREAK</field></block>`;

/* ---------------- 演示工程定义（组件按视觉顺序） ---------------- */
const SCREENS = [
  { title: '首页', comps: [
    ['text', 'FAST 积木大全', { key: 'T_TITLE' }],
    ['text', '一个作品玩遍所有积木', { key: 'T_SUB' }],
    ['button', '① 基础交互', { key: 'B_S2' }],
    ['button', '② 输入框与列表', { key: 'B_S3' }],
    ['button', '③ 开关·滑块·进度', { key: 'B_S4' }],
    ['button', '④ 控制·数学·变量', { key: 'B_S5' }],
    ['button', '⑤ 云表格 SeaTable', { key: 'B_S6' }],
    ['button', '退出应用', { key: 'B_EXIT' }]
  ]},
  { title: '基础交互', comps: [
    ['text', '① 基础交互', { key: 'T2_TITLE' }],
    ['text', '点下面按钮改变我', { key: 'T2_TARGET' }],
    ['image', '示例图片', { key: 'IMG2', image: true }],
    ['button', '随机背景色', { key: 'B2_BG' }],
    ['button', '文字变红色', { key: 'B2_FG' }],
    ['button', '隐藏图片', { key: 'B2_HIDE' }],
    ['button', '显示图片', { key: 'B2_SHOW' }],
    ['button', '随机透明度', { key: 'B2_OP' }],
    ['button', '震动并提示', { key: 'B2_VIB' }],
    ['button', '返回首页', { key: 'B2_BACK' }]
  ]},
  { title: '输入与列表', comps: [
    ['text', '② 输入框与列表', { key: 'T3_TITLE' }],
    ['input', '', { key: 'INP3', hint: '请输入一项后点添加' }],
    ['button', '添加到列表', { key: 'B3_ADD' }],
    ['list', '', { key: 'LST3', items: ['苹果', '香蕉', '橙子'] }],
    ['button', '清空列表', { key: 'B3_CLEAR' }],
    ['text', '项数：3', { key: 'T3_COUNT' }],
    ['button', '返回首页', { key: 'B3_BACK' }]
  ]},
  { title: '开关滑块', comps: [
    ['text', '③ 开关·滑块·进度', { key: 'T4_TITLE' }],
    ['switch', '通知开关', { key: 'SW4' }],
    ['checkbox', '记住选择', { key: 'CB4' }],
    ['slider', '', { key: 'SL4', min: 0, max: 100, value: 30 }],
    ['progress', '', { key: 'PB4', max: 100, value: 30 }],
    ['text', '滑块：30', { key: 'T4_VAL' }],
    ['button', '翻转开关', { key: 'B4_TOGGLE' }],
    ['button', '两个都开？', { key: 'B4_BOTH' }],
    ['button', '读取所有状态', { key: 'B4_READ' }],
    ['button', '滑块归 50', { key: 'B4_RESET' }],
    ['button', '返回首页', { key: 'B4_BACK' }]
  ]},
  { title: '控制数学', comps: [
    ['text', '④ 控制·数学·变量', { key: 'T5_TITLE' }],
    ['button', '1 加到 10（for）', { key: 'B5_SUM' }],
    ['text', 'for 结果：', { key: 'T5_SUM' }],
    ['button', 'while 计数（break）', { key: 'B5_WHILE' }],
    ['text', 'while 结果：', { key: 'T5_WHILE' }],
    ['button', '重复 3 次拼星', { key: 'B5_REP' }],
    ['text', 'repeat 结果：', { key: 'T5_REP' }],
    ['button', '√144 与随机数', { key: 'B5_MATH' }],
    ['text', 'math 结果：', { key: 'T5_MATH' }],
    ['button', '标题随机变色', { key: 'B5_COLOR' }],
    ['button', '返回首页', { key: 'B5_BACK' }]
  ]},
  { title: '云表格', comps: [
    ['text', '⑤ 云表格 SeaTable', { key: 'T6_TITLE' }],
    ['text', '状态：未加载', { key: 'T6_STATUS' }],
    ['list', '', { key: 'LST6' }],
    ['button', '表格名称与行数', { key: 'B6_INFO' }],
    ['button', '读取所有行', { key: 'B6_REFRESH' }],
    ['button', '新增一行', { key: 'B6_ADD' }],
    ['button', '更新选中行', { key: 'B6_UPD' }],
    ['button', '删除选中行', { key: 'B6_DEL' }],
    ['button', 'SQL 查询演示', { key: 'B6_SQL' }],
    ['button', '返回首页', { key: 'B6_BACK' }]
  ]}
];

/* 每页积木（ids 在组件建好后按 key 注入） */
function blocksFor(si, C, S) {
  const v = { vn: { id: 'var_n', name: 'n' }, vsum: { id: 'var_sum', name: 'sum' }, vk: { id: 'var_k', name: 'k' },
    vs: { id: 'var_s', name: 's' }, vi: { id: 'var_i', name: 'i' }, vr: { id: 'var_rows', name: 'rows' },
    vsel: { id: 'var_sel', name: 'selId' }, vq: { id: 'var_r', name: 'r' } };
  const declare = names => '<variables>' + names.map(n => `<variable id="${n.id}">${esc(n.name)}</variable>`).join('') + '</variables>';
  if (si === 0) {
    const hats = [hat('ev_first_start', null, [toast(txt('欢迎！这是首次打开演示'))])];
    [['B_S2', 1], ['B_S3', 2], ['B_S4', 3], ['B_S5', 4], ['B_S6', 5]].forEach(([k, ti]) =>
      hats.push(hat('ev_click', `<field name="COMP">${C[k]}</field>`, [gotoP(S[ti])])));
    hats.push(hat('ev_click', `<field name="COMP">${C.B_EXIT}</field>`, [exitApp()]));
    return { xml: hats.join('') };
  }
  if (si === 1) {
    return { xml: [
      hat('ev_start', null, [setText(C.T2_TARGET, txt('页面已启动，试试下面按钮'))]),
      hat('ev_click', `<field name="COMP">${C.IMG2}</field>`, [toast(txt('你点了图片组件'))]),
      hat('ev_click', `<field name="COMP">${C.B2_BG}</field>`, [setBg(C.T2_TARGET, rgb(randInt(num(0), num(255)), randInt(num(0), num(255)), randInt(num(0), num(255))))]),
      hat('ev_click', `<field name="COMP">${C.B2_FG}</field>`, [setFg(C.T2_TARGET, picker('#D81B60'))]),
      hat('ev_click', `<field name="COMP">${C.B2_HIDE}</field>`, [hide(C.IMG2)]),
      hat('ev_click', `<field name="COMP">${C.B2_SHOW}</field>`, [show(C.IMG2)]),
      hat('ev_click', `<field name="COMP">${C.B2_OP}</field>`, [opacity(C.IMG2, arith('MULTIPLY', randFrac(), num(100)))]),
      hat('ev_click', `<field name="COMP">${C.B2_VIB}</field>`, [vibrate(num(60)), toast(txt('震动 60 毫秒'))]),
      hat('ev_click', `<field name="COMP">${C.B2_BACK}</field>`, [back()])
    ].join('') };
  }
  if (si === 2) {
    return {
      vars: [v.vn],
      xml: [
        hat('ev_start', null, [
          setHint(C.INP3, txt('请输入一项后点添加')),
          listSet(C.LST3, listCreate([txt('苹果'), txt('香蕉'), txt('橙子')])),
          vset(v.vn.id, v.vn.name, num(3)),
          setText(C.T3_COUNT, join([txt('项数：'), vget(v.vn.id, v.vn.name)]))
        ]),
        hat('ev_click', `<field name="COMP">${C.B3_ADD}</field>`, [
          ifBlock(cmp('NEQ', getText(C.INP3), txt('')),
            [toast(join([txt('已添加，输入长度：'), tlen(getText(C.INP3))])),
             listAdd(C.LST3, getText(C.INP3)),
             setText(C.INP3, txt('')),
             vset(v.vn.id, v.vn.name, arith('ADD', vget(v.vn.id, v.vn.name), num(1))),
             setText(C.T3_COUNT, join([txt('项数：'), vget(v.vn.id, v.vn.name)]))],
            [toast(txt('输入框是空的'))])
        ]),
        hat('ev_itemclick', `<field name="COMP">${C.LST3}</field>`, [
          toast(join([txt('选中：'), selItem(C.LST3), txt('（第'), arith('ADD', selIndex(C.LST3), num(1)), txt('项）')]))
        ]),
        hat('ev_click', `<field name="COMP">${C.B3_CLEAR}</field>`, [
          listClear(C.LST3), vset(v.vn.id, v.vn.name, num(0)), setText(C.T3_COUNT, txt('项数：0'))
        ]),
        hat('ev_click', `<field name="COMP">${C.B3_BACK}</field>`, [back()])
      ].join('')
    };
  }
  if (si === 3) {
    return {
      xml: [
        hat('ev_start', null, [
          setChecked(C.SW4, bool(false)), setChecked(C.CB4, bool(false)),
          setSlider(C.SL4, num(30)), setProgress(C.PB4, num(30)),
          setText(C.T4_VAL, join([txt('滑块：'), num(30)]))
        ]),
        hat('ev_slider_change', `<field name="COMP">${C.SL4}</field>`, [
          setProgress(C.PB4, getSlider(C.SL4)),
          setText(C.T4_VAL, join([txt('滑块：'), getSlider(C.SL4)]))
        ]),
        hat('ev_click', `<field name="COMP">${C.B4_TOGGLE}</field>`, [setChecked(C.SW4, not(getChecked(C.SW4)))]),
        hat('ev_click', `<field name="COMP">${C.B4_BOTH}</field>`, [
          ifBlock(logic('AND', getChecked(C.SW4), getChecked(C.CB4)),
            [toast(txt('两个都开了'))], [toast(txt('还没都开'))])
        ]),
        hat('ev_click', `<field name="COMP">${C.B4_READ}</field>`, [
          ifBlock(cmp('GT', getSlider(C.SL4), num(80)),
            [toast(join([txt('滑块偏大；开关:'), getChecked(C.SW4), txt(' 复选:'), getChecked(C.CB4),
              join([txt(' 进度:'), getProgress(C.PB4), txt('')])]))],
            [toast(join([txt('滑块正常；开关:'), getChecked(C.SW4), txt(' 复选:'), getChecked(C.CB4),
              join([txt(' 进度:'), getProgress(C.PB4), txt('')])]))])
        ]),
        hat('ev_click', `<field name="COMP">${C.B4_RESET}</field>`, [
          setSlider(C.SL4, num(50)), setProgress(C.PB4, num(50)), setChecked(C.CB4, bool(true))
        ]),
        hat('ev_click', `<field name="COMP">${C.B4_BACK}</field>`, [back()])
      ].join('')
    };
  }
  if (si === 4) {
    return {
      vars: [v.vsum, v.vk, v.vs, v.vi],
      xml: [
        hat('ev_click', `<field name="COMP">${C.B5_SUM}</field>`, [
          vset(v.vsum.id, v.vsum.name, num(0)),
          forLoop(v.vi.id, v.vi.name, num(1), num(10), num(1),
            [vset(v.vsum.id, v.vsum.name, arith('ADD', vget(v.vsum.id, v.vsum.name), vget(v.vi.id, v.vi.name)))]),
          setText(C.T5_SUM, join([txt('1到10的和='), vget(v.vsum.id, v.vsum.name)]))
        ]),
        hat('ev_click', `<field name="COMP">${C.B5_WHILE}</field>`, [
          vset(v.vk.id, v.vk.name, num(0)),
          whileLoop('WHILE', cmp('LT', vget(v.vk.id, v.vk.name), num(5)), [
            vset(v.vk.id, v.vk.name, arith('ADD', vget(v.vk.id, v.vk.name), num(1))),
            ifBlock(cmp('GTE', vget(v.vk.id, v.vk.name), num(5)), [brk()])
          ]),
          setText(C.T5_WHILE, join([txt('计数完成 k='), vget(v.vk.id, v.vk.name)]))
        ]),
        hat('ev_click', `<field name="COMP">${C.B5_REP}</field>`, [
          vset(v.vs.id, v.vs.name, txt('')),
          repeat(num(3), [vset(v.vs.id, v.vs.name, join([vget(v.vs.id, v.vs.name), txt('★')]))]),
          setText(C.T5_REP, join([txt('重复3次：'), vget(v.vs.id, v.vs.name)]))
        ]),
        hat('ev_click', `<field name="COMP">${C.B5_MATH}</field>`, [
          setText(C.T5_MATH, join([txt('√144='), single('SQRT', num(144)),
            join([txt('，随机1~100='), randInt(num(1), num(100))])]))
        ]),
        hat('ev_click', `<field name="COMP">${C.B5_COLOR}</field>`, [
          setBg(C.T5_TITLE, rgb(randInt(num(0), num(200)), randInt(num(0), num(200)), randInt(num(0), num(200))))
        ]),
        hat('ev_click', `<field name="COMP">${C.B5_BACK}</field>`, [back()])
      ].join('')
    };
  }
  // si === 5 云表格
  const T = txt('测试表1');
  return {
    vars: [v.vr, v.vsel, v.vq],
    xml: [
      hat('ev_start', null, [toast(txt('云表格演示，请点按钮加载'))]),
      hat('ev_click', `<field name="COMP">${C.B6_INFO}</field>`, [
        setText(C.T6_STATUS, join([clTables(), join([txt('；行数：'), clCount(T)])]))
      ]),
      hat('ev_click', `<field name="COMP">${C.B6_REFRESH}</field>`, [
        vset(v.vr.id, v.vr.name, clRows(T)),
        listClear(C.LST6),
        forLoop(v.vi.id, v.vi.name, num(1), clCount(T), num(1), [
          listAdd(C.LST6, jsonGet(jsonGet(vget(v.vr.id, v.vr.name), arith('MINUS', vget(v.vi.id, v.vi.name), num(1))), txt('测试列1')))
        ]),
        setText(C.T6_STATUS, join([txt('已读取行数：'), clCount(T)]))
      ]),
      hat('ev_itemclick', `<field name="COMP">${C.LST6}</field>`, [
        vset(v.vsel.id, v.vsel.name, jsonGet(jsonGet(vget(v.vr.id, v.vr.name), selIndex(C.LST6)), txt('_id'))),
        toast(join([txt('已选：'), jsonGet(jsonGet(vget(v.vr.id, v.vr.name), selIndex(C.LST6)), txt('测试列1'))]))
      ]),
      hat('ev_click', `<field name="COMP">${C.B6_ADD}</field>`, [
        clAdd(T, chain([clField(txt('测试列1'), join([txt('演示'), randInt(num(1000), num(9999))])),
                        clField(txt('测试列2'), txt('来自FAST'))])),
        toast(txt('已新增，请再点“读取所有行”'))
      ]),
      hat('ev_click', `<field name="COMP">${C.B6_UPD}</field>`, [
        ifBlock(cmp('NEQ', vget(v.vsel.id, v.vsel.name), txt('')),
          [clUpdate(T, vget(v.vsel.id, v.vsel.name), clField(txt('测试列2'), txt('已更新'))),
           toast(txt('已更新，请再点“读取所有行”'))],
          [toast(txt('请先在列表点选一行'))])
      ]),
      hat('ev_click', `<field name="COMP">${C.B6_DEL}</field>`, [
        ifBlock(cmp('NEQ', vget(v.vsel.id, v.vsel.name), txt('')),
          [chain([
            // 先用行 Id 取整行（覆盖 cloud_row_by_id），提示后删除
            vset(v.vq.id, v.vq.name, clRowById(T, vget(v.vsel.id, v.vsel.name))),
            toast(join([txt('删除：'), jsonGet(vget(v.vq.id, v.vq.name), txt('测试列1'))])),
            wait(num(0.5)),
            clDelete(T, vget(v.vsel.id, v.vsel.name)),
            vset(v.vsel.id, v.vsel.name, txt('')),
            toast(txt('已删除，请再点“读取所有行”'))
          ])],
          [toast(txt('请先在列表点选一行'))])
      ]),
      hat('ev_click', `<field name="COMP">${C.B6_SQL}</field>`, [
        vset(v.vq.id, v.vq.name, clSql(txt('SELECT * FROM `测试表1` WHERE `测试列2` = \'来自FAST\''))),
        setText(C.T6_STATUS, join([txt('SQL 命中行数：'), llen(vget(v.vq.id, v.vq.name))]))
      ]),
      hat('ev_click', `<field name="COMP">${C.B6_BACK}</field>`, [back()])
    ].join('')
  };
}

(async () => {
  const l = await get('/json/list'); const t = l.find(x => x.type === 'page'); const c = await conn(t.webSocketDebuggerUrl); const send = c.send;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { const d = r.exceptionDetails; console.log('  !! EXC', d.exception && d.exception.description || d.text); return undefined; } return r.result.value; };
  const load = async u => { await send('Page.navigate', { url: u }); await sleep(800); };

  /* 1. 建应用 */
  await load('http://127.0.0.1:8931/editor.html?t=' + Date.now());
  await ev(`localStorage.clear();1`);
  await load('http://127.0.0.1:8931/editor.html?t=' + Date.now());
  await ev(`(function(){document.getElementById('btnNewApp').click();var i=document.getElementById('newAppName');i.value='FAST积木大全';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();})()`);
  await sleep(600);

  /* 页面内辅助：设置属性面板字段（建应用后再注入，避免重载丢失） */
  await ev(`window.__setPP = function(label, value){
    var fields = document.querySelectorAll('#propPanel .pp-field');
    for (var i=0;i<fields.length;i++){
      var lab = fields[i].querySelector('span');
      if (lab && lab.textContent.indexOf(label)===0){ var inp = fields[i].querySelector('input,textarea');
        if (inp){ inp.focus(); inp.value = value; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.blur(); return true; } } }
    return false;
  }; 1`);
  await ev(`window.__addComp = async function(type, label, opt){
    document.querySelector('[data-add="'+type+'"]').click(); await new Promise(r=>setTimeout(r,120));
    if (type==='text') window.__setPP('显示文字', label);
    else if (type==='button') window.__setPP('按钮文字', label);
    else if (type==='input') window.__setPP('提示文字', label);
    else if (type==='switch'||type==='checkbox') window.__setPP('标签文字', label);
    else if (type==='image') window.__setPP('占位说明', label);
    else if (type==='list') window.__setPP('列表项', (opt&&opt.items||[]).join('\\n'));
    if (type==='slider'||type==='progress'){
      window.__setPP('最大值', String(opt.max));
      if (type==='slider') window.__setPP('最小值', String(opt.min));
      window.__setPP((type==='slider'?'默认数值':'当前进度'), String(opt.value));
    }
    // 演示工程统一宽度（走属性面板，避免改名后紧凑初始宽度导致文字竖排）
    var W={text:340,button:320,input:340,list:340,switch:230,checkbox:250,slider:300,progress:300}[type];
    if (W) window.__setPP('宽度(px)', String(W));
    if (type==='list') window.__setPP('高度(px)', '240');
    await new Promise(r=>setTimeout(r,60)); return true;
  };1`);

  /* 2. 加页面到 6 个 */
  for (let i = 1; i < 6; i++) {
    await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
    await ev(`document.getElementById('menuAddScreen').click();1`); await sleep(450);
  }
  // 重命名页面标题（页面菜单按钮在标题重命名后显示新名）
  const proj0 = await ev(`JSON.parse(localStorage.getItem('__bb_projects_v2')).items.find(x=>x.id===localStorage.getItem('__bb_open_id')).project`);
  console.log('页面数:', proj0.screens.length);

  /* 3. 逐页：重命名 + 加组件（倒序添加以适配 unshift）+ 改标题 */
  for (let si = 0; si < 6; si++) {
    // 切到目标页
    await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
    await ev(`document.querySelectorAll('#screenMenuList .menu-item')[${si}].click();1`); await sleep(400);
    // 重命名页面：更多菜单里的重命名走 prompt（Blockly dialog）。直接改工程模型并刷新菜单
    await ev(`(function(){var p=JSON.parse(localStorage.getItem('__bb_projects_v2'));var it=p.items.find(x=>x.id===localStorage.getItem('__bb_open_id'));
      it.project.screens[${si}].title=${JSON.stringify(SCREENS[si].title)};
      localStorage.setItem('__bb_projects_v2',JSON.stringify(p));})();1`);
    // 倒序添加组件
    const comps = SCREENS[si].comps.slice().reverse();
    for (const [type, label, opt] of comps) {
      await ev(`window.__addComp(${JSON.stringify(type)}, ${JSON.stringify(label)}, ${JSON.stringify(opt || {})})`);
    }
    await sleep(200);
  }
  console.log('组件添加完成');

  /* 4. 读工程，按 label 映射组件 id */
  const store = await ev(`JSON.stringify(JSON.parse(localStorage.getItem('__bb_projects_v2')).items.find(x=>x.id===localStorage.getItem('__bb_open_id')).project)`);
  const project = JSON.parse(store);
  const screenIds = project.screens.map(s => s.id);
  const keyMap = [];
  project.screens.forEach((s, si) => {
    const m = {};
    SCREENS[si].comps.forEach((spec, order) => {
      const key = spec[2].key;
      // 组件 unshift：视觉顺序与数组顺序相反；用 label 匹配更稳
      const label = spec[1];
      let comp;
      if (spec[0] === 'image') comp = s.components.find(c => c.type === 'image');
      else if (spec[0] === 'list') comp = s.components.filter(c => c.type === 'list')[0];
      else if (['slider', 'progress', 'switch', 'checkbox', 'input'].includes(spec[0]))
        comp = s.components.filter(c => c.type === spec[0])[0];
      else comp = s.components.find(c => (c.text || c.value || '') === label);
      if (!comp) throw new Error('组件未找到: p' + si + ' ' + key + ' label=' + label);
      m[key] = comp.id;
    });
    keyMap.push(m);
  });

  /* 4.5 先登记云表格（等同创建云列表弹窗）并重载编辑器，保证云下拉含 c1，再注入云页积木 */
  await ev(`(function(){var raw=localStorage.getItem('__bb_projects_v2');var p=JSON.parse(raw);var it=p.items.find(x=>x.id===localStorage.getItem('__bb_open_id'));
    it.project.clouds=[{id:'c1',name:'演示云表',provider:'seatable-cn',server:'https://cloud.seatable.cn',
      uuid:'99498ec1-ede9-4e40-a881-cb7f9a2fd3dc',token:'9437f5e39a7292abfe631bf55d5fa9cebd885e32'}];
    localStorage.setItem('__bb_projects_v2',JSON.stringify(p));return 1;})()`);
  await load('http://127.0.0.1:8931/editor.html?t=' + Date.now());
  await sleep(1000);
  const cloudReady = await ev(`(JSON.parse(localStorage.getItem('__bb_projects_v2')).items.find(x=>x.id===localStorage.getItem('__bb_open_id')).project.clouds||[]).length`);
  if (cloudReady !== 1) { console.log('重载后云表格丢失'); process.exit(1); }
  console.log('云表格已登记并重载编辑器');

  /* 5. 逐页注入积木：打开积木视图 → 注入活工作区 → 切回设计视图（触发编辑器保存） */
  const genResults = [];
  for (let si = 0; si < 6; si++) {
    await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
    await ev(`document.querySelectorAll('#screenMenuList .menu-item')[${si}].click();1`); await sleep(400);
    const def = blocksFor(si, keyMap[si], screenIds);
    const varsXml = def.vars ? `<variables>${def.vars.map(n => `<variable id="${n.id}">${esc(n.name)}</variable>`).join('')}</variables>` : '';
    const xml = `<xml xmlns="https://developers.google.com/blockly/xml">${varsXml}${def.xml}</xml>`;
    const r = await ev(`(function(){
      try{
        document.getElementById('tabBlocks').click();
        var ws = Blockly.getMainWorkspace ? Blockly.getMainWorkspace() : Blockly.Workspace.getAll().find(w=>w.getToolbox&&w.getToolbox());
        var dom = Blockly.utils.xml.textToDom(${JSON.stringify(xml)});
        Blockly.Xml.domToWorkspace(dom, ws);
        var n = ws.getAllBlocks(false).length;
        document.getElementById('tabDesign').click();   // 触发 saveCurrentWs
        return JSON.stringify({ok:true, n:n});
      }catch(e){ return JSON.stringify({ok:false, err:String(e&&e.stack||e)}); }
    })()`);
    const rr = JSON.parse(r);
    if (!rr.ok) { console.log('页面', si + 1, '积木注入失败:\n', rr.err); process.exit(1); }
    console.log('页面', si + 1, SCREENS[si].title, '积木块数', rr.n);
  }
  // 最后一页之后没有切页动作，而保存发生在切页时：切到首页再切回，确保第 6 页积木写回
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  await ev(`document.querySelectorAll('#screenMenuList .menu-item')[0].click();1`); await sleep(400);
  await ev(`document.getElementById('btnScreenMenu').click();1`); await sleep(200);
  await ev(`document.querySelectorAll('#screenMenuList .menu-item')[5].click();1`); await sleep(400);
  const s6saved = await ev(`(function(){var p=JSON.parse(localStorage.getItem('__bb_projects_v2')).items.find(x=>x.id===localStorage.getItem('__bb_open_id')).project;return p.screens[5].blocksXml.length;})()`);
  console.log('云页 blocksXml 长度', s6saved);
  if (s6saved < 500) { console.log('云页积木未保存'); process.exit(1); }

  /* 6. 导出最终工程（编辑器格式） */
  const finalRaw = await ev(`JSON.stringify(JSON.parse(localStorage.getItem('__bb_projects_v2')).items.find(x=>x.id===localStorage.getItem('__bb_open_id')).project)`);
  const finalProject = JSON.parse(finalRaw);
  // 页面标题（构建时直接改了存储，内存里可能还是默认名，这里统一在产物上修正）
  finalProject.screens.forEach((s, i) => { s.title = SCREENS[i].title; });
  fs.writeFileSync('/tmp/demo_editor_project.json', JSON.stringify(finalProject, null, 1));
  console.log('编辑器工程已写 /tmp/demo_editor_project.json；页面', finalProject.screens.length, '组件总数',
    finalProject.screens.reduce((a, s) => a + s.components.length, 0));
  /* 8. 走编辑器同款生成器逐页生成 code（等同 buildOutput），产出运行时工程并语法检查 */
  const codeCheck = await ev(`(function(){
    var out=[]; var B=Blockly;
    try{
      var p=JSON.parse(${JSON.stringify(JSON.stringify(finalProject))});
      p.screens.forEach(function(sc){
        window.__codegenScreen=sc;
        var ws=new B.Workspace();
        try{
          B.Xml.domToWorkspace(B.utils.xml.textToDom(sc.blocksXml||'<xml/>'),ws);
          var code = window.generateEventCode ? window.generateEventCode(ws) : '';
          new Function('RT', code);
          out.push({t:sc.title, ok:true, blocks:ws.getAllBlocks(false).length, code:code});
        }catch(e){ out.push({t:sc.title, ok:false, err:String(e)}); }
        finally{ ws.dispose(); window.__codegenScreen=null; }
      });
    }catch(e){ out.push({t:'?', ok:false, err:String(e)}); }
    return JSON.stringify(out);
  })()`);
  const cc = JSON.parse(codeCheck);
  let allOk = true;
  cc.forEach((r, i) => { if (r.ok) { console.log('代码生成 ✓', r.t, '块', r.blocks); finalProject.screens[i].code = r.code; fs.writeFileSync('/tmp/demo_code_' + r.t + '.js', r.code); }
    else { allOk = false; console.log('代码生成 ✗', r.t, r.err); } });
  if (!allOk) process.exit(1);
  // 运行时/导出工程：等同 buildOutput 产物
  finalProject.appName = 'FAST积木大全';
  finalProject.startScreen = finalProject.screens[0].id;
  finalProject.orientation = 'portrait';
  finalProject.version = '1.0';
  fs.writeFileSync('/tmp/demo_project.json', JSON.stringify(finalProject, null, 1));
  console.log('运行时工程已写 /tmp/demo_project.json（含 sc.code）');
  console.log('全部页面代码语法通过');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
