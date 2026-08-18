// POST /api/trains  { from, to, date? } → 12306 余票 + 估算票价
import { queryTrains, estimateFare } from './lib/railway';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const { from, to, date } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from/to required' });
    const d = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const trains = await queryTrains(from, to, d);
    const fare = estimateFare(from, to);
    const trainsWithPrice = trains.map((t) => ({ ...t, prices: fare }));
    return res.status(200).json({
      date: d,
      from,
      to,
      trains: trainsWithPrice,
      fareNote: '票价为城市间距估算（非 12306 实时价），可在 lib/railway.ts 接入官方查价接口',
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'train query failed' });
  }
}
