/**
 * 云函数：cities（对外地址 GET /api/cities）
 * ─────────────────────────────────────────────────────────────
 * 它是干什么的？
 *   把数据库里那张 cities 表（370 个城市）通过一个公网地址吐出来。
 *   前端拿到的就是一个数组，数组里每一项是一个城市。
 *
 * 它跟 health 那个函数的区别？
 *   health 不碰数据，只回一句"我还活着"。
 *   这个函数**真的去读数据库** —— 所以它是第一个"业务接口"。
 *
 * 返回什么形状？（全项目统一，前端只认这一个形状）
 *   成功：{ ok: true,  data: [...], error: null }
 *   失败：{ ok: false, data: null,  error: "人能看懂的中文说明" }
 *   ⚠️ 三个字段永远都在。成功时 error 是 null，失败时 data 是 null ——
 *      前端不用先判断"这个字段存不存在"，写法简单一半。
 *
 * ── 它怎么读到数据库的？（这是本函数最需要理解的一处） ──
 *
 * CloudBase 的 PostgreSQL 自带一个 **HTTP 接口**（风格叫 PostgREST），
 * 地址长这样：
 *     https://{环境ID}.api.tcloudbasegateway.com/v1/rdb/rest/{表名}?查询参数
 *
 * 所以云函数**不需要装数据库驱动、也不需要连接串**，把它当成一个普通网址
 * 请求一下就行 —— 返回的就是 JSON。
 *
 * 但那个地址要验身份，需要一把**钥匙（API Key）**：
 *   · 这把钥匙权限最高（相当于数据库管理员），能绕过所有行级权限。
 *   · 所以它**只能待在云函数的环境变量里**，
 *     ⚠️ 绝对不能写死在代码里、更不能发给网页 —— 一旦漏出去等于数据库裸奔。
 *   · 下面代码是 `process.env.CLOUDBASE_API_KEY`，就是说
 *     "去环境变量里取，别在这儿写值"。
 *
 * ── 为什么用 Node 自带的 https 模块，不用 fetch 或 axios？ ──
 *   ① 零依赖：不用在控制台装任何包（跟 health 一样干净）
 *   ② 不看运行时的脸色：Node 18 以上才有全局 fetch，用 https 模块则哪个版本都能跑
 *   代价是代码啰嗦十几行 —— 但换来"不会因为版本不同而莫名其妙跑不起来"。
 * ─────────────────────────────────────────────────────────────
 */

const https = require('https');

/** 环境 ID。不是机密（它就出现在公网地址里），写死没关系；也允许用环境变量覆盖。 */
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'travel-planner-d4g8o6mee9d231c64';

/** 数据库钥匙。**只从环境变量读，代码里绝不写值。** */
const API_KEY = process.env.CLOUDBASE_API_KEY || '';

/** 要读的表 */
const TABLE = 'cities';

/**
 * 要取的字段 —— 是"点名要"，不是 `select=*`。
 *
 * 为什么不用 `*`：`*` 的意思是"表里有什么就给什么"。
 * 将来表加了内部字段（比如给运维看的备注），`*` 会**自动把它泄露出去**。
 * 点名要的写法有个好处：**加了新字段，接口不会跟着变** —— 想暴露哪些是显式决定的。
 *
 * ⚠️ 这里保留了 created_at（这行数据是什么时候入库的）。
 *    前端其实用不上它，但 ④ 真库验证时要拿接口返回和 `SELECT *` 逐字段对照，
 *    留着它才能看出"数据库里的 timestamp 到了 JSON 里变成了字符串"这件事。
 */
const FIELDS = 'id,name,created_at';

/**
 * 一次最多要多少行。
 *
 * 为什么写这个：这类网关（PostgREST）通常有个**默认返回上限**，
 * 不确定它给多少。所以显式要一个大数字 —— 免得"表里 370 行、接口只给 100 行"
 * 这种事悄悄发生。真跑出来如果还是不够 370，那说明上限比这个大，要改成分页。
 */
const LIMIT_ROWS = 2000;

/**
 * 请求数据库网关的超时（毫秒）。网络卡住时别让函数一直挂着。
 *
 * ⚠️ 为什么是 2.5 秒，而不是 10 秒、20 秒？
 *
 *   云函数自己有个「执行超时」（控制台「函数配置」里那一项），
 *   我们这套（免费/体验版）**上限就是 3 秒** —— 想调到 20 秒得升级套餐。
 *
 *   关键点：**平台那 3 秒是硬砍**，到点直接掐断这个函数，
 *   我们代码里等多久都拦不住。所以函数内部写 10 秒、20 秒**毫无意义** ——
 *   等不到那一刻就被杀了，而且用户看到的是平台那句很难懂的"执行超时"。
 *
 *   改成 2.5 秒 = 留 0.5 秒给我们自己把话说清楚再返回。
 *   真慢到这个地步，用户看到的是：
 *     { ok:false, error:"连不上数据库网关：请求数据库超时（超过 2.5 秒）" }
 *   比平台那句强得多。
 *
 *   ⚠️ 这两个数字是**一对**：TIMEOUT_MS 必须**小于**函数配置里的执行超时。
 *      将来真的升级套餐把函数超时调大了，这里也要跟着放大（比如 3 秒 → 2500，20 秒 → 15000）。
 */
const TIMEOUT_MS = 2500;

/** 跨域头。让浏览器能读，也让 OPTIONS 预检能过。 */
const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ============================================================
   一、小工具
   ============================================================ */

/** 成功的返回体 */
function ok(data) {
  return { ok: true, data: data, error: null };
}

