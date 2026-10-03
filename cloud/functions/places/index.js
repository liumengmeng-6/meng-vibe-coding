/**
 * 云函数：places（对外地址 GET /api/places?city=成都）
 * ─────────────────────────────────────────────────────────────
 * 它是干什么的？
 *   给一个城市名，返回那个城市有哪些吃的、哪些玩的，以及参考价。
 *
 * 跟 cities 那个函数的关系？
 *   两个函数**长得几乎一样**，差别只在"查哪张表、怎么查"。
 *   重复的那部分（请求网关、拼返回形状）是**故意重复的** ——
 *   云函数是各自独立打包上传的，一个函数读不到另一个函数的文件。
 *   为了让两边可以各改各的、互不影响，宁可重复这几十行。
 *
 * 返回什么形状？（跟 cities 完全一致，全项目统一）
 *   成功：{ ok: true,  data: [...], error: null }
 *   失败：{ ok: false, data: null,  error: "人能看懂的中文说明" }
 *
 * ── 为什么查一次要用两条请求？ ──
 *   places 表里**不存城市名，只存 city_id 这个数字**（这就是"关联字段"）。
 *   现在手上只有城市名「成都」，所以：
 *     第 1 步：去 cities 表按名字查出它的 id（成都 = 256）
 *     第 2 步：去 places 表按 city_id = 256 查地点
 *   这叫"两次查询"，好处是**不用手写 join**、每一步都看得懂。
 *   （进阶写法是让网关一次做完关联查询，那是以后的事。）
 *
 * ⚠️ city 是必填的。不传就直接报错，绝不"那我把整张表给你吧" ——
 *    那样数据一多就会把接口拖垮。
 * ─────────────────────────────────────────────────────────────
 */

const https = require('https');

/** 环境 ID。不是机密（它就在公网地址里），写死没关系；也允许用环境变量覆盖。 */
const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'travel-planner-d4g8o6mee9d231c64';

/** 数据库钥匙。**只从环境变量读，代码里绝不写值。** */
const API_KEY = process.env.CLOUDBASE_API_KEY || '';

/** 要读的两张表 */
const TABLE_CITIES = 'cities';
const TABLE_PLACES = 'places';

/** 要取的字段（点名要，不用 `*`，理由见 cities 那个函数的注释） */
const CITY_FIELDS = 'id,name';
const PLACE_FIELDS = 'id,city_id,name,type,price,note,created_at';

/** 一次最多要多少行（理由见 cities 那个函数的注释） */
const LIMIT_ROWS = 2000;

/**
 * 请求数据库网关的超时（毫秒）
 *
 * ⚠️ 为什么是 2.5 秒：云函数本身的「执行超时」上限只有 3 秒（免费/体验版，
 *    调大要升级套餐），到点被平台硬砍，函数里等更久没有意义。
 *    留 0.5 秒，好让我们自己返回一句看得懂的中文，而不是平台那句"执行超时"。
 *    将来升级套餐把函数超时调大了，这里跟着放大。
 */
const TIMEOUT_MS = 2500;

/** 跨域头 */
const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ============================================================
   一、小工具（与 cities 那个函数相同）
   ============================================================ */

function ok(data) {
  return { ok: true, data: data, error: null };
}

function fail(error) {
  return { ok: false, data: null, error: error };
}

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

/** 从 event 里取出查询参数（四种可能的形状都试一遍，理由见 cities 那个函数的注释） */
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

