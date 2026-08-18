// POST /api/flights  { from, to, date? } → 机票比价（演示数据）
import { mockFlights } from './lib/flights';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { from, to, date } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from/to required' });
    const flights = mockFlights(from, to, date);
    return res.status(200).json({
      from,
      to,
      date,
      flights,
      note: '机票为演示数据；接入真实比价 API 后替换 lib/flights.ts，路由与前端无需改动',
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'flight query failed' });
  }
}
