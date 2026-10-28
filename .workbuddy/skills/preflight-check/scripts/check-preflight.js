#!/usr/bin/env node
/* ============================================================
   preflight-check Skill 的检查脚本 —— Day 25 创建

   它做什么（上线之前，先在本机把"不该上线的东西"拦下来）：
     真的去读项目里的文件、真的去问 git 要"入库文件清单"，
     然后按 SKILL.md 里那六组规矩逐项断言，最后把结果写成 LAST_RUN.md。

   为什么要写成能跑的脚本，而不是一份文字清单：
     文字清单"我检查过了"全凭一张嘴。变成命令之后，
     检查 = 跑它，结论 = 它打印的结果，编不了。

   怎么跑：
     node .workbuddy/skills/preflight-check/scripts/check-preflight.js
     node .workbuddy/skills/preflight-check/scripts/check-preflight.js --demo
       --demo = 把主产品复制一份、往副本里"故意弄坏一项"，
                验证这个检查真的会报错，而不是橡皮图章。
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/* scripts/ → preflight-check/ → skills/ → .workbuddy/ → 项目根 */
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SKILL_DIR = path.resolve(__dirname, '..');

const DEMO = process.argv.indexOf('--demo') >= 0;

/* 主产品三件套（仓库根那份）—— AC14 / AC1 / AC13 只管这三件 */
const MAIN_FILES = ['index.html', 'app.js', 'style.css'];
/* 后端三个云函数（Day 24 的 CORS 收紧成果就住在这儿） */
const FN_FILES = [
  'cloud/functions/health/index.js',
  'cloud/functions/cities/index.js',
  'cloud/functions/places/index.js',
];

/* AC15：站内不主动联网（断网照样能用），只允许"用户自己点开才跳"的指路外链。
   2026-10-27 用户要求把查攻略/查吃住也做成跳转 → 新增抖音、小红书、B站、美团、携程。
   ⚠️ 这几家都只是【点击跳转】，页面本身不发任何网络请求，所以 AC14 断网可用不受影响；
   真正要守的底线是：主产品里不许出现会自动加载的外部资源（那由 A1/A2/A5 三条盯着）。 */
const ALLOWED_HOSTS = [
  'uri.amap.com',           // 高德：看路线/距离
  'www.12306.cn',           // 铁路 12306：查票价余票
  'www.douyin.com',         // 抖音：看真实游客视频
  'www.xiaohongshu.com',    // 小红书：图文攻略
  'search.bilibili.com',    // B 站：长视频攻略
  'www.meituan.com',        // 美团：找吃的
  'hotels.ctrip.com'        // 携程：比酒店
];

/* 顺手引的第三方库（CDN）会让"断网可用"当场失效 */
const CDN_HINTS = ['cdn.', 'unpkg.com', 'jsdelivr', 'cdnjs', 'googleapis', 'bootcdn', 'staticfile'];

/* "密钥长相"——只认**值的样子**，不认词。
   教训（Day 23）：搜 api_key 这个词，会把变量名、文档说明一起命中，报一堆假警。
   所以这里列的全是"真钥匙长什么样"（前缀 + 长度 + 形状）。 */
