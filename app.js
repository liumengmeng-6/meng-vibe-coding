/* ============================================================
   出行规划小助手 · 逻辑与数据
   项目：meng-vibe-coding
   依据：PRD.md（v1.1）第四节验收标准 AC1–AC14、第三节功能 F1–F8
        TECH_DESIGN.md 第四节「已知的坑」——本文件必须遵守：
          · 不用 import / export（file:// 下会崩）
          · 不 fetch 任何外部文件（file:// 下会被拦）
          · 所有数据写成下面的常量
   规矩：改规则只动这个文件
   ============================================================ */

'use strict';

/* ============================================================
   〇、价目表（集中放一处，改价只改这里）
   口径（PRD 第二节 C）：
     · 「天数」一律指总天数（含在途日）—— 在途那天照样要吃、要住
     · 住宿按「总天数 − 1」晚计算
     · 市内交通 / 吃 / 门票 按「总天数 × 单价」
   所有数字均为学生档【估算值】，不是实时价格。
   ============================================================ */

var PRICES = {
  cityTransferPerDay: 20,   // 市内交通：元/天
  hotelPerNight:      90,   // 住宿：元/晚（学生档，快捷酒店档位）
  foodPerDay:         80,   // 吃：元/天
  ticketPerDay:       60,   // 门票：元/天
  note: '学生档参考价（估算值），非实时价格'
};


/* ============================================================
   一、内置城市清单（成都、重庆各 6 条 = 3 吃 + 3 玩）
   AC10 要求：每城至少 6 条，每条都有 名称 / 类型 / 参考花费
   口径（PRD F7）：清单里的花费【只显示，不计入总花费合计】
   ============================================================ */

var CITY_HIGHLIGHTS = {
  '成都': [
    { name: '龙抄手（总店）',   type: 'en', price: 20,  note: '一碗抄手，人均约 20 元' },
    { name: '玉林串串香',       type: 'en', price: 45,  note: '串串按签计价，人均约 45 元' },
    { name: '蛋烘糕（街边小摊）', type: 'en', price: 8,   note: '小吃，2–8 元一个' },
    { name: '大熊猫繁育研究基地', type: 'play', price: 55,  note: '学生票约 27 元，记得带学生证' },
    { name: '人民公园（鹤鸣茶社）', type: 'play', price: 30,  note: '免费入园，喝茶约 30 元/位' },
    { name: '宽窄巷子',         type: 'play', price: 0,   note: '免费，只逛街不消费就是 0 元' }
  ],
  '重庆': [
    { name: '重庆小面（街边面馆）', type: 'en', price: 12,  note: '二两小面约 10–15 元' },
    { name: '老火锅（社区店）',     type: 'en', price: 70,  note: '避开景区店，人均约 60–80 元' },
    { name: '酸辣粉 / 山城小汤圆',  type: 'en', price: 15,  note: '街头小吃，10–20 元' },
    { name: '洪崖洞',               type: 'play', price: 0,   note: '免费外观，夜景最佳' },
    { name: '长江索道',             type: 'play', price: 30,  note: '单程约 30 元' },
    { name: '磁器口古镇',           type: 'play', price: 0,   note: '免费，逛吃另算' }
  ]
};


/* ============================================================
   二、城际交通参考价
   按「出发地 → 目的地」的公里级距离给出参考方案（估算值）。
   数据拿不到实时票价（PRD 第五节：本期不做），所以用「距离 × 经验换算」推。
   耗时与票价都是估算，页面必须标注。

   本节提供 4 种可组合的公共交通方式：
     高铁 / 普速列车 / 长途汽车 / 拼车（顺风车）
   每种方式有各自的「生效距离范围」，超出范围就不列（比如短途没有普速、
   超长途不推荐拼车），避免给出不现实的选项。

   字段：mode 方式名、hours 耗时（小时）、price 单人票价（元）、
        label 人话说明、key 方式代号（用于方案组合时识别）
   ============================================================ */

/* 每种交通方式的换算参数（估算值，集中放一处好维护）
     speed   ：含进出站、停站、实际限速折损后的平均时速（km/h）
     perKm   ：每人每公里票价（元）
     fixed   ：固定附加费（元），模拟起步价 / 服务费
     minKm   ：短于这个距离就不列（太近了坐它没意义）
     maxKm   ：长于这个距离就不列（太远了坐它不现实）
     nightOk ：该方式是否可能有过夜车次（可省一晚住宿） */
var TRANSPORT_MODES = {
  highspeed: {
    key: 'highspeed', mode: '高铁',
    speed: 200, perKm: 0.42, fixed: 20,
    minKm: 0, maxKm: Infinity, nightOk: false,
    label: '最快，也最贵'
  },
  normal: {
    key: 'normal', mode: '普速列车',
    speed: 70, perKm: 0.14, fixed: 10,
    minKm: 100, maxKm: Infinity, nightOk: true,
    label: '慢很多，但便宜；过夜车次还能省一晚住宿'
  },
  coach: {
    key: 'coach', mode: '长途汽车',
    speed: 65, perKm: 0.30, fixed: 8,
    minKm: 0, maxKm: 800, nightOk: false,
    label: '中短途常见，比高铁便宜；班次多但要自己盯时刻'
  },
  carpool: {
    key: 'carpool', mode: '拼车 / 顺风车',
    speed: 75, perKm: 0.55, fixed: 15,
    minKm: 0, maxKm: 400, nightOk: false,
    label: '跨城顺风车，一车多人分摊路费；价格随行情浮动'
  }
};

/* 常见城市的大致坐标（只用于估算距离，不画地图、不联网） */
var CITY_COORDS = {
  '北京': { lat: 39.90, lng: 116.41 },
  '上海': { lat: 31.23, lng: 121.47 },
  '广州': { lat: 23.13, lng: 113.26 },
  '深圳': { lat: 22.54, lng: 114.06 },
  '武汉': { lat: 30.59, lng: 114.31 },
  '成都': { lat: 30.57, lng: 104.07 },
  '重庆': { lat: 29.56, lng: 106.55 },
  '西安': { lat: 34.34, lng: 108.94 },
  '青岛': { lat: 36.07, lng: 120.38 },
  '杭州': { lat: 30.27, lng: 120.16 },
  '南京': { lat: 32.06, lng: 118.80 },
  '长沙': { lat: 28.23, lng: 112.94 },
  '郑州': { lat: 34.75, lng: 113.63 },
  '洛阳': { lat: 34.62, lng: 112.45 },
  '开封': { lat: 34.80, lng: 114.31 },
  '昆明': { lat: 25.04, lng: 102.71 },
  '贵阳': { lat: 26.65, lng: 106.63 },
  '南昌': { lat: 28.68, lng: 115.86 },
  '厦门': { lat: 24.48, lng: 118.09 },
  '兰州': { lat: 36.06, lng: 103.83 },
  '天津': { lat: 39.08, lng: 117.20 },
  '沈阳': { lat: 41.80, lng: 123.43 },
  '哈尔滨': { lat: 45.80, lng: 126.53 },
  '银川': { lat: 38.49, lng: 106.23 }
};

/* 两个坐标之间的粗略直线距离（公里）——用「等距圆柱投影」近似，够用了 */
function distanceKm(a, b) {
  var R = 6371;
  var dLat = (b.lat - a.lat) * Math.PI / 180;
  var dLng = (b.lng - a.lng) * Math.PI / 180;
  var midLat = (a.lat + b.lat) / 2 * Math.PI / 180;
  var x = dLng * Math.cos(midLat);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

/* 直线距离 → 铁路里程的修正系数
   为什么要乘 1.25：火车不走直线，要绕行。武汉到成都直线约 980 公里，
   实际铁路里程约 1200 公里。不修正的话耗时会算少一半，行程天数直接算错。 */
var RAIL_DETOUR = 1.25;

/* 根据距离列出所有可行的交通方式（按「耗时从少到多」排好序，第一个就是最快的） */
function estimateTransport(fromCity, toCity) {
  var a = CITY_COORDS[fromCity];
  var b = CITY_COORDS[toCity];

  // 坐标表里没有的城市：给一个"保守估计"，并明确标注需要用户自己核实
  if (!a || !b) {
    return {
      known: false,
      options: [
        { key: 'highspeed', mode: '高铁', hours: 5, price: 400,
          label: '暂无该城市的坐标数据，此处为保守估算' }
      ]
    };
  }

  var km = distanceKm(a, b) * RAIL_DETOUR;   // 换算成公路/铁路里程（估算）

  var options = [];
  Object.keys(TRANSPORT_MODES).forEach(function (k) {
    var t = TRANSPORT_MODES[k];

    // 超出这种方式适合的距离范围 → 不列
    if (km < t.minKm || km > t.maxKm) return;

    var hours = Math.max(0.5, km / t.speed);
    // 票价按 5 元取整，避免出现 137 元这种假精确的数字
    var price = Math.round((km * t.perKm + t.fixed) / 5) * 5;

    options.push({
      key: t.key,
      mode: t.mode,
      hours: round1(hours),
      price: price,
      label: t.label,
      nightOk: t.nightOk
    });
  });

  // 按耗时排序：第一个是最快的（分天数算法要看它）
  options.sort(function (x, y) { return x.hours - y.hours; });

  return { known: true, km: Math.round(km), options: options };
}

/* 在一段路的所有方式里，挑出指定的那一种（找不到就返回最快的那种兜底） */
function pickOption(leg, key) {
  var opts = leg.estimate.options;
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].key === key) return opts[i];
  }
  return opts[0];
}

/* 在一段路里挑最便宜的那种 */
function cheapestOption(leg) {
  var opts = leg.estimate.options;
  var best = opts[0];
  for (var i = 1; i < opts.length; i++) {
    if (opts[i].price < best.price) best = opts[i];
  }
  return best;
}

function round1(n) { return Math.round(n * 10) / 10; }


/* ============================================================
   三、分天数（PRD F3，核心算法）
   规则：
     1. 一段城际交通耗时 ≥ 6 小时 → 占 1 整天
     2. 可用于游玩的天数 = 总天数 − 各段占用的整天数之和
     3. 可用于游玩的天数 < 城市数 → 报错 E4
     4. 平均分配；余数按城市顺序从前到后各加 1 天
     5. 占 1 整天的交通段单独成行，写「在途：A → B」
   ============================================================ */

