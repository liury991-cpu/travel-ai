// 机票比价（演示 Provider）
// 当前环境没有现成的机票比价技能/连接器，这里先用确定性「演示数据」跑通闭环。
// 接入真实源时，只需替换 fetchFlights 内部实现（Ctrip / 聚合 API / 你已有的工具），
// 返回结构保持 FlightOption[] 即可，前端与路由不变。
import type { FlightOption } from './types';
import { estimateFare } from './railway';

const AIRLINES = [
  { code: 'CA', name: '国航' },
  { code: 'MU', name: '东航' },
  { code: 'CZ', name: '南航' },
  { code: 'HU', name: '海航' },
];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function mockFlights(fromCity: string, toCity: string, _date: string): FlightOption[] {
  const seed = hash(fromCity + '>' + toCity);
  const fare = estimateFare(fromCity, toCity);
  const basePrice = Math.max(400, Math.round(fare.km * 0.9));

  return AIRLINES.slice(0, 3 + (seed % 2)).map((al, i) => {
    const departMin = 6 * 60 + ((seed >> (i * 3)) % (14 * 60)); // 06:00 起随机散布
    const durationMin = 60 + (seed % 180) + i * 10;
    const price = Math.round((basePrice * (0.8 + ((seed >> i) % 40) / 100)) / 10) * 10;
    const hh = Math.floor(departMin / 60);
    const mm = departMin % 60;
    const arr = departMin + durationMin;
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return {
      airline: al.name,
      flightNo: `${al.code}${1000 + ((seed >> i) % 8000)}`,
      from: fromCity,
      to: toCity,
      departTime: fmt(departMin),
      arriveTime: fmt(arr),
      durationMin,
      price,
      provider: '演示数据',
    };
  });
}
