/**
 * db.js —— 数据访问层（Data Access Layer）
 * ─────────────────────────────────────────────────────────────
 * 【它是干什么的？】
 *   只干一件事：**怎么跟数据库说话**。
 *   拼网关地址、带钥匙、发请求、超时保护、把上游的错整理成中文。
 *
 * 【它不干什么？】
 *   ✗ 不认识 HTTP 请求 —— 不看 event、不分 GET/POST 路由（那是 index.js 的事）
 *   ✗ 不认识返回形状 { ok, data, error }（那是 index.js 的事）
 *   ✗ 不做业务校验 —— 不知道什么算"缺 city"（那是 index.js 的事）
 *   换句话说：它不认识"城市""地点"，只认识"怎么读一行、怎么写一行"。
 *
 * 【谁在用】（Day 19 拆分新增）
 *   cities/index.js、places/index.js 里各带一份 db.js（两份内容相同）。
 *
 * 【为什么每个函数各带一份、不共用一份？】
 *   云函数之间是**彼此独立**的：每个函数部署时只打包自己目录下的文件，
 *   别人的文件它根本拿不到。想让多个函数共用一份，要用控制台的「层」功能
 *   （把公共代码打进"层"、函数再绑定它）—— 那是进阶玩法，本期不做。
 *   ⚠️ 所以这次"拆分"解决的是 **职责分离**（代码更好读、好改），
 *      不是"消除重复"。消除重复要等「层」。
 *   ⚠️ 也正因为各带一份：**改这里时，另一个函数里那份要一起改**，别让两边跑偏。
 *
 * 【对外提供什么】（见文件末尾 module.exports）
 *   hasKey()                          —— 钥匙配了没
 *   noKeyHint(函数名)                 —— 没配钥匙时的中文提示
 *   select(表名, 查询串)               —— 读：GET 一条查询
 *   insert(表名, 一行数据, 字段清单)    —— 写：POST 插一行，并把插进去的那行要回来
 *   requestJson(路径, {method,body})  —— 最底层：直接请求网关（一般不用自己调）
 *   upstreamError(查什么, 结果)        —— 把上游非 200 的结果整理成中文
 * ─────────────────────────────────────────────────────────────
 */

const https = require('https');

/*
 * ── 为什么用 Node 自带的 https 模块，不用 fetch 或 axios？ ──
 *   ① 零依赖：不用在控制台装任何包（函数目录里 package.json 是空的）
 *   ② 不看运行时的脸色：Node 18 以上才有全局 fetch，用 https 模块则哪个版本都能跑
 *   代价是代码啰嗦十几行 —— 但换来"不会因为版本不同而莫名跑不起来"。
 */

/** 环境 ID。不是机密（它就在公网地址里），写死没关系；也允许用环境变量覆盖。 */
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'travel-planner-d4g8o6mee9d231c64';

/** 数据库钥匙。**只从环境变量读，代码里绝不写值。** */
const API_KEY = process.env.CLOUDBASE_API_KEY || '';

/** 数据库网关（CloudBase 的 PostgreSQL 自带一个 PostgREST 风格的 HTTP 接口） */
const GATEWAY_HOST = ENV_ID + '.api.tcloudbasegateway.com';
const REST_PREFIX = '/v1/rdb/rest/';

/**
 * 请求数据库网关的超时（毫秒）。
 *
 * ⚠️ 为什么是 2.5 秒：云函数本身的「执行超时」上限只有 3 秒（免费/体验版，
 *    调大要升级套餐），到点被平台硬砍，函数里等更久没有意义。
 *    留 0.5 秒，好让我们自己返回一句看得懂的中文，而不是平台那句"执行超时"。
 *    ⚠️ 这两个数字是一对：TIMEOUT_MS 必须**小于**函数配置里的执行超时。
 *    将来升级套餐把函数超时调大了，这里要跟着放大。
 */
const TIMEOUT_MS = 2500;

