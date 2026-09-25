#!/usr/bin/env node
/* ============================================================
   filter-interaction Skill 的检查脚本（Day 12 创建）

   它做什么：
     真的把 index.html 加载起来、真的执行 app.js、真的去点筛选按钮，
     然后按 SKILL.md 里那 5 条规矩逐项断言，最后把结果写成 LAST_RUN.md。

   为什么要有这个脚本：
     Skill 如果只是一份文字说明书，"我调用过了"就全凭一张嘴。
     配上这个能跑的脚本 —— 调用 = 运行它，记录 = 它打印并写下的结果，编不了。

   怎么跑：
     node .workbuddy/skills/filter-interaction/scripts/check-filter.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

// scripts/ → filter-interaction/ → skills/ → .workbuddy/ → 项目根
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const INDEX = path.join(ROOT, 'index.html');
const APP = path.join(ROOT, 'app.js');
const CSS = path.join(ROOT, 'style.css');
const REPORT = path.join(__dirname, '..', 'LAST_RUN.md');

/* ---------- 找 jsdom（本机它装在 WorkBuddy 的 node 工作区里） ---------- */
function loadJsdom() {
  const cands = [
    'jsdom',
    process.env.JSDOM_PATH,
    'C:/Users/Lenovo/.workbuddy/binaries/node/workspace/node_modules/jsdom'
  ].filter(Boolean);
  for (const c of cands) {
    try { return require(c); } catch (e) { /* 换下一个 */ }
  }
  console.error('\n找不到 jsdom。两种解法：');
  console.error('  1) 设 NODE_PATH 指向装了 jsdom 的 node_modules，再跑；');
  console.error('  2) 在本项目里 npm i -D jsdom（node_modules 已被 .gitignore 忽略，不会进仓库）。\n');
  process.exit(2);
}
const { JSDOM } = loadJsdom();

/* ---------- 小工具 ---------- */
let pass = 0, fail = 0;
const failList = [];
const lines = [];

function say(s) { lines.push(s); console.log(s); }
function section(t) { say('\n' + t); }
function ok(cond, label, detail) {
  if (cond) { pass++; say('  [PASS] ' + label + (detail ? ' —— ' + detail : '')); }
  else {
    fail++; failList.push(label + (detail ? ' —— ' + detail : ''));
    say('  [FAIL] ' + label + (detail ? ' —— ' + detail : ''));
  }
}

/* ---------- 起一个页面（每次都是干净的一份） ---------- */
const htmlSrc = fs.readFileSync(INDEX, 'utf8');
const appSrc = fs.readFileSync(APP, 'utf8');
const cssSrc = fs.readFileSync(CSS, 'utf8');

