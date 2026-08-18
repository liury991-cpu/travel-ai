// 前端使用的类型（与 api/lib/types.ts 保持一致）
export type PoiCategory = 'sight' | 'food' | 'culture' | 'night' | 'shopping';

export interface PlanItem {
  id: string;
  day: number;
  time: string;
  name: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  poiId?: string;
  cost: number;
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
  seats: Record<string, string>;
  prices?: Record<string, number>;
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