function splitDays(fromCity, cities, totalDays) {
  var legs = [];
  var transitDays = 0;

  // 依次算每一段：出发地 → 城市1 → 城市2 → …
  var prev = fromCity;
  for (var i = 0; i < cities.length; i++) {
    var est = estimateTransport(prev, cities[i]);
    // 取最快的那条方案来判断是否占用整天
    var fastest = est.options[0];
    var occupies = fastest.hours >= 6 ? 1 : 0;
    transitDays += occupies;

    legs.push({
      from: prev,
      to: cities[i],
      estimate: est,
      occupiesWholeDay: occupies === 1
    });
    prev = cities[i];
  }

  var playableDays = totalDays - transitDays;

  // 校验：可用于游玩的天数不足
  if (playableDays < cities.length) {
    return {
      ok: false,
      errorCode: 'E4',
      message: '去 ' + cities.length + ' 个城市至少需要 ' + cities.length +
               ' 天（不含路上），请增加天数或减少城市'
    };
  }

  // 平均分配 + 余数从前往后加
  var base = Math.floor(playableDays / cities.length);
  var remainder = playableDays - base * cities.length;

  var plan = [];
  for (var j = 0; j < cities.length; j++) {
    plan.push({
      city: cities[j],
      days: base + (j < remainder ? 1 : 0)
    });
  }

  return {
    ok: true,
    legs: legs,
    transitDays: transitDays,
    playableDays: playableDays,
    plan: plan
  };
}

/* 按「指定的交通方式组合」重算一遍行程天数。
   pickKeys：每段用哪种方式，例如 ['cheapest','highspeed','normal']
   —— 不加这个的话，换交通方式后天数不会变，用户就看不到"省钱的代价"。
   totalDays 传进来的是【总天数】，这是 PRD 的固定口径。 */
function splitDaysWithModes(fromCity, cities, totalDays, pickKeys) {
  var legs = [];
  var transitDays = 0;

  var prev = fromCity;
  for (var i = 0; i < cities.length; i++) {
    var est = estimateTransport(prev, cities[i]);
    var leg = { from: prev, to: cities[i], estimate: est };

    // 挑出这一段用的方式（pickKeys 里给的是 'cheapest' 就用最便宜的）
    var chosen;
    if (pickKeys[i] === 'cheapest') {
      chosen = cheapestOption(leg);
    } else {
      chosen = pickOption(leg, pickKeys[i]);
    }

    leg.chosen = chosen;

    // 用【这一种方式】的耗时判断是否占整天（不是最快的那种）
    var occupies = chosen.hours >= 6 ? 1 : 0;
    leg.occupiesWholeDay = occupies === 1;
    leg.chosenWholeDay = occupies === 1;
    transitDays += occupies;

    legs.push(leg);
    prev = cities[i];
  }

  var playableDays = totalDays - transitDays;
  if (playableDays < cities.length) {
    return { ok: false, errorCode: 'E4', legs: legs, transitDays: transitDays,
             playableDays: playableDays };
  }

  var base = Math.floor(playableDays / cities.length);
  var remainder = playableDays - base * cities.length;
  var plan = [];
  for (var j = 0; j < cities.length; j++) {
    plan.push({ city: cities[j], days: base + (j < remainder ? 1 : 0) });
  }

  return {
    ok: true,
    legs: legs,
    transitDays: transitDays,
    playableDays: playableDays,
    plan: plan
  };
}


/* ============================================================
   四、算总账（PRD F5）
   口径严格按 PRD 第二节 C：
     城际交通 = 各段【这套方案选用方式】的票价合计
                （Day 7 起：不再是"硬取最便宜"，而是跟着方案走，
                  这样切到"性价比方案"时总价才会跟着变）
     市内交通 = 20 × 总天数
     住宿     = 90 × (总天数 − 1)
     吃       = 80 × 总天数
     门票     = 60 × 总天数
   ============================================================ */

function calcCost(legs, totalDays) {
  var intercity = 0;
  for (var i = 0; i < legs.length; i++) {
    // 这套方案在这一段选了哪种方式，就用它的票价
    var leg = legs[i];
    var chosen = leg.chosen || leg.estimate.options[0];
    intercity += chosen.price;
  }

  var cityTransfer = PRICES.cityTransferPerDay * totalDays;
  var hotel        = PRICES.hotelPerNight * Math.max(0, totalDays - 1);
  var food         = PRICES.foodPerDay * totalDays;
  var ticket       = PRICES.ticketPerDay * totalDays;

  var total = intercity + cityTransfer + hotel + food + ticket;

  return {
    items: [
      { key: 'intercity',    label: '城际交通', detail: '本方案各段所选交通方式的票价合计', amount: intercity },
      { key: 'cityTransfer', label: '市内交通', detail: PRICES.cityTransferPerDay + ' 元/天 × ' + totalDays + ' 天', amount: cityTransfer },
      { key: 'hotel',        label: '住宿',     detail: PRICES.hotelPerNight + ' 元/晚 × ' + Math.max(0, totalDays - 1) + ' 晚', amount: hotel },
      { key: 'food',         label: '吃',       detail: PRICES.foodPerDay + ' 元/天 × ' + totalDays + ' 天', amount: food },
      { key: 'ticket',       label: '门票',     detail: PRICES.ticketPerDay + ' 元/天 × ' + totalDays + ' 天', amount: ticket }
    ],
    total: total
  };
}


/* ============================================================
   五之二、整体出行方案组合（Day 7 追加）
   用户不想只看"零件"，想看"整体怎么走更划算"。
   这里给 2 套现成方案，每套都按它自己的交通方式重算天数和总价：

     · 最省方案：每段都挑最便宜的交通方式
     · 性价比方案：不看票价绝对值，看「每省 1 元要多花几小时」；
                   多花的时间超过阈值就不划算，这一段就改用更快的

   阈值怎么定的（估算口径）：
     一次旅行里，时间是有价的。学生党时间相对宽裕，但也不该为了省
     二三十块钱多坐四五个小时。这里定为：多花 1 小时至少得省下
     VALUE_PER_HOUR 元才算划算。取 25 元/小时（约等于一顿正餐）。
   ============================================================ */

var VALUE_PER_HOUR = 30;   // 元/小时：每多花 1 小时，至少要省这么多钱才值得

/* 多占一整天的额外代价（元/天）
   为什么需要这个：一段路如果耗时跨过 6 小时这条线，就会多占 1 整天在途，
   行程天数没变、钱也照花，但能玩的城市天数少了一天。这不划算，
   而且光看"每小时省多少钱"看不出来。所以选慢车时要把这代价算进去。
   取 300 元/天：约等于"那一天本该有的 吃 80 + 门票 60 + 市内 20 + 住宿 90"
   再加一点"假期本身的价值"。 */
var PENALTY_WHOLE_DAY = 300;

/* 在某一小段里，按"性价比"挑一种方式
   核心思路：先保"天数不缩水"，再在同等天数下省钱。
     第 1 关：把这段路可能的方式按"会不会多占整天"分组，
             优先留在【不额外占整天】的那一组里 —— 时间宝贵，先保住能玩的天数
     第 2 关：在这组里，找"每多花 1 小时至少省 VALUE_PER_HOUR 元"里最便宜的
   两关都过不了才退回最快的那种。 */
function bestValueOption(leg) {
  var opts = leg.estimate.options;
  var fastest = opts[0];                 // opts 已按耗时排序，第 0 个最快
  var fastWholeDay = fastest.hours >= 6;

  // 第 1 关：筛出"不会比最快方案多占整天"的方式
  var sameDayGroup = [];
  for (var i = 0; i < opts.length; i++) {
    var o = opts[i];
    var thisWholeDay = o.hours >= 6;
    // 最快方案本来就不占整天，这种方式也不占 → 同类
    // 最快方案本来就占整天，那多占不多占都无所谓了
    if (!thisWholeDay || fastWholeDay) sameDayGroup.push(o);
  }

  // 第 2 关：在同类里挑最划算的
  var best = null;
  for (var k = 0; k < sameDayGroup.length; k++) {
    var cand = sameDayGroup[k];
    var extraHours = cand.hours - fastest.hours;
    var savedMoney = fastest.price - cand.price;

    if (savedMoney <= 0) {
      // 更贵：只有当它不比最快慢时才有意义（同价更快的场景不存在，跳过）
      continue;
    }
    if (extraHours <= 0) {
      // 一样快（或更快）还更便宜 → 直接就是最优，不用比了
      return cand;
    }

    var valuePerHour = savedMoney / extraHours;
    if (valuePerHour < VALUE_PER_HOUR) continue;   // 时间换钱不划算

    if (!best || cand.price < best.price) best = cand;
  }

  return best || fastest;
}

/* 生成两套整体方案 */
function buildPlans(input) {
  var fromCity = input.fromCity;
  var cities = input.cities;
  var totalDays = input.days;

  var plans = [];

  /* ---------- 方案 1：最省 ---------- */
  var cheapKeys = [];
  for (var i = 0; i < cities.length; i++) cheapKeys.push('cheapest');
  var cheapSplit = splitDaysWithModes(fromCity, cities, totalDays, cheapKeys);
  if (cheapSplit.ok) {
    var cheapCost = calcCost(cheapSplit.legs, totalDays);
    plans.push({
      id: 'cheapest',
      name: '最省方案',
      tagline: '每段都坐最便宜的车，能省就省',
      legs: cheapSplit.legs,
      split: cheapSplit,
      cost: cheapCost,
      total: cheapCost.total,
      transitDays: cheapSplit.transitDays,
      playableDays: cheapSplit.playableDays
    });
  }

  /* ---------- 方案 2：性价比 ---------- */
  var valueKeys = [];
  var valueLegsProbe = [];
  var prev = fromCity;
  for (var k = 0; k < cities.length; k++) {
    var probeLeg = { from: prev, to: cities[k], estimate: estimateTransport(prev, cities[k]) };
    var chosen = bestValueOption(probeLeg);
    valueKeys.push(chosen.key);
    valueLegsProbe.push(probeLeg);
    prev = cities[k];
  }
  var valueSplit = splitDaysWithModes(fromCity, cities, totalDays, valueKeys);
  if (valueSplit.ok) {
    var valueCost = calcCost(valueSplit.legs, totalDays);
    plans.push({
      id: 'value',
      name: '性价比方案',
      tagline: '多花的时间算得过来才省；否则宁可坐快的',
      legs: valueSplit.legs,
      split: valueSplit,
      cost: valueCost,
      total: valueCost.total,
      transitDays: valueSplit.transitDays,
      playableDays: valueSplit.playableDays
    });
  }

  /* ---------- 两套方案的关系：省了多少、代价是什么 ---------- */
  if (plans.length === 2) {
    var cheapPlan = plans[0];
    var valuePlan = plans[1];
    var savedMoney = valuePlan.total - cheapPlan.total;      // 最省方案便宜多少
    var extraHours = 0;

    for (var m = 0; m < cheapPlan.legs.length; m++) {
      extraHours += cheapPlan.legs[m].chosen.hours - valuePlan.legs[m].chosen.hours;
    }
    extraHours = round1(extraHours);

    // 两套完全一样的话，得如实告诉用户，不能假装有区别
    var identical = savedMoney === 0 && extraHours === 0;

    cheapPlan.compare = {
      identical: identical,
      savedMoney: savedMoney,
      extraHours: extraHours,
      text: identical
        ? '这套和「性价比方案」在交通上完全相同——这几段路能选的方式里，' +
          '没有"多花时间能省下钱"的选项。'
        : ('比「性价比方案」省 ¥' + savedMoney + '，代价是多花约 ' + extraHours + ' 小时在路上。')
    };
    valuePlan.compare = {
      identical: identical,
      savedMoney: savedMoney,
      extraHours: extraHours,
      text: identical
        ? '这套和「最省方案」在交通上完全相同。'
        : ('比「最省方案」多花 ¥' + savedMoney + '，换回约 ' + extraHours + ' 小时的自由时间。')
    };
  }

  return plans;
}