/** 失败的返回体。error 一律是给人看的中文，不要塞英文报错原文。 */
function fail(error) {
  return { ok: false, data: null, error: error };
}

/** 把 "a=1&b=2" 这种查询串解析成对象 */
function parseQueryString(qs) {
  const out = {};
  String(qs || '').split('&').forEach(function (pair) {
    if (!pair) return;
    const i = pair.indexOf('=');
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? '' : pair.slice(i + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  });
  return out;
}

/**
 * 从 event 里取出查询参数。
 *
 * ⚠️ 为什么写得这么"啰嗦"（四处都试一遍）？
 *   我们现在**不确定** HTTP 访问服务把查询参数放在哪个字段里 ——
 *   没有真实调用过一次。与其猜一个然后猜错，不如**每种可能都看一眼**，
 *   谁有就用谁。等第一次真跑通了、知道是哪个字段，可以把这里简化掉。
 *   （这是"不猜"的写法：不确定的地方多试几个来源，而不是赌一个。）
 */
function getQuery(event) {
  if (!event) return {};
  if (event.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters;
  }
  if (typeof event.queryString === 'string') return parseQueryString(event.queryString);
  if (typeof event.rawPath === 'string' && event.rawPath.indexOf('?') >= 0) {
    return parseQueryString(event.rawPath.split('?')[1]);
  }
  if (typeof event.path === 'string' && event.path.indexOf('?') >= 0) {
    return parseQueryString(event.path.split('?')[1]);
  }
  return {};
}

/* ============================================================
   二、去数据库网关取数
   ============================================================ */

/**
 * 请求数据库网关，返回 { status, raw, json, headers }。
 * 不在这里判断对错 —— 判断交给调用方，这样错误信息能写得更具体。
 */
function requestJson(path) {
  return new Promise(function (resolve, reject) {
    const req = https.request(
      {
        hostname: ENV_ID + '.api.tcloudbasegateway.com',
        path: path,
        method: 'GET',
        headers: {
          // 这把钥匙扮演"管理员"角色，所以能读到数据
          'Authorization': 'Bearer ' + API_KEY,
          'Accept': 'application/json',
        },
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

    // 超时保护：等不到结果就主动断开，报一个能看懂的错（秒数见上面的 TIMEOUT_MS）
    req.setTimeout(TIMEOUT_MS, function () {
      req.destroy(new Error('请求数据库超时（超过 ' + (TIMEOUT_MS / 1000) + ' 秒）'));
    });

    req.end();
  });
}

/** 上游出问题时的统一处理：把状态码和一小段原文带上，方便排查 */
function upstreamFail(res) {
  const snippet = String(res.raw || '').slice(0, 300);
  return {
    http: 502,
    body: fail('数据库网关返回了 ' + res.status + '。原文（截断）：' + snippet),
  };
}

/**
 * 真正干活的地方：读 cities 表。
 * 返回 { http: 该给浏览器的状态码, body: 该给浏览器的 JSON }
 */
async function readCities() {
  // 钥匙没配 —— 这是最容易犯的部署错误，所以单独给一条说人话的提示
  if (!API_KEY) {
    return {
      http: 500,
      body: fail(
        '云函数还没配数据库钥匙。请到「云函数 → cities → 配置 → 环境变量」加一条：' +
        '名 CLOUDBASE_API_KEY，值填控制台建的 API Key。' +
        '改完直接刷新本页即可 —— 环境变量是"配置"不是"代码"，不用重新部署。'
      ),
    };
  }

  // 拼查询串：点名要字段 + 按 id 排序（保证每次顺序一样）+ 最多要 LIMIT_ROWS 行
  const qs = 'select=' + FIELDS + '&order=id.asc&limit=' + LIMIT_ROWS;

  let res;
  try {
    res = await requestJson('/v1/rdb/rest/' + TABLE + '?' + qs);
  } catch (e) {
    return { http: 502, body: fail('连不上数据库网关：' + e.message) };
  }

  if (res.status !== 200) return upstreamFail(res);

  // 正常应该拿到一个数组。不是数组说明网关给的是别的东西（比如错误对象）
  if (!Array.isArray(res.json)) {
    return {
      http: 502,
      body: fail('返回的不是数组（预期是城市列表）。原文（截断）：' + String(res.raw || '').slice(0, 300)),
    };
  }

  return { http: 200, body: ok(res.json) };
}

/* ============================================================
   三、入口
   ============================================================ */

/**
 * 云函数入口。CloudBase 收到请求时调用它。
 *
 * ⚠️ 这里为什么要判断两种调用方式？（跟 health 一样）
 *   SDK 调用   → 直接返回对象，调用方拿到的就是 result
 *   HTTP 访问  → 必须返回 { statusCode, headers, body }，否则浏览器不知道
 *                内容类型是 JSON、也不知道状态码
 *   判断依据：HTTP 访问时 event 里会带 httpMethod
 */
exports.main = async (event, context) => {
  const isHttpRequest = !!(event && event.httpMethod);
  const method = (event && event.httpMethod) || 'GET';

  // 浏览器跨域之前会先发一个 OPTIONS 探路请求，要答应它
  if (isHttpRequest && method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // 这个接口只读，别的方法一律拒绝
  if (isHttpRequest && method !== 'GET') {
    const body = fail('这个接口只支持 GET（只看数据，不改数据）。收到的是 ' + method);
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify(body) };
  }

  const result = await readCities();

  if (isHttpRequest) {
    return {
      statusCode: result.http,
      headers: CORS_HEADERS,
      body: JSON.stringify(result.body),
    };
  }

  // SDK 调用：直接返回对象
  return result.body;
};
