# preflight-check Skill —— 「故意弄坏」对照运行记录

> 这份文件是检查脚本的真实输出，不是手写的总结。
> 重新跑一次脚本就会覆盖它。

- 运行时间：2026/10/15 21:00:51
- 命令：node .workbuddy/skills/preflight-check/scripts/check-preflight.js --demo
- 范围：主产品三件套（index.html / app.js / style.css）+ 三个云函数 + 入库文件清单
- ⚠️ 这是「故意弄坏」的对照运行：副本的 index.html 里被塞了一行 CDN 外链脚本，
   用来验证这个检查真的会报错，而不是橡皮图章。（副本用完即删，真文件一个字节没动）

A. 断网可用（AC14 / AC15 —— 只管主产品三件套）
  [PASS] A1 样式表全是本地文件（没引外链 CSS） —— 共 1 个 <link rel=stylesheet>，都是本地
  [FAIL] A2 脚本全是本地文件（没引外链 JS） —— <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js">
  [PASS] A3 没有 type="module"（有它双击打开就不会执行） —— 共 3 个 <script>，都没有 type="module"
  [FAIL] A4 主产品里的公网地址都在白名单内（AC15：全站只有一个联网点） —— index.html → https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js
  [FAIL] A5 主产品里没有 CDN 关键字（cdn. / unpkg / jsdelivr …） —— index.html → "cdn." | index.html → "jsdelivr"

B. 密钥（真钥匙不出门）
  [PASS] B1 入库文件里没有"密钥长相"的字符串 —— 扫了 31 个文本文件 × 6 种密钥长相，0 命中
  [PASS] B2 没有把密钥 / 凭证文件提交进仓库（.env / *.pem / id_rsa …） —— 共检查 32 个入库文件
  [PASS] B3a .gitignore 仍在挡 .env
  [PASS] B3b .gitignore 仍在挡 凭证文件（credentials*.json）
  [PASS] B3c .gitignore 仍在挡 *.pem
  [PASS] B4 仓库目录里没有 .env 之类的明文配置文件（哪怕没入库也提醒一下）

C. 双击即开 / 窄屏（AC1 / AC13）
  [PASS] C1 有 <meta charset>（中文不乱码）
  [PASS] C2 有 viewport（AC13 窄屏可读）
  [PASS] C3 没有以 / 开头的绝对路径（双击打开时找不到文件） —— 检查了 5 处引用
  [PASS] C4 app.js 里没有 fetch / XMLHttpRequest / import（数据是写死的 JS 常量，断网照跑）

D. 外链安全（AC22）
  [PASS] D1 每个新窗口外链都带 rel="noopener noreferrer" —— 共 1 个 target="_blank" 链接，rel 都齐

E. 后端跨域白名单（Day 24 的成果别被改回去）
  [PASS] E1 三个云函数都没有把跨域头写成通配 * —— 三个都查了
  [PASS] E2 三个云函数都做了"白名单命中才回显" —— ALLOWED_ORIGINS + 条件赋值都在
  [PASS] E3 三个云函数的白名单内容完全一致（防只改了一个） —— 3 条：https://meng-travel-plan.app.workbuddy.host , https://travel-planner-budget.app.workbuddy.host , https://travel-planner-d4g8o6mee9d231c64-1499365786.tcloudbaseapp.com
  [PASS] E4 白名单里有线上发布域名（*.app.workbuddy.host） —— https://meng-travel-plan.app.workbuddy.host , https://travel-planner-budget.app.workbuddy.host

F. 仓库卫生（防手滑）
  [PASS] F1 入库文件里没有超过 1MB 的（防误传大文件） —— 最大的一个是 app.js（168KB）
  [PASS] F2 node_modules 没有被提交进仓库 —— 干净

========================================================
通过 19 项，失败 3 项，共 22 项

失败清单：
  - A2 脚本全是本地文件（没引外链 JS） —— <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js">
  - A4 主产品里的公网地址都在白名单内（AC15：全站只有一个联网点） —— index.html → https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js
  - A5 主产品里没有 CDN 关键字（cdn. / unpkg / jsdelivr …） —— index.html → "cdn." | index.html → "jsdelivr"

✅ 结论：故意的错被抓住了（3 条 FAIL）—— 这个检查不是橡皮图章。
========================================================