const SECRET_SHAPES = [
  ['腾讯云密钥（AKID 开头）', /AKID[A-Za-z0-9]{16,}/],
  ['OpenAI 风格密钥（sk- 开头）', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['私钥文件内容', /-----BEGIN[^-]{0,40}PRIVATE KEY-----/],
  ['带账号密码的数据库连接串', /(?:mysql|postgres|postgresql|mongodb|redis):\/\/[^\s:'"/]+:[^\s@'"]+@/i],
  ['SecretId / SecretKey 写死在代码里', /(?:SecretId|SecretKey|secretKey|secret_key|accessKeyId|accessKeySecret)\s*[:=]\s*['"][A-Za-z0-9/+=_-]{12,}['"]/],
  ['password 直接写死', /(?:password|passwd|pwd)\s*[:=]\s*['"][^\s'"]{6,}['"]/i],
];

/* 不该进仓库的文件（.gitignore 挡的主要就是这些） */
const SENSITIVE_FILE = [
  /(^|\/)\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /(^|\/)id_rsa(\.pub)?$/i,
  /credentials.*\.json$/i,
  /(^|\/)\.npmrc$/i,
];

/* 当文本文件来扫的后缀 */
const TEXT_EXT = /\.(html?|js|mjs|cjs|css|md|sql|json|txt|ya?ml|sh|ps1|bat|cfg|ini)$/i;

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
function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  return m ? m[1] : null;
}
function tags(html, name) {
  return html.match(new RegExp('<' + name + '\\b[^>]*>', 'gi')) || [];
}
function uniq(a) { return Array.from(new Set(a)); }

/* ---------- 读主产品三件套（--demo 时读副本） ---------- */
let BASE = ROOT;
function readMain(name) { return fs.readFileSync(path.join(BASE, name), 'utf8'); }

/* ---------- 问 git 要"入库文件清单" ---------- */
function gitListFiles() {
  try {
    return execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' })
      .split('\0').filter(Boolean);
  } catch (e) {
    console.error('读不到 git 文件清单（这个目录是 git 仓库吗？）：' + e.message);
    process.exit(2);
  }
}

/* ---------- --demo：复制一份、故意弄坏一项 ---------- */
let demoDir = null;
function setupDemo() {
  demoDir = path.join(ROOT, '.git', '.preflight-demo');
  fs.rmSync(demoDir, { recursive: true, force: true });
  fs.mkdirSync(demoDir, { recursive: true });
  MAIN_FILES.forEach(function (f) { fs.copyFileSync(path.join(ROOT, f), path.join(demoDir, f)); });

  /* 故意弄坏的那一项 = 「断网可用（AC14）」
     手法：往副本的 index.html 里塞一行 CDN 外链脚本。
     这是上线前最常犯的错 —— 顺手引个第三方库，断网就白屏。 */
  const p = path.join(demoDir, 'index.html');
  let s = fs.readFileSync(p, 'utf8');
  if (s.indexOf('</head>') < 0) { s = s + '\n</head>\n'; }
  s = s.replace('</head>',
    '  <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>\n</head>');
  fs.writeFileSync(p, s, 'utf8');
}

/* ============================================================
   开跑
   ============================================================ */
say('# preflight-check 检查记录');
say('');
say('- 运行时间：' + new Date().toLocaleString('zh-CN'));
say('- 命令：node .workbuddy/skills/preflight-check/scripts/check-preflight.js' + (DEMO ? ' --demo' : ''));
say('- 范围：主产品三件套（index.html / app.js / style.css）+ 三个云函数 + 入库文件清单');

if (DEMO) {
  setupDemo();
  BASE = demoDir;
  say('- ⚠️ 这是「故意弄坏」的对照运行：副本的 index.html 里被塞了一行 CDN 外链脚本，');
  say('   用来验证这个检查真的会报错，而不是橡皮图章。（副本用完即删，真文件一个字节没动）');
}

const html = readMain('index.html');
const app = readMain('app.js');
const css = readMain('style.css');
const tracked = gitListFiles();

/* ---------- A. 断网可用（AC14 / AC15） ---------- */
section('A. 断网可用（AC14 / AC15 —— 只管主产品三件套）');

const linkTags = tags(html, 'link').filter(function (t) { return /rel\s*=\s*"stylesheet"/i.test(t); });
const badLinks = linkTags.filter(function (t) { return /^(https?:)?\/\//i.test(attr(t, 'href') || ''); });
ok(linkTags.length > 0 && badLinks.length === 0,
  'A1 样式表全是本地文件（没引外链 CSS）',
  badLinks.length ? badLinks.join(' | ') : '共 ' + linkTags.length + ' 个 <link rel=stylesheet>，都是本地');

const scriptTags = tags(html, 'script').filter(function (t) { return attr(t, 'src') !== null; });
const badScripts = scriptTags.filter(function (t) { return /^(https?:)?\/\//i.test(attr(t, 'src') || ''); });
ok(badScripts.length === 0,
  'A2 脚本全是本地文件（没引外链 JS）',
  badScripts.length ? badScripts.join(' | ') : '共 ' + scriptTags.length + ' 个带 src 的 <script>，都是本地');

/* 只看**真正的 <script> 标签**，不看整份文件文本 ——
   否则 index.html 里那句"不能用 type="module""的**注释**也会被命中，报假警。
   （Day 25 自己踩到：第一版就是拿整份 html 文本去搜的。） */
const moduleTags = tags(html, 'script').filter(function (t) { return /type\s*=\s*"module"/i.test(t); });
ok(moduleTags.length === 0,
  'A3 没有 type="module"（有它双击打开就不会执行）',
  moduleTags.length ? moduleTags.join(' | ') : '共 ' + tags(html, 'script').length + ' 个 <script>，都没有 type="module"');

const urls = [];
MAIN_FILES.forEach(function (f) {
  const s = readMain(f);
  (s.match(/https?:\/\/[^\s"'`()<>\[\]]+/g) || []).forEach(function (u) { urls.push({ file: f, url: u }); });
});
const outsiders = urls.filter(function (o) {
  let host = '';
  try { host = new URL(o.url).host; } catch (e) { return true; }
  return !ALLOWED_HOSTS.some(function (a) { return host === a || host.endsWith('.' + a); });
});
ok(urls.length > 0 && outsiders.length === 0,
  'A4 主产品里的公网地址都在白名单内（AC15：站内不主动联网，只有用户点击的指路外链）',
  outsiders.length
    ? outsiders.map(function (o) { return o.file + ' → ' + o.url; }).join(' | ')
    : '共 ' + urls.length + ' 处公网地址，主机名：' + uniq(urls.map(function (o) { return new URL(o.url).host; })).join(' / '));

const cdnHits = [];
MAIN_FILES.forEach(function (f) {
  const low = readMain(f).toLowerCase();
  CDN_HINTS.forEach(function (k) { if (low.indexOf(k) >= 0) { cdnHits.push(f + ' → "' + k + '"'); } });
});
ok(cdnHits.length === 0,
  'A5 主产品里没有 CDN 关键字（cdn. / unpkg / jsdelivr …）',
  cdnHits.length ? uniq(cdnHits).join(' | ') : '比对了 ' + CDN_HINTS.length + ' 个关键字，一个都没出现');

/* ---------- B. 密钥（真钥匙不出门） ---------- */
section('B. 密钥（真钥匙不出门）');

const textFiles = tracked.filter(function (f) { return TEXT_EXT.test(f); });
const secretHits = [];
textFiles.forEach(function (f) {
  let s;
  try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return; }
  SECRET_SHAPES.forEach(function (pair) {
    const m = s.match(pair[1]);
    if (m) { secretHits.push(f + ' → ' + pair[0] + '：' + m[0].slice(0, 28) + '…'); }
  });
});
ok(secretHits.length === 0,
  'B1 入库文件里没有"密钥长相"的字符串',
  secretHits.length ? uniq(secretHits).join(' | ') : '扫了 ' + textFiles.length + ' 个文本文件 × ' + SECRET_SHAPES.length + ' 种密钥长相，0 命中');

const sensHits = tracked.filter(function (f) { return SENSITIVE_FILE.some(function (re) { return re.test(f); }); });
ok(sensHits.length === 0,
  'B2 没有把密钥 / 凭证文件提交进仓库（.env / *.pem / id_rsa …）',
  sensHits.length ? sensHits.join(', ') : '共检查 ' + tracked.length + ' 个入库文件');

const gi = fs.existsSync(path.join(ROOT, '.gitignore')) ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8') : '';
ok(/^\s*\.env\s*$/m.test(gi), 'B3a .gitignore 仍在挡 .env');
ok(/credentials/i.test(gi), 'B3b .gitignore 仍在挡 凭证文件（credentials*.json）');
ok(/\.pem/.test(gi), 'B3c .gitignore 仍在挡 *.pem');

const envSuspects = ['.env', '.env.local', '.env.production', 'cloud/.env', 'cloud/functions/.env']
  .filter(function (p) { return fs.existsSync(path.join(ROOT, p)); });
ok(envSuspects.length === 0,
  'B4 仓库目录里没有 .env 之类的明文配置文件（哪怕没入库也提醒一下）',
  envSuspects.join(', '));

/* ---------- C. 双击即开 / 窄屏（AC1 / AC13） ---------- */
section('C. 双击即开 / 窄屏（AC1 / AC13）');

ok(/<meta\s+charset\s*=/i.test(html), 'C1 有 <meta charset>（中文不乱码）');
ok(/<meta[^>]*name\s*=\s*"viewport"[^>]*width\s*=\s*device-width/i.test(html),
  'C2 有 viewport（AC13 窄屏可读）');

const refTags = tags(html, 'link').concat(tags(html, 'script'), tags(html, 'img'), tags(html, 'a'));
const absRefs = [];
refTags.forEach(function (t) {
  ['href', 'src'].forEach(function (a) {
    const v = attr(t, a);
    if (v && /^\//.test(v)) { absRefs.push(a + '="' + v + '"'); }
  });
});
ok(absRefs.length === 0,
  'C3 没有以 / 开头的绝对路径（双击打开时找不到文件）',
  absRefs.length ? absRefs.join(' | ') : '检查了 ' + refTags.length + ' 处引用');

ok(!/\bfetch\s*\(/.test(app) && !/XMLHttpRequest/.test(app) && !/^\s*import\s/m.test(app) && !/\bimport\s*\(/.test(app),
  'C4 app.js 里没有 fetch / XMLHttpRequest / import（数据是写死的 JS 常量，断网照跑）');

/* ---------- D. 外链安全（AC22） ---------- */
section('D. 外链安全（AC22）');

const aBlank = tags(html, 'a').filter(function (t) { return /target\s*=\s*"_blank"/i.test(t); });
const badRel = aBlank.filter(function (t) {
  const r = attr(t, 'rel') || '';
  return !/noopener/i.test(r) || !/noreferrer/i.test(r);
});
ok(badRel.length === 0,
  'D1 每个新窗口外链都带 rel="noopener noreferrer"',
  badRel.length ? badRel.join(' | ') : '共 ' + aBlank.length + ' 个 target="_blank" 链接，rel 都齐');

/* ---------- E. 后端跨域白名单（Day 24 的成果别被改回去） ---------- */
section('E. 后端跨域白名单（Day 24 的成果别被改回去）');

const fnSrc = {};
FN_FILES.forEach(function (f) { fnSrc[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });

const wild = FN_FILES.filter(function (f) {
  return /Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/.test(fnSrc[f]);
});
ok(wild.length === 0,
  'E1 三个云函数都没有把跨域头写成通配 *',
  wild.length ? wild.join(', ') : '三个都查了');

const noWhitelist = FN_FILES.filter(function (f) {
  return !/ALLOWED_ORIGINS\s*=\s*\[/.test(fnSrc[f]) ||
         !/Access-Control-Allow-Origin'\]\s*=\s*origin/.test(fnSrc[f]);
});
ok(noWhitelist.length === 0,
  'E2 三个云函数都做了"白名单命中才回显"',
  noWhitelist.length ? noWhitelist.join(', ') : 'ALLOWED_ORIGINS + 条件赋值都在');

function originList(s) {
  const m = s.match(/ALLOWED_ORIGINS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) { return null; }
  return (m[1].match(/'(https?:\/\/[^']+)'/g) || [])
    .map(function (x) { return x.replace(/'/g, ''); }).sort();
}
const lists = FN_FILES.map(function (f) { return originList(fnSrc[f]); });
const same = lists[0] && lists.every(function (l) { return l && l.join(',') === lists[0].join(','); });
ok(same,
  'E3 三个云函数的白名单内容完全一致（防只改了一个）',
  same ? lists[0].length + ' 条：' + lists[0].join(' , ') : '三份白名单对不上');

ok(same && lists[0].some(function (u) { return /\.app\.workbuddy\.host/.test(u); }),
  'E4 白名单里有线上发布域名（*.app.workbuddy.host）',
  same ? lists[0].filter(function (u) { return /workbuddy\.host/.test(u); }).join(' , ') : '（上面那条没过）');

/* ---------- F. 仓库卫生 ---------- */
section('F. 仓库卫生（防手滑）');

let maxSize = 0, maxFile = '';
const bigFiles = [];
tracked.forEach(function (f) {
  let sz = 0;
  try { sz = fs.statSync(path.join(ROOT, f)).size; } catch (e) { return; }
  if (sz > maxSize) { maxSize = sz; maxFile = f; }
  if (sz > 1024 * 1024) { bigFiles.push(f + '（' + (sz / 1024 / 1024).toFixed(1) + 'MB）'); }
});
ok(bigFiles.length === 0,
  'F1 入库文件里没有超过 1MB 的（防误传大文件）',
  bigFiles.length ? bigFiles.join(', ') : '最大的一个是 ' + maxFile + '（' + (maxSize / 1024).toFixed(0) + 'KB）');

const nm = tracked.filter(function (f) { return /(^|\/)node_modules\//.test(f); });
ok(nm.length === 0, 'F2 node_modules 没有被提交进仓库', nm.length ? nm.slice(0, 3).join(', ') : '干净');

/* ---------- 汇总 ---------- */
section('='.repeat(56));
say('通过 ' + pass + ' 项，失败 ' + fail + ' 项，共 ' + (pass + fail) + ' 项');
if (fail > 0) {
  say('');
  say('失败清单：');
  failList.forEach(function (f) { say('  - ' + f); });
}
if (DEMO) {
  say('');
  say(DEMO_NOTE());
}
say('='.repeat(56));

function DEMO_NOTE() {
  return fail > 0
    ? '✅ 结论：故意的错被抓住了（' + fail + ' 条 FAIL）—— 这个检查不是橡皮图章。'
    : '❌ 结论：故意弄坏了却还是全绿 —— 这个检查在"虚报通过"，必须修脚本！';
}

/* ---------- 收尾：删副本、写记录 ---------- */
if (demoDir) {
  fs.rmSync(demoDir, { recursive: true, force: true });
  console.log('\n（临时副本已删除：' + path.relative(ROOT, demoDir) + '）');
}

const REPORT = path.join(SKILL_DIR, DEMO ? 'LAST_RUN-demo.md' : 'LAST_RUN.md');
const title = DEMO
  ? '# preflight-check Skill —— 「故意弄坏」对照运行记录'
  : '# preflight-check Skill —— 最近一次检查记录';
const stamp = [
  title,
  '',
  '> 这份文件是检查脚本的真实输出，不是手写的总结。',
  '> 重新跑一次脚本就会覆盖它。',
  '',
  lines.join('\n').replace(/^# preflight-check 检查记录\n\n/, ''),
  ''
].join('\n');
fs.writeFileSync(REPORT, stamp, 'utf8');
console.log('调用记录已写入：' + path.relative(ROOT, REPORT));

process.exitCode = fail > 0 ? 1 : 0;
