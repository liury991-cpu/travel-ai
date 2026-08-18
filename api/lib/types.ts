// 服务端 / 前端共享的数据模型（前端另有一份 src/lib/types.ts，内容一致）
export type PoiCategory = 'sight' | 'food' | 'culture' | 'night' | 'shopping';

export interface PlanItem {
  id: string;
  day: number;
  time: string; // "09:00"
  name: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  poiId?: string;
  cost: number; // 估算人民币
  durationMin?: number;
  desc?: string;
}

export interface PlanDay {
  day: number;
  title: string;
  items: PlanItem[];
}

export interface Plan {
  city: string;
  days: number;
  prefs: string[];
  budget: string;
  days_list: PlanDay[];
  totalBudget: number;
  pois: PlanItem[];
  generatedAt: string;
  source: 'tencent' | 'mock';
}

export interface TrainOption {
  trainCode: string;
  fromStation: string;
  toStation: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  canBuy: boolean;
  seats: Record<string, string>; // 余票状态：有/无/数字/--
  prices?: Record<string, number>; // 估算票价（非 12306 实时）
}

export interface FlightOption {
  airline: string;
  flightNo: string;
  from: string;
  to: string;
  departTime: string;
  arriveTime: string;
  durationMin: number;
  price: number;
  provider: string;
}
