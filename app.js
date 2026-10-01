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
     nightOk ：该方式是否可能有过夜车次（可省一晚住宿）
     airportOnly ：只对"有机场的城市"出现（两头都得有机场）

   飞机构造：0.7 元/公里 + 90 元（机建燃油）。按经济舱全价算 ——
   学生党实际常能买到折扣票，但折扣不可预测，宁可算多不算少。
   时速按 700 算，但要加上两头奔机场、安检、候机的时间，所以另给
   AIRPORT_EXTRA_HOURS（见下），不能只按飞行时间。 */
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
  },
  plane: {
    key: 'plane', mode: '飞机',
    speed: 700, perKm: 0.70, fixed: 90,
    minKm: 800, maxKm: Infinity, nightOk: false,
    airportOnly: true,
    label: '长途最快；票价按全价估算，提前买常能便宜'
  }
};

/* 飞机两头都要有机场才列出来。
   这份清单只覆盖 CITY_COORDS 里的 24 城 —— 挑的是有民航客运机场的。
   （洛阳、开封这类没有民航机场的城市就不在里面，它们不会出飞机选项。）
   数据依据：各市是否有民航运输机场，属公开常识，不联网核实。 */
var AIRPORT_CITIES = {
  '北京': true, '上海': true, '广州': true, '深圳': true,
  '武汉': true, '成都': true, '重庆': true, '西安': true,
  '青岛': true, '杭州': true, '南京': true, '长沙': true,
  '郑州': true, '昆明': true, '贵阳': true, '南昌': true,
  '厦门': true, '兰州': true, '天津': true, '沈阳': true,
  '哈尔滨': true, '银川': true
  // 洛阳、开封：无民航客运机场
};

/* 坐飞机要多花的时间（小时）：往机场 + 安检 + 候机 + 落地后进城。
   不加这个的话，800 公里飞机只算 1.1 小时，比高铁还快得不真实 ——
   现实中两头折腾至少多花 3 小时。 */
var AIRPORT_EXTRA_HOURS = 3;

/* 两个城市是否都有机场（都满足才可能出飞机选项） */
function bothHaveAirport(fromCity, toCity) {
  return !!(AIRPORT_CITIES[fromCity] && AIRPORT_CITIES[toCity]);
}


/* ---------- 国内城市名单（用来判断"用户填的是不是国内城市"） ----------

   为什么需要这份名单：
     程序靠【经纬度】算两地距离，再拿距离推票价。而坐标表（CITY_COORDS）
     只覆盖 24 个城市 —— 用户填了表外的城市，程序算不出距离。
     以前的做法是"兜底给一个 5 小时 400 元"，也就是【凭空编一个数字】。
     碧儿测出来的问题就是这个：填「东京」照样出一份方案、报 800 块，
     页面上一句提示都没有 —— 用户会拿着这个数字去做决定。

   所以现在改成：填的城市不在【国内】就明确拦住，不再编数字。

   数据依据：公开的行政区划（34 个省级行政区 + 主要地级市 / 自治州 / 地区），
             属公开常识，不联网核实。
   口径：收地级市及以上（含自治州、盟、地区），不收县级市 —— 太多了，
         而且用户一般报的是地级市名。
   已知局限（待核实）：民政部会新设 / 撤并地级市，这份名单是按 2023 年口径整理的，
             将来可能有个别出入。漏掉时用户可以换个相近的大城市。 */
var CN_CITIES = {
  '北京': true, '天津': true, '上海': true, '重庆': true, '香港': true, '澳门': true, '石家庄': true, '唐山': true,
  '秦皇岛': true, '邯郸': true, '邢台': true, '保定': true, '张家口': true, '承德': true, '沧州': true, '廊坊': true,
  '衡水': true, '太原': true, '大同': true, '阳泉': true, '长治': true, '晋城': true, '朔州': true, '晋中': true,
  '运城': true, '忻州': true, '临汾': true, '吕梁': true, '呼和浩特': true, '包头': true, '乌海': true, '赤峰': true,
  '通辽': true, '鄂尔多斯': true, '呼伦贝尔': true, '巴彦淖尔': true, '乌兰察布': true, '兴安盟': true, '锡林郭勒盟': true, '阿拉善盟': true,
  '沈阳': true, '大连': true, '鞍山': true, '抚顺': true, '本溪': true, '丹东': true, '锦州': true, '营口': true,
  '阜新': true, '辽阳': true, '盘锦': true, '铁岭': true, '朝阳': true, '葫芦岛': true, '长春': true, '吉林': true,
  '四平': true, '辽源': true, '通化': true, '白山': true, '松原': true, '白城': true, '延边': true, '哈尔滨': true,
  '齐齐哈尔': true, '鸡西': true, '鹤岗': true, '双鸭山': true, '大庆': true, '伊春': true, '佳木斯': true, '七台河': true,
  '牡丹江': true, '黑河': true, '绥化': true, '大兴安岭': true, '南京': true, '无锡': true, '徐州': true, '常州': true,
  '苏州': true, '南通': true, '连云港': true, '淮安': true, '盐城': true, '扬州': true, '镇江': true, '泰州': true,
  '宿迁': true, '杭州': true, '宁波': true, '温州': true, '嘉兴': true, '湖州': true, '绍兴': true, '金华': true,
  '衢州': true, '舟山': true, '台州': true, '丽水': true, '合肥': true, '芜湖': true, '蚌埠': true, '淮南': true,
  '马鞍山': true, '淮北': true, '铜陵': true, '安庆': true, '黄山': true, '滁州': true, '阜阳': true, '宿州': true,
  '六安': true, '亳州': true, '池州': true, '宣城': true, '福州': true, '厦门': true, '莆田': true, '三明': true,
  '泉州': true, '漳州': true, '南平': true, '龙岩': true, '宁德': true, '南昌': true, '景德镇': true, '萍乡': true,
  '九江': true, '新余': true, '鹰潭': true, '赣州': true, '吉安': true, '宜春': true, '抚州': true, '上饶': true,
  '济南': true, '青岛': true, '淄博': true, '枣庄': true, '东营': true, '烟台': true, '潍坊': true, '济宁': true,
  '泰安': true, '威海': true, '日照': true, '临沂': true, '德州': true, '聊城': true, '滨州': true, '菏泽': true,
  '郑州': true, '开封': true, '洛阳': true, '平顶山': true, '安阳': true, '鹤壁': true, '新乡': true, '焦作': true,
  '濮阳': true, '许昌': true, '漯河': true, '三门峡': true, '南阳': true, '商丘': true, '信阳': true, '周口': true,
  '驻马店': true, '济源': true, '武汉': true, '黄石': true, '十堰': true, '宜昌': true, '襄阳': true, '鄂州': true,
  '荆门': true, '孝感': true, '荆州': true, '黄冈': true, '咸宁': true, '随州': true, '恩施': true, '仙桃': true,
  '潜江': true, '天门': true, '神农架': true, '长沙': true, '株洲': true, '湘潭': true, '衡阳': true, '邵阳': true,
  '岳阳': true, '常德': true, '张家界': true, '益阳': true, '郴州': true, '永州': true, '怀化': true, '娄底': true,
  '湘西': true, '广州': true, '韶关': true, '深圳': true, '珠海': true, '汕头': true, '佛山': true, '江门': true,
  '湛江': true, '茂名': true, '肇庆': true, '惠州': true, '梅州': true, '汕尾': true, '河源': true, '阳江': true,
  '清远': true, '东莞': true, '中山': true, '潮州': true, '揭阳': true, '云浮': true, '南宁': true, '柳州': true,
  '桂林': true, '梧州': true, '北海': true, '防城港': true, '钦州': true, '贵港': true, '玉林': true, '百色': true,
  '贺州': true, '河池': true, '来宾': true, '崇左': true, '海口': true, '三亚': true, '三沙': true, '儋州': true,
  '五指山': true, '琼海': true, '文昌': true, '万宁': true, '东方': true, '定安': true, '屯昌': true, '澄迈': true,
  '临高': true, '白沙': true, '昌江': true, '乐东': true, '陵水': true, '保亭': true, '琼中': true, '成都': true,
  '自贡': true, '攀枝花': true, '泸州': true, '德阳': true, '绵阳': true, '广元': true, '遂宁': true, '内江': true,
  '乐山': true, '南充': true, '眉山': true, '宜宾': true, '广安': true, '达州': true, '雅安': true, '巴中': true,
  '资阳': true, '阿坝': true, '甘孜': true, '凉山': true, '贵阳': true, '六盘水': true, '遵义': true, '安顺': true,
  '毕节': true, '铜仁': true, '黔西南': true, '黔东南': true, '黔南': true, '昆明': true, '曲靖': true, '玉溪': true,
  '保山': true, '昭通': true, '丽江': true, '普洱': true, '临沧': true, '楚雄': true, '红河': true, '文山': true,
  '西双版纳': true, '大理': true, '德宏': true, '怒江': true, '迪庆': true, '拉萨': true, '日喀则': true, '昌都': true,
  '林芝': true, '山南': true, '那曲': true, '阿里': true, '西安': true, '铜川': true, '宝鸡': true, '咸阳': true,
  '渭南': true, '延安': true, '汉中': true, '榆林': true, '安康': true, '商洛': true, '兰州': true, '嘉峪关': true,
  '金昌': true, '白银': true, '天水': true, '武威': true, '张掖': true, '平凉': true, '酒泉': true, '庆阳': true,
  '定西': true, '陇南': true, '临夏': true, '甘南': true, '西宁': true, '海东': true, '海北': true, '黄南': true,
  '海南州': true, '果洛': true, '玉树': true, '海西': true, '银川': true, '石嘴山': true, '吴忠': true, '固原': true,
  '中卫': true, '乌鲁木齐': true, '克拉玛依': true, '吐鲁番': true, '哈密': true, '昌吉': true, '博尔塔拉': true, '巴音郭楞': true,
  '阿克苏': true, '克孜勒苏': true, '喀什': true, '和田': true, '伊犁': true, '塔城': true, '阿勒泰': true, '石河子': true,
  '阿拉尔': true, '图木舒克': true, '五家渠': true, '北屯': true, '铁门关': true, '双河': true, '可克达拉': true, '昆玉': true,
  '胡杨河': true, '新星': true
};

