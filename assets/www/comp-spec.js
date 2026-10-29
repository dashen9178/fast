/* ============================================================
   FAST · 控件类型注册表（编辑器与运行时共用）
   为什么要这一份：以前同一个控件的信息散在 5 个地方——
     editor.js 的 TYPE_META（名称/图标/说明）
     editor.js 的 COMPONENT_DEFAULTS（默认属性）
     editor.js 的 naturalSize（新增时的紧凑尺寸）
     editor.js 的 defaultSize（未填宽高时的兜底尺寸）
     runtime.js 的 defaultBox（运行时的兜底尺寸）
   后两者已经出现过不一致（audio 44/40、container/table/chart 运行时缺项），
   导致"设计页看到的尺寸"和"运行时/导出的尺寸"不同。
   现在统一到这里：加新控件先在这张表加一条，再补两个渲染分支即可。

   字段：
     label  界面显示名
     ico    控件选择面板里的小图标（文字或 emoji）
     desc   选择面板里的一句说明
     size   兜底尺寸（没填 w/h 时用；编辑器与运行时同一份）
     nat    点"添加控件"时的紧凑初始尺寸
            mode:'text' → 宽度按文字实测宽度算；否则用 w
     def    新建控件的默认属性（文案、初值、选项…）
   ============================================================ */
