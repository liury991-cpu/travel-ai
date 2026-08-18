// 腾讯地图封装：travel_guide(A2A) + poi_search(WebService)
// 关键发现：travel_guide 的 A2A 通道用 key=none，行程生成大概率无需 Key；
// 但前端 JSAPI 底图与 poi_search 仍需 TMAP_KEY。
import type { PoiCategory } from './types';

const A2A_URL = 'https://h5gw.map.qq.com/aichat/v1/a2a?key=none&apptag=lbs_ai_chat_a2a';

function randHex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export interface TravelGuideResult {
  plan_summary: any;
  plan_days: any[];
}

// 调腾讯 A2A 生成多日攻略，解析 SSE 里的 plan_summary / plan_day
export async function travelGuide(
  query: string,
  lat = 30.5728,
  lng = 104.0668,
): Promise<TravelGuideResult> {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'message/stream',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: query }],
        metadata: {
          brand: 'oppo',
          device_id: 'skill-' + randHex(16),
          latitude: lat,
          longitude: lng,
          osVersion: '16.1',
          theme: 'light',
          traceId: randHex(16),
        },
      },
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s 超时，快速 fallback
  try {
    const res = await fetch(A2A_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('A2A HTTP ' + res.status);
    const text = await res.text();
    return parseA2aText(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseA2aText(text: string): TravelGuideResult {
  if (text.trim().startsWith('<')) {
    throw new Error('A2A 返回 HTML 错误页，可能是海外 IP 被拦截');
  }


  let plan_summary: any = null;
  const plan_days: any[] = [];
  for (const blk of text.split('\n\n')) {
    if (!blk.trim()) continue;
    const dataLines = blk
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (!dataLines.length) continue;
    try {
      const ev = JSON.parse(dataLines.join('\n'));
      const r = ev?.result ?? {};
      if (r.kind !== 'artifact-update') continue;
      const art = r.artifact ?? {};
      const name = art.name ?? '';
      for (const p of art.parts ?? []) {
        if (!('data' in p)) continue;
        if (name === 'plan_summary') plan_summary = p.data;
        else if (name === 'plan_day') plan_days.push(p.data);
      }
    } catch {
      /* 忽略解析失败的单块 */
    }
  }
  if (!plan_summary && plan_days.length === 0) {
    throw new Error('A2A 未返回攻略数据（可能限流或服务不可用）');
  }
  return { plan_summary, plan_days };
}

// WebService 地点搜索（需要 TMAP_KEY）
export async function poiSearch(
  keyword: string,
  region: string,
  key: string,
  pageSize = 10,
): Promise<any[]> {
  const url = new URL('https://apis.map.qq.com/ws/place/v1/search');
  url.searchParams.set('key', key);
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('region', region);
  url.searchParams.set('page_size', String(pageSize));
  const res = await fetch(url);
  const json: any = await res.json();
  if (json.status !== 0) throw new Error('poi_search: ' + json.message);
  return json.data ?? [];
}

// —— 类别识别（腾讯返回项未必带类别，用名称关键词兜底）——
const CATEGORY_KEYWORDS: Record<PoiCategory, string[]> = {
  culture: ['博物馆', '文化', '故居', '遗址', '纪念', '书院', '古迹', '历史', '寺', '庙', '道观', '教堂', '馆'],
  night: ['夜市', '酒吧', '夜游', '演出', '剧场', 'live', 'club', 'ktv', '夜景', '灯光', '演艺'],
  food: ['美食', '餐厅', '小吃', '火锅', '串', '面', '饭', '菜', '餐', '食', '茶', '咖啡', '酒', '铺', '坊'],
  shopping: ['购物', '商场', '市场', '超市', '免税', '特产', '商圈', '街'],
  sight: ['景点', '景区', '公园', '山', '湖', '塔', '阁', '园', '广场', '城', '谷', '岭'],
};

export function classify(name: string): PoiCategory {
  for (const cat of ['culture', 'night', 'food', 'shopping', 'sight'] as PoiCategory[]) {
    if (CATEGORY_KEYWORDS[cat].some((k) => name.includes(k))) return cat;
  }
  return 'sight';
}