/* ============================================================
   六、预算对比 + 超支建议（PRD F6）
   合计 ≤ 预算 → 显示还剩多少
   合计 > 预算 → 按顺序给建议，命中即显示，最多 3 条
   ============================================================ */

function compareBudget(cost, budget, legs, plan) {
  if (budget === null || budget === undefined || budget === '') {
    return { hasBudget: false, over: false, diff: 0, advice: [] };
  }

  var diff = budget - cost.total;   // 正数 = 还剩，负数 = 超出
  if (diff >= 0) {
    return { hasBudget: true, over: false, diff: diff, advice: [] };
  }

  var overAmount = -diff;
  var advice = [];
  var totalDays = (plan && plan.totalDays) ? plan.totalDays : 0;
  var nights = Math.max(0, totalDays - 1);
  var hotelSave = 40 * nights;      // 住宿换青旅能省的钱（建议里要用两次）

  /* 情况 0：只超出一点点（一顿饭以内）→ 先给"零钱级"的提醒，
     这时候劝人换青旅、砍城市都是杀鸡用牛刀。
     阈值 50 元的依据：一天吃饭约 80 元（PRICES.foodPerDay），
       50 元不到一顿正餐，属于"随便省省就回来了"的量级。 */
  if (overAmount <= 50) {
    advice.push({
      text: '只超了 ¥' + overAmount + '，不到一顿饭钱。少买点纪念品、路上少喝两杯奶茶就回来了，' +
            '行程完全不用动。',
      save: overAmount,
      pain: 0                          // 代价最小：行程一点不改
    });
  }

  /* 建议的排序原则：代价从小到大 —— 先劝"不痛不痒就能省下来"的，
     最后才是"砍行程"这种伤筋动骨的。
     为什么：超支 ¥5 却建议"去掉一个城市"，属于为了小钱办大事，用户会觉得离谱。
     顺序 = ⓪ 零钱级提醒 ① 换整体方案 ② 住宿降档 ③ 单段换车 ④ 去掉城市 */

  // ① 如果当前方案不是最省方案，先告诉用户"换成最省方案能省多少"
  //    这条最实在：不动行程内容，只是每段改坐便宜的车
  if (plan && plan.cheaperPlan && plan.cheaperPlan.total < cost.total) {
    var saveToCheapest = cost.total - plan.cheaperPlan.total;
    advice.push({
      text: '换成「' + plan.cheaperPlan.name + '」：每段都坐最便宜的交通方式，' +
            '总花费降到 ¥' + plan.cheaperPlan.total + '，能省约 ¥' + saveToCheapest + '。' +
            (plan.cheaperPlan.compare ? '（' + plan.cheaperPlan.compare.text + '）' : ''),
      save: saveToCheapest,
      pain: 1                          // 代价最小：行程一点没少，只是路上时间变长
    });
  }

  // ② 住宿降档（换成青旅）—— 代价也小，但比"换方案"更影响体验，排第二
  if (nights > 0) {
    advice.push({
      text: '住宿从快捷酒店换成青旅床位，每晚约省 ¥40，' + nights + ' 晚共省约 ¥' + hotelSave + '。',
      save: hotelSave,
      pain: 2                          // 代价：住得差一点，行程完全不变
    });
  }

  // ③ 挑一段改成更便宜的方式，省票价 + 可选夜车省一晚住宿
  //    注意：每段有 1–4 种方式，不能只看"第 0 个和第 1 个"，
  //         要在这段的所有方式里找"比当前用的更便宜、且总省钱最多"的那种。
  var best = null;
  for (var i = 0; i < legs.length; i++) {
    var leg = legs[i];

    var cur = leg.chosen || leg.estimate.options[0];
    var opts = leg.estimate.options;

    for (var k = 0; k < opts.length; k++) {
      var o = opts[k];
      if (o.price >= cur.price) continue;          // 不比现在便宜就不看

      var save = cur.price - o.price;
      // 如果这种方式能过夜，还能顺带省一晚住宿
      var nightSave = o.nightOk ? PRICES.hotelPerNight : 0;
      var totalSave = save + nightSave;

      if (!best || totalSave > best.totalSave) {
        best = { leg: leg, from: cur, to: o, save: save,
                 nightSave: nightSave, totalSave: totalSave };
      }
    }
  }
  if (best) {
    advice.push({
      text: '把「' + best.leg.from + ' → ' + best.leg.to + '」从' + best.from.mode +
            '改成' + best.to.mode + '（约 ' + best.to.hours + ' 小时），票价省约 ¥' +
            best.save + (best.nightSave > 0
              ? '；选夜间车次过夜，还能再省 1 晚住宿约 ¥' + PRICES.hotelPerNight + '。'
              : '，代价是多花约 ' + round1(best.to.hours - best.from.hours) + ' 小时。'),
      save: best.totalSave,
      pain: 3                          // 代价：这一段要多坐几小时
    });
  }

  // ④ 去掉最远的城市 —— 代价最大（行程内容少一块），所以放最后
  if (plan && plan.plan && plan.plan.length >= 2) {
    var lastCity = plan.plan[plan.plan.length - 1];
    var lastLeg = legs[legs.length - 1];
    var lastCur = lastLeg ? (lastLeg.chosen || lastLeg.estimate.options[0]) : null;
    var cutTrans = lastCur ? lastCur.price : 0;
    var cutHotel = PRICES.hotelPerNight * lastCity.days;
    advice.push({
      text: '如果时间紧张，去掉最远的「' + lastCity.city + '」（' + lastCity.days +
            ' 天），可省城际交通约 ¥' + cutTrans + ' + 住宿约 ¥' + cutHotel + '。',
      save: cutTrans + cutHotel,
      pain: 4                          // 代价：少玩一个城市
    });
  }

  // 排序：代价小的排前面；代价相同时，省得多的排前面
  advice.sort(function (a, b) {
    if (a.pain !== b.pain) return a.pain - b.pain;
    return b.save - a.save;
  });

  /* 只挑最前面几条 —— 但有个前提：
     建议的省钱额必须"配得上"超支的数额。
     比如超支 ¥5，就不该建议"去掉西安（省 ¥200）"——那是为了小钱办大事。
     规则：按顺序累加，凑够差额就停（最多 2 条）。
       只要"第一条"能覆盖差额，就只给 1 条，不硬凑。 */
  var picked = [];
  var acc = 0;
  for (var n = 0; n < advice.length && picked.length < 2; n++) {
    picked.push(advice[n]);
    acc += advice[n].save;
    if (acc >= overAmount) break;      // 已经够了，不再往下堆
  }
  advice = picked;

  // 兜底：上面所有"省一点"的办法加起来仍填不平差额 →
  //   说明这套行程在预算里根本走不通，别再劝人省小钱了，直接说清事实
  var totalSave = 0;
  for (var m = 0; m < advice.length; m++) totalSave += advice[m].save;
  if (totalSave < overAmount) {
    advice = [{
      text: '超了 ¥' + overAmount + '，上面那些"省一点"的办法（加起来约能省 ¥' +
            totalSave + '）也填不平。这套行程的最低可行预算是 ¥' + cost.total +
            '。建议二选一：把预算提到 ¥' + cost.total + ' 左右，或者少去一个城市 / 换更近的目的地。',
      save: totalSave
    }];
  }

  return {
    hasBudget: true,
    over: true,
    diff: diff,
    overAmount: overAmount,
    // 建议已经在上面"按代价排序 + 凑够差额就停"筛好了，这里直接用
    advice: advice
  };
}


/* ============================================================
   六、输入校验（PRD F1，错误码 E1–E5）
   ============================================================ */

function validateInput(input) {
  var errors = {};

  // E1 出发城市为空
  if (!input.fromCity || input.fromCity.trim() === '') {
    errors.fromCity = '请填写出发城市';
  }

  // E2 没选任何目的城市
  if (!input.cities || input.cities.length === 0) {
    errors.cities = '请至少选择 1 个想去的城市';
  } else if (input.cities.length > 4) {
    errors.cities = '最多选择 4 个城市，当前有 ' + input.cities.length + ' 个';
  }

  // E3 天数不是 2–20 的整数
  var d = input.days;
  if (d === null || d === undefined || d === '' || !isFinite(d) ||
      Math.floor(d) !== d || d < 2 || d > 20) {
    errors.days = '天数请填 2 到 20 之间的整数';
  }

  // E5 预算填了但不是正数
  if (input.budget !== null && input.budget !== undefined && input.budget !== '') {
    if (!isFinite(input.budget) || input.budget <= 0) {
      errors.budget = '预算请填一个大于 0 的数字（不想设预算可以留空）';
    }
  }

  // E4 城市数 > 可用于游玩的天数（需要先分天数才知道）
  if (!errors.days && !errors.cities && !errors.fromCity) {
    var split = splitDays(input.fromCity.trim(), input.cities, d);
    if (!split.ok) {
      errors.days = split.message;
    }
  }

  return errors;
}


/* ============================================================
   七、界面逻辑（把上面的算法接到页面上）
   分三块：
     A. 读输入 / 清错误 / 显示错误
     B. 渲染五块结果
     C. 事件绑定（添加城市、删城市、生成、清空）
   ============================================================ */

/* 页面上的状态：已经加了哪些城市 */
var selectedCities = [];

