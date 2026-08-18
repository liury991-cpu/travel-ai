// 12306 高铁查询（复刻 12306 Skill 的 leftTicket 逻辑，纯服务端直连）
// 注意：12306 官方接口只返回「余票/有无」，不含票价；
// 票价由 estimateFare 按城市间距估算兜底（RAILWAY_FARE_SOURCE=base-table）。
import type { TrainOption } from './types';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Referer: 'https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc',
};

// 12306 leftTicket 返回的管道分隔字段索引
const F: Record<string, number> = {
  trainNo: 2, trainCode: 3, fromCode: 6, toCode: 7,
  departTime: 8, arriveTime: 9, duration: 10, canBuy: 11, date: 13,
  gr: 21, rw: 23, rz: 24, tz: 25, wz: 26, yw: 28, yz: 29,
  ze: 30, zy: 31, swz: 32, dw: 33,
};

const STATION_JS = 'https://kyfw.12306.cn/otn/resources/js/station_name.js';
let _stations: Record<string, string> | null = null;

// 拉取并解析 12306 车站表（缓存到内存）
export async function loadStations(): Promise<Record<string, string>> {
  if (_stations) return _stations;
  const res = await fetch(STATION_JS);
  const txt = await res.text();
  const body = txt.replace(/^var\s+station_names\s*=\s*'/, '').replace(/';?\s*$/, '');
  const map: Record<string, string> = {};
  for (const chunk of body.split('@')) {
    if (!chunk) continue;
    const f = chunk.split('|');
    const name = f[1];
    const code = f[2];
    if (name && code) {
      map[name] = code;
      if (f[0]) map[f[0]] = code; // 拼音码也作为别名
    }
  }
  _stations = map;
  return map;
}

async function getCookie(): Promise<string> {
  const res = await fetch('https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc', {
    headers: HEADERS,
    redirect: 'manual',
  });
  const cookies = (res.headers.getSetCookie?.() as string[]) || [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

export async function queryTrains(
  fromName: string,
  toName: string,
  date: string,
): Promise<TrainOption[]> {
  const stations = await loadStations();
  const fromCode = stations[fromName];
  const toCode = stations[toName];
  if (!fromCode || !toCode) {
    throw new Error('车站未找到：' + (!fromCode ? fromName : toName));
  }

  const cookie = await getCookie();
  const params = new URLSearchParams({
    'leftTicketDTO.train_date': date,
    'leftTicketDTO.from_station': fromCode,
    'leftTicketDTO.to_station': toCode,
    purpose_codes: 'ADULT',
  });
  const res = await fetch(`https://kyfw.12306.cn/otn/leftTicket/query?${params}`, {
    headers: { ...HEADERS, Cookie: cookie },
  });
  const json = await res.json();
  const result: string[] = json?.data?.result ?? [];

  return result.map((raw) => {
    const f = raw.split('|');
    const v = (k: string) => f[F[k]] || '--';
    const seats: Record<string, string> = {
      swz: v('swz'), tz: v('tz'), zy: v('zy'), ze: v('ze'),
      gr: v('gr'), rw: v('rw'), dw: v('dw'),
      yw: v('yw'), rz: v('rz'), yz: v('yz'), wz: v('wz'),
    };
    return {
      trainCode: v('trainCode'),
      fromStation: fromName,
      toStation: toName,
      departTime: v('departTime'),
      arriveTime: v('arriveTime'),
      duration: v('duration'),
      canBuy: v('canBuy') === 'Y',
      seats,
    };
  });
}

// —— 票价估算（城市经纬度距离 × 高铁单价）——
const CITY_COORD: Record<string, [number, number]> = {
  北京: [39.9042, 116.4074], 上海: [31.2304, 121.4737], 广州: [23.1291, 113.2644],
  深圳: [22.5431, 114.0579], 成都: [30.5728, 104.0668], 杭州: [30.2741, 120.1551],
  西安: [34.3416, 108.9398], 重庆: [29.5630, 106.5516], 南京: [32.0603, 118.7969],
  武汉: [30.5928, 114.3055], 长沙: [28.2282, 112.9388], 厦门: [24.4798, 118.0894],
  青岛: [36.0671, 120.3826], 昆明: [24.8801, 102.8329], 丽江: [26.8721, 100.2299],
  三亚: [18.2528, 109.5119], 桂林: [25.2736, 110.2990], 拉萨: [29.6520, 91.1721],
  天津: [39.3434, 117.3616], 苏州: [31.2989, 120.5853], 香港: [22.3193, 114.1694],
  哈尔滨: [45.8038, 126.5350], 沈阳: [41.8057, 123.4315], 济南: [36.6512, 117.1201],
  郑州: [34.7466, 113.6254], 福州: [26.0745, 119.2965], 贵阳: [26.6470, 106.6302],
  兰州: [36.0611, 103.8343], 乌鲁木齐: [43.8256, 87.6168], 南宁: [22.8170, 108.3665],
};

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 返回估算票价（二等座基准 × 系数）。明确标注为估算，非 12306 实时。
export function estimateFare(fromCity: string, toCity: string) {
  const A = CITY_COORD[fromCity] ?? CITY_COORD['成都'];
  const B = CITY_COORD[toCity] ?? CITY_COORD['成都'];
  const km = Math.round(haversine(A, B));
  const second = Math.max(50, Math.round(km * 0.45));
  return {
    km,
    second,
    first: Math.round(second * 1.6),
    business: Math.round(second * 3),
    sleeper: Math.round(second * 0.55),
    estimated: true,
  };
}
