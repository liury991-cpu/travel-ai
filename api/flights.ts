// POST /api/flights  { from, to, date? } → 机票比价（演示数据）
// 自包含：不再 import 本地 ./lib/*（@vercel/nft 不会把相对 TS import 打进 Lambda）。
export const config = { runtime: 'nodejs', maxDuration: 30 };

interface FlightOption {
  airline: string; flightNo: string; from: string; to: string;
  departTime: string; arriveTime: string; durationMin: number; price: number; provider: string;
}

const CITY_COORD: Record<string, [number, number]> = {
  北京: [39.9042, 116.4074], 上海: [31.2304, 121.4737], 广州: [23.1291, 113.2644],
  深圳: [22.5431, 114.0579], 成都: [30.5728, 104.0668], 杭州: [30.2741, 120.1551],
  西安: [34.3416, 108.9398], 重庆: [29.563, 106.5516], 南京: [32.0603, 118.7969],
  武汉: [30.5928, 114.3055], 长沙: [28.2282, 112.9388], 厦门: [24.4798, 118.0894],
  青岛: [36.0671, 120.3826], 昆明: [24.8801, 102.8329], 丽江: [26.8721, 100.2299],
  三亚: [18.2528, 109.5119], 桂林: [25.2736, 110.299], 拉萨: [29.652, 91.1721],
  天津: [39.3434, 117.3616], 苏州: [31.2989, 120.5853], 香港: [22.3193, 114.1694],
  哈尔滨: [45.8038, 126.535], 沈阳: [41.8057, 123.4315], 济南: [36.6512, 117.1201],
  郑州: [34.7466, 113.6254], 福州: [26.0745, 119.2965], 贵阳: [26.647, 106.6302],
  兰州: [36.0611, 103.8343], 乌鲁木齐: [43.8256, 87.6168], 南宁: [22.817, 108.3665],
};
function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180; const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function estimateFare(fromCity: string, toCity: string) {
  const A = CITY_COORD[fromCity] ?? CITY_COORD['成都'];
  const B = CITY_COORD[toCity] ?? CITY_COORD['成都'];
  const km = Math.round(haversine(A, B));
  const second = Math.max(50, Math.round(km * 0.45));
  return { km, second, first: Math.round(second * 1.6), business: Math.round(second * 3), sleeper: Math.round(second * 0.55), estimated: true };
}

const AIRLINES = [
  { code: 'CA', name: '国航' }, { code: 'MU', name: '东航' }, { code: 'CZ', name: '南航' }, { code: 'HU', name: '海航' },
];

// 城市级 IATA 码（用于携程机票搜索深链）
const CITY_IATA: Record<string, string> = {
  北京: 'BJS', 上海: 'SHA', 广州: 'CAN', 深圳: 'SZX', 成都: 'CTU', 杭州: 'HGH',
  西安: 'XIY', 重庆: 'CKG', 南京: 'NKG', 武汉: 'WUH', 长沙: 'CSX', 厦门: 'XMN',
  青岛: 'TAO', 昆明: 'KMG', 丽江: 'LJG', 三亚: 'SYX', 桂林: 'KWL', 拉萨: 'LXA',
  天津: 'TSN', 苏州: 'SHA', 香港: 'HKG', 哈尔滨: 'HRB', 沈阳: 'SHE', 济南: 'TNA',
  郑州: 'CGO', 福州: 'FOC', 贵阳: 'KWE', 兰州: 'LHW', 乌鲁木齐: 'URC', 南宁: 'NNG',
};
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function mockFlights(fromCity: string, toCity: string, _date: string): FlightOption[] {
  const seed = hash(fromCity + '>' + toCity);
  const fare = estimateFare(fromCity, toCity);
  const basePrice = Math.max(400, Math.round(fare.km * 0.9));
  return AIRLINES.slice(0, 3 + (seed % 2)).map((al, i) => {
    const departMin = 6 * 60 + ((seed >> (i * 3)) % (14 * 60));
    const durationMin = 60 + (seed % 180) + i * 10;
    const price = Math.round((basePrice * (0.8 + ((seed >> i) % 40) / 100)) / 10) * 10;
    const arr = departMin + durationMin;
    const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { airline: al.name, flightNo: `${al.code}${1000 + ((seed >> i) % 8000)}`, from: fromCity, to: toCity,
      departTime: fmt(departMin), arriveTime: fmt(arr), durationMin, price, provider: '演示数据' };
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { from, to, date } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from/to required' });
    const d = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const flights = mockFlights(from, to, d);
    // 携程机票搜索深链（城市级 IATA 码）
    const fp = CITY_IATA[from]; const tp = CITY_IATA[to];
    const buyUrl = fp && tp
      ? `https://flights.ctrip.com/online/list/oneway-${fp.toLowerCase()}-${tp.toLowerCase()}?depdate=${d}`
      : 'https://flights.ctrip.com/';
    return res.status(200).json({ from, to, date: d, flights, buyUrl,
      note: '机票为演示数据；接入真实比价 API 后替换内部实现即可' });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'flight query failed' });
  }
}