/* Day 7 追加：整体方案相关的状态
   lastInput  —— 本次生成的输入（切换方案时不用重新读表单）
   lastPlans  —— 本次算出的所有整体方案
   activePlanId —— 当前正在看哪一套 */
var lastInput = null;
var lastPlans = null;
var activePlanId = null;

/* 城市之间排行程时，怎么安排"当天大致安排"
   改进（Day 7 用户反馈后）：
     原来是「一个城市一句话」，第 2 天和第 3 天显示同一句，看起来像复制粘贴。
     现在改成「一个城市一组安排，按天往下排」——第 1 天看什么、第 2 天看什么，
     各不一样；排完了就从头循环（免得第 5 天没内容可写）。
   括号里的都是【估算值 / 常见参考】，不是精确时刻表。 */
var CITY_PLAN_HINT = {
  '西安': ['兵马俑（要留半天以上）', '城墙骑车 + 回民街', '大唐不夜城 / 大唐芙蓉园', '陕西历史博物馆'],
  '成都': ['宽窄巷子 / 人民公园', '大熊猫繁育研究基地', '武侯祠 + 锦里 / 玉林路', '都江堰或青城山（一日往返）'],
  '重庆': ['洪崖洞（看夜景）', '磁器口古镇 + 李子坝轻轨站', '长江索道 + 山城步道', '武隆天生三桥（一日往返）'],
  '北京': ['故宫 + 天安门', '八达岭长城（一日往返）', '颐和园 / 圆明园', '南锣鼓巷 + 什刹海', '国家博物馆 / 798'],
  '上海': ['外滩 + 南京路', '武康路 + 安福路（梧桐区）', '豫园 + 城隍庙', '上海博物馆 / 西岸美术馆', '迪士尼（一日）'],
  '杭州': ['西湖（断桥—苏堤）', '灵隐寺 + 飞来峰', '河坊街 + 南宋御街', '西溪湿地 / 龙井村'],
  '南京': ['中山陵 + 明孝陵', '夫子庙 + 秦淮河', '总统府 + 1912 街区', '侵华日军南京大屠杀遇难同胞纪念馆'],
  '青岛': ['栈桥 + 老城区', '八大关 + 第二海水浴场', '崂山（一日往返）', '台东夜市 / 小麦岛'],
  '长沙': ['橘子洲头', '岳麓山 + 湖南大学', '太平街 + 坡子街（小吃）', '湖南省博物馆'],
  '昆明': ['滇池 + 海埂大坝', '翠湖 + 云南大学', '石林（一日往返）', '斗南花市'],
  '厦门': ['鼓浪屿（一日）', '环岛路骑行 + 曾厝垵', '厦门大学 + 南普陀寺', '中山路步行街'],
  '武汉': ['黄鹤楼 + 长江大桥', '东湖绿道骑行', '户部巷 + 昙华林', '湖北省博物馆（看编钟）'],
  '广州': ['陈家祠 + 沙面', '广州塔 + 珠江夜游', '北京路 + 上下九', '长隆（一日）'],
  '深圳': ['世界之窗 / 欢乐谷', '深圳湾公园骑行', '南头古城 + 海上世界', '大鹏所城（一日往返）'],
  '天津': ['五大道 + 意式风情区', '天津之眼 + 海河', '古文化街 + 鼓楼', '滨海图书馆（网红打卡）'],
  '郑州': ['二七广场 + 德化街', '河南博物院', '郑州黄河风景区', '只有河南·戏剧幻城'],
  '洛阳': ['龙门石窟', '白马寺 + 洛阳博物馆', '老城十字街夜市', '应天门 + 洛邑古城（汉服打卡）'],
  '开封': ['清明上河园', '开封府 + 包公祠', '鼓楼夜市', '龙亭公园'],
  '贵阳': ['甲秀楼 + 南明河', '青岩古镇（一日）', '黔灵山公园', '花果园 / 二七路小吃'],
  '南昌': ['滕王阁', '八一广场 + 万寿宫', '绳金塔美食街', '梅岭 / 瑶湖'],
  '兰州': ['中山桥 + 黄河风情线', '甘肃省博物馆', '正宁路夜市（牛奶鸡蛋醪糟）', '白塔山公园'],
  '银川': ['镇北堡西部影城', '西夏王陵', '沙湖（一日）', '怀远夜市'],
  '沈阳': ['沈阳故宫 + 大帅府', '中街 + 太原街', '北陵公园', '辽宁省博物馆'],
  '哈尔滨': ['中央大街 + 索菲亚教堂', '冰雪大世界（冬季）', '松花江 + 太阳岛', '老道外中华巴洛克']
};

/* 取某个城市"第 n 天"的安排（n 从 0 开始）
   天数超过列表长度时循环取，避免出现空白；排到头会提示"再安排就重复了" */
function planHintFor(city, dayIndex) {
  var list = CITY_PLAN_HINT[city];
  if (!list || list.length === 0) return '自由安排';
  return list[dayIndex % list.length];
}

/* 该城市有没有内置安排表 */
function hasPlanHint(city) {
  return !!(CITY_PLAN_HINT[city] && CITY_PLAN_HINT[city].length);
}

/* ---------- A. 输入相关 ---------- */

function readInput() {
  var daysRaw = document.getElementById('days').value;
  var budgetRaw = document.getElementById('budget').value;

  return {
    fromCity: document.getElementById('from-city').value,
    cities: selectedCities.slice(),
    days: daysRaw === '' ? null : Number(daysRaw),
    budget: budgetRaw === '' ? null : Number(budgetRaw)
  };
}

/* 清掉所有红色错误提示 */
function clearErrors() {
  ['error-from-city', 'error-to-city', 'error-days', 'error-budget'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { el.hidden = true; el.textContent = ''; }
  });
}

/* 把校验结果画到页面上 */
function showErrors(errors) {
  var map = {
    fromCity: 'error-from-city',
    cities:   'error-to-city',
    days:     'error-days',
    budget:   'error-budget'
  };
  Object.keys(errors).forEach(function (key) {
    var el = document.getElementById(map[key]);
    if (el) { el.hidden = false; el.textContent = errors[key]; }
  });
}

/* ---------- B. 渲染 ---------- */

/* B1 每日行程 */
/* B1 每日行程
   Day 7 改进（用户反馈"西安三天只有三个选项"）：
     原来的毛病是「一个城市一句话，第 2、3 天复制同一句」，而且自填的地点
     进不了行程。现在改成：
       1. 每天从该城市的内置安排表里取【不同的一条】（`planHintFor` 按天索引取）
       2. 把用户自己添加的地点【也排进去】—— 内置安排先排，自填的接在后面
       3. 一天排几条：按"每天大约排 2 条"分配；某天实在没内容就如实写"这天还没安排"
     注意：自填地点的花费【不进总合计】（和美食清单的规矩一致，防止重复计算）。 */
function renderItinerary(split, input) {
  var tbody = document.getElementById('table-itinerary').querySelector('tbody');
  tbody.innerHTML = '';

  // ① 把"占整天"的交通段，按顺序插进行程里
  //    规则：占整天的段单独成行；不占整天的段，先进城再游玩
  var rows = [];
  var prev = input.fromCity.trim();

  for (var i = 0; i < split.legs.length; i++) {
    var leg = split.legs[i];

    if (leg.occupiesWholeDay) {
      var chosen = leg.chosen || leg.estimate.options[0];
      rows.push({
        type: 'transit',
        label: '在途：' + leg.from + ' → ' + leg.to,
        detail: '全天在路上（' + chosen.mode + ' 约 ' + chosen.hours + ' 小时）',
        cost: 0
      });
    }

    // 这个城市待几天，就补几行
    var cityDays = 0;
    for (var k = 0; k < split.plan.length; k++) {
      if (split.plan[k].city === leg.to) { cityDays = split.plan[k].days; break; }
    }

    var city = leg.to;

    // 收集这个城市"要排进去的内容"：
    //   顺序很重要 —— 【用户自己加的地点排在内置建议前面】
    //   原因：天数常常不够排完所有内容，内置建议是"参考"，自己加的才是"想去"，
    //        被天数截掉时应该先保留用户自己的选择。
    var pool = [];
    var mine = selfAdded[city] || [];
    for (var s = 0; s < mine.length; s++) {
      pool.push({
        text: mine[s].name + (mine[s].price > 0 ? '（约 ' + mine[s].price + ' 元）' : ''),
        self: true
      });
    }
    if (hasPlanHint(city)) {
      var builtin = CITY_PLAN_HINT[city];
      for (var b = 0; b < builtin.length; b++) {
        pool.push({ text: builtin[b], self: false });
      }
    }

    // 每天排几条：按"每天最多 2 条"切。
    //   为什么：如果内容有 4 条、城市只待 1 天，硬均分会把 4 条全塞进那一天，
    //          看起来像"一天跑四个景点"，不现实。
    //   排不完就顺延到后面的天；后面的天都没有了，就如实说明"没排完"。
    var PER_DAY = 2;
    var perDay = Math.min(PER_DAY, Math.max(1, Math.ceil(pool.length / Math.max(1, cityDays))));

    for (var d = 0; d < cityDays; d++) {
      var slice = pool.slice(d * perDay, (d + 1) * perDay);

      // 第一天到得晚，先写"到达"，再排当天的内容
      var detail;
      if (slice.length === 0) {
        detail = hasPlanHint(city)
          ? '这天还没安排（内置建议已排完，可在下面"美食美景清单"里自己加）'
          : '这天还没安排（该城市暂无内置建议，可在下面"美食美景清单"里自己加）';
      } else {
        detail = slice.map(function (x) { return x.text; }).join('；');
        if (d === 0) detail = '到达 + ' + detail;
      }

      // 最后一天：如果内容没排完，如实告诉用户"还剩几条没排进去"
      //   为什么必须说：用户自己加的地点若因为天数不够被吞掉，他会以为"加了没用"
      if (d === cityDays - 1) {
        var leftCount = pool.length - cityDays * perDay;
        if (leftCount > 0) {
          detail += '（还有 ' + leftCount + ' 条建议没排下，' +
                    city + '只待 ' + cityDays + ' 天，加天数就能排上）';
        }
      }

      rows.push({
        type: 'city',
        label: city,
        detail: detail,
        // 当天花费：市内交通 + 吃 + 门票（住宿不按天摊，它按"晚"单独算）
        //   注意：这里【不含】自填地点的花费，避免和"门票"那一项重复计算
        cost: PRICES.cityTransferPerDay + PRICES.foodPerDay + PRICES.ticketPerDay,
        hasSelf: slice.some(function (x) { return x.self; })
      });
    }
  }

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var tr = document.createElement('tr');
    // 注意：用 classList.add 逐个加，不能连续用 className = 赋值 ——
    //       那样后一次会把前一次覆盖掉（曾导致 row-transit 风格丢失）
    if (row.type === 'transit') tr.classList.add('row-transit');
    if (row.hasSelf) tr.classList.add('row-has-self');

    var td1 = document.createElement('td');
    td1.className = 'col-day';
    /* 「第 N 天」外面套一个胶囊 span（Day 9 追加）。
       为什么不用 innerHTML —— 保持本项目一贯做法：一律 createElement，
       不拼字符串，省得以后往里面放用户输入的时候埋下 XSS 的坑。
       为什么套 span 而不是直接给 td 上色 —— td 会被拉满整列宽度，
       胶囊就会变成"一条横杠"；套个 inline-block 的 span，宽度才跟着字走。 */
    var dayPill = document.createElement('span');
    dayPill.className = 'day-pill';
    dayPill.textContent = '第 ' + (r + 1) + ' 天';
    td1.appendChild(dayPill);

    var td2 = document.createElement('td');
    td2.textContent = row.label;

    var td3 = document.createElement('td');
    td3.textContent = row.detail;

    var td4 = document.createElement('td');
    td4.className = 'num';
    td4.textContent = row.cost > 0 ? ('约 ' + row.cost + ' 元') : '—';

    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
    tbody.appendChild(tr);
  }
}