(function (g) {
  'use strict';

  var C = {
    text:      { label: '文字',        ico: 'Aa',   desc: '显示一段文字',
                 size: { w: 220, h: 40 },  nat: { mode: 'text', field: 'value', fs: 16, pad: 8, minW: 56, h: 0 },
                 def: { value: '文字' } },
    button:    { label: '按钮',        ico: 'Btn',  desc: '可点击的按钮',
                 size: { w: 220, h: 48 },  nat: { mode: 'text', field: 'text', fs: 15, pad: 36, iconPad: 46, minW: 88, h: 48 },
                 def: { text: '按钮' } },
    input:     { label: '输入框',      ico: 'In',   desc: '让用户输入文字',
                 size: { w: 220, h: 52 },  nat: { w: 220, h: 52 },
                 def: { hint: '请输入', value: '' } },
    list:      { label: '列表',        ico: 'List', desc: '可滚动、可点选的列表',
                 size: { w: 240, h: 170 }, nat: { w: 260, h: 170 },
                 def: { items: ['第一项', '第二项'] } },
    image:     { label: '图片',        ico: 'Img',  desc: '图片',
                 size: { w: 160, h: 120 }, nat: { w: 160, h: 120 },
                 def: { alt: '图片' } },
    switch:    { label: '开关',        ico: 'Sw',   desc: '开 / 关切换',
                 size: { w: 220, h: 40 },  nat: { mode: 'text', field: 'text', fs: 16, pad: 72, minW: 112, h: 40 },
                 def: { text: '开关', checked: false } },
    checkbox:  { label: '复选框',      ico: '☑',    desc: '勾选 / 取消勾选',
                 size: { w: 220, h: 40 },  nat: { mode: 'text', field: 'text', fs: 16, pad: 42, minW: 96, h: 40 },
                 def: { text: '复选项', checked: false } },
    slider:    { label: '滑块',        ico: 'Sl',   desc: '拖动选择一个数值',
                 size: { w: 220, h: 40 },  nat: { w: 200, h: 48 },
                 def: { min: 0, max: 100, value: 40 } },
    progress:  { label: '进度条',      ico: 'Pr',   desc: '显示进度百分比',
                 size: { w: 220, h: 12 },  nat: { w: 200, h: 14 },
                 def: { max: 100, value: 40 } },
    video:     { label: '视频播放器',  ico: '▶',    desc: '播放网络视频（mp4）',
                 size: { w: 240, h: 135 }, nat: { w: 240, h: 135 },
                 def: { src: '' } },
    audio:     { label: '音频播放',    ico: '♪',    desc: '播放网络音频（mp3）',
                 size: { w: 280, h: 44 },  nat: { w: 280, h: 44 },
                 def: { src: '' } },
    web:       { label: '网页',        ico: 'W',    desc: '内嵌显示一个网页',
                 size: { w: 320, h: 240 }, nat: { w: 320, h: 240 },
                 def: { url: '' } },
    select:    { label: '下拉选择框',  ico: '▾',    desc: '点开选一项（表单常用）',
                 size: { w: 220, h: 48 },  nat: { w: 220, h: 48 },
                 def: { items: ['选项一', '选项二', '选项三'], value: '选项一' } },
    radio:     { label: '单选组',      ico: '◉',    desc: '一组里只能选一个',
                 size: { w: 220, h: 96 },  nat: { w: 220, h: 96 },
                 def: { items: ['选项一', '选项二'], value: '选项一' } },
    date:      { label: '日期',        ico: '📅',   desc: '选择年月日',
                 size: { w: 200, h: 48 },  nat: { w: 200, h: 48 },
                 def: { value: '' } },
    time:      { label: '时间',        ico: '⏰',   desc: '选择时分',
                 size: { w: 160, h: 48 },  nat: { w: 160, h: 48 },
                 def: { value: '' } },
    stepper:   { label: '步进器',      ico: '±',    desc: '加减一个数字',
                 size: { w: 200, h: 48 },  nat: { w: 200, h: 48 },
                 def: { text: '数量', value: 1, min: 0, max: 99 } },
    imgbtn:    { label: '图片按钮',    ico: '🖼',   desc: '能点、带图片的按钮',
                 size: { w: 160, h: 120 }, nat: { w: 160, h: 120 },
                 def: { text: '按钮', src: '' } },
    timer:     { label: '计时器',      ico: '⏱',   desc: '显示倒计时/计时',
                 size: { w: 160, h: 44 },  nat: { w: 160, h: 44 },
                 def: { text: '00:00', seconds: 60 } },
    canvas:    { label: '画布',        ico: '✎',    desc: '用代码画点、线、圆（做小游戏）',
                 size: { w: 300, h: 200 }, nat: { w: 300, h: 200 },
                 def: {} },
    card:      { label: '卡片',        ico: '▢',    desc: '一块带背景圆角的底板，用来分组',
                 size: { w: 300, h: 120 }, nat: { w: 300, h: 120 },
                 def: { text: '卡片' } },
    container: { label: '容器',        ico: '▣',    desc: '真正的分组：装进去的控件跟着它一起动',
                 size: { w: 300, h: 180 }, nat: { w: 300, h: 180 },
                 def: { text: '容器', children: [] } },
    scroll:    { label: '滚动区',      ico: '⇳',    desc: '内容比它高时可以上下滑动（可放别的控件）',
                 size: { w: 300, h: 220 }, nat: { w: 300, h: 220 },
                 def: { text: '滚动区', children: [] } },
    bottomNav: { label: '底部导航',    ico: '▤',    desc: '底部一排按钮，点一下切换',
                 size: { w: 360, h: 58 },  nat: { w: 360, h: 58 },
                 def: { items: ['首页', '消息', '我的'], value: 0, bg: '#ECE6F0' } },
    table:     { label: '表格',        ico: '▦',    desc: '按行按列显示数据',
                 size: { w: 300, h: 140 }, nat: { w: 300, h: 140 },
                 def: { columns: ['名称', '数量'], rows: [['苹果', '3'], ['香蕉', '5']] } },
    chart:     { label: '图表',        ico: '📊',   desc: '柱状图 / 折线图 / 饼图',
                 size: { w: 280, h: 180 }, nat: { w: 280, h: 180 },
                 def: { chartType: 'bar', chartData: [{ label: '一月', value: 30 }, { label: '二月', value: 60 }, { label: '三月', value: 45 }] } },
    divider:   { label: '分隔线',      ico: '—',    desc: '一条横线，用来分隔内容',
                 size: { w: 280, h: 8 },   nat: { w: 280, h: 8 },
                 def: {} },
    spacer:    { label: '空白占位',    ico: '␣',    desc: '透明的间隔，用来撑开距离',
                 size: { w: 280, h: 24 },  nat: { w: 280, h: 24 },
                 def: {} },
    tabs:      { label: '标签页',      ico: 'Tab',  desc: '一排页签，点一下切换',
                 size: { w: 300, h: 48 },  nat: { w: 300, h: 48 },
                 def: { items: ['页签一', '页签二', '页签三'], value: 0 } },
    collapse:  { label: '折叠面板',    ico: '⌄',    desc: '点标题展开或收起内容',
                 size: { w: 300, h: 96 },  nat: { w: 300, h: 96 },
                 def: { text: '点我展开', body: '这里是内容', open: false } },
    rating:    { label: '评分',        ico: '★',    desc: '点星星打分',
                 size: { w: 180, h: 44 },  nat: { w: 180, h: 44 },
                 def: { value: 3, max: 5 } },
    ring:      { label: '进度环',      ico: '◎',    desc: '圆环显示百分比',
                 size: { w: 120, h: 120 }, nat: { w: 120, h: 120 },
                 def: { value: 60, max: 100 } },
    multiSelect: { label: '多选下拉',  ico: '☰',    desc: '一次可以选好几个选项',
                 size: { w: 260, h: 48 },  nat: { w: 260, h: 48 },
                 def: { items: ['选项一', '选项二', '选项三'], value: ['选项一'] } },
    dateRange: { label: '日期范围',    ico: '📆',   desc: '选开始和结束两个日期',
                 size: { w: 300, h: 52 },  nat: { w: 300, h: 52 },
                 def: { start: '', end: '' } },
    colorPicker: { label: '颜色选择器', ico: '🎨',  desc: '点一下选一个颜色',
                 size: { w: 200, h: 48 },  nat: { w: 200, h: 48 },
                 def: { value: '#6750a4' } },
    badge:     { label: '徽章',        ico: '●',    desc: '小圆点 + 文字，用来提示状态',
                 size: { w: 120, h: 32 },  nat: { mode: 'text', field: 'text', fs: 14, pad: 50, minW: 76, h: 32 },
                 def: { text: '新', dot: '#e5484d', bg: '' } },
    clock:     { label: '时钟',        ico: '🕒',   desc: '显示当前时间，自动走秒',
                 size: { w: 170, h: 44 },  nat: { w: 170, h: 44 },
                 def: { format: 'hm' } },
    qr:        { label: '二维码',      ico: '▩',    desc: '把网址或文字画成二维码',
                 size: { w: 150, h: 150 }, nat: { w: 150, h: 150 },
                 def: { value: 'https://' } }
  };

  /** 兜底尺寸：编辑器 defaultSize 与运行时 defaultBox 都取这里，防止两处走偏 */
  function sizeOf(type) {
    var s = C[type];
    return (s && s.size) ? s.size : { w: 200, h: 44 };
  }
  /** 新建控件的默认属性 */
  function defaultsOf(type) {
    var s = C[type];
    return (s && s.def) ? s.def : {};
  }
  /** 新建控件时的紧凑尺寸参数（实际像素仍由编辑器按文字宽度算） */
  function naturalOf(type) {
    var s = C[type];
    return (s && s.nat) ? s.nat : null;
  }

  g.FAST_COMPONENTS = C;
  g.FAST_COMP = {
    sizeOf: sizeOf,
    defaultsOf: defaultsOf,
    naturalOf: naturalOf,
    types: function () { return Object.keys(C); }
  };
})(window);