/** 钥匙配了没？ */
function hasKey() {
  return !!API_KEY;
}

/** 没配钥匙时的中文提示（这是最容易犯的部署错误，单独给一条说人话的） */
function noKeyHint(functionName) {
  return '云函数还没配数据库钥匙。请到「云函数 → ' + functionName + ' → 配置 → 环境变量」加一条：' +
    '名 CLOUDBASE_API_KEY，值填控制台建的 API Key。' +
    '改完直接刷新本页即可 —— 环境变量是"配置"不是"代码"，不用重新部署。';
}

/**
 * 最底层的请求。方法默认 GET；传了 body 就走 POST（写数据）。
 * 返回 { status, raw, json, headers } —— **不在这里判断对错**，
 * 判断交给调用方，这样错误信息能写得更具体。
 *
 * @param {string} path  网关路径，如 /v1/rdb/rest/places?select=...
 * @param {object} [extra] 可选：{ method, body }，body 会被 JSON.stringify
 */
function requestJson(path, extra) {
  const method = (extra && extra.method) || 'GET';
  const bodyStr = (extra && extra.body !== undefined) ? JSON.stringify(extra.body) : null;

  const headers = {
    // 这把钥匙扮演"管理员"角色，能绕过所有行级权限，所以读得到、也写得进
    'Authorization': 'Bearer ' + API_KEY,
    'Accept': 'application/json',
  };
  if (bodyStr !== null) {
    headers['Content-Type'] = 'application/json';
    // Prefer: return=representation —— PostgREST 的说法，
    // 意思是"插完把它插进去的那一行原样还给我"，这样我们能拿到新 id 和 created_at。
    headers['Prefer'] = 'return=representation';
  }

  return new Promise(function (resolve, reject) {
    const req = https.request(
      {
        hostname: GATEWAY_HOST,
        path: path,
        method: method,
        headers: headers,
      },
      function (res) {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) { raw += chunk; });
        res.on('end', function () {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { json = null; }
          resolve({ status: res.statusCode, raw: raw, json: json, headers: res.headers || {} });
        });
      }
    );

    req.on('error', reject);

    // 超时保护：等不到结果就主动断开，报一个能看懂的错
    req.setTimeout(TIMEOUT_MS, function () {
      req.destroy(new Error('请求数据库超时（超过 ' + (TIMEOUT_MS / 1000) + ' 秒）'));
    });

    if (bodyStr !== null) req.write(bodyStr);
    req.end();
  });
}

/**
 * 读：对某张表发一条查询。
 * @param {string} table        表名，如 'places'
 * @param {string} queryString  ? 后面那串（**不含 ?**），如 'select=id&limit=1'
 */
function select(table, queryString) {
  return requestJson(REST_PREFIX + table + '?' + queryString);
}

/**
 * 写：往某张表插一行，并让数据库把插进去的那行还回来。
 * @param {string} table        表名
 * @param {object} row          一行数据（键是列名）
 * @param {string} selectFields 还回来时要哪几列，如 'id,city_id,name'
 */
function insert(table, row, selectFields) {
  return requestJson(REST_PREFIX + table + '?select=' + selectFields, {
    method: 'POST',
    body: row,
  });
}

/** 上游出问题时的统一处理：把状态码和一小段原文带上，方便排查 */
function upstreamError(what, res) {
  const snippet = String(res.raw || '').slice(0, 300);
  return '查' + what + '时数据库网关返回了 ' + res.status + '。原文（截断）：' + snippet;
}

module.exports = {
  hasKey: hasKey,
  noKeyHint: noKeyHint,
  requestJson: requestJson,
  select: select,
  insert: insert,
  upstreamError: upstreamError,
  ENV_ID: ENV_ID,
  GATEWAY_HOST: GATEWAY_HOST,
  REST_PREFIX: REST_PREFIX,
  TIMEOUT_MS: TIMEOUT_MS,
};