/* 常见别名 / 俗称 → 正式城市名
   为什么要这个：用户可能打"魔都""蓉城"，这些不是正式名但意思很明确。
   只收流传最广的几个，不追求把俗称收全。 */
var CN_CITY_ALIAS = {
  '帝都': '北京', '魔都': '上海', '鹏城': '深圳', '羊城': '广州',
  '蓉城': '成都', '山城': '重庆', '春城': '昆明', '冰城': '哈尔滨',
  '姑苏': '苏州', '金陵': '南京', '维多利亚港': '香港'
};

/* 用户填的这串字是不是一个国内城市？
   判断顺序：① 空 → 交给 E1 那条规则去管，这里不管
             ② 别名 → 换成正式名再看
             ③ 在 CN_CITIES 里 → 是
   ⚠️ 这个函数只回答"是不是"，不管"有没有坐标"。国内小城可能没坐标
      （坐标表只有 24 城），那种情况由 estimateTransport 去标注"估算"。 */
function isKnownChineseCity(name) {
  if (!name) return false;
  var n = String(name).trim();
  if (n === '') return false;
  if (CN_CITY_ALIAS[n]) n = CN_CITY_ALIAS[n];
  return !!CN_CITIES[n];
}

/* 别名/城市名 → 正式城市名（查坐标、查清单都要用正式名） */
function normalizeCityName(name) {
  if (!name) return '';
  var n = String(name).trim();
  if (n === '') return '';
  return CN_CITY_ALIAS[n] || n;
}

/* 「这个城市不支持」那句话 —— 只写一遍（Day 16）。
   为什么要抽出来：同一个意思现在要在【三个地方】说 ——
     ① 点「添加」时（输入区红字）
     ② 离开「出发城市」输入框时（输入区红字）
     ③ 兜底：点「生成方案」时（万一前面两条被绕过）
   要是三处各写一遍，将来改口径（比如支持范围变了）必有漏改的。
   所以：文案只在这里定义，别处一律调这个函数拿。 */
