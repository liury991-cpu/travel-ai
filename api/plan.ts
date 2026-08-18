// POST /api/plan  { city, days, prefs[], budget, fromCity? } → Plan
// 自包含版本：不再 import 本地 ./lib/*（@vercel/nft 不会把相对 TS import 打进 Lambda，
// 会导致运行时 "Cannot find module" → FUNCTION_INVOCATION_FAILED）。所有逻辑内联。
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

type PoiCategory = 'sight' | 'food' | 'culture' | 'night' | 'shopping';
interface PlanItem {
  id: string; day: number; time: string; name: string; category: PoiCategory;
  lat: number; lng: number; poiId?: string; cost: number; durationMin?: number; desc?: string;
}
interface PlanDay { day: number; title: string; items: PlanItem[]; }
interface Plan {
  city: string; days: number; prefs: string[]; budget: string; days_list: PlanDay[];
  totalBudget: number; pois: PlanItem[]; generatedAt: string; source: 'tencent' | 'llm' | 'mock';
}

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

const A2A_URL = 'https://h5gw.map.qq.com/aichat/v1/a2a?key=none&apptag=lbs_ai_chat_a2a';
function randHex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
const CATEGORY_KEYWORDS: Record<PoiCategory, string[]> = {
  culture: ['博物馆', '文化', '故居', '遗址', '纪念', '书院', '古迹', '历史', '寺', '庙', '道观', '教堂', '馆'],
  night: ['夜市', '酒吧', '夜游', '演出', '剧场', 'live', 'club', 'ktv', '夜景', '灯光', '演艺'],
  food: ['美食', '餐厅', '小吃', '火锅', '串', '面', '饭', '菜', '餐', '食', '茶', '咖啡', '酒', '铺', '坊'],
  shopping: ['购物', '商场', '市场', '超市', '免税', '特产', '商圈', '街'],
  sight: ['景点', '景区', '公园', '山', '湖', '塔', '阁', '园', '广场', '城', '谷', '岭'],
};
function classify(name: string): PoiCategory {
  for (const cat of ['culture', 'night', 'food', 'shopping', 'sight'] as PoiCategory[]) {
    if (CATEGORY_KEYWORDS[cat].some((k) => name.includes(k))) return cat;
  }
  return 'sight';
}

