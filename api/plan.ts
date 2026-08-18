// POST /api/plan  { city, days, prefs[], budget, fromCity? } → Plan
import { generatePlan } from './lib/plan';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  regions: ['hkg1'], // 香港节点，离大陆近，便于直连腾讯 A2A / 12306
};

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, time: new Date().toISOString() });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const { city, days, prefs, budget, fromCity } = req.body || {};
    if (!city) return res.status(400).json({ error: 'city required' });
    const plan = await generatePlan({
      city,
      days: Number(days) || 3,
      prefs: Array.isArray(prefs) ? prefs : [],
      budget: budget || 'comfort',
      fromCity,
    });
    return res.status(200).json(plan);
  } catch (e: any) {
    const stack = typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 4) : [];
    return res.status(500).json({
      error: e?.message || 'plan failed',
      stack,
      source: 'plan-handler',
    });
  }
}
