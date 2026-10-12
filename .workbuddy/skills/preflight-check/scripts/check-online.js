/* 线上内容核对 —— 发布 / 回退之后，用来确认「线上到底是什么版本」。
   零依赖（只用 Node 自带的 https / crypto / fs / path）。

   用法：
     node .workbuddy/skills/preflight-check/scripts/check-online.js            # 与仓库根目录比
     node .workbuddy/skills/preflight-check/scripts/check-online.js _rollback  # 与指定目录比

   判据：线上 index.html / app.js 的字节数 + sha256 与本地逐字节一致。
   额外看一眼 app.js 里有没有 Day 24 查重修复的特征词 canon（共 3 处）：
     有 = v1.0 及以后 ；0 处 = v0.9 及以前（Day 23 版）。
*/
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'https://meng-travel-plan.app.workbuddy.host/';
const LOCAL_DIR = process.argv[2] || '.';

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'check-online/1.0', 'Cache-Control': 'no-cache' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return get(new URL(r.headers.location, url).href).then(res, rej);
      }
      const chunks = [];
      r.on('data', d => chunks.push(d));
      r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', rej);
  });
}

(async () => {
  console.log('核对时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('线上地址：' + BASE);
  console.log('比对本地：' + LOCAL_DIR);
  console.log('--------------------------------------------');

  let allSame = true;

  for (const f of ['index.html', 'app.js']) {
    const r = await get(BASE + f + '?nocache=' + Date.now());
    const sha = crypto.createHash('sha256').update(r.body).digest('hex');
    const local = fs.readFileSync(path.join(LOCAL_DIR, f));
    const lsha = crypto.createHash('sha256').update(local).digest('hex');
    const same = sha === lsha;
    if (!same) allSame = false;
    console.log(f);
    console.log('  线上：HTTP ' + r.status + '，' + r.body.length + ' 字节，sha256=' + sha.slice(0, 16) + '…');
    console.log('  本地：      ' + local.length + ' 字节，sha256=' + lsha.slice(0, 16) + '…');
    console.log('  ' + (same ? '✅ 一致' : '❌ 不一致'));
    if (f === 'app.js') {
      const n = (r.body.toString('utf8').match(/canon/g) || []).length;
      console.log('  Day24 查重修复特征 canon：' + n + ' 处' + (n > 0 ? '（= v1.0 及以后）' : '（= v0.9 及以前）'));
    }
  }

  const h = await get(BASE + '?nocache=' + Date.now());
  const title = (h.body.toString('utf8').match(/<title>([^<]*)<\/title>/) || [, '(无)'])[1];
  console.log('--------------------------------------------');
  console.log('首页：HTTP ' + h.status + '，' + h.body.length + ' 字节，标题「' + title + '」');
  console.log(allSame ? '结论：线上与本地逐字节一致 ✅' : '结论：线上与本地不一致 ❌（先强制刷新再复核，仍不一致说明发布没生效）');

  process.exitCode = allSame ? 0 : 1;
})().catch(e => { console.error('核对失败：' + e.message); process.exit(1); });
