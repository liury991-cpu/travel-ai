// 行程编排：优先调腾讯 travel_guide(A2A)，失败则回落 mock。
// 输出标准化的 Plan（含每天 POI、类别、坐标、估算花费）。
import { travelGuide, classify } from './tencent';
import { llmPlan } from './llm';
import type { Plan, PlanDay, PlanItem, PoiCategory } from './types';

const BUDGET_WEIGHT: Record<string, Record<PoiCategory, number>> = {
  economy: { sight: 30, food: 40, culture: 20, night: 50, shopping: 30 },
  comfort: { sight: 80, food: 120, culture: 60, night: 150, shopping: 100 },
  luxury: { sight: 200, food: 400, culture: 150, night: 500, shopping: 400 },
};

const CITY_CENTER: Record<string, [number, number]> = {
  北京: [39.9042, 116.4074], 上海: [31.2304, 121.4737], 广州: [23.1291, 113.2644],
  深圳: [22.5431, 114.0579], 成都: [30.5728, 104.0668], 杭州: [30.2741, 120.1551],
  西安: [34.3416, 108.9398], 重庆: [29.563, 106.5516], 南京: [32.0603, 118.7969],
  武汉: [30.5928, 114.3055], 长沙: [28.2282, 112.9388], 厦门: [24.4798, 118.0894],
  青岛: [36.0671, 120.3826], 昆明: [24.8801, 102.8329], 丽江: [26.8721, 100.2299],
  三亚: [18.2528, 109.5119], 桂林: [25.2736, 110.299], 拉萨: [29.652, 91.1721],
  天津: [39.3434, 117.3616], 苏州: [31.2989, 120.5853], 香港: [22.3193, 114.1694],
};

function mockDays(city: string, days: number, budget: string): PlanDay[] {
  const center = CITY_CENTER[city] ?? CITY_CENTER['成都'];
  const w = BUDGET_WEIGHT[budget] ?? BUDGET_WEIGHT.comfort;
  const templates: Array<{ cat: PoiCategory; name: (c: string) => string; time: string }> = [
    { cat: 'sight', name: (c) => `${c}城市观光`, time: '09:00' },
    { cat: 'food', name: (c) => `${c}地道美食街`, time: '12:00' },
    { cat: 'culture', name: (c) => `${c}历史文化馆`, time: '14:30' },
    { cat: 'shopping', name: (c) => `${c}特色商圈`, time: '17:00' },
    { cat: 'night', name: (c) => `${c}夜生活地标`, time: '19:30' },
  ];
  const out: PlanDay[] = [];
  for (let d = 1; d <= days; d++) {
    const items: PlanItem[] = templates.map((t, j) => {
      const lat = +(center[0] + (d * 0.01 - 0.02) + j * 0.004).toFixed(5);
      const lng = +(center[1] + (j * 0.006 - 0.015) + d * 0.003).toFixed(5);
      return {
        id: `${d}-${j + 1}`,
        day: d,
        time: t.time,
        name: t.name(city),
        category: t.cat,
        lat,
        lng,
        cost: w[t.cat],
        durationMin: 90,
      };
    });
    out.push({ day: d, title: `第 ${d} 天 · ${city}探索`, items });
  }
  return out;
}

export async function generatePlan(opts: {
  city: string;
  days: number;
  prefs: string[];
  budget: string;
  fromCity?: string;
}): Promise<Plan> {
  const { city, days, prefs, budget } = opts;
  const query = `${city}${days}天${prefs.join('')}游`;

  let source: 'tencent' | 'llm' | 'mock' = 'tencent';
  let days_list: PlanDay[] = [];

  // 1) 优先腾讯 A2A（在能直连的节点上是真实结构化数据）
  try {
    const raw = await travelGuide(query);
    if (raw.plan_days.length) {
      days_list = raw.plan_days.map((d: any, i: number) => {
        const items: any[] = d.items ?? d.pois ?? [];
        const planItems: PlanItem[] = items.map((p: any, j: number) => {
          const name = p.location_name ?? p.name ?? '未命名地点';
          const lat = Number(p.latitude ?? p.lat ?? 0);
          const lng = Number(p.longitude ?? p.lng ?? 0);
          const category = classify(name);
          const cost = (BUDGET_WEIGHT[budget] ?? BUDGET_WEIGHT.comfort)[category];
          return {
            id: `${i + 1}-${j + 1}`,
            day: i + 1,
            time: p.time ?? `${9 + j}:00`,
            name,
            category,
            lat,
            lng,
            poiId: p.poi_uid ?? p.poiId,
            cost,
            durationMin: p.durationMin,
            desc: p.location_desc ?? p.review ?? p.desc,
          };
        });
        return { day: i + 1, title: d.day_title ?? `第 ${i + 1} 天`, items: planItems };
      });
      source = 'tencent';
    }
  } catch {
    /* 腾讯不可达（海外节点 geo 拦截/超时）→ 走 LLM 兜底 */
  }

  // 2) 腾讯失败则用自己的 LLM（区域无关，从 Vercel 全球节点可直连）
  if (days_list.length === 0) {
    try {
      const llmDays = await llmPlan({ city, days, prefs, budget });
      if (llmDays.length) {
        days_list = llmDays;
        source = 'llm';
      }
    } catch (e: any) {
      console.error('[plan] LLM 兜底失败:', e?.message);
    }
  }

  // 3) 都没有则 mock
  if (days_list.length === 0) {
    days_list = mockDays(city, days, budget);
    source = 'mock';
  }

  // 归一化到请求天数（A2A 返回天数可能不一致）
  if (days_list.length > days) days_list = days_list.slice(0, days);
  while (days_list.length < days) {
    const extra = mockDays(city, 1, budget);
    days_list.push({ ...extra[0], day: days_list.length + 1 });
  }

  const pois = days_list.flatMap((d) => d.items);
  const totalBudget = pois.reduce((s, it) => s + it.cost, 0);

  return {
    city,
    days,
    prefs,
    budget,
    days_list,
    totalBudget,
    pois,
    generatedAt: new Date().toISOString(),
    source,
  };
}