function newPage() {
  const dom = new JSDOM(htmlSrc, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  // 生成方案有 400ms 的"假装在算"延迟，打桩成同步，测试才能一句一句往下写
  w.setTimeout = function (fn) { if (typeof fn === 'function') { fn(); } return 0; };
  w.eval(appSrc);
  return w;
}

function generate(w, from, cities, days, budget) {
  const doc = w.document;
  doc.getElementById('from-city').value = from;
  cities.forEach(function (c) {
    doc.getElementById('to-city-input').value = c;
    doc.getElementById('btn-add-city').click();
  });
  doc.getElementById('days').value = String(days);
  doc.getElementById('budget').value = String(budget);
  doc.getElementById('btn-generate').click();
}

/* ---------- 读取页面状态的几个小函数 ---------- */
const rowsOf = doc => Array.from(doc.querySelectorAll('#highlights-body .city-block tbody tr'));
const eatsOf = doc => rowsOf(doc).filter(r => r.querySelector('.tag-eat'));
const playsOf = doc => rowsOf(doc).filter(r => r.querySelector('.tag-play'));
const fbtn = (doc, f) => doc.querySelector('#block-highlights .filter-btn[data-filter="' + f + '"]');
const countText = doc => {
  const e = doc.getElementById('filter-count');
  return e ? e.textContent.trim() : '(没有条数元素)';
};
const firstNum = s => {
  const m = String(s).match(/\d+/);
  return m ? Number(m[0]) : NaN;
};
function blockOf(doc, city) {
  return Array.from(doc.querySelectorAll('#highlights-body .city-block')).filter(function (b) {
    const h = b.querySelector('h3');
    return h && h.textContent.trim().indexOf(city) === 0;
  })[0];
}
function addSelf(w, city, name, type, price) {
  const doc = w.document;
  const b = blockOf(doc, city);
  if (!b) { return false; }
  const form = b.querySelector('.self-add');
  if (!form) { return false; }
  form.querySelector('input.name').value = name;
  form.querySelector('select').value = type;
  form.querySelector('input.price').value = String(price);
  form.querySelector('.btn-ghost').click();
  return true;
}

/* ============================================================
   开跑
   ============================================================ */
say('# filter-interaction 检查记录');
say('');
say('- 运行时间：' + new Date().toLocaleString('zh-CN'));
say('- 命令：node .workbuddy/skills/filter-interaction/scripts/check-filter.js');
say('- 场景：武汉 → 成都 / 重庆 / 西安，6 天，预算 4000（西安无内置数据，用来构造"筛出 0 条"）');

const w = newPage();
const doc = w.document;
generate(w, '武汉', ['成都', '重庆', '西安'], 6, 4000);

/* ---------- A. 结构：东西都在不在 ---------- */
section('A. 结构（规矩 1、4）');
ok(!!doc.querySelector('#block-highlights .filter-bar'), 'A1 筛选栏存在');
const btns = Array.from(doc.querySelectorAll('#block-highlights .filter-btn'));
ok(btns.length === 3, 'A2 三个档位按钮都在', '实际 ' + btns.length + ' 个');
ok(btns.every(b => b.tagName === 'BUTTON'),
   'A3 三个都是真 <button>（白捡键盘能力：Tab 能到、回车能触发）',
   btns.map(b => b.tagName).join('/'));
const bar = doc.querySelector('#block-highlights .filter-bar');
ok(bar && bar.getAttribute('role') === 'group' && (bar.getAttribute('aria-label') || '').trim() !== '',
   'A4 按钮组有 role="group" + 非空 aria-label（读屏会报"筛选清单，分组"）');
ok(btns.every(b => ['true', 'false'].indexOf(b.getAttribute('aria-pressed')) >= 0),
   'A5 每个按钮都有 aria-pressed（读屏靠它知道选中的是哪一档）',
   btns.map(b => b.getAttribute('aria-pressed')).join('/'));
const cnt = doc.getElementById('filter-count');
ok(!!cnt && cnt.getAttribute('aria-live') === 'polite',
   'A6 条数元素存在且 aria-live="polite"（筛完会自动播报新数字）');
ok(!!fbtn(doc, 'all'), 'A7 有「全部」这一档 —— 能筛进去也能回来，不是死路（规矩 1）');

/* ---------- B. 默认状态 ---------- */
section('B. 默认状态');
ok(fbtn(doc, 'all').className.indexOf('is-on') >= 0 &&
   fbtn(doc, 'all').getAttribute('aria-pressed') === 'true',
   'B1 默认选中「全部」');
ok(fbtn(doc, 'en').getAttribute('aria-pressed') === 'false' &&
   fbtn(doc, 'play').getAttribute('aria-pressed') === 'false',
   'B2 未选中的两档 aria-pressed="false"');
const baseRows = rowsOf(doc).length;
ok(baseRows === 12, 'B3 默认显示全部 12 条（成都 6 + 重庆 6）', '实际 ' + baseRows + ' 条');
ok(eatsOf(doc).length === 6 && playsOf(doc).length === 6,
   'B4 默认状态：吃的 6 条 + 玩的 6 条',
   '吃的 ' + eatsOf(doc).length + ' / 玩的 ' + playsOf(doc).length);
ok(firstNum(countText(doc)) === baseRows && /共/.test(countText(doc)),
   'B5 条数文字说"共 N 条"且与实际行数一致（规矩 3：结果要有文字证据）',
   '页面写"' + countText(doc) + '"，实际 ' + baseRows + ' 行');

/* ---------- C. 自填一条，把数据撑起来 ---------- */
section('C. 准备"会被筛空"的城市（西安没有内置数据）');
ok(addSelf(w, '西安', '肉夹馍', 'en', 15), 'C1 往西安添加一条「吃的」成功');
const afterAdd = rowsOf(doc).length;
ok(afterAdd === baseRows + 1, 'C2 清单多出 1 行', baseRows + ' → ' + afterAdd);
ok(/13/.test(countText(doc)), 'C3 条数跟着变成 13（添加后条数自动刷新，没留在旧值）',
   '页面写"' + countText(doc) + '"');

/* ---------- D. 有结果：筛「吃的」 ---------- */
section('D. 筛「吃的」—— 有结果（规矩 2、3）');
fbtn(doc, 'en').click();
ok(fbtn(doc, 'en').className.indexOf('is-on') >= 0 &&
   fbtn(doc, 'en').getAttribute('aria-pressed') === 'true',
   'D1 「吃的」变成选中态 + aria-pressed="true"');
ok(fbtn(doc, 'all').getAttribute('aria-pressed') === 'false',
   'D2 「全部」同时变成 aria-pressed="false"（选中态是唯一的）');
const eatRows = rowsOf(doc).length;
ok(eatRows === 7, 'D3 只剩 7 条（成都 3 + 重庆 3 + 西安 1）', '实际 ' + eatRows + ' 条');
ok(playsOf(doc).length === 0, 'D4 一条"玩的"都不剩', '还剩 ' + playsOf(doc).length + ' 条');
ok(/筛出/.test(countText(doc)) && firstNum(countText(doc)) === eatRows,
   'D5 条数文字变成"筛出 N 条"，且 N 与实际行数一致（规矩 3）',
   '页面写"' + countText(doc) + '"，实际 ' + eatRows + ' 行');

/* ---------- E. 没结果：筛「玩的」时西安是空的 ---------- */
section('E. 筛「玩的」—— 有城市筛出 0 条（规矩 2，最容易漏的那条）');
fbtn(doc, 'play').click();
const playRows = rowsOf(doc).length;
ok(playRows === 6, 'E1 表面结果只剩 6 条', '实际 ' + playRows + ' 条');
const xiBlock = blockOf(doc, '西安');
ok(!!xiBlock, 'E2 西安这个城市块还在（筛空了也不能把城市整块抹掉）');
const emptyBox = xiBlock ? xiBlock.querySelector('.filter-empty') : null;
ok(!!emptyBox, 'E3 西安块里出现了空状态 —— 不是白屏（规矩 2）');
ok(!!emptyBox && /没有条目/.test(emptyBox.textContent),
   'E4 空状态有明确文案', emptyBox ? '"' + emptyBox.textContent.trim().slice(0, 40) + '…"' : '（元素不存在）');
ok(!!emptyBox && /全部/.test(emptyBox.textContent),
   'E5 空状态里给出了出口（提示去点「全部」）');
ok(xiBlock && !xiBlock.querySelector('table'),
   'E6 西安块里确实没有表格了（不是"藏起来还占位置"）');
ok(/^6$/.test(String(firstNum(countText(doc)))),
   'E7 条数跟着变成 6（筛完立刻更新，不留旧数字）', '页面写"' + countText(doc) + '"');

/* ---------- F. 恢复：点「全部」 ---------- */
section('F. 点「全部」—— 恢复原状（规矩 1、2）');
fbtn(doc, 'all').click();
ok(rowsOf(doc).length === 13, 'F1 13 条全回来了，一条不多一条不少',
   '实际 ' + rowsOf(doc).length + ' 条');
ok(eatsOf(doc).length === 7 && playsOf(doc).length === 6,
   'F2 吃 7 条、玩 6 条，跟筛之前一模一样',
   '吃的 ' + eatsOf(doc).length + ' / 玩的 ' + playsOf(doc).length);
ok(!doc.querySelector('#highlights-body .filter-empty'), 'F3 空状态消失');
ok(fbtn(doc, 'all').getAttribute('aria-pressed') === 'true' &&
   fbtn(doc, 'en').getAttribute('aria-pressed') === 'false',
   'F4 按钮选中态回到「全部」');
ok(/共/.test(countText(doc)) && firstNum(countText(doc)) === 13,
   'F5 条数文字从"筛出"变回"共 13 条"', '页面写"' + countText(doc) + '"');

/* ---------- G. 连续操作不出错 ---------- */
section('G. 连续操作（清单里的"连续操作测试"）');
for (let i = 0; i < 5; i++) { fbtn(doc, 'en').click(); }
ok(rowsOf(doc).length === 7, 'G1 连点「吃的」5 次，行数不变（不会越点越多）',
   '实际 ' + rowsOf(doc).length + ' 条');
ok(fbtn(doc, 'en').getAttribute('aria-pressed') === 'true' &&
   fbtn(doc, 'all').getAttribute('aria-pressed') === 'false',
   'G2 连点后按钮状态没乱（只有一个选中）');

fbtn(doc, 'play').click();
fbtn(doc, 'en').click();
fbtn(doc, 'play').click();
fbtn(doc, 'all').click();
ok(rowsOf(doc).length === 13 && firstNum(countText(doc)) === 13,
   'G3 吃的→玩的→吃的→玩的→全部 来回切，最后仍完整恢复',
   '实际 ' + rowsOf(doc).length + ' 条 / ' + countText(doc));

// 筛着的时候切方案：清单不重画，但页面不能坏
const planBtns = Array.from(doc.querySelectorAll('#plans-body .btn[data-plan]'));
if (planBtns.length > 1) {
  fbtn(doc, 'en').click();
  const other = planBtns.filter(b => b.className.indexOf('btn-primary') < 0)[0];
  if (other) { other.click(); }
  ok(rowsOf(doc).length > 0 && firstNum(countText(doc)) === rowsOf(doc).length,
     'G4 筛着的时候切方案：不报错、行数和条数依然对得上',
     '实际 ' + rowsOf(doc).length + ' 条 / ' + countText(doc));
} else {
  ok(true, 'G4 只有一套方案，跳过切换测试');
}

// 筛着的时候重新生成
fbtn(doc, 'en').click();
doc.getElementById('btn-generate').click();
ok(rowsOf(doc).length > 0 && firstNum(countText(doc)) === rowsOf(doc).length,
   'G5 筛着的时候重新生成方案：不报错、行数和条数依然对得上',
   '实际 ' + rowsOf(doc).length + ' 条 / ' + countText(doc));
ok(fbtn(doc, 'en').getAttribute('aria-pressed') === 'true',
   'G6 重新生成没把用户选的档位弄丢（还是"吃的"）');

/* ---------- H. 可访问性（余力加练） ---------- */
section('H. 可访问性（余力加练：键盘 + 读屏 + 对比度）');
let focusOk = true;
for (const f of ['all', 'en', 'play']) {
  const b = fbtn(doc, f);
  b.focus();
  if (doc.activeElement !== b) { focusOk = false; }
}
ok(focusOk, 'H1 三个按钮都能拿到键盘焦点（Tab 能走到）');
ok(/\.filter-btn:focus-visible\s*\{/.test(cssSrc),
   'H2 写了 :focus-visible 规则（键盘给框、鼠标点完不留框）');
const fvRule = (cssSrc.match(/\.filter-btn:focus-visible\s*\{[\s\S]{0,200}?\}/) || [''])[0];
ok(/outline\s*:/.test(fvRule), 'H3 焦点提示用 outline 画（不靠改颜色糊弄）', fvRule.trim().slice(0, 60));
ok(/'true'|"true"/.test(appSrc) && /aria-pressed/.test(appSrc),
   'H4 代码里真的在维护 aria-pressed（不是 HTML 里写死一次就不管了）');
const onRule = (cssSrc.match(/\.filter-btn\.is-on\s*\{[\s\S]{0,300}?\}/) || [''])[0];
ok(/var\(--brand/.test(onRule), 'H5 选中态底色走 var(--brand)，没写死色值',
   onRule.indexOf('var(--brand') < 0 ? '规则里没看到 var(--brand)' : '');
ok(/var\(--on-brand/.test(onRule),
   'H6 选中态文字色走 var(--on-brand) —— 两套主题各自适配（赛博是深字，白字在亮青上不达标）',
   onRule.indexOf('var(--on-brand') < 0 ? '规则里没看到 var(--on-brand)' : '');
ok(/--on-brand:\s*#ffffff/.test(cssSrc) && /--on-brand:\s*#[0-9a-fA-F]{6}/g.test(cssSrc),
   'H7 两套主题都定义了 --on-brand');
ok(/prefers-reduced-motion/.test(cssSrc),
   'H8 尊重"减少动态效果"系统设置（全局那条媒体查询还在）');
ok(/\.filter-count\s*\{[\s\S]{0,300}?tabular-nums/.test(cssSrc),
   'H9 条数用等宽数字（切档位时数字不会左右抖）');

/* ---------- H2. 对比度（规矩 5：两套主题都得看得清） ---------- */
section('H2. 对比度（规矩 5：正文 ≥ 4.5:1）');

// 从 CSS 里把两套主题的变量值抠出来
function varsIn(blockRe) {
  const out = {};
  const re = new RegExp(blockRe.source + '\\s*\\{([\\s\\S]*?)\\}', 'g');
  let m;
  while ((m = re.exec(cssSrc))) {
    const vr = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
    let v;
    while ((v = vr.exec(m[1]))) { out[v[1]] = v[2]; }
  }
  return out;
}
const LIGHT = varsIn(/:root/);
const CYBER = varsIn(/\[data-theme="cyber"\]/);

// WCAG 相对亮度 / 对比度
function chan(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex) {
  const h = hex.replace('#', '');
  return 0.2126 * chan(parseInt(h.slice(0, 2), 16)) +
         0.7152 * chan(parseInt(h.slice(2, 4), 16)) +
         0.0722 * chan(parseInt(h.slice(4, 6), 16));
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function pair(id, label, v, themeName, fgVar, bgVar) {
  const fg = v[fgVar], bg = v[bgVar];
  if (!fg || !bg) { ok(false, id + ' ' + label + '（' + themeName + '）', '缺变量 ' + (!fg ? fgVar : bgVar)); return; }
  const r = ratio(fg, bg);
  ok(r >= 4.5, id + ' ' + label + '（' + themeName + '）',
     fg + ' 压 ' + bg + ' = ' + r.toFixed(2) + ':1');
}
[['明亮', LIGHT], ['赛博', CYBER]].forEach(function (p) {
  const n = p[0], v = p[1];
  pair('H10', '选中档位的文字', v, n, '--on-brand', '--brand');
  pair('H11', '未选中档位的文字', v, n, '--ink-2', '--surface');
  pair('H12', '条数文字', v, n, '--ink-2', '--surface-2');
  pair('H13', '「只看：」标签', v, n, '--ink-3', '--surface-2');
});

/* ---------- I. 回归：别把老功能改坏 ---------- */
section('I. 回归（改动不能碰坏原有的东西）');
const selfRows = rowsOf(doc).filter(r => r.querySelector('.btn-del'));
ok(selfRows.length > 0, 'I1 自填的行还有删除按钮（Day 7 的功能）',
   '找到 ' + selfRows.length + ' 个删除按钮');
const beforeDel = rowsOf(doc).length;
selfRows[0].querySelector('.btn-del').click();
ok(rowsOf(doc).length === beforeDel - 1, 'I2 点删除能删掉一条（筛着的时候也能删）',
   beforeDel + ' → ' + rowsOf(doc).length);
ok(!!doc.getElementById('confirm-reset'), 'I3 Day 10 的「清空重填」确认条还在');
ok(!!doc.querySelector('#table-itinerary .more-btn') || /more-btn/.test(cssSrc),
   'I4 Day 11 的展开按钮样式还在');
ok(doc.getElementById('block-highlights') && !doc.getElementById('block-highlights').hidden,
   'I5 美食清单卡片正常显示');

/* ---------- 汇总 ---------- */
section('='.repeat(56));
say('通过 ' + pass + ' 项，失败 ' + fail + ' 项，共 ' + (pass + fail) + ' 项');
if (fail > 0) {
  say('');
  say('失败清单：');
  failList.forEach(f => say('  - ' + f));
}
say('='.repeat(56));

/* ---------- 写调用记录 ---------- */
const stamp = [
  '# filter-interaction Skill —— 最近一次检查记录',
  '',
  '> 这份文件是检查脚本的真实输出，不是手写的总结。',
  '> 重新跑一次脚本就会覆盖它。',
  '',
  lines.join('\n').replace(/^# filter-interaction 检查记录\n\n/, ''),
  ''
].join('\n');
fs.writeFileSync(REPORT, stamp, 'utf8');
console.log('\n调用记录已写入：' + path.relative(ROOT, REPORT));

process.exitCode = fail > 0 ? 1 : 0;