function requestJson(path) {
  return new Promise(function (resolve, reject) {
    const req = https.request(
      {
        hostname: ENV_ID + '.api.tcloudbasegateway.com',
        path: path,
        method: 'GET',
        headers: {
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
    req.setTimeout(TIMEOUT_MS, function () {
      req.destroy(new Error('请求数据库超时（超过 ' + (TIMEOUT_MS / 1000) + ' 秒）'));
    });
    req.end();
  });
}

function upstreamFail(what, res) {
  const snippet = String(res.raw || '').slice(0, 300);
  return {
    http: 502,
    body: fail('查' + what + '时数据库网关返回了 ' + res.status + '。原文（截断）：' + snippet),
  };
}

/** 钥匙没配时的提示（最容易犯的部署错误，单独给一条说人话的） */
function noKey() {
  return {
    http: 500,
    body: fail(
      '云函数还没配数据库钥匙。请到「云函数 → places → 配置 → 环境变量」加一条：' +
      '名 CLOUDBASE_API_KEY，值填控制台建的 API Key。' +
      '改完直接刷新本页即可 —— 环境变量是"配置"不是"代码"，不用重新部署。'
    ),
  };
}

/**
 * 真正干活的地方。
 * @param {string} cityName 城市名，如「成都」
 */
async function readPlaces(cityName) {
  // ① 必填校验 —— 先拦在前面，别去白跑两次数据库
  if (!cityName) {
    return {
      http: 400,
      body: fail('请指定城市，例如：/api/places?city=成都。可用城市见 GET /api/cities'),
    };
  }

  if (!API_KEY) return noKey();

  // ② 第 1 步：按名字把城市的 id 查出来
  //    名字里可能有中文，必须 encodeURIComponent 编码后才能放进网址
  const cityQs = 'select=' + CITY_FIELDS + '&name=eq.' + encodeURIComponent(cityName) + '&limit=1';

  let cityRes;
  try {
    cityRes = await requestJson('/v1/rdb/rest/' + TABLE_CITIES + '?' + cityQs);
  } catch (e) {
    return { http: 502, body: fail('连不上数据库网关：' + e.message) };
  }

  if (cityRes.status !== 200) return upstreamFail('城市', cityRes);
  if (!Array.isArray(cityRes.json)) {
    return {
      http: 502,
      body: fail('查城市时返回的不是数组。原文（截断）：' + String(cityRes.raw || '').slice(0, 300)),
    };
  }
  if (cityRes.json.length === 0) {
    return {
      http: 404,
      body: fail('没有找到城市「' + cityName + '」。可用城市见 GET /api/cities'),
    };
  }

  const cityId = cityRes.json[0].id;

  // ③ 第 2 步：拿这个 id 去 places 表查地点
  const placeQs =
    'select=' + PLACE_FIELDS +
    '&city_id=eq.' + cityId +
    '&order=id.asc&limit=' + LIMIT_ROWS;

  let placeRes;
  try {
    placeRes = await requestJson('/v1/rdb/rest/' + TABLE_PLACES + '?' + placeQs);
  } catch (e) {
    return { http: 502, body: fail('连不上数据库网关：' + e.message) };
  }

  if (placeRes.status !== 200) return upstreamFail('地点', placeRes);
  if (!Array.isArray(placeRes.json)) {
    return {
      http: 502,
      body: fail('查地点时返回的不是数组。原文（截断）：' + String(placeRes.raw || '').slice(0, 300)),
    };
  }

  return { http: 200, body: ok(placeRes.json) };
}

/* ============================================================
   三、入口
   ============================================================ */

exports.main = async (event, context) => {
  const isHttpRequest = !!(event && event.httpMethod);
  const method = (event && event.httpMethod) || 'GET';

  if (isHttpRequest && method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (isHttpRequest && method !== 'GET') {
    const body = fail('这个接口只支持 GET（只看数据，不改数据）。收到的是 ' + method);
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify(body) };
  }

  // 取出 ?city= 后面的值（顺带把两边空格去掉，"成都 "和"成都"当成同一个）
  const query = getQuery(event);
  const cityName = String((query && query.city) || '').trim();

  const result = await readPlaces(cityName);

  if (isHttpRequest) {
    return {
      statusCode: result.http,
      headers: CORS_HEADERS,
      body: JSON.stringify(result.body),
    };
  }

  return result.body;
};
