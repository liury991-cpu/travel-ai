// 极简健康检查：无第三方依赖、无本地 import，用以隔离「Vercel 打包/运行时」与「业务代码」问题。
export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

export default async function handler(req: any, res: any) {
  return res.status(200).json({ ok: true, t: new Date().toISOString(), src: 'health' });
}
