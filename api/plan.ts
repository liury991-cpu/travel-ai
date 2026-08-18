// POST /api/plan  { city, days, prefs[], budget, fromCity? } → Plan
import { generatePlan } from './lib/plan';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
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
    return res.status(500).json({ error: e?.message || 'plan failed' });
  }
}
