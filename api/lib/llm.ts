// LLM 行程引擎（OpenAI 兼容接口，区域无关，可作为腾讯 A2A 的兜底）
// 通过环境变量激活：LLM_API_KEY（必填）、LLM_BASE_URL（默认 DeepSeek）、LLM_MODEL（默认 deepseek-chat）
import type { PlanDay, PlanItem, PoiCategory } from './types';
import { classify } from './tencent';

const BUDGET_HINT: Record<string, string> = {
  economy: '经济型（控制人均花费）',
  comfort: '舒适型（兼顾体验与性价比）',
  luxury: '豪华型（优先品质与私密）',
};

const CATS: PoiCategory[] = ['sight', 'culture', 'food', 'shopping', 'night'];

export async function llmPlan(opts: {
  city: string;
  days: number;
  prefs: string[];
  budget: string;
}): Promise<PlanDay[]> {
  const base = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  if (!key) throw new Error('LLM_API_KEY 未配置');

  const budgetText = BUDGET_HINT[opts.budget] || BUDGET_HINT.comfort;
  const sys = `你是一名专业的旅行行程规划师。用户给出目的地城市、天数、兴趣偏好与预算档位，你需要生成一份详细、可执行的多日行程。
输出要求：
- 每天安排 4-6 个地点（POI），必须按时间先后排序。
- 每个 POI 包含字段：name（中文景点/店铺名）、category（只能是 sight/culture/food/shopping/night 之一）、time（HH:MM 24 小时制到达时间）、lat（纬度，尽量准确）、lng（经度，尽量准确）、cost（该点人均花费估算，单位人民币元，按预算档位取值）、durationMin（建议停留分钟数）、desc（一句话亮点介绍）。
- 必须只输出一个纯 JSON 对象，结构严格为：{"days":[{"day":1,"title":"第1天·主题","items":[{...}]}]}，不要任何解释文字、不要 markdown 代码块。
- 坐标使用 GCJ-02/WGS84 近似即可，知名地点请尽量精确，便于地图打点。
- 兼顾用户偏好（历史文化 / 美食 / 自然 / 夜生活 / 购物），并融入当地特色。`;

  const user = `请为「${opts.city}」规划 ${opts.days} 天行程。兴趣偏好：${
    opts.prefs.join('、') || '综合（历史、美食、自然、夜生活、购物均衡）'
  }。预算档位：${budgetText}。`;

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('LLM HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  const j: any = await res.json();
  const content: string = j?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  const daysRaw: any[] = parsed?.days ?? [];
  if (!daysRaw.length) throw new Error('LLM 未返回有效行程');

  return daysRaw.map((d: any, i: number) => ({
    day: i + 1,
    title: d.title || `第 ${i + 1} 天`,
    items: (d.items || []).map((p: any, k: number) => {
      const name = p.name || '未命名地点';
      const category = CATS.includes(p.category) ? (p.category as PoiCategory) : classify(name);
      return {
        id: `${i + 1}-${k + 1}`,
        day: i + 1,
        time: p.time || `${9 + k}:00`,
        name,
        category,
        lat: Number(p.lat || 0),
        lng: Number(p.lng || 0),
        cost: Number(p.cost || 0),
        durationMin: Number(p.durationMin || 90),
        desc: p.desc || '',
      } as PlanItem;
    }),
  }));
}

function extractJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    /* ignore */
  }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* ignore */
    }
  }
  return null;
}