/* B2 城际交通对比：每一段路，把它所有可行方式都列出来
   Day 7 追加：段数变多了（最多 4 种方式），所以做了三件事——
     1. 每段之间加一条分隔线，避免看串行
     2. 标出这一段"最省 / 最快"分别是哪种
     3. 段尾给一句"时间 vs 花费"的结论（AC7）+ 是否占整天
   chosenKeys：当前展出的这套整体方案，每段实际选了哪种（用于打勾标记） */
function renderTransport(split, chosenKeys) {
  var table = document.getElementById('table-transport');
  var tbody = table.querySelector('tbody');
  tbody.innerHTML = '';

  // 每段的"结论句"统一收进这个容器，重渲染时一起清掉。
  // 原来是把段落直接 append 到表格外面（靠 parentNode.parentNode 找位置），
  // 那样一旦 DOM 层级变动就会崩，这里改成显式的容器。
  var notesBox = document.getElementById('transport-notes');
  if (notesBox) notesBox.innerHTML = '';

  for (var i = 0; i < split.legs.length; i++) {
    var leg = split.legs[i];
    var opts = leg.estimate.options;

    // 找出这一段的最快 / 最省（用于打标记）
    var fastest = opts[0];
    var cheapest = cheapestOption(leg);

    // 这一段的表头行
    var headTr = document.createElement('tr');
    headTr.className = 'row-seg-head';
    var headTd = document.createElement('td');
    headTd.colSpan = 5;
    headTd.textContent = '第 ' + (i + 1) + ' 段：' + leg.from + ' → ' + leg.to +
      '（约 ' + leg.estimate.km + ' 公里）';
    headTr.appendChild(headTd);
    tbody.appendChild(headTr);

    for (var k = 0; k < opts.length; k++) {
      var o = opts[k];
      var tr = document.createElement('tr');

      // 这一段方案里，当前这套方案选中的那种，加个重点标记
      var isPicked = chosenKeys && chosenKeys[i] === o.key;
      if (isPicked) tr.className = 'row-picked';

      var td1 = document.createElement('td');
      td1.textContent = isPicked ? '✓ 本方案选用' : '';

      var td2 = document.createElement('td');
      var marks = [];
      if (o === fastest) marks.push('最快');
      if (o === cheapest) marks.push('最省');
      var markTxt = marks.length > 0 ? '（' + marks.join(' / ') + '）' : '';
      td2.textContent = o.mode + markTxt;

      var td3 = document.createElement('td');
      // 「耗时」也是个数字列：跟「票价」一样右对齐，
      //   否则表头「耗时」和「单人票价」一个左一个右，两个数字列自己就不齐
      td3.className = 'num';
      td3.textContent = '约 ' + o.hours + ' 小时';

      var td4 = document.createElement('td');
      td4.className = 'num';
      td4.textContent = '约 ' + o.price + ' 元';

      var td5 = document.createElement('td');
      td5.textContent = o.label;

      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tr.appendChild(td4); tr.appendChild(td5);
      tbody.appendChild(tr);
    }

    // 每段下面必须有一句"时间 vs 花费"的结论（AC7）
    var note = document.createElement('p');
    note.className = 'seg-note';

    if (fastest !== cheapest) {
      var saveMoney = fastest.price - cheapest.price;
      var saveTime = round1(cheapest.hours - fastest.hours);
      note.textContent = '这段坐' + fastest.mode + '最快（' + fastest.hours +
        ' 小时、约 ¥' + fastest.price + '）；改坐' + cheapest.mode + '能省约 ¥' +
        saveMoney + '，但要多花约 ' + saveTime + ' 小时。' +
        (leg.occupiesWholeDay ? '这段耗时较长，整天在路上，行程里已单独占一天。' : '');
    } else {
      note.textContent = '这段只有' + fastest.mode + '一种可行方案（约 ' + fastest.hours +
        ' 小时、约 ¥' + fastest.price + '）。' +
        (leg.occupiesWholeDay ? '耗时较长，整天在路上，行程里已单独占一天。' : '');
    }
    if (notesBox) notesBox.appendChild(note);
  }
}

/* B3 花费清单 */
/* 数字滚动：把一个金额从 0 滚到目标值，约 0.7 秒内跑完。
   为什么加：合计金额是整页最该被看到的数字，让它"数上去"比直接显示更有存在感。
   性能做法：用 requestAnimationFrame（浏览器每帧回调一次，天然跟着屏幕刷新率），
   不用 setInterval（那个固定间隔，掉帧时会跳字）。 */
function countUp(el, target, ms) {
  // 极老环境没有 requestAnimationFrame 就直接显示结果，不让功能坏掉
  if (typeof requestAnimationFrame !== 'function') {
    el.textContent = '¥' + target;
    return;
  }

  var DURATION = ms || 720;
  var start = null;

  function step(ts) {
    if (start === null) start = ts;
    var p = Math.min(1, (ts - start) / DURATION);
    // easeOutCubic：开头快、结尾缓缓停住，比匀速自然
    var eased = 1 - Math.pow(1 - p, 3);
    el.textContent = '¥' + Math.round(target * eased);
    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = '¥' + target;   // 保证最终值精确
    }
  }

  requestAnimationFrame(step);
}

function renderCost(cost) {
  var tbody = document.getElementById('table-cost').querySelector('tbody');
  tbody.innerHTML = '';

  for (var i = 0; i < cost.items.length; i++) {
    var it = cost.items[i];
    var tr = document.createElement('tr');

    var td1 = document.createElement('td');
    td1.textContent = it.label;

    var td2 = document.createElement('td');
    td2.textContent = it.detail;

    var td3 = document.createElement('td');
    td3.className = 'num';
    td3.textContent = '¥' + it.amount;

    // 每项金额也逐个淡入，错峰 60ms，看起来是"一项项算出来"
    tr.classList.add('reveal-item');
    tr.style.animationDelay = (i * 60) + 'ms';

    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    tbody.appendChild(tr);
  }

  var trTotal = document.createElement('tr');
  trTotal.className = 'row-total';
  trTotal.innerHTML = '<td>合计</td><td>以上五项相加</td><td class="num" id="cost-total">¥0</td>';
  tbody.appendChild(trTotal);

  // 合计金额滚上去
  var totalEl = document.getElementById('cost-total');
  if (totalEl) countUp(totalEl, cost.total, 760);
}