function unsupportedCityMessage(name) {
  return '「' + String(name).trim() + '」暂时不支持。' +
    '目前只能规划国内城市，比如：北京、上海、广州、成都、重庆、西安。';
}

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

  /* 坐标表里没有的城市（Day 14 用户反馈后改动）
     ——以前这里直接返回"高铁 5 小时 400 元"，也就是【凭空编一个数字】。
     碧儿测出来的问题正是这个：填「东京」报 800 块，一句提示都没有，
     用户会当真。现在改了：
       · 境外城市已经被 E6 在校验阶段拦住，走不到这里；
       · 能走到这里的只有【国内但没坐标】的城市（乌鲁木齐、三亚、桂林…）；
       · 不再假装"算出来了"，而是给一个明确标注的估算基准价，
         并且沿途一路带着 estimated 标记，最后显示在页面上和账本里。
     为什么还留一个选项（而不是返回空数组）：下游有十几处用 options[0]
     取"最快的那段"来算是否占用整天（≥6 小时）。返回空数组会让那些地方
     全部读到 undefined 然后崩掉。所以保留一项，但如实标成估算。 */
  if (!a || !b) {
    return {
      known: false,
      estimateNote: '该城市暂无距离数据，以下按「同省或邻省中长途」估算',
      options: [
        { key: 'highspeed', mode: '高铁', hours: 5, price: 400,
          estimated: true,
          label: '估算值，仅供参考（暂无该城市数据）' }
      ]
    };
  }

  var km = distanceKm(a, b) * RAIL_DETOUR;   // 换算成公路/铁路里程（估算）

  var canFly = bothHaveAirport(fromCity, toCity);

  var options = [];
  Object.keys(TRANSPORT_MODES).forEach(function (k) {
    var t = TRANSPORT_MODES[k];

    // 超出这种方式适合的距离范围 → 不列
    if (km < t.minKm || km > t.maxKm) return;

    // 飞机要求两头都有机场 → 不满足就不列
    if (t.airportOnly && !canFly) return;

    var hours = Math.max(0.5, km / t.speed);
    // 飞机要另加两头折腾的时间（奔机场 + 安检 + 候机 + 落地进城）
    if (t.airportOnly) hours += AIRPORT_EXTRA_HOURS;

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
        （含【返程】那一段：玩完要回家，回家的路一样占时间）
     3. 可用于游玩的天数 < 城市数 → 报错 E4
     4. 平均分配；余数按城市顺序从前到后各加 1 天
     5. 占 1 整天的交通段单独成行，写「在途：A → B」
   路线：出发地 → 城市1 → … → 城市N → 【回出发地】
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

  // 最后一段：从最后一个城市回家（返程）。
  // 不带这段的话，用户按单程预算出门，回来一定要超支。
  var backEst = estimateTransport(prev, fromCity);
  var backFastest = backEst.options[0];
  var backOccupies = backFastest.hours >= 6 ? 1 : 0;
  transitDays += backOccupies;

  legs.push({
    from: prev,
    to: fromCity,
    estimate: backEst,
    occupiesWholeDay: backOccupies === 1,
    isReturn: true
  });

  var playableDays = totalDays - transitDays;

  // 校验：可用于游玩的天数不足
  if (playableDays < cities.length) {
    return {
      ok: false,
      errorCode: 'E4',
      message: '去 ' + cities.length + ' 个城市，路上至少要占 ' + transitDays +
               ' 天（含返程），只剩 ' + Math.max(0, playableDays) + ' 天可玩，不够分。' +
               '请增加天数或减少城市'
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
   ★ 注意：pickKeys 的长度 = 城市数 + 1（最后一个是返程那段）。
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

  // 返程段：从最后一个城市回出发地（pickKeys 的最后一位是它）
  var backLeg = { from: prev, to: fromCity, estimate: estimateTransport(prev, fromCity) };
  var backKey = pickKeys[cities.length];
  var backChosen;
  if (backKey === 'cheapest') {
    backChosen = cheapestOption(backLeg);
  } else {
    backChosen = pickOption(backLeg, backKey);
  }
  backLeg.chosen = backChosen;
  var backOccupies = backChosen.hours >= 6 ? 1 : 0;
  backLeg.occupiesWholeDay = backOccupies === 1;
  backLeg.chosenWholeDay = backOccupies === 1;
  backLeg.isReturn = true;
  transitDays += backOccupies;
  legs.push(backLeg);

  var playableDays = totalDays - transitDays;
  if (playableDays < cities.length) {
    return { ok: false, errorCode: 'E4', legs: legs, transitDays: transitDays,
             playableDays: playableDays,
             message: '去 ' + cities.length + ' 个城市，路上至少要占 ' + transitDays +
                      ' 天（含返程），只剩 ' + Math.max(0, playableDays) + ' 天可玩，不够分。' +
                      '请增加天数或减少城市' };
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
  var estimatedLegs = 0;   // 有几段用的是"没有数据、只能估"的票价（Day 14 加）

  for (var i = 0; i < legs.length; i++) {
    // 这套方案在这一段选了哪种方式，就用它的票价
    var leg = legs[i];
    var chosen = leg.chosen || leg.estimate.options[0];
    intercity += chosen.price;
    if (chosen.estimated) estimatedLegs++;
  }

  var cityTransfer = PRICES.cityTransferPerDay * totalDays;
  var hotel        = PRICES.hotelPerNight * Math.max(0, totalDays - 1);
  var food         = PRICES.foodPerDay * totalDays;
  var ticket       = PRICES.ticketPerDay * totalDays;

  var total = intercity + cityTransfer + hotel + food + ticket;

  /* 城际交通这一行的口径说明。
     为什么要在个别城市没数据时特别写出来：合计里混着估算的钱，
     不说清的话用户会以为整笔都是算准的（AGENTS.md 8.7 第 4 条：
     页面上凡是估算的数字，必须显示"估算值，仅供参考"）。 */
  var intercityDetail = '本方案各段所选交通方式的票价合计';
  if (estimatedLegs > 0) {
    intercityDetail += '（含 ' + estimatedLegs + ' 段估算值，仅供参考）';
  }

  return {
    items: [
      { key: 'intercity',    label: '城际交通', detail: intercityDetail, amount: intercity },
      { key: 'cityTransfer', label: '市内交通', detail: PRICES.cityTransferPerDay + ' 元/天 × ' + totalDays + ' 天', amount: cityTransfer },
      { key: 'hotel',        label: '住宿',     detail: PRICES.hotelPerNight + ' 元/晚 × ' + Math.max(0, totalDays - 1) + ' 晚', amount: hotel },
      { key: 'food',         label: '吃',       detail: PRICES.foodPerDay + ' 元/天 × ' + totalDays + ' 天', amount: food },
      { key: 'ticket',       label: '门票',     detail: PRICES.ticketPerDay + ' 元/天 × ' + totalDays + ' 天', amount: ticket }
    ],
    total: total,
    hasEstimate: estimatedLegs > 0
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
  // pickKeys 比城市数多一位 —— 最后那位是【返程段】
  var cheapKeys = [];
  for (var i = 0; i <= cities.length; i++) cheapKeys.push('cheapest');
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
  // 去程各段
  for (var k = 0; k < cities.length; k++) {
    var probeLeg = { from: prev, to: cities[k], estimate: estimateTransport(prev, cities[k]) };
    var chosen = bestValueOption(probeLeg);
    valueKeys.push(chosen.key);
    valueLegsProbe.push(probeLeg);
    prev = cities[k];
  }
  // 返程段：跟去程同一套性价比逻辑
  var backProbeLeg = { from: prev, to: fromCity, estimate: estimateTransport(prev, fromCity) };
  var backChosenProbe = bestValueOption(backProbeLeg);
  valueKeys.push(backChosenProbe.key);
  valueLegsProbe.push(backProbeLeg);

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

  /* E6 填的不是国内城市（Day 14 用户反馈后新加）
     为什么加这条：以前填「东京」也照样出一份方案、报 800 块交通费 ——
     因为程序算不出距离时会给一个兜底的"5 小时 400 元"。
     那个数字是编的，用户却看不出，会当真。现在改成直接拦住、说清楚。
     放在 E2 之后：得先有城市，才谈得上"这个城市认不认识"。
     出发地和目的地都要查 —— 出发地填「东京」同样算不出距离。 */
  if (!errors.fromCity && input.fromCity && !isKnownChineseCity(input.fromCity)) {
    errors.fromCity = unsupportedCityMessage(input.fromCity);
  }
  if (!errors.cities && input.cities && input.cities.length > 0) {
    var unknown = [];
    for (var ci = 0; ci < input.cities.length; ci++) {
      if (!isKnownChineseCity(input.cities[ci])) {
        unknown.push(String(input.cities[ci]).trim());
      }
    }
    if (unknown.length > 0) {
      errors.cities = unsupportedCityMessage(unknown.join('」「'));
    }
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

  /* 城市名在这里就【统一成正式名】（Day 14 加）。
     为什么放在这一个地方：用户可能打俗称（"魔都"），而后面算距离、
     查内置清单用的都是正式名（"上海"）。要是在每个用到的地方各自转换，
     迟早漏一处。读输入时转一次，后面全拿到正式名。
     normalizeCityName 只做"别名 → 正式名"，不做别的判断。 */
  var cities = [];
  for (var i = 0; i < selectedCities.length; i++) {
    cities.push(normalizeCityName(selectedCities[i]));
  }

  return {
    fromCity: normalizeCityName(document.getElementById('from-city').value),
    cities: cities,
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

  /* Day 13：除了字段旁边的红字，再在结果区给一张会说话的卡片。
     两个各管一头 —— 红字贴着输入框（改起来近），
     卡片管"错误这个状态本身要有个看得见的样子"。
     这里把 errors 转成 [{label, message}] 交给 showError。 */
  var labels = {
    fromCity: '出发城市',
    cities:   '想去的城市',
    days:     '玩几天',
    budget:   '总预算'
  };
  var items = Object.keys(errors).map(function (key) {
    return { label: labels[key] || key, message: errors[key] };
  });
  showError(items);
}

/* ---------- B. 渲染 ---------- */

/* B1-b 「当天大致安排」这一格怎么画（Day 15 新增）

   同一个单元格有两种模样，靠 editingRowKey 决定画哪种：
     · 只读态：文字 + （用户改过就显示「已改」）+「编辑」按钮
     · 编辑态：每条安排一个输入框，各带 上移/下移/删除；底部「加一条」；「完成」「取消」

   为什么"编辑"入口做成一格的按钮、而不是让用户直接点文字改：
     · 直接点文字就改（contenteditable）在手机上很容易误触 ——
       用户想滚动页面，手指一划就进了编辑状态，还弹出键盘。
     · 这个项目的行里本来就有「展开看这 N 条」按钮，再加一个按钮最自然。
     · 编辑态里能塞下"改安排不会改动花费"这句说明；直接可编辑的话没地方放。 */
function renderDetailCell(td, row) {
  var key = rowKeyOf(row);
  var editing = (editingRowKey === key);
  var items = itemsForRow(row);

  /* ⚠️ 这里【不能】去操作 tr（td.parentNode）：此刻这个 td 还没被 append 到 tr 上，
     parentNode 是 null，"给整行加底色"的样式挂不上（Day 15 踩过，表现是
     编辑态开出来了、但行底色没变）。
     整行的类统一由 renderItinerary 在 append 之后挂。 */

  /* ---------- 在途行：不给编辑入口 ----------
     在途只可能是"全天在路上（普速 约 11.7 小时）"这一句，
     它由算法算出来的，改它没有意义（改完也算不出别的路）。
     给一个点了没用的按钮，比不给更差。 */
  if (row.type === 'transit') {
    var t = document.createElement('span');
    t.className = 'row-detail';
    t.textContent = items.length > 0 ? items[0] : '全天在路上';
    td.appendChild(t);
    return;
  }

  if (editing) {
    renderDetailEditor(td, row, items);
    return;
  }

  /* ---------- 只读态 ---------- */
  if (items.length === 0) {
    var empty = document.createElement('span');
    empty.className = 'row-detail row-detail-empty';
    empty.textContent = hasPlanHint(row.label)
      ? '这天还没安排（内置建议已排完，点「编辑」可以自己加）'
      : '这天还没安排（该城市暂无内置建议，点「编辑」可以自己加）';
    td.appendChild(empty);
  } else {
    /* 正文外面套一个块级 span（Day 11）：
       这样后面那个展开按钮会自己换到下一行，不用在 JS 里塞 <br>。 */
    var detailText = document.createElement('span');
    detailText.className = 'row-detail';
    /* 「到达 + 」前缀：只在"这座城市的第一天"加上，而且是渲染时临时加的 ——
       不写进 items 里。为什么：用户编辑时看到一串内容，若前缀也在里面，
       他会以为那是自己内容的一部分，删了就再也回不来。 */
    var body = items.join('；');
    if (isFirstDayOfCity(row)) { body = '到达 + ' + body; }
    detailText.textContent = body;
    td.appendChild(detailText);
  }

  // 用户改过的标记：让他一眼看出"这行不是 AI 原来的建议"
  if (isRowEdited(row)) {
    var badge = document.createElement('span');
    badge.className = 'edited-badge';
    badge.textContent = '已改';
    badge.title = '这一天的安排你改过';
    td.appendChild(badge);
  }

  // 「编辑」按钮
  var editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'edit-btn';
  editBtn.setAttribute('aria-label', row.label + ' 第 ' + (row.cityDayIndex + 1) + ' 天的安排，进入编辑');
  editBtn.textContent = '编辑';
  editBtn.addEventListener('click', function () {
    /* ⚠️ 顺序不能反：editDraft 必须先算好，再设 editingRowKey。
       反过来的话，itemsForRow 会走"编辑态"那条分支去读草稿，
       而此刻草稿还是上一次的（或 null），拷进来的就是错的东西。 */
    editDraft = itemsForRow(row);
    editingRowKey = key;
    repaintItinerary();
    /* 把焦点送进第一个输入框 —— 键盘用户点了编辑就能直接打字，
       不用再 Tab 一圈找输入框。 */
    var tbody = document.getElementById('table-itinerary').querySelector('tbody');
    var tr = tbody.querySelector('tr[data-row-key="' + cssEscape(key) + '"]');
    if (tr) {
      var first = tr.querySelector('.edit-input');
      if (first) { first.focus(); }
    }
  });
  td.appendChild(editBtn);
}

/* 判断这一行是不是"该城市的第一天"（用来决定要不要加「到达 + 」）
   只看 row.cityDayIndex 就够了 —— 同一城市的天是连续的、从 0 开始。
   ⚠️ 别拿"整张表第几行"来判：在途行夹在中间，两种编号根本对不上。 */
function isFirstDayOfCity(row) {
  return row.cityDayIndex === 0;
}

/* 画编辑态（Day 15） */
function renderDetailEditor(td, row, items) {
  var key = rowKeyOf(row);

  var wrap = document.createElement('div');
  wrap.className = 'edit-list';
  wrap.setAttribute('data-edit-key', key);

  // 顶部说明：为什么改安排不动花费（对应 ②A 的选择）
  var tip = document.createElement('p');
  tip.className = 'edit-tip';
  tip.textContent = '改这里只改安排内容；当天的花费是按时天固定标准估的，不会跟着变。';
  wrap.appendChild(tip);

  for (var i = 0; i < items.length; i++) {
    wrap.appendChild(buildEditRow(row, items, i));
  }

  // 空的时候给一句，别让用户面对一片空白
  if (items.length === 0) {
    var none = document.createElement('p');
    none.className = 'edit-empty';
    none.textContent = '这一天还没有安排，点下面的「加一条」自己加。';
    wrap.appendChild(none);
  }

  // 「加一条」
  var addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-quiet edit-add';
  addBtn.textContent = '+ 加一条';
  /* 「加一条」= 往草稿里塞一条空的 + 重画。
     ⚠️ 这里【不碰存档】。若写进存档，用户随后点「取消」就取消不掉了 ——
        存档已经被污染，而「取消」的语义是"这次编辑整个不要了"（Day 15 踩过）。
     另外要先把输入框里已有的字读回草稿：用户可能改了几个字还没提交，
        不读回来的话这次重画会把那些改动冲掉。 */
  addBtn.addEventListener('click', function () {
    var cur = readEditorItems(row);
    cur.push('');
    editDraft = cur;
    repaintItinerary();
  });
  wrap.appendChild(addBtn);

  // 底部：完成 / 取消
  var actions = document.createElement('div');
  actions.className = 'edit-actions';

  var doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn btn-primary';
  doneBtn.textContent = '完成';
  /* 「完成」= 把草稿落进存档（顺便把空条目过滤掉），退出编辑态。
     这里是【唯一】写存档的地方 —— 进来之后所有动作都只改草稿。 */
  doneBtn.addEventListener('click', function () {
    commitRowEdit(row, readEditorItems(row));
  });

  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-quiet';
  cancelBtn.textContent = '取消';
  /* 「取消」= 丢掉草稿、退出编辑态。存档一个字节都没动过，
     所以重画之后自然就回到"进来之前"的样子。
     （正因为编辑期间从不写存档，这里才能这么简单。） */
  cancelBtn.addEventListener('click', function () {
    editingRowKey = null;
    editDraft = null;
    repaintItinerary();
  });

  actions.appendChild(doneBtn);
  actions.appendChild(cancelBtn);
  wrap.appendChild(actions);

  td.appendChild(wrap);
}

/* 编辑态里的一行：输入框 + 上移 / 下移 / 删除 */
function buildEditRow(row, items, i) {
  var line = document.createElement('div');
  line.className = 'edit-line';

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.value = items[i];
  input.setAttribute('aria-label', '第 ' + (i + 1) + ' 条安排');
  line.appendChild(input);

  var tools = document.createElement('div');
  tools.className = 'edit-tools';

  // 上移（第一条不给 —— 给了也没用，禁用比隐藏更能说明"到头了"）
  var up = document.createElement('button');
  up.type = 'button';
  up.className = 'edit-mini';
  up.textContent = '↑';
  up.setAttribute('aria-label', '第 ' + (i + 1) + ' 条上移');
  up.disabled = (i === 0);
  up.addEventListener('click', function () {
    var cur = readEditorItems(row);
    swapItem(cur, i, i - 1);
    editDraft = cur;
    repaintItinerary();
  });

  var down = document.createElement('button');
  down.type = 'button';
  down.className = 'edit-mini';
  down.textContent = '↓';
  down.setAttribute('aria-label', '第 ' + (i + 1) + ' 条下移');
  down.disabled = (i === items.length - 1);
  down.addEventListener('click', function () {
    var cur = readEditorItems(row);
    swapItem(cur, i, i + 1);
    editDraft = cur;
    repaintItinerary();
  });

  var del = document.createElement('button');
  del.type = 'button';
  del.className = 'edit-mini edit-del';
  del.textContent = '×';
  del.setAttribute('aria-label', '删掉第 ' + (i + 1) + ' 条');
  del.addEventListener('click', function () {
    var cur = readEditorItems(row);
    cur.splice(i, 1);
    editDraft = cur;
    repaintItinerary();
  });

  tools.appendChild(up);
  tools.appendChild(down);
  tools.appendChild(del);
  line.appendChild(tools);

  return line;
}

function swapItem(arr, a, b) {
  if (a < 0 || b < 0 || a >= arr.length || b >= arr.length) { return; }
  var tmp = arr[a]; arr[a] = arr[b]; arr[b] = tmp;
}

/* 把编辑框里的内容读出来（要读 DOM 而不是闭包 —— 闭包在重画后会指错行） */
function readEditorItems(row) {
  var out = [];
  var tbody = document.getElementById('table-itinerary').querySelector('tbody');
  var tr = tbody.querySelector('tr[data-row-key="' + cssEscape(rowKeyOf(row)) + '"]');
  if (!tr) { return itemsForRow(row); }
  var inputs = tr.querySelectorAll('.edit-input');
  for (var i = 0; i < inputs.length; i++) { out.push(inputs[i].value); }
  return out;
}

/* 【唯一】往存档里写的地方：点「完成」时调这个（Day 15）
   编辑期间的所有动作都只改草稿、不碰存档 —— 这样「取消」才有东西可取消。

   为什么要过滤空白条目：用户点开编辑、又不想加东西，会留下空输入框，
   若原样存下来，只读态会看到"；；"这种空条。
   过滤在【存之前】做，这样"存进存档的东西"永远是可以直接显示的。 */
function commitRowEdit(row, items) {
  var key = rowKeyOf(row);

  var cleaned = items.filter(function (s) { return String(s).trim() !== ''; })
                     .map(function (s) { return String(s).trim(); });

  itineraryEdits[key] = { items: cleaned, dirty: true };
  saveItineraryEdits();

  editingRowKey = null;   // 退出编辑态
  editDraft = null;
  repaintItinerary();
}

/* 只重画行程表那一块（不重新算、不动其他块）。
   为什么单独抽出来：编辑态里的每次增删改都只需要刷新这一张表，
   走一遍完整 generate 会重新校验、重新算钱、还会闪一下加载态 —— 太重。 */
function repaintItinerary() {
  if (!lastInput || !lastPlans) { return; }
  var plan = null;
  for (var i = 0; i < lastPlans.length; i++) {
    if (lastPlans[i].id === activePlanId) { plan = lastPlans[i]; }
  }
  if (!plan) { plan = lastPlans[0]; }
  renderItinerary(plan.split, lastInput);
}

/* 把 key 安全地放进 CSS 属性选择器里。
   为什么要转义：key 里带城市名（c:成都:0），还带 > （t:武汉>成都），
   直接拼进 [data-row-key="..."] 里，某些字符会让选择器解析失败。 */
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) { return CSS.escape(s); }
  return String(s).replace(/["\\\]]/g, '\\$&');
}

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

  /* Day 15：重画之前先记下"这次一共有哪些行"，画完再回头核对。
     为什么要核对：editingRowKey 可能指向【已经不存在的行】——
     比如用户正编辑"成都第 3 天"，此时改了天数、或切了方案，
     就没有"成都第 3 天"这一行了。
     若不处理，renderDetailCell 里 `editingRowKey === key` 永远不成立，
     用户再也进不去编辑态：点「编辑」没反应，还不报错（查起来很费劲）。

     ⚠️ 不能在这里直接 `editingRowKey = null` —— 那会把"点编辑"本身也一起干掉：
        点「编辑」的动作就是【先设 editingRowKey、再重画】，
        一进来就清掉，编辑态永远打不开（这个错真犯过一次）。
        所以只能"画完之后按结果核对"，不能"开工前一律清空"。 */
  var liveKeys = {};

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
        // 在途行的内容也当"一条"存，好让整套数据结构一致
        items: ['全天在路上（' + chosen.mode + ' 约 ' + chosen.hours + ' 小时）'],
        cost: 0
      });
    }

    // 这个城市待几天，就补几行
    var cityDays = 0;
    for (var k = 0; k < split.plan.length; k++) {
      if (split.plan[k].city === leg.to) { cityDays = split.plan[k].days; break; }
    }

    // ⚠️ 返程段的"目的地"是出发地，不是要游玩的城市 —— 直接跳过补天数那一段。
    //    不能只靠"plan 里查不到"来兜底：万一用户把出发地也填成想去的城市，
    //    返程段就会被当成"又去了一趟出发地"而多出游玩行（对应 AC6 行数校验）。
    if (leg.isReturn) { cityDays = 0; }

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

      /* Day 15：这里不再拼成一个字符串，而是留一份【条目数组】items。
         为什么必须拆开：用户要"自行增删改"每一条安排，
         一个拼好的字符串（"宽窄巷子；熊猫基地"）没法单独删掉其中一条。
         注意两个东西【不进 items】，它们是渲染时临时加的外观：
           · "到达 + " 前缀   → 渲染时按"是不是这座城市的第一天"决定加不加
           · "这天还没安排…"  → items 为空时的占位文案
         让它们留在 items 里的话，用户会以为自己填的内容里真带着这几个字。 */
      var items = slice.map(function (x) { return x.text; });

      // 最后一天：如果内容没排完，如实告诉用户"还剩几条没排进去"
      //   为什么必须说：用户自己加的地点若因为天数不够被吞掉，他会以为"加了没用"
      // 最后一天：如果内容没排完，把"没排上的那几条"挂在这一行上（Day 11 改成可展开）
      //   为什么从"一句话"改成"可展开"：
      //     原来只报个数（"还有 2 条建议没排下"），用户知道有东西被扔了、
      //     却看不到被扔的是什么 —— 等于程序算完又藏起来。
      //     展开能看见具体是哪几条，这句话才算说完。
      var more = null;
      if (d === cityDays - 1) {
        var rest = pool.slice(cityDays * perDay);
        if (rest.length > 0) {
          more = {
            count: rest.length,
            reason: city + '只待 ' + cityDays + ' 天，加天数就能都排上',
            items: rest.map(function (x) { return x.text; })
          };
        }
      }

      rows.push({
        type: 'city',
        label: city,
        // 这一行是这座城市待的第几天（从 0 数）—— 算稳定 key 要用，Day 15
        cityDayIndex: d,
        cityDays: cityDays,
        // 可编辑的内容本身
        items: items,
        // 这一行"没排下的建议"（Day 11）：没有就是 null，渲染时也就不出展开按钮
        more: more,
        // 当天花费：市内交通 + 吃 + 门票（住宿不按天摊，它按"晚"单独算）
        //   注意：这里【不含】自填地点的花费，避免和"门票"那一项重复计算
        //   ⚠️ Day 15：这个数是【固定公式】算的，跟上面 items 写了什么无关。
        //      用户改行程不会改动它 —— 界面上要写清这一点，否则用户会以为
        //      把"熊猫基地"改成"迪士尼"门票就变了。
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
    if (isRowEdited(row)) tr.classList.add('row-edited');
    // 正在编辑的这一行：整行加底色，让用户一眼看出"改的是哪一天"
    if (editingRowKey === rowKeyOf(row)) tr.classList.add('is-editing');
    // 把"行 key"存到 DOM 上（Day 15）：编辑按钮不用闭包变量认行，
    //   靠 data-row-key 找回自己那一行 —— 重画后闭包会指错，这个坑踩过两次。
    tr.setAttribute('data-row-key', rowKeyOf(row));
    liveKeys[rowKeyOf(row)] = true;

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
    /* Day 15：详情单元格整个交给一个函数去画 ——
       因为它在"两种模样"之间切换（只读 / 编辑），还要能原地重画自己。
       写在循环里会让这段越来越长，抽出去更好读。 */
    renderDetailCell(td3, row);

    /* 这一天"没排下的建议"：默认藏起来，点一下才看（Day 11）
       反馈设计说明：
         - 按钮上的字从「展开看这 N 条」变成「收起」 → 这是最明确的一档反馈
           （状态文字变了）。文字会一直留在那儿，用户不用盯着看也漏不掉。
         - 箭头转 180°、列表淡入               → 只是陪衬，让人"觉得顺"，
           不靠它传达信息（动效眨眼就过，是最弱的一档）。
       为什么按钮里先放两个 span 再往里填字：
         回调里要改的只有文字那一段，用 span 精确定位比重新拼一遍按钮内容稳。 */
    if (row.more) {
      var moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'more-btn';
      moreBtn.setAttribute('aria-expanded', 'false');

      var moreTxt = document.createElement('span');
      moreTxt.className = 'more-txt';
      moreTxt.textContent = '展开看这 ' + row.more.count + ' 条';

      var moreArrow = document.createElement('span');
      moreArrow.className = 'more-arrow';
      moreArrow.setAttribute('aria-hidden', 'true');
      moreArrow.textContent = '▾';

      moreBtn.appendChild(moreTxt);
      moreBtn.appendChild(moreArrow);

      var moreList = document.createElement('ul');
      moreList.className = 'more-list';
      moreList.hidden = true;
      for (var q = 0; q < row.more.items.length; q++) {
        var moreLi = document.createElement('li');
        moreLi.textContent = row.more.items[q];
        moreList.appendChild(moreLi);
      }

      var moreWhy = document.createElement('p');
      moreWhy.className = 'more-why';
      moreWhy.hidden = true;
      moreWhy.textContent = row.more.reason;

      /* 点击切换：只认"自己这一组"（按钮 + 它后面那个列表和说明）。
         所以从按钮本身去找兄弟节点，不用闭包变量 —— 闭包变量在重渲染后会指错行，
         Day 7 做删除按钮时就踩过这个坑（当时改用 data-* 存身份解决）。 */
      moreBtn.addEventListener('click', function (ev) {
        var btn = ev.currentTarget;
        var list = btn.parentNode.querySelector('.more-list');
        var why = btn.parentNode.querySelector('.more-why');
        var txt = btn.querySelector('.more-txt');
        var willOpen = list.hidden;

        list.hidden = !willOpen;
        why.hidden = !willOpen;
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        btn.classList.toggle('is-open', willOpen);
        txt.textContent = willOpen ? '收起' : '展开看这 ' + list.children.length + ' 条';
      });

      td3.appendChild(moreBtn);
      td3.appendChild(moreList);
      td3.appendChild(moreWhy);
    }

    var td4 = document.createElement('td');
    td4.className = 'num';
    td4.textContent = row.cost > 0 ? ('约 ' + row.cost + ' 元') : '—';

    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
    tbody.appendChild(tr);
  }

  /* 画完了，回头核对"正在编辑的那一行"还在不在（见函数开头那段说明）。
     不在 → 作废，免得 editingRowKey 卡在一个永远匹配不上的 key 上。
     在 → 原样留着，编辑态自然是开着的。
     ⚠️ 草稿要一起清掉：留在那儿的草稿是【上一批数据】的，一旦以后
        又匹配上同名 key（比如又出现了 c:成都:0），用户点开会看到
        旧草稿的内容 —— 那是错的内容，比没有更糟。 */
  if (editingRowKey !== null && !liveKeys[editingRowKey]) {
    editingRowKey = null;
    editDraft = null;
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
    // 返程段单独称呼，别叫「第 N 段」—— 它是"回家"，性质不一样
    /* 括号里的距离：只有算得出距离时才写。
       没有坐标数据的城市，estimate.km 是 undefined ——
       以前这里会直接拼出「约 undefined 公里」漏到页面上（Day 14 修）。 */
    var kmTxt = (typeof leg.estimate.km === 'number')
      ? '（约 ' + leg.estimate.km + ' 公里）'
      : '（距离未知，按估算值）';
    headTd.textContent = (leg.isReturn ? '返程：' : '第 ' + (i + 1) + ' 段：') +
      leg.from + ' → ' + leg.to + kmTxt;
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
      /* 有坐标数据 → 直接给数字；没有 → 数字后面加个标记。
         为什么加了标记还要给数字：完全不给数字，下面的账本和"是否占整天"
         就没法算了。给数字但说清它是估的，比假装算准了诚实。 */
      td4.textContent = o.estimated
        ? ('约 ' + o.price + ' 元 *')
        : ('约 ' + o.price + ' 元');

      var td5 = document.createElement('td');
      td5.textContent = o.label;

      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tr.appendChild(td4); tr.appendChild(td5);
      tbody.appendChild(tr);
    }

    // 每段下面必须有一句"时间 vs 花费"的结论（AC7）
    var note = document.createElement('p');
    note.className = 'seg-note';

    /* 这一段有没有"没数据、只能估"的情况（Day 14 加）。
       有的话，结论句后面再补一句，说明这个数字是怎么来的。 */
    var hasEstimate = false;
    for (var q = 0; q < opts.length; q++) {
      if (opts[q].estimated) { hasEstimate = true; break; }
    }

    if (fastest !== cheapest) {
      var saveMoney = fastest.price - cheapest.price;
      var saveTime = round1(cheapest.hours - fastest.hours);
      note.textContent = (leg.isReturn ? '回程这段坐' : '这段坐') + fastest.mode +
        '最快（' + fastest.hours +
        ' 小时、约 ¥' + fastest.price + '）；改坐' + cheapest.mode + '能省约 ¥' +
        saveMoney + '，但要多花约 ' + saveTime + ' 小时。' +
        (leg.occupiesWholeDay ? '这段耗时较长，整天在路上，行程里已单独占一天。' : '');
    } else {
      note.textContent = (leg.isReturn ? '回程这段只有' : '这段只有') + fastest.mode +
        '一种可行方案（约 ' + fastest.hours +
        ' 小时、约 ¥' + fastest.price + '）。' +
        (leg.occupiesWholeDay ? '耗时较长，整天在路上，行程里已单独占一天。' : '');
    }
    if (notesBox) notesBox.appendChild(note);

    /* 估算声明（AC 口径：页面上凡是估算的数字必须标"估算值，仅供参考"）
       为什么单独起一段、而不是并进上面那句：
       上面那句是"这段路怎么选"的结论，这句是"这个数字可不可信"的说明，
       两件事。混在一起用户会以为整段都是估的（其实只有这一种方式没数据）。 */
    if (hasEstimate && notesBox) {
      var est = document.createElement('p');
      est.className = 'seg-note seg-note-estimate';
      est.textContent = '⚠️ 这一段有城市不在数据表里，票价和耗时是估算值，仅供参考。' +
        '实际请以铁路 12306 / 航司官网为准。';
      notesBox.appendChild(est);
    }
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

  /* 合计里混了估算值时，在账本底部补一句总声明。
     为什么放在"合计"下面而不是表格上面：用户是看完数字才需要这句话，
     先声明会被当成"又一段说明文字"跳过去。 */
  var oldNote = document.getElementById('cost-estimate-note');
  if (oldNote) oldNote.parentNode.removeChild(oldNote);

  if (cost.hasEstimate) {
    var note = document.createElement('p');
    note.id = 'cost-estimate-note';
    note.className = 'field-note';
    note.textContent = '⚠️ 上面的城际交通含估算值 —— 有城市不在数据表里（目前覆盖 24 个主要城市），' +
      '票价和耗时按同类路线估算，仅供参考。实际请以铁路 12306 / 航司官网为准。';
    if (tbody.parentNode) tbody.parentNode.appendChild(note);
  }

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

  /* 换了一套方案 → 退出"正在编辑某一行"的状态（Day 15）。
     理由同 generate()：换的是整批行，编辑态不该跨过去。
     （用户的修改仍然保留 —— 它们在 itineraryEdits 里，跟这个状态无关。） */
  exitRowEditing();

  var chosenKeys = [];
  for (var k = 0; k < picked.legs.length; k++) {
    chosenKeys.push(picked.legs[k].chosen.key);
  }

  var verdict = compareBudget(picked.cost, lastInput.budget, picked.legs, {
    plan: picked.split.plan,
    totalDays: lastInput.days,
    cheaperPlan: cheaperOf(lastPlans, picked)
  });

  /* ⚠️ Day 14 修 bug：这里以前是"只重画当前视图里那几块"（if inView.indexOf(...)），
     结果切方案在「整体方案」和「每日行程」两个视图里全都失效 —— 因为 currentView
     是 'plan' 时 applyView 把 block-itinerary / block-cost / block-budget 都设成了
     hidden=true，而切换方案时 currentView 并不会变成 'trip' 或 'cost'，
     那三块就永远轮不到重画。表现：点「按这套重新算」，卡片上的选中标记变了、
     "在路上 N 天"也变了，但下面的行程表 / 花费表还是旧方案的数字。

     现在改回**无条件全部重画**。为什么这样不浪费、也不出错：
       · 重画只是往 hidden 的块里写内容 —— 不显示、不可见，用户完全无感；
       · 下次切到这个视图时 applyView 把 hidden 一解开，看到的就已经是新方案的内容。
     两张表的重画成本远低于"数字对不上"的代价，这里优先保证正确。 */
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

/* 当前筛选档位：'all' 全部 / 'en' 只看吃的 / 'play' 只看玩的（Day 12）
   为什么放在函数外面、不当参数传：
     这份清单会被重画很多次（添加/删除自填地点、重新生成方案都会重画），
     每次重画都不该把用户刚选好的档位弄丢。 */
var highlightFilter = 'all';

/* 把"当前选中哪一档"同步到三个按钮上。
   aria-pressed 是给读屏软件看的 —— 它读不出"颜色深一点"，
   但读得出"这个按钮处于按下状态"。 */
function syncFilterButtons() {
  var btns = document.querySelectorAll('#block-highlights .filter-btn');
  for (var i = 0; i < btns.length; i++) {
    var on = btns[i].getAttribute('data-filter') === highlightFilter;
    btns[i].className = 'filter-btn' + (on ? ' is-on' : '');
    btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/* 切换档位：先同步按钮，再重画清单（条数在重画时一起更新） */
function setHighlightFilter(f) {
  if (f === highlightFilter) { return; }   // 点同一档不用重画
  highlightFilter = f;
  syncFilterButtons();
  if (lastInput && lastInput.cities) {
    renderHighlights(lastInput.cities);
  }
}

function renderHighlights(cities) {
  var box = document.getElementById('highlights-body');
  box.innerHTML = '';

  // 全页一共筛出多少条（顶部那行"共 N 条 / 筛出 N 条"要用）
  var shownTotal = 0;

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

    // 按当前档位过滤（Day 12）
    //   注意：这里过滤的是"这个城市要显示哪几条"，不是把数据删掉 ——
    //   切回「全部」时用的还是 allRows，一条都不会少。
    var rows = highlightFilter === 'all'
      ? allRows
      : allRows.filter(function (r) { return r.type === highlightFilter; });
    shownTotal += rows.length;

    // 这个城市的统计说明，下面两个分支共用同一份文字
    var tagText = list && list.length > 0
      ? ('（内置推荐 ' + list.length + ' 条' +
         (saved.length > 0 ? ' + 你自己添加 ' + saved.length + ' 条' : '') + '）')
      : ('（你自己添加 ' + saved.length + ' 条）');

    if (rows.length > 0) {
      var tag = document.createElement('span');
      tag.className = 'city-tag';
      tag.textContent = tagText;
      h3.appendChild(tag);
      block.appendChild(h3);

      var table = document.createElement('table');
      table.className = 'data-table';
      var thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>类型</th><th>名称</th><th class="num">参考花费</th>' +
                        '<th class="col-op"></th></tr>';
      table.appendChild(thead);
      var tbody = document.createElement('tbody');

      for (var k = 0; k < rows.length; k++) {
        var item = rows[k];
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
    } else if (allRows.length > 0) {
      // 这个城市有内容，但当前档位把它们全筛掉了（Day 12）
      //   必须说话 —— 直接留一片空白，用户会以为页面坏了。
      //   文案里要给出出口（点「全部」），并把真实条数讲明白，免得看起来像"数据丢了"。
      var tag3 = document.createElement('span');
      tag3.className = 'city-tag';
      tag3.textContent = '（这个筛选下没有）';
      h3.appendChild(tag3);
      block.appendChild(h3);

      var filteredOut = document.createElement('div');
      filteredOut.className = 'empty-note filter-empty';
      filteredOut.textContent = '这个筛选下没有条目 —— ' + city + '一共有 ' + allRows.length +
        ' 条，都属于另一类。点上面的「全部」就能都看回来。';
      block.appendChild(filteredOut);
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

  // 顶部条数（Day 12）：让用户一眼看到"筛完还剩几条"
  //   文字是最明确的一档反馈 —— 它一直留在那儿，不像动效眨眼就过。
  //   这个元素上已经写了 aria-live="polite"，读屏软件会自动播报新数字。
  var cnt = document.getElementById('filter-count');
  if (cnt) {
    cnt.textContent = highlightFilter === 'all'
      ? ('共 ' + shownTotal + ' 条')
      : ('筛出 ' + shownTotal + ' 条');
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

/* ---------- 行程可编辑（Day 15 新增） ----------

   用户的原话："每日行程中大致安排那一列做成可上下交换式的，就是可自行增删改，
   因为这只是你给出的方案，用户不一定喜欢你的安排，我们也要允许个性化的设计。"

   设计上分三层，别混在一起：
     ① 【AI 原稿】renderItinerary 算出来的 items —— 程序推荐的内容
     ② 【用户修改】itineraryEdits 里按"行 key"存的 items —— 用户改过的
     ③ 【最终显示】渲染时：有修改就用修改，没有就用原稿

   为什么要分②③而不是"直接改掉原稿"：
     renderItinerary 会在【切方案 / 重新生成 / 增删自填地点】时整块重画。
     直接改原稿的话，下一次重画就把它洗掉了 —— 用户的修改等于没保存。
     所以修改必须单独存一份，重画时把它"盖"回原稿上面。 */
var itineraryEdits = {};

/* 用户修改的存储 key。和自填地点分开存：
   两者的"过期条件"不一样 —— 自填地点跟城市走、跟天数无关；
   行程修改跟"哪一天"绑得很紧，换天数就可能对不上号。 */
var EDITS_KEY = 'meng-vibe-coding:itineraryEdits';

/* 当前正在编辑哪一行（行 key）。null = 没有行在编辑态。
   为什么"一次只允许一行进编辑态"：
     多行同时可编辑的话，用户改到一半切走、或者两行的输入框都在飘，
     很容易出现"改了一半的算不算数"这种说不清的状态。一次一行最简单也最稳。
   为什么放在函数外面：和 highlightFilter 同理 —— 重画时不该把它弄丢
     （重画后要能回到"还在这行编辑"的状态）。 */
var editingRowKey = null;

/* 【草稿】正在编辑的这一行的内容（Day 15）

   为什么需要它：编辑态里的每个动作（加一条 / 上移 / 删除）都要重画才能看到效果，
   而重画必须有个"内容来源"。如果不给草稿，就只能
     · 要么改存档 → 用户点「取消」也取消不掉（存档已经被污染）
     · 要么读 DOM  → 每次操作都得先把输入框里的字抠出来，绕，而且
                     "加一条空条目"这种动作在 DOM 里没有落点
   有了草稿，三件事一次说清：
     · 进编辑态 → 把当前内容拷进 draft
     · 编辑期间 → 所有动作改 draft + 重画（渲染只看 draft）
     · 点「完成」→ draft 落进存档；点「取消」→ 扔掉 draft，存档一字未动
   ⚠️ 只在编辑态里有值；退出编辑态（完成/取消）后置回 null。 */
var editDraft = null;

/* 退出编辑态（丢掉草稿）。
   什么时候调：任何"换了一批新数据"的动作 —— 重新生成 / 切方案 / 清空重填。
   为什么必须退出：编辑态是绑在【当前这一批行】上的状态。
     换了数据（比如重新生成），用户对"我正在编辑"的预期已经结束了，
     而且那一行可能已经不存在。留着编辑态会让人莫名其妙：
     看到一列输入框，却不知道自己刚才点的是哪儿。
   ⚠️ 注意这跟"保留用户的修改"是两件事：
     修改存在 itineraryEdits 里，不受影响（③A 照样成立）；
     这里丢掉的只是"正在编辑"这个动作状态。 */
function exitRowEditing() {
  editingRowKey = null;
  editDraft = null;
}

/* 算一行的稳定 key（用户修改就按这个 key 对号入座）。
   为什么不用"第 N 天"当 key：天数一变，同一个"第 3 天"就换城市了，
     用户的修改会莫名其妙跑到别的城市头上。
   为什么这么设计：
     · 在途行 → 't:武汉>成都'：这段路是唯一的，换方案也还是这段路
     · 游玩行 → 'c:成都:0'  = 成都的第 1 天（从 0 数）
       同一城市待 3 天就有 c:成都:0/1/2 三个 key。
       这样"把成都第 1 天的安排改一改"，下次生成时只要成都还是待这么多天，
       那条修改就还落在成都第 1 天上 —— 符合直觉。
   副作用（要如实说）：城市少待一天，c:成都:2 就找不到位置了 → 那条修改
     自然失效（丢弃）。这比"硬塞到别的天"要好，也不会让用户困惑。 */
function rowKeyOf(row) {
  if (row.type === 'transit') { return 't:' + row.label.replace('在途：', ''); }
  return 'c:' + row.label + ':' + row.cityDayIndex;
}

/* 把本地存储里的行程修改读回来（页面打开时调一次） */
function loadItineraryEdits() {
  try {
    if (typeof localStorage === 'undefined') return;
    var raw = localStorage.getItem(EDITS_KEY);
    if (!raw) return;
    var data = JSON.parse(raw);
    /* 还要挡一层：本地存的东西不可信（用户可能手改过、也可能是旧版本存的）。
       只要不是"正经对象"就丢掉 —— 数组 typeof 也是 'object'，得单独排掉。 */
    if (data && typeof data === 'object' && !Array.isArray(data)) { itineraryEdits = data; }
    else { itineraryEdits = {}; }
  } catch (e) {
    itineraryEdits = {};   // 存坏了就当没有，功能照常用（只是刷新后不保留）
  }
}

/* 写回本地存储 */
function saveItineraryEdits() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(EDITS_KEY, JSON.stringify(itineraryEdits));
  } catch (e) {
    // 存不进去就算了：功能照常用，只是刷新后不保留
  }
}

/* 清掉全部行程修改（点"清空重填"时用） */
function clearItineraryEdits() {
  itineraryEdits = {};
  editingRowKey = null;
  editDraft = null;
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(EDITS_KEY);
  } catch (e) {}
}

/* 取某一行"最终要显示的内容"：
   编辑态 → 用草稿（editDraft）
   否则   → 用户改过就用用户的，没改过就用 AI 原稿
   ⚠️ 必须返回副本（slice），不能让调用方直接改到存档/原稿里那份 ——
      那样"取消编辑"就没法还原了（改的已经是存档本身了）。 */
function itemsForRow(row) {
  /* 编辑态里一律看草稿，而且【不过滤空条目】——
     因为"+ 加一条"刚加出来的就是一个空输入框，过滤掉它等于按钮没反应。 */
  if (editingRowKey === rowKeyOf(row) && editDraft) {
    return editDraft.slice();
  }
  var k = rowKeyOf(row);
  var edit = itineraryEdits[k];
  if (edit && edit.items && edit.dirty) {
    return edit.items.slice();
  }
  return row.items.slice();
}

/* 判断这一行是不是用户改过的（用来挂"已改"标记） */
function isRowEdited(row) {
  var e = itineraryEdits[rowKeyOf(row)];
  return !!(e && e.dirty);
}

/* ============================================================
   主题切换（Day 8）
   ============================================================

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
   四个地方共用：空输入 / 不是国内城市 / 已经加过 / 超过 4 个。
   （Day 10 收尾追加：原来前两种情况完全静默，用户不知道发生了什么）
   （Day 16：文案改由 unsupportedCityMessage 统一提供） */
function setCityHint(msg) {
  var el = document.getElementById('error-to-city');
  el.hidden = false;
  el.textContent = msg;
}

/* 「出发城市」输完就查一次（Day 16 用户反馈后加）。
   什么时候触发：焦点离开输入框时（blur）。
   为什么不在打字途中查：输入框里是「武」的时候还没输完，
   那时候报"不支持"是冤枉他 —— 输完再判才合理。
   为什么在这里判而不是只在"生成"时判：跟添加城市一个道理，
   错了要立刻说，不要攒着。
   注意：空着不报错 —— 「没填」是 E1 那条规则的事，
   两条规则各管一头，别在这里重复报同一件事。

   ⚠️ 查对了要【把旧红字擦掉】（第一版漏了这一步）：
   用户看到「东京 不支持」→ 改成「武汉」→ 红字还在，
   他会以为改了不起作用。所以这里两条路都走：
   认出来就 clear，认不出来才报。 */
function checkFromCity() {
  var el = document.getElementById('from-city');
  var name = el.value.trim();
  var box = document.getElementById('error-from-city');

  if (name === '') {
    /* 空着：如果之前报过"不支持"，现在清空了也该擦掉 ——
       留着会让人以为"空着也报错"。擦掉之后交给 E1 管。 */
    clearFieldError('error-from-city');
    return;
  }

  if (isKnownChineseCity(name)) {
    clearFieldError('error-from-city');
    return;
  }

  setFieldError('error-from-city', unsupportedCityMessage(name));
}

/* 往某个字段下面的红字位上写一句话 / 擦掉它。
   抽出来是因为「出发城市」现在有【两处】要写同一个位置：
   ① 输完立刻查（checkFromCity）② 点生成时的兜底校验（showErrors）。 */
function setFieldError(id, msg) {
  var el = document.getElementById(id);
  if (!el) { return; }
  el.hidden = false;
  el.textContent = msg;
}

function clearFieldError(id) {
  var el = document.getElementById(id);
  if (!el) { return; }
  el.hidden = true;
  el.textContent = '';
}

function addCity() {
  var input = document.getElementById('to-city-input');
  var name = input.value.trim();

  if (name === '') {
    setCityHint('先输入一个城市名，再点「添加」');
    input.focus();
    return;
  }

  /* ⚠️ 这里拦住"不是国内城市"的（Day 16 用户反馈后加）。
     为什么必须在【添加】这一步拦，而不是等点「生成方案」：
     点添加就是把城市收进列表 —— 收进来的那一刻，用户默认它"能用"了。
     等到生成才报错，等于让他填完一堆再回头改，白填。
     所以：认不出来就【不进列表】，输入框里的字保留（他好改），
     红字说清楚为什么。
     注意顺序：放在"重复"和"超 4 个"【之前】——
     因为那两条都是"这个城市本身没问题，只是加不进去"，
     而这条是"这个城市根本用不了"，性质更严重，该先说。 */
  if (!isKnownChineseCity(name)) {
    setCityHint(unsupportedCityMessage(name));
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

  /* 要重新算一趟了 → 先退出"正在编辑某一行"的状态（Day 15）。
     为什么放在最前面：这一趟算出来的是一整批新行，跟用户刚才在编辑的
     那一行没有关系。留着编辑态会让用户看到一列输入框、却不知道自己在改哪。 */
  exitRowEditing();

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
    /* 有校验不过 → 切到「错误」状态（Day 13：以前是"默默退回空状态"），
       并且【不生成半成品】（PRD F2）。 */
    showErrors(errors);
    return;
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
      /* 出错了：收掉转圈和按钮锁，切到「错误」状态。
         注意【不要】在这里先调 showEmpty() ——
         showErrors 内部会调 showError，它自己就是"切到错误状态"，
         前面再插一次 showEmpty 只会白闪一下空状态。 */
      hideLoading();
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

  /* 每次生成都从「整体方案」开始看。
     理由：用户按顺序就是"先挑方案、再看行程、最后看账本"。
     上一轮如果停在"账本"，这次生成完直接跳到账本会让人莫名其妙 ——
     明明是重新算了一遍，却看不到最该先看的方案对比。 */
  currentView = 'plan';

  // 渲染六块（都渲染好，切视图时不用重算；显隐由 applyView 管）
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
       revealBlocks 内部会按当前视图决定显示哪几块，
       所以这里不用再管结果区本身（结果区一直可见，切换的是里面哪一块可见）。 */
    document.getElementById('block-empty').hidden = true;
    revealBlocks();

    /* 地址栏同步写上 #plan。
       为什么连"本来是空 hash"也要写：用户切到 #trip 之后按后退键，
       浏览器要回到上一个历史点 —— 那个点如果没写锚点，就退不回来了。
       先写下 #plan 等于给"最初的视图"钉了个记认点。
       用 replace 不入历史：重新生成本来就该覆盖当前状态，不该多一个历史点。 */
    if (window.location.hash !== '#plan') {
      try { window.location.replace('#plan'); } catch (e) { /* 忽略即可 */ }
    }

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

/* ---------- E0. 视图切换（Day 13 新增） ----------

   三个视图，每个视图装自己那几块：

     整体方案 plan → block-plans + block-transport
     每日行程 trip → block-itinerary
     账本     cost → block-cost + block-budget + block-highlights

   为什么这么分：用户看结果的顺序本来就是"先挑方案 → 再看行程 → 最后看花销"，
   六块挤在一条竖直线上要滚很久；分成三屏之后每屏只管一件事。

   视图方式选的是【标签 + 地址锚点】（没引路由库）：
     · 标签本身纯 JS 换显隐，零依赖，跟项目里其他交互一个路子
     · 同时改 location.hash，白捡两件事：浏览器后退键能回上一个视图、刷新停在同一视图
     · 用 hashchange 而不是自己写路由器：地址一变就跟着切，代码量约等于零
   为什么不用 full 路由库：这点需求引库要多配一堆东西（还有可能碰 AC1/AC14），
   属于"用了大炮打蚊子"。 */

var VIEWS = {
  plan: ['block-plans', 'block-transport'],
  trip: ['block-itinerary'],
  cost: ['block-cost', 'block-budget', 'block-highlights']
};

/* 当前在哪个视图。默认"整体方案"—— 用户生成完最该先看的就是挑哪套。 */
var currentView = 'plan';

/* 把某个视图的块显示出来、其它视图的块藏起来。
   注意这里只管【正常态内的切换】，空/加载/错误三种状态是另一回事
   （见下面的 showEmpty / showLoading / showError）。 */
function applyView(view) {
  if (!VIEWS[view]) { view = 'plan'; }   // 地址栏里手输了奇怪的 #xxx → 退回默认，不报错
  currentView = view;

  // ① 先把六个结果块全部藏起来
  BLOCK_IDS.forEach(function (id) {
    document.getElementById(id).hidden = true;
  });

  // ② 只要有数据，就把当前视图该显示的那几块放出来
  //    （没数据时不放 —— 那时候页面显示的是空/加载/错误，不该有结果块）
  if (hasResults) {
    VIEWS[view].forEach(function (id) {
      document.getElementById(id).hidden = false;
    });
  }

  syncViewTabs();
}

/* 把"现在是哪个视图"同步到三个标签按钮上。
   aria-selected 是给读屏软件看的：它读不出"哪个按钮颜色深"，
   只能读这个属性 —— 跟 Day 12 筛选栏的 aria-pressed 是一个道理。 */
function syncViewTabs() {
  var tabs = document.querySelectorAll('#view-tabs .view-tab');
  for (var i = 0; i < tabs.length; i++) {
    var on = tabs[i].getAttribute('data-view') === currentView;
    tabs[i].classList.toggle('is-on', on);
    tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    /* 选中的那个才进 Tab 键顺序（roving tabindex）。
       这是标签组的标准做法：Tab 键在整组上只停一次，组内用左右方向键换。 */
    tabs[i].setAttribute('tabindex', on ? '0' : '-1');
  }
}

/* 切视图。用户点标签、或者地址栏 hash 变了，都走这里。 */
function switchView(view, opts) {
  opts = opts || {};
  if (!VIEWS[view]) { view = 'plan'; }

  /* 切之前先按需重画 —— 切换方案时我们只重画了"当时在那个视图里"的块，
     所以别的视图里可能还是旧方案的内容。不重画的话会出现：
     在"整体方案"里切到性价比方案 → 再点"每日行程" → 看到的还是最省方案的行程。
     （重画用的是 lastInput / lastPlans，没生成过就跳过。） */
  repaintForView(view);

  applyView(view);

  // 地址栏跟着变（用 replace 是为了不让"切视图"在历史里堆一长串）
  if (!opts.skipHash) {
    var want = '#' + view;
    if (window.location.hash !== want) {
      try {
        if (opts.replace) {
          window.location.replace('#' + view);
        } else {
          window.location.hash = view;
        }
      } catch (e) { /* 极老浏览器或 file:// 下个别限制，忽略即可，页面照样能切 */ }
    }
  }

  /* 切完视图滚到结果区顶部。
     不滚的话：在"账本"里往下看了很久，切到"每日行程"还停在原来的滚动位置，
     会直接落在页面中间，用户以为点坏了。 */
  var area = document.getElementById('result-area');
  if (area && area.scrollIntoView) {
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* 按当前选中的方案，重画指定视图里的块。
   只在"生成过"的前提下干活；没生成过就什么都不做（那时候页面是空状态）。 */
function repaintForView(view) {
  if (!hasResults || !lastInput || !lastPlans) { return; }

  var picked = null;
  for (var i = 0; i < lastPlans.length; i++) {
    if (lastPlans[i].id === activePlanId) { picked = lastPlans[i]; }
  }
  if (!picked) { picked = lastPlans[0]; }

  var chosenKeys = [];
  for (var k = 0; k < picked.legs.length; k++) {
    chosenKeys.push(picked.legs[k].chosen.key);
  }

  var ids = VIEWS[view] || [];
  if (ids.indexOf('block-itinerary') >= 0) { renderItinerary(picked.split, lastInput); }
  if (ids.indexOf('block-transport') >= 0) { renderTransport(picked.split, chosenKeys); }
  if (ids.indexOf('block-cost') >= 0) { renderCost(picked.cost); }
  if (ids.indexOf('block-highlights') >= 0) { renderHighlights(lastInput.cities); }
  if (ids.indexOf('block-budget') >= 0) {
    var verdict = compareBudget(picked.cost, lastInput.budget, picked.legs, {
      plan: picked.split.plan,
      totalDays: lastInput.days,
      cheaperPlan: cheaperOf(lastPlans, picked)
    });
    renderBudget(verdict);
  }

  /* 注意：这里【不】调 revealBlocks()。
     重画只是把内容换个新的，不该再播一遍"依次滑入"的入场动画 ——
     用户只是切了个视图，不是重新生成，每切一次都动画一次会很吵。 */
}

/* 从地址栏读出该显示哪个视图（直接带 #trip 打开页面时用） */
function viewFromHash() {
  var h = (window.location.hash || '').replace(/^#\/?/, '');
  return VIEWS[h] ? h : 'plan';
}

/* 加载中至少显示多久。太短了转圈会"闪一下"，比不显示还难看。
   400 毫秒：短到不烦人，长到能看清。 */
var LOADING_MIN_MS = 400;

/* 本次任务的编号。
   为什么需要它 —— 加载是把揭晓动作放在 setTimeout 里的，
   如果用户在这 400 毫秒里点了"清空重填"、或者又点了一次生成，
   那个迟到的 setTimeout 照样会跑，把已经作废的结果画到屏幕上。
   编号对不上就自己作废，这是异步代码里最省事的"防迟到"手段。 */
var runToken = 0;

/* 有没有算出过结果。
   为什么要单独记一个标记：视图切换（applyView）需要知道
   "现在该不该显示结果块" —— 页面刚打开时是空状态，这时候就算你把
   #trip 敲进地址栏，也不该凭空冒出六块结果来。 */
var hasResults = false;

/* 把结果区里所有内容块收起来（六块结果 + 转圈 + 空状态 + 错误卡）。
   四种状态互相切换时，第一步都是"先全部藏掉，再显示该显示的那个"，
   这样不会出现两个状态同时可见的中间态。 */
function hideAllBlocks() {
  BLOCK_IDS.forEach(function (id) {
    document.getElementById(id).hidden = true;
  });
  document.getElementById('block-loading').hidden = true;
  document.getElementById('block-empty').hidden = true;
  document.getElementById('block-error').hidden = true;   // Day 13
  /* 视图标签栏也跟着藏：空/加载/错误这三种状态下都没有"多个视图"可言，
     留着三个按钮可点却点不出东西，是骗人。 */
  document.getElementById('view-tabs').hidden = true;
}

/* 切到「空」状态：还没生成过、或者刚被清空。 */
function showEmpty() {
  hasResults = false;
  hideAllBlocks();
  document.getElementById('result-area').hidden = false;
  document.getElementById('block-empty').hidden = false;

  /* Day 15：把三张表的旧内容也倒掉。
     为什么要多这一步：上面只是把块 hidden 起来，DOM 里还留着上一次的行。
     正常情况下用户看不见，但只要以后有哪个地方"显示块"时忘了重画，
     露出来的就是上一次的旧行程 —— 这种"看着像新结果、其实是旧的"最难查。
     顺手倒掉成本几乎为零，还省内存。 */
  ['table-itinerary', 'table-transport', 'table-cost'].forEach(function (id) {
    var t = document.getElementById(id);
    if (t) { t.querySelector('tbody').innerHTML = ''; }
  });
}

/* 切到「错误」状态（Day 13 新增）。

   以前输入不合格是"字段下面一行红字 + 结果区默默退回空状态" ——
   等于用户【看不到"错误"这个状态本身】，只看到页面又变空了。

   现在做成一张独立的错误卡片：写清楚哪几项不对、错在哪、怎么改。
   注意字段旁边那行红字【还是留着】—— 它贴着输入框，改起来近；
   这张卡片管的是"状态要有个看得见的样子"。两个各管一头。

   items 是 [{label, message}, …]（label 是字段名，message 是为什么错） */
function showError(items) {
  hasResults = false;
  hideAllBlocks();

  var area = document.getElementById('result-area');
  area.hidden = false;

  var list = document.getElementById('error-list');
  list.innerHTML = '';
  for (var i = 0; i < items.length; i++) {
    var li = document.createElement('li');
    var name = document.createElement('b');
    name.textContent = items[i].label + '：';
    li.appendChild(name);
    li.appendChild(document.createTextNode(items[i].message));
    list.appendChild(li);
  }

  /* 标题里带上条数。一条的时候别写"共 1 项"（啰嗦），写清楚是哪儿就行。 */
  document.getElementById('error-title').textContent =
    items.length === 1 ? '这里还差一点' : '有 ' + items.length + ' 处需要改一下';

  document.getElementById('block-error').hidden = false;

  /* 滚到错误卡片那儿 —— 用户在按钮附近点生成，错误卡片在下面，
     不滚过去的话他只会看到"页面没反应"。 */
  var card = document.getElementById('block-error');
  if (card.scrollIntoView) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function showLoading() {
  runToken++;                 // 发一个本次任务的编号
  var myToken = runToken;

  var area = document.getElementById('result-area');
  area.hidden = false;

  /* 六块结果 + 空状态 + 错误卡全部收起来：转圈期间界面只留转圈，干净 */
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

/* 结果块错峰淡入。抽成函数是因为"加载完成后"和"切换方案时"都要用到。

   Day 13 改动（这里是加视图时最容易漏的一处）：
     原来它无脑把【六块全部】hidden = false —— 加了视图之后这么干，
     一点生成就会三个视图的内容一起堆在屏幕上，标签切了也像没切。
     现在只让【当前视图】那几块淡入，其它视图的块保持藏着。 */
function revealBlocks() {
  hasResults = true;

  /* 每块比上一块晚 70 毫秒出现，看起来是"依次滑入"而不是"啪一下全冒出来"。
     用 CSS 动画（见 style.css 的 fade-up + .reveal 类），
     这里只负责把类加上、并清掉上一次的延迟，避免第二次生成时累积。 */
  var ids = VIEWS[currentView];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    el.hidden = false;
    el.classList.remove('reveal');          // 先摘掉，才能重新触发动画
    el.style.animationDelay = '';           // 清掉上一次的延迟
    // 强制浏览器"重新计算一次样式"，否则连续两次生成时动画不会重播
    void el.offsetWidth;
    el.style.animationDelay = (i * 70) + 'ms';
    el.classList.add('reveal');
  }

  /* 其它视图的块确保是藏着的（比如上一轮看过"账本"，这一次生成后
     它们不该还留在屏幕上）。 */
  for (var j = 0; j < BLOCK_IDS.length; j++) {
    if (ids.indexOf(BLOCK_IDS[j]) < 0) {
      document.getElementById(BLOCK_IDS[j]).hidden = true;
    }
  }

  // 视图标签栏：有结果了才配出现
  document.getElementById('view-tabs').hidden = false;
  syncViewTabs();
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

  /* 美食清单的三个筛选按钮（Day 12）
     三段几乎一样的代码合成一段，靠 data-filter 区分是哪一档。
     用 this 而不是闭包变量去认按钮：闭包在重画后会指错元素
     （这个坑 Day 7 做删除按钮时踩过）。 */
  var filterBtns = document.querySelectorAll('#block-highlights .filter-btn');
  for (var fb = 0; fb < filterBtns.length; fb++) {
    filterBtns[fb].addEventListener('click', function () {
      setHighlightFilter(this.getAttribute('data-filter'));
    });
  }

  // 城市输入框里按回车 = 点"添加"
  document.getElementById('to-city-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addCity(); }
  });

  /* 「出发城市」输完就查（Day 16）。
     用 blur（焦点离开）而不是 input（每打一个字）——
     见 checkFromCity 里的说明：打一半就报错是冤枉用户。
     另外补一个 change：鼠标点「添加」按钮时也会先触发 blur，
     所以正常操作路径已经覆盖；change 是给"改完直接提交"这类情况的兜底。 */
  document.getElementById('from-city').addEventListener('blur', checkFromCity);

  /* ---------- 视图标签（Day 13） ----------
     三个标签：点一下切视图。
     除了鼠标点，还要管键盘 —— 标签组的标准做法是
     【Tab 键在整组上只停一次，组内用左右方向键换】，
     所以这里额外监听左右键，并且同步把焦点移到新选中的那个标签上。
     （只让鼠标能切是偷懒，Tab 到不了 = 键盘用户完全用不了。） */
  var viewTabs = document.querySelectorAll('#view-tabs .view-tab');
  for (var vt = 0; vt < viewTabs.length; vt++) {
    viewTabs[vt].addEventListener('click', function () {
      switchView(this.getAttribute('data-view'), { replace: true });
      /* replace: true —— 点标签切视图不往历史里堆。
         理由：用户切了 3 次视图，再按"后退"却要退 3 次才回到上一页，很烦。
         后退键留给"真正的页面级跳转"（用 #plan/#trip/#cost 之外的方式进来时）。 */
    });

    viewTabs[vt].addEventListener('keydown', function (e) {
      var keys = { ArrowLeft: -1, ArrowRight: 1 };
      var step = keys[e.key];
      if (step === undefined) { return; }

      e.preventDefault();
      var list = [];
      for (var q = 0; q < viewTabs.length; q++) { list.push(viewTabs[q]); }
      var idx = list.indexOf(this);
      var next = list[(idx + step + list.length) % list.length];   // 到头的绕回另一头
      next.focus();
      switchView(next.getAttribute('data-view'), { replace: true });
    });
  }

  /* 地址栏的 hash 一变就跟着切视图。
     为什么用 hashchange 而不是自己写路由器：地址一变就通知我，
     这点需求它完全够用，还自动覆盖了"用户按后退键"这一种情况。 */
  window.addEventListener('hashchange', function () {
    var v = viewFromHash();
    if (v !== currentView) {
      /* skipHash: true —— 地址本来就已经是那个值了（是用户改的），
         不要再往回写一遍，否则会把后退键的历史搞乱。 */
      switchView(v, { skipHash: true });
    }
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
    clearItineraryEdits();       // 行程里改过的"大致安排"也一起清掉
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

  // 读回上次改过的"大致安排"（localStorage），刷新页面后修改还在
  loadItineraryEdits();

  /* 一开始就显示"空状态"—— 打开页面就能看到"该怎么用"的引导，
     而不是往下翻一片空白。这也是"四种页面状态"里最容易漏掉的那个：
     空状态不是没有状态，它本身就是一种要给用户看的状态。 */
  showEmpty();

  /* 但地址栏如果带着 #trip / #cost（用户刷新页面、或点了别人发来的链接），
     就把"下次生成后要看哪个视图"记下来。注意此刻还是空状态，
     所以不能直接把结果块显示出来 —— 等生成完自然会落到那个视图。 */
  currentView = viewFromHash();

  // 主题按钮：注意它【不受"清空重填"影响】——
  // 主题是长期偏好，跟本次填的城市天数不是一回事，所以不放进上面那个 reset 里。
  initTheme();
}

// 注意：脚本用 defer 加载，执行时 DOM 已就绪，这里直接初始化即可
initApp();