async function travelGuide(query: string, lat = 30.5728, lng = 104.0668) {
  const payload = {
    jsonrpc: '2.0', id: 1, method: 'message/stream',
    params: { message: { role: 'user', parts: [{ kind: 'text', text: query }], metadata: {
      brand: 'oppo', device_id: 'skill-' + randHex(16), latitude: lat, longitude: lng,
      osVersion: '16.1', theme: 'light', traceId: randHex(16) } } },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(A2A_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    if (!res.ok) throw new Error('A2A HTTP ' + res.status);
    const text = await res.text();
    if (text.trim().startsWith('<')) throw new Error('A2A 返回 HTML（海外 IP 可能被拦截）');
    const plan_summary: any = null; const plan_days: any[] = [];
    for (const blk of text.split('\n\n')) {
      if (!blk.trim()) continue;
      const dataLines = blk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
      if (!dataLines.length) continue;
      try {
        const ev = JSON.parse(dataLines.join('\n'));
        const r = ev?.result ?? {}; if (r.kind !== 'artifact-update') continue;
        const art = r.artifact ?? {}; const name = art.name ?? '';
        for (const p of art.parts ?? []) {
          if (!('data' in p)) continue;
          if (name === 'plan_summary') (plan_summary as any) = p.data;
          else if (name === 'plan_day') plan_days.push(p.data);
        }
      } catch { /* ignore */ }
    }
    if (!plan_summary && plan_days.length === 0) throw new Error('A2A 未返回攻略数据');
    return { plan_summary, plan_days };
  } finally { clearTimeout(timeout); }
}

async function llmPlan(opts: { city: string; days: number; prefs: string[]; budget: string }): Promise<PlanDay[]> {
  const base = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  if (!key) throw new Error('LLM_API_KEY 未配置');
  const budgetText = { economy: '经济型', comfort: '舒适型', luxury: '豪华型' }[opts.budget] || '舒适型';
  const sys = `你是一名专业的旅行行程规划师。输出要求：每天 4-6 个 POI，按时间排序；每个 POI 含 name/category(sight|culture|food|shopping|night)/time(HH:MM)/lat/lng/cost(人民币)/durationMin/desc；只输出纯 JSON {"days":[{"day":1,"title":"","items":[{}]}]}，不要 markdown。`;
  const user = `请为「${opts.city}」规划 ${opts.days} 天行程。偏好：${opts.prefs.join('、') || '综合'}。预算：${budgetText}。`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.7, response_format: { type: 'json_object' } }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timeout); }
  if (!res.ok) { const t = await res.text(); throw new Error('LLM HTTP ' + res.status + ' ' + t.slice(0, 200)); }
  const j: any = await res.json();
  const content: string = j?.choices?.[0]?.message?.content || '';
  let parsed: any = null;
  try { parsed = JSON.parse(content); } catch { const m = content.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
  const daysRaw: any[] = parsed?.days ?? [];
  if (!daysRaw.length) throw new Error('LLM 未返回有效行程');
  const CATS: PoiCategory[] = ['sight', 'culture', 'food', 'shopping', 'night'];
  return daysRaw.map((d: any, i: number) => ({
    day: i + 1, title: d.title || `第 ${i + 1} 天`,
    items: (d.items || []).map((p: any, k: number) => {
      const name = p.name || '未命名地点';
      const category = CATS.includes(p.category) ? (p.category as PoiCategory) : classify(name);
      return { id: `${i + 1}-${k + 1}`, day: i + 1, time: p.time || `${9 + k}:00`, name, category,
        lat: Number(p.lat || 0), lng: Number(p.lng || 0), cost: Number(p.cost || 0),
        durationMin: Number(p.durationMin || 90), desc: p.desc || '' } as PlanItem;
    }),
  }));
}

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
      return { id: `${d}-${j + 1}`, day: d, time: t.time, name: t.name(city), category: t.cat, lat, lng, cost: w[t.cat], durationMin: 90 };
    });
    out.push({ day: d, title: `第 ${d} 天 · ${city}探索`, items });
  }
  return out;
}

async function generatePlan(opts: { city: string; days: number; prefs: string[]; budget: string; fromCity?: string }): Promise<Plan> {
  const { city, days, prefs, budget } = opts;
  const query = `${city}${days}天${prefs.join('')}游`;
  let source: 'tencent' | 'llm' | 'mock' = 'tencent';
  let days_list: PlanDay[] = [];
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
          return { id: `${i + 1}-${j + 1}`, day: i + 1, time: p.time ?? `${9 + j}:00`, name, category, lat, lng,
            poiId: p.poi_uid ?? p.poiId, cost, durationMin: p.durationMin, desc: p.location_desc ?? p.review ?? p.desc };
        });
        return { day: i + 1, title: d.day_title ?? `第 ${i + 1} 天`, items: planItems };
      });
      source = 'tencent';
    }
  } catch { /* 腾讯不可达 → LLM 兜底 */ }
  if (days_list.length === 0) {
    try {
      const llmDays = await llmPlan({ city, days, prefs, budget });
      if (llmDays.length) { days_list = llmDays; source = 'llm'; }
    } catch (e: any) { console.error('[plan] LLM 兜底失败:', e?.message); }
  }
  if (days_list.length === 0) { days_list = mockDays(city, days, budget); source = 'mock'; }
  if (days_list.length > days) days_list = days_list.slice(0, days);
  while (days_list.length < days) {
    const extra = mockDays(city, 1, budget);
    days_list.push({ ...extra[0], day: days_list.length + 1 });
  }
  const pois = days_list.flatMap((d) => d.items);
  const totalBudget = pois.reduce((s, it) => s + it.cost, 0);
  return { city, days, prefs, budget, days_list, totalBudget, pois, generatedAt: new Date().toISOString(), source };
}

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, time: new Date().toISOString() });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { city, days, prefs, budget, fromCity } = req.body || {};
    if (!city) return res.status(400).json({ error: 'city required' });
    const plan = await generatePlan({ city, days: Number(days) || 3, prefs: Array.isArray(prefs) ? prefs : [], budget: budget || 'comfort', fromCity });
    return res.status(200).json(plan);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'plan failed', source: 'plan-handler' });
  }
}