/* B4 预算结论 */
function renderBudget(verdict) {
  var box = document.getElementById('budget-verdict');
  box.innerHTML = '';

  if (!verdict.hasBudget) {
    var p = document.createElement('p');
    p.className = 'field-note';
    p.textContent = '你没有填预算，所以这里只算总花费、不做对比。想比较的话，回去把预算填上再生成一次。';
    box.appendChild(p);
    return;
  }

  var div = document.createElement('div');
  div.className = 'verdict ' + (verdict.over ? 'bad' : 'good');

  var main = document.createElement('span');
  main.className = 'verdict-main';
  main.textContent = verdict.over
    ? ('超出 ¥' + verdict.overAmount)
    : ('预算内，还剩 ¥' + verdict.diff);
  div.appendChild(main);

  var sub = document.createElement('span');
  sub.textContent = verdict.over
    ? '按当前方案，比预算多花了这些钱。'
    : '按当前方案，钱够用。';
  div.appendChild(sub);
  box.appendChild(div);

  if (verdict.advice && verdict.advice.length > 0) {
    var title = document.createElement('p');
    title.className = 'field-note';
    title.style.marginTop = '14px';
    title.textContent = '想省下来的话，可以试试：';
    box.appendChild(title);

    var ul = document.createElement('ul');
    ul.className = 'verdict-advice';
    for (var i = 0; i < verdict.advice.length; i++) {
      var li = document.createElement('li');
      var no = document.createElement('span');
      no.className = 'advice-no';
      no.textContent = String(i + 1);
      var txt = document.createElement('span');
      txt.textContent = verdict.advice[i].text;
      li.appendChild(no); li.appendChild(txt);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }
}

/* B6 整体方案（Day 7 追加）
   把「最省 / 性价比」两套方案并列展示，每套写清：
     · 每段分别坐什么
     · 在路上几天、能玩几天
     · 总花费多少
     · 和其他方案比，省了多少 / 多花了多少时间
   用户点某一套的按钮，下面的行程、交通、花费就全按那一套重算。 */
function renderPlans(plans, activeId) {
  var box = document.getElementById('plans-body');
  box.innerHTML = '';

  for (var i = 0; i < plans.length; i++) {
    var p = plans[i];
    var card = document.createElement('div');
    card.className = 'plan-card' + (p.id === activeId ? ' active' : '');

    var head = document.createElement('div');
    head.className = 'plan-head';
    var name = document.createElement('h3');
    name.className = 'plan-name';
    name.textContent = p.name;
    var totalEl = document.createElement('span');
    totalEl.className = 'plan-total';
    totalEl.textContent = '¥' + p.total;
    head.appendChild(name);
    head.appendChild(totalEl);
    card.appendChild(head);

    var tag = document.createElement('p');
    tag.className = 'plan-tagline';
    tag.textContent = p.tagline;
    card.appendChild(tag);

    // 每一段坐什么
    var legsUl = document.createElement('ul');
    legsUl.className = 'plan-legs';
    for (var k = 0; k < p.legs.length; k++) {
      var leg = p.legs[k];
      var ch = leg.chosen;
      var li = document.createElement('li');
      li.textContent = leg.from + ' → ' + leg.to + '：' + ch.mode +
        '（' + ch.hours + ' 小时，¥' + ch.price + '）';
      legsUl.appendChild(li);
    }
    card.appendChild(legsUl);

    // 天数结构：在路上几天 + 能玩几天
    var daysLine = document.createElement('p');
    daysLine.className = 'plan-days';
    daysLine.textContent = '在路上 ' + p.transitDays + ' 天，实际能玩 ' + p.playableDays + ' 天';
    card.appendChild(daysLine);

    // 和其他方案的对比
    if (p.compare) {
      var cmp = document.createElement('p');
      cmp.className = 'plan-compare';
      cmp.textContent = p.compare.text;
      card.appendChild(cmp);
    }

    // 选用按钮
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ' + (p.id === activeId ? 'btn-primary' : 'btn-ghost');
    btn.textContent = p.id === activeId ? '正在看这套' : '按这套重新算';
    btn.setAttribute('data-plan', p.id);
    btn.addEventListener('click', function () {
      var id = this.getAttribute('data-plan');
      switchPlan(id);
    });
    card.appendChild(btn);

    box.appendChild(card);
  }
}

/* 切换整体方案：只重渲染下面的结果，不重新校验输入 */
function switchPlan(planId) {
  if (!lastInput || !lastPlans) return;

  var picked = null;
  for (var i = 0; i < lastPlans.length; i++) {
    if (lastPlans[i].id === planId) picked = lastPlans[i];
  }
  if (!picked) return;

  activePlanId = planId;

  var chosenKeys = [];
  for (var k = 0; k < picked.legs.length; k++) {
    chosenKeys.push(picked.legs[k].chosen.key);
  }

  var verdict = compareBudget(picked.cost, lastInput.budget, picked.legs, {
    plan: picked.split.plan,
    totalDays: lastInput.days,
    cheaperPlan: cheaperOf(lastPlans, picked)
  });

  renderPlans(lastPlans, activePlanId);
  renderItinerary(picked.split, lastInput);
  renderTransport(picked.split, chosenKeys);
  renderCost(picked.cost);
  renderBudget(verdict);
}

/* 在若干方案里，找出比"当前这套"更便宜的那一套（用于超支建议） */
function cheaperOf(plans, current) {
  var best = null;
  for (var i = 0; i < plans.length; i++) {
    if (plans[i].total < current.total) {
      if (!best || plans[i].total < best.total) best = plans[i];
    }
  }
  return best;
}

/* B5 美食美景清单 */
function renderHighlights(cities) {
  var box = document.getElementById('highlights-body');
  box.innerHTML = '';

  for (var i = 0; i < cities.length; i++) {
    var city = cities[i];
    var block = document.createElement('div');
    block.className = 'city-block';

    var h3 = document.createElement('h3');
    h3.textContent = city;
    var list = CITY_HIGHLIGHTS[city];
    // 之前自己存下来的地点（localStorage 读回来的，或者本次已添加的）
    var saved = selfAdded[city] || [];

    // 内置清单 + 已存的自填地点，合并成一张表来渲染
    //   为什么要合并：刷新页面后 selfAdded 是从本地存储读回来的，
    //   如果这里不画出来，用户会以为"我加的地点丢了"（实际还在，也在行程里）
    var allRows = [];
    if (list && list.length > 0) {
      for (var k0 = 0; k0 < list.length; k0++) {
        allRows.push({ type: list[k0].type, name: list[k0].name, note: list[k0].note,
                       price: list[k0].price, self: false });
      }
    }
    for (var s0 = 0; s0 < saved.length; s0++) {
      allRows.push({ type: saved[s0].type, name: saved[s0].name, note: '',
                     price: saved[s0].price, self: true, selfIndex: s0 });
    }

    if (allRows.length > 0) {
      var tag = document.createElement('span');
      tag.className = 'city-tag';
      tag.textContent = list && list.length > 0
        ? ('（内置推荐 ' + list.length + ' 条' +
           (saved.length > 0 ? ' + 你自己添加 ' + saved.length + ' 条' : '') + '）')
        : ('（你自己添加 ' + saved.length + ' 条）');
      h3.appendChild(tag);
      block.appendChild(h3);

      var table = document.createElement('table');
      table.className = 'data-table';
      var thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>类型</th><th>名称</th><th class="num">参考花费</th>' +
                        '<th class="col-op"></th></tr>';
      table.appendChild(thead);
      var tbody = document.createElement('tbody');

      for (var k = 0; k < allRows.length; k++) {
        var item = allRows[k];
        var tr = document.createElement('tr');

        var td1 = document.createElement('td');
        var badge = document.createElement('span');
        badge.className = item.type === 'en' ? 'tag-eat' : 'tag-play';
        badge.textContent = item.type === 'en' ? '吃' : '玩';
        td1.appendChild(badge);

        var td2 = document.createElement('td');
        td2.textContent = item.name + (item.note ? '（' + item.note + '）' : '') +
                          (item.self ? '（你自己添加的）' : '');

        var td3 = document.createElement('td');
        td3.className = 'num';
        td3.textContent = item.price > 0 ? ('约 ' + item.price + ' 元') : '免费';

        // 最后一列：只有"你自己添加的"才有删除按钮
        //   内置推荐删不掉 —— 那是写死在代码里的数据，删了下次刷新又回来，没意义
        var td4 = document.createElement('td');
        td4.className = 'col-op';
        if (item.self) {
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn-del';
          delBtn.textContent = '×';
          delBtn.title = '删除「' + item.name + '」';
          // 用 data-* 存身份：点了删哪个城市、第几条
          //   （不能用闭包变量直接引用，因为重渲染后索引会变）
          delBtn.setAttribute('data-city', city);
          delBtn.setAttribute('data-index', String(item.selfIndex));

          delBtn.addEventListener('click', function () {
            var c = this.getAttribute('data-city');
            var idx = Number(this.getAttribute('data-index'));
            removeSelfAdded(c, idx);
          });

          td4.appendChild(delBtn);
        }

        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      block.appendChild(table);
    } else {
      var tag2 = document.createElement('span');
      tag2.className = 'city-tag';
      tag2.textContent = '（暂无内置数据）';
      h3.appendChild(tag2);
      block.appendChild(h3);

      var empty = document.createElement('div');
      empty.className = 'empty-note';
      empty.textContent = '暂无数据，可点下面自己添加。';
      block.appendChild(empty);
    }

    // 不管是内置城市还是没数据的城市，都给一个"自己添加"的口子（PRD A+B）
    var addForm = buildAddForm(city);
    block.appendChild(addForm);

    // 已经存过的自填地点 → 小计文字要立刻是正确数字，不能还写着"还没有添加"
    var subEl = addForm.querySelector('.subtotal-line');
    if (subEl) refreshSelfSubtotal(city, subEl);

    box.appendChild(block);
  }
}

/* 生成"自己添加地点"的小表单 —— 用 addEventListener 绑定，不用行内 onclick
   （TECH_DESIGN 没禁止，但行内 onclick 在 file:// 下也不算安全，统一走监听器） */
function buildAddForm(city) {
  var wrap = document.createElement('div');
  wrap.className = 'self-add';

  var row = document.createElement('div');
  row.className = 'self-add-row';

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'name';
  nameInput.placeholder = '自己加一个：名称（如 都江堰）';

  var typeSelect = document.createElement('select');
  typeSelect.innerHTML = '<option value="en">吃</option><option value="play">玩</option>';

  var priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.className = 'price';
  priceInput.placeholder = '花费';
  priceInput.min = '0';

  var addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost';
  addBtn.textContent = '添加';

  row.appendChild(nameInput);
  row.appendChild(typeSelect);
  row.appendChild(priceInput);
  row.appendChild(addBtn);
  wrap.appendChild(row);

  var subtotal = document.createElement('p');
  subtotal.className = 'subtotal-line';
  subtotal.textContent = '自填地点（参考）：还没有添加。';
  wrap.appendChild(subtotal);

  // 记录这个城市里用户自己添加的条目
  selfAdded[city] = selfAdded[city] || [];

  addBtn.addEventListener('click', function () {
    var name = nameInput.value.trim();
    if (name === '') {
      nameInput.focus();
      return;
    }
    var price = priceInput.value === '' ? 0 : Number(priceInput.value);
    if (!isFinite(price) || price < 0) price = 0;

    var entry = { name: name, type: typeSelect.value, price: price, selfAdded: true };
    selfAdded[city].push(entry);

    nameInput.value = '';
    priceInput.value = '';

    // 添加后统一走 syncSelfAdded：它一次把三处都刷新好
    //   ① 本地存储（刷新页面还在）② 清单区（含小计 + 删除按钮）③ 每日行程
    //   为什么要抽成一个函数：添加和删除必须走同一条路，
    //   否则很容易"添加时记得存、删除时忘了存"（或者反过来）
    //   注意：这一步会把整个清单区重画，所以最后要把输入焦点还给用户
    syncSelfAdded(city);
    nameInput.focus();
  });

  return wrap;
}

/* 用户自填条目：按城市存一份
   Day 7 追加：存进浏览器的本地存储（localStorage）
     —— localStorage 是浏览器自带的一个小仓库，数据留在【你的电脑上】，
        不联网、不上传。所以刷新页面后自填的地点还在。
     兼容处理：极少数环境禁用本地存储（比如隐私模式），
        这时降级为"只在当前页面有效"，不让整个页面崩掉。 */
var selfAdded = {};

var STORAGE_KEY = 'meng-vibe-coding:selfAdded';

/* 把内存里的自填数据写回本地存储 */
function saveSelfAdded() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selfAdded));
  } catch (e) {
    // 存不进去就算了，功能照常用，只是刷新后不保留
  }
}

/* 从本地存储读回自填数据（页面打开时调用一次） */
function loadSelfAdded() {
  try {
    if (typeof localStorage === 'undefined') return;
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var data = JSON.parse(raw);
    if (data && typeof data === 'object') selfAdded = data;
  } catch (e) {
    selfAdded = {};
  }
}

/* 清空本地存储里的自填数据（点"清空重填"时用） */
function clearSelfAddedStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

/* ---------- 主题切换（Day 8 追加） ----------

   两套主题：明亮（默认）/ 赛博（深色霓虹）。
   实现方式：给 <html> 打一个 data-theme="cyber" 属性，
   style.css 里所有颜色都走 CSS 变量，属性一变整站跟着变。

   为什么在 head 里还有一段重复的读取逻辑？
     那段是为了"防止刷新时闪白"——必须在页面画出来之前就把属性设好，
     而 app.js 是 defer 加载的，那时已经晚了。两者读的是同一个 key。 */

var THEME_KEY = 'meng-vibe-coding:theme';
var THEME_CYBER = 'cyber';

/* 读当前主题（读不到就当作默认的明亮主题） */
function getTheme() {
  var attr = document.documentElement.getAttribute('data-theme');
  return attr === THEME_CYBER ? THEME_CYBER : 'light';
}

/* 把主题写到页面上 + 存进本地存储 */
function applyTheme(theme) {
  if (theme === THEME_CYBER) {
    document.documentElement.setAttribute('data-theme', THEME_CYBER);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_KEY, theme);
    }
  } catch (e) {
    /* 隐私模式下存不进，就当"仅当前页面有效" */
  }
  syncThemeButton();
}

/* 按钮上的文字随主题变：现在是什么主题，就提示"切到另一个" */
function syncThemeButton() {
  var btn = document.getElementById('btn-theme');
  var label = document.getElementById('theme-label');
  if (!btn || !label) return;
  var isCyber = getTheme() === THEME_CYBER;
  label.textContent = isCyber ? '明亮主题' : '赛博主题';
  btn.setAttribute('aria-pressed', isCyber ? 'true' : 'false');
  btn.title = isCyber ? '切换回明亮主题' : '切换到赛博主题（深色霓虹）';
}

function initTheme() {
  var btn = document.getElementById('btn-theme');
  if (btn) {
    btn.addEventListener('click', function () {
      applyTheme(getTheme() === THEME_CYBER ? 'light' : THEME_CYBER);
    });
  }
  syncThemeButton();
}

/* ---------- 顶端进度条 ----------

   点「生成方案」后滑过一条，给"正在算"的视觉反馈。
   算法其实只要几十毫秒，所以它跑完就自己淡出，不留痕迹。

   为什么要"先摘类、强制重排、再加类"这三步：
   连续两次点击时，如果类还在，浏览器会认为动画没变、不重播。
   中间读一次 offsetWidth 逼浏览器重新计算样式，动画才会重新跑。 */
function runProgressBar() {
  var bar = document.getElementById('progress-bar');
  if (!bar) return;
  bar.classList.remove('running');
  void bar.offsetWidth;
  bar.classList.add('running');
}

function refreshSelfSubtotal(city, el) {
  var list = selfAdded[city] || [];
  if (list.length === 0) {
    el.textContent = '自填地点（参考）：还没有添加。';
    return;
  }
  var sum = 0;
  for (var i = 0; i < list.length; i++) sum += list[i].price;
  el.textContent = '自填地点（参考）：共 ' + list.length + ' 条，合计约 ¥' + sum +
                   ' —— 这一行同样不计入上面的总花费。';
}

/* 自填数据一变（添加 / 删除），把该同步的地方【一次性全刷新】
   为什么要抽成一个函数：自填数据同时出现在三个地方 ——
     ① 清单表（⑥）
     ② 每日行程（②）
     ③ 本地存储
   散着写容易漏，漏了就会出现"清单删了、行程还在"这种对不上的情况。 */
function syncSelfAdded(city) {
  // ① 存回本地存储
  saveSelfAdded();

  // ② 重画整个清单区（这样表格行数、小计、标题里"你自己添加 N 条"都会一起更新）
  //    注意：renderHighlights 需要知道当前选了哪些城市，用 lastInput 拿；
  //         还没生成过就没必要重画。
  if (lastInput && lastInput.cities) {
    renderHighlights(lastInput.cities);
  }

  // ③ 重画每日行程
  if (lastPlans) {
    var activePlan = null;
    for (var pi = 0; pi < lastPlans.length; pi++) {
      if (lastPlans[pi].id === activePlanId) activePlan = lastPlans[pi];
    }
    if (activePlan) renderItinerary(activePlan.split, lastInput);
  }
}

/* 删掉某城市里"你自己添加的"第 idx 条
   idx 是这个城市自填数组里的位置（从 0 开始）
   删完立刻同步清单、行程、本地存储三处 */
function removeSelfAdded(city, idx) {
  var list = selfAdded[city];
  if (!list || idx < 0 || idx >= list.length) return;

  list.splice(idx, 1);       // 从数组里拿走这一条

  // 三处一起刷新（存回本地存储 + 重画清单 + 重画行程）
  syncSelfAdded(city);
}

/* ---------- C. 城市标签 ---------- */

/* 记住上一次画出来的城市，用来判断哪个是"新加进来的"。
   只有新加的那个才播"弹出"动画 —— 否则每次重画所有标签一起弹，很闹。 */
var lastChipList = [];

function renderCityChips() {
  var box = document.getElementById('city-chips');
  box.innerHTML = '';

  for (var i = 0; i < selectedCities.length; i++) {
    var city = selectedCities[i];
    var chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = city;

    // 判断是不是这次新加的（上次没有、这次有）
    if (lastChipList.indexOf(city) < 0) {
      chip.style.animationDelay = '0ms';
    } else {
      // 老标签不播动画：把 animation 关掉，免得一闪
      chip.style.animation = 'none';
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = '移除 ' + city;
    btn.setAttribute('data-city', city);

    btn.addEventListener('click', function () {
      var c = this.getAttribute('data-city');
      var idx = selectedCities.indexOf(c);
      if (idx >= 0) selectedCities.splice(idx, 1);
      renderCityChips();
    });

    chip.appendChild(btn);
    box.appendChild(chip);
  }

  // 记下这一轮的结果，供下次比较
  lastChipList = selectedCities.slice();
}

/* 往「想去的城市」下方那条提示位上写一句话。
   三个地方共用：空输入 / 已经加过 / 超过 4 个。
   （Day 10 收尾追加：原来前两种情况完全静默，用户不知道发生了什么） */
function setCityHint(msg) {
  var el = document.getElementById('error-to-city');
  el.hidden = false;
  el.textContent = msg;
}

function addCity() {
  var input = document.getElementById('to-city-input');
  var name = input.value.trim();

  if (name === '') {
    setCityHint('先输入一个城市名，再点「添加」');
    input.focus();
    return;
  }

  if (selectedCities.indexOf(name) >= 0) {
    setCityHint('「' + name + '」已经在列表里了');
    input.value = '';
    input.focus();
    return;   // 已经加过了，不重复加
  }
  if (selectedCities.length >= 4) {
    setCityHint('最多 4 个城市，先去掉一个再加');
    return;
  }

  clearErrors();
  selectedCities.push(name);
  input.value = '';
  renderCityChips();
  input.focus();
}

/* ---------- D. 主流程：生成方案 ---------- */

function generate() {
  clearErrors();

  /* 注意力已经转到"生成"上了 —— 清空的确认条先收起来。
     否则上面挂着"确定清空吗"、下面开始算行程，看着很怪。
     （按回车也能触发 generate，所以放在这里最保险，
       不用给每个入口单独加。） */
  hideResetConfirm();

  /* 先把上次的结果收起来（回到"空"状态），避免"新输入 + 旧结果"混在一起看。
     注意：结果区本身【不再整体隐藏】—— 它现在一开始就可见，
     里面装着空状态；生成过程中换成转圈、生成完换成六块结果。 */
  showEmpty();

  var input = readInput();
  var errors = validateInput(input);

  if (Object.keys(errors).length > 0) {
    showErrors(errors);
    return;   // 有任何一项不过 → 不生成半成品（PRD F2）
  }

  /* 校验都过了才开始加载 + 干活。
     注意顺序很关键：加载态放在校验【之后】——
     要是先转圈再报错，用户会看到"圈转了一下又说输入不对"，很怪。 */
  var token = showLoading();
  runProgressBar();

  /* 给浏览器一帧时间把"转圈"画出来，再去跑同步计算。
     不这么做的话：计算是同步的，浏览器会等函数全部跑完才重绘，
     结果是"转圈根本没出现过"直接跳到结果。 */
  setTimeout(function () {
    if (!isCurrentRun(token)) { return; }   // 期间被清空或被新任务顶掉 → 作废
    doGenerate(input, token);
  }, 0);
}

/* 真正的计算 + 渲染。从 generate 里拆出来，就是为了让加载态能先画到屏幕上。 */
function doGenerate(input, token) {
  var startedAt = Date.now();

  var fromCity = input.fromCity.trim();
  input.fromCity = fromCity;

  // F2 固定顺序：校验 → 组合整体方案 → 排交通 → 算总账 → 比预算 → 出清单
  var plans = buildPlans(input);

  // 一套方案都算不出来（比如每套都撞上天数不够）→ 退回单套算法，如实报错
  if (plans.length === 0) {
    var single = splitDays(fromCity, input.cities, input.days);
    if (!single.ok) {
      // 出错了：收掉转圈和按钮锁，退回"空"状态 + 字段下方红字提示
      hideLoading();
      showEmpty();
      showErrors({ days: single.message });
      return;
    }
    // 理论上不会走到这里，保底用单套算法渲染
    plans = [{
      id: 'cheapest', name: '最省方案', tagline: '',
      legs: single.legs, split: single, cost: calcCost(single.legs, input.days),
      total: calcCost(single.legs, input.days).total,
      transitDays: single.transitDays, playableDays: single.playableDays
    }];
    plans[0].cost = calcCost(single.legs, input.days);
  }

  // 默认选中「最省方案」（口径与 PRD 验证算例一致）
  var defaultPlan = plans[0];
  for (var i = 0; i < plans.length; i++) {
    if (plans[i].id === 'cheapest') { defaultPlan = plans[i]; break; }
  }

  lastInput = input;
  lastPlans = plans;
  activePlanId = defaultPlan.id;

  var chosenKeys = [];
  for (var k = 0; k < defaultPlan.legs.length; k++) {
    chosenKeys.push(defaultPlan.legs[k].chosen.key);
  }

  var verdict = compareBudget(defaultPlan.cost, input.budget, defaultPlan.legs, {
    plan: defaultPlan.split.plan,
    totalDays: input.days,
    cheaperPlan: cheaperOf(plans, defaultPlan)
  });

  // 渲染六块
  renderPlans(plans, activePlanId);
  renderItinerary(defaultPlan.split, input);
  renderTransport(defaultPlan.split, chosenKeys);
  renderCost(defaultPlan.cost);
  renderBudget(verdict);
  renderHighlights(input.cities);

  /* 计算其实早就跑完了（本地计算是毫秒级）。
     但转圈不能"闪一下就没" —— 那样比不显示还难看。
     所以补足到 LOADING_MIN_MS 再揭晓结果。
     第 3 周接真实接口后，这里等待的就是真实网络耗时，逻辑不用改。 */
  var elapsed = Date.now() - startedAt;
  var wait = Math.max(0, LOADING_MIN_MS - elapsed);

  setTimeout(function () {
    /* 关键：如果这 400 毫秒里用户点了「清空重填」或又点了一次生成，
       我这个回调就过期了 —— 直接作废，绝不能把结果画到已经变干净的界面上。 */
    if (!isCurrentRun(token)) { return; }

    hideLoading();

    /* 切到「正常」状态：收掉空状态，六块错峰淡入。
       revealBlocks 内部会把六块逐个 hidden=false，所以这里不用再管结果区本身
       （结果区现在一直是可见的，切换的是里面哪一块可见）。 */
    document.getElementById('block-empty').hidden = true;
    revealBlocks();

    // 按顺序执行完，滚到结果那儿（否则用户不知道下面出东西了）
    // 加一层判断：极老的浏览器可能没有这个 API，不该因此让整个生成失败
    var resultArea = document.getElementById('result-area');
    if (resultArea.scrollIntoView) {
      resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, wait);
}

/* ---------- E. 加载中 / 空 / 正常 三种状态的切换 ----------
   项目里目前有四种页面状态：
     ① 正常   —— 六块结果都算出来了
     ② 加载中 —— 正在算的时候（本函数新加）
     ③ 空     —— 还没点过「生成方案」，结果区整个不显示
     ④ 错误   —— 输入不合格，字段下方红字提示（E1–E5）

   加载中为什么要做得这么"郑重"：
   现在全是本地计算，几十毫秒就完事，说实话看不出它的必要。
   但第 3 周一旦接真实接口，网络要等几百毫秒到几秒 ——
   那时要是没有加载状态，用户会以为页面卡死了，然后反复点按钮。
   所以现在先把这个"位置"留出来，将来只换数据来源，界面不用返工。 */

/* 结果区的六块。定义在这里（而不是函数内部），
   因为"加载时收起"、"加载完错峰淡入"两个地方都要用它。 */
var BLOCK_IDS = ['block-plans', 'block-itinerary', 'block-transport',
                 'block-cost', 'block-budget', 'block-highlights'];

/* 加载中至少显示多久。太短了转圈会"闪一下"，比不显示还难看。
   400 毫秒：短到不烦人，长到能看清。 */
var LOADING_MIN_MS = 400;

/* 本次任务的编号。
   为什么需要它 —— 加载是把揭晓动作放在 setTimeout 里的，
   如果用户在这 400 毫秒里点了"清空重填"、或者又点了一次生成，
   那个迟到的 setTimeout 照样会跑，把已经作废的结果画到屏幕上。
   编号对不上就自己作废，这是异步代码里最省事的"防迟到"手段。 */
var runToken = 0;

/* 把结果区里所有内容块收起来（六块结果 + 转圈 + 空状态）。
   三种状态互相切换时，第一步都是"先全部藏掉，再显示该显示的那个"，
   这样不会出现两个状态同时可见的中间态。 */
function hideAllBlocks() {
  BLOCK_IDS.forEach(function (id) {
    document.getElementById(id).hidden = true;
  });
  document.getElementById('block-loading').hidden = true;
  document.getElementById('block-empty').hidden = true;
}

/* 切到「空」状态：还没生成过、或者刚被清空 / 输入不合格。 */
function showEmpty() {
  hideAllBlocks();
  document.getElementById('result-area').hidden = false;
  document.getElementById('block-empty').hidden = false;
}

function showLoading() {
  runToken++;                 // 发一个本次任务的编号
  var myToken = runToken;

  var area = document.getElementById('result-area');
  area.hidden = false;

  // 六块结果 + 空状态全部收起来：转圈期间界面只留转圈，干净
  hideAllBlocks();
  document.getElementById('block-loading').hidden = false;

  // 按钮锁住：加载期间点不动，且文字改成"生成中…"
  var btn = document.getElementById('btn-generate');
  btn.disabled = true;
  // 只在按钮当前不是"生成中…"时才记原文案 ——
  // 否则连点时第二次会把"生成中…"记成原文案，以后就再也回不去了
  if (btn.textContent !== '生成中…') {
    btn.dataset.originalText = btn.textContent;
  }
  btn.textContent = '生成中…';

  // 把转圈那块滚进视野，否则用户不知道下面有动静
  var loadingCard = document.getElementById('block-loading');
  if (loadingCard.scrollIntoView) {
    loadingCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return myToken;             // 交回编号，后面用来判断"我还算不算数"
}

/* 判断某个任务是否还有效（期间没被清空 / 没被新任务顶掉） */
function isCurrentRun(token) {
  return token === runToken;
}

function hideLoading() {
  document.getElementById('block-loading').hidden = true;

  var btn = document.getElementById('btn-generate');
  btn.disabled = false;
  // 恢复按钮原文案（读回存在 dataset 里的，不写死字符串）
  if (btn.dataset.originalText) {
    btn.textContent = btn.dataset.originalText;
  }
}

/* 清空重填时调：把当前任务作废（让迟到的回调失效），收掉加载态，回到空状态 */
function cancelRunning() {
  runToken++;                 // 编号前进 → 所有在途任务全部作废
  hideLoading();
  showEmpty();
}

/* 六块结果错峰淡入。抽成函数是因为"加载完成后"和"切换方案时"都要用到。 */
function revealBlocks() {
  /* 每块比上一块晚 70 毫秒出现，看起来是"依次滑入"而不是"啪一下全冒出来"。
     用 CSS 动画（见 style.css 的 fade-up + .reveal 类），
     这里只负责把类加上、并清掉上一次的延迟，避免第二次生成时累积。 */
  BLOCK_IDS.forEach(function (id, i) {
    var el = document.getElementById(id);
    el.hidden = false;
    el.classList.remove('reveal');          // 先摘掉，才能重新触发动画
    el.style.animationDelay = '';           // 清掉上一次的延迟
    // 强制浏览器"重新计算一次样式"，否则连续两次生成时动画不会重播
    void el.offsetWidth;
    el.style.animationDelay = (i * 70) + 'ms';
    el.classList.add('reveal');
  });
}

/* ---------- E2. 清空确认（Day 10 新增） ---------- */

/* 为什么需要这两个函数：
   原来的「清空重填」是【一点就清、清完一个字都不说】——
   输入没了，用户自己加的地点（这部分还存在浏览器里）也一起没了，
   页面上却什么提示都没有。误点一下只能重填一遍。

   现在改成两步：点按钮 → 出现确认条 → 点「确定清空」才真清。
   注意这是【页面上的】一条，不是浏览器原生那种灰框弹窗：
   原生弹窗长得像操作系统、跟整个页面脱节，也装不下这句说明。 */

function showResetConfirm() {
  var bar = document.getElementById('confirm-reset');
  if (bar) { bar.hidden = false; }
  /* 焦点默认落在「取消」上。理由：这是"会删东西"的操作，
     闭着眼敲回车不该把数据删掉 —— 安全的那个选项才配当默认。 */
  var no = document.getElementById('btn-reset-no');
  if (no) { no.focus(); }
}

function hideResetConfirm() {
  var bar = document.getElementById('confirm-reset');
  if (bar) { bar.hidden = true; }
}

/* ---------- F. 初始化 ---------- */

function initApp() {
  document.getElementById('btn-generate').addEventListener('click', generate);
  document.getElementById('btn-add-city').addEventListener('click', addCity);

  // 城市输入框里按回车 = 点"添加"
  document.getElementById('to-city-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addCity(); }
  });

  // 天数、预算框里按回车 = 直接生成
  ['days', 'budget', 'from-city'].forEach(function (id) {
    document.getElementById(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); generate(); }
    });
  });

  /* 点「清空重填」→ 不再直接清，先问一句（Day 10 改动）。
     这一步只负责"把确认条亮出来"，真正清空在下面那个监听里。 */
  document.getElementById('btn-reset').addEventListener('click', function () {
    showResetConfirm();
  });

  /* 点「确定清空」→ 这次真清 */
  document.getElementById('btn-reset-yes').addEventListener('click', function () {
    document.getElementById('from-city').value = '';
    document.getElementById('to-city-input').value = '';
    document.getElementById('days').value = '';
    document.getElementById('budget').value = '';
    selectedCities = [];
    selfAdded = {};
    clearSelfAddedStorage();     // 本地存储也一起清掉
    lastPlans = null;
    lastInput = null;
    activePlanId = null;
    clearErrors();
    /* 万一是在"加载中"点的清空：转圈和按钮锁都要收掉，
       并且把在途的任务作废 —— 否则那个迟到的回调会把结果画到清空后的界面上。
       cancelRunning 内部已经会把结果区切回"空状态"。 */
    cancelRunning();
    renderCityChips();
    hideResetConfirm();
    document.getElementById('from-city').focus();
  });

  /* 点「取消」→ 收起来，什么都不动，焦点回到「清空重填」上 */
  document.getElementById('btn-reset-no').addEventListener('click', function () {
    hideResetConfirm();
    document.getElementById('btn-reset').focus();
  });

  /* 按 Esc 也能取消。正经产品都这样 ——
     不用让用户"必须把鼠标移回去点那个取消"。 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') { return; }
    var bar = document.getElementById('confirm-reset');
    if (bar && !bar.hidden) {
      hideResetConfirm();
      document.getElementById('btn-reset').focus();
    }
  });

  renderCityChips();

  // 读回上次存的自填地点（localStorage），这样刷新页面后自己加的地点还在
  loadSelfAdded();

  /* 一开始就显示"空状态"—— 打开页面就能看到"该怎么用"的引导，
     而不是往下翻一片空白。这也是"四种页面状态"里最容易漏掉的那个：
     空状态不是没有状态，它本身就是一种要给用户看的状态。 */
  showEmpty();

  // 主题按钮：注意它【不受"清空重填"影响】——
  // 主题是长期偏好，跟本次填的城市天数不是一回事，所以不放进上面那个 reset 里。
  initTheme();
}

// 注意：脚本用 defer 加载，执行时 DOM 已就绪，这里直接初始化即可
initApp();
