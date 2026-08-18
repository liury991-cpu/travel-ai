import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from './lib/supabase';
import { loadTMap, makePin } from './lib/tencent-map';
import type { Plan, PlanItem, PoiCategory, TrainOption, FlightOption } from './lib/types';

const TMAP_KEY = (import.meta.env.VITE_TMAP_KEY as string) || '';

const CATEGORIES: Record<PoiCategory, { label: string; color: string; emoji: string }> = {
  sight: { label: '景点', color: '#3b62ff', emoji: '🏞️' },
  food: { label: '美食', color: '#ff7a45', emoji: '🍜' },
  culture: { label: '文化', color: '#8b5cf6', emoji: '🏛️' },
  night: { label: '夜生活', color: '#ec4899', emoji: '🌃' },
  shopping: { label: '购物', color: '#10b981', emoji: '🛍️' },
};

const PREF_OPTIONS = ['历史文化', '美食', '自然', '夜生活', '购物', '亲子'];
const BUDGET_OPTIONS = [
  { id: 'economy', label: '经济' },
  { id: 'comfort', label: '舒适' },
  { id: 'luxury', label: '豪华' },
];

interface SavedPlan {
  id: string;
  city: string;
  title: string;
  days: number;
  total_budget: number | null;
  created_at: string;
  data?: Plan;
}

export default function App() {
  const [form, setForm] = useState({
    city: '成都',
    days: 3,
    prefs: [] as string[],
    budget: 'comfort',
    fromCity: '',
  });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeDay, setActiveDay] = useState(1);
  const [selected, setSelected] = useState<PlanItem | null>(null);

  const [trainForm, setTrainForm] = useState({ from: '北京', to: '成都', date: '' });
  const [trains, setTrains] = useState<TrainOption[]>([]);
  const [flights, setFlights] = useState<FlightOption[]>([]);
  const [transportLoading, setTransportLoading] = useState(false);

  const [user, setUser] = useState<any>(null);
  const [saved, setSaved] = useState<SavedPlan[]>([]);
  const [showPlans, setShowPlans] = useState(false);
  const [dark, setDark] = useState(false);
  const [mapStatus, setMapStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const infoRef = useRef<any>(null);

  // —— 登录态 ——
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadSaved = async () => {
    const { data } = await supabase
      .from('itineraries')
      .select('id,city,title,days,total_budget,created_at')
      .order('created_at', { ascending: false });
    setSaved((data as SavedPlan[]) ?? []);
  };

  // —— 生成行程 ——
  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPlan(data);
      setActiveDay(1);
      setSelected(null);
    } catch (e: any) {
      alert('生成失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // —— 交通查询 ——
  const queryTransport = async () => {
    setTransportLoading(true);
    try {
      const [t, f] = await Promise.all([
        fetch('/api/trains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trainForm),
        }).then((r) => r.json()),
        fetch('/api/flights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trainForm),
        }).then((r) => r.json()),
      ]);
      setTrains(t.trains ?? []);
      setFlights(f.flights ?? []);
    } catch (e: any) {
      alert('交通查询失败：' + e.message);
    } finally {
      setTransportLoading(false);
    }
  };

  const savePlan = async () => {
    if (!user) return alert('请先登录');
    if (!plan) return;
    const { error } = await supabase.from('itineraries').insert({
      user_id: user.id,
      city: plan.city,
      title: `${plan.city}${plan.days}天行程`,
      days: plan.days,
      prefs: plan.prefs,
      budget_tier: plan.budget,
      data: plan,
      total_budget: plan.totalBudget,
    });
    if (error) alert('保存失败：' + error.message);
    else {
      alert('已保存到「我的行程」');
      loadSaved();
    }
  };

  const openSaved = async (id: string) => {
    const { data } = await supabase
      .from('itineraries')
      .select('data')
      .eq('id', id)
      .single();
    if (data?.data) {
      setPlan(data.data as Plan);
      setActiveDay(1);
      setShowPlans(false);
    }
  };

  const login = () =>
    supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin },
    });
  const logout = () => supabase.auth.signOut();

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
  };

  // —— 地图：按天打点 + 连线 ——
  const dayItems = useMemo(
    () => (plan ? plan.days_list.find((d) => d.day === activeDay)?.items ?? [] : []),
    [plan, activeDay],
  );

  useEffect(() => {
    if (!plan || !mapEl.current) return;
    if (!TMAP_KEY) {
      setMapStatus('error');
      return;
    }
    let cancelled = false;
    setMapStatus('loading');
    loadTMap(TMAP_KEY)
      .then((TMap) => {
        if (cancelled) return;
        if (!mapRef.current) {
          const c = plan.pois[0] ?? { lat: 30.5728, lng: 104.0668 };
          mapRef.current = new TMap.Map(mapEl.current, {
            center: new TMap.LatLng(c.lat, c.lng),
            zoom: 12,
          });
        }
        renderDay(TMap);
        setMapStatus('ready');
      })
      .catch((err) => {
        if (!cancelled) setMapStatus('error');
        // eslint-disable-next-line no-console
        console.warn('腾讯地图加载失败:', err?.message || err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, activeDay, TMAP_KEY]);

  function renderDay(TMap: any) {
    const items = dayItems;
    if (!items.length) return;
    const styles: any = {};
    const geometries = items.map((it, i) => {
      const color = CATEGORIES[it.category].color;
      styles['s' + i] = new TMap.MarkerStyle({ width: 34, height: 34, src: makePin(color, i + 1) });
      return {
        id: it.id,
        styleId: 's' + i,
        position: new TMap.LatLng(it.lat, it.lng),
        properties: { item: it },
      };
    });
    if (markersRef.current) markersRef.current.setGeometries(geometries);
    else markersRef.current = new TMap.MultiMarker({ map: mapRef.current, geometries, styles });

    markersRef.current.on('click', (e: any) => {
      const it = e?.geometry?.properties?.item;
      if (it) {
        setSelected(it);
        openInfo(TMap, it);
      }
    });

    const path = items.map((it) => new TMap.LatLng(it.lat, it.lng));
    if (polylineRef.current) polylineRef.current.setGeometries([{ id: 'route', paths: path }]);
    else
      polylineRef.current = new TMap.MultiPolyline({
        map: mapRef.current,
        geometries: [{ id: 'route', paths: path }],
        styles: {
          route: new TMap.PolylineStyle({ color: 0x3b62ff, width: 4, lineDash: 'dash', borderWidth: 0 }),
        },
      });

    const bounds = new TMap.LatLngBounds();
    items.forEach((it) => bounds.extend(new TMap.LatLng(it.lat, it.lng)));
    mapRef.current.fitBounds(bounds, 60);
  }

  function openInfo(TMap: any, it: PlanItem) {
    if (!infoRef.current)
      infoRef.current = new TMap.InfoWindow({
        map: mapRef.current,
        position: new TMap.LatLng(it.lat, it.lng),
        content: '',
        offset: { x: 0, y: -30 },
      });
    const c = CATEGORIES[it.category];
    infoRef.current.setPosition(new TMap.LatLng(it.lat, it.lng));
    infoRef.current.setContent(
      `<div style="padding:8px 12px;font:14px system-ui"><b>${it.name}</b><br/><span style="color:${c.color}">${c.label}</span> · ${it.time} · 约¥${it.cost}</div>`,
    );
    infoRef.current.open();
  }

  // 点击左侧卡片 → 地图飞行定位
  const flyTo = (it: PlanItem) => {
    setSelected(it);
    const TMap = (window as any).TMap;
    if (mapRef.current && TMap) {
      mapRef.current.panTo(new TMap.LatLng(it.lat, it.lng));
      openInfo(TMap, it);
    }
  };

  const cheapestTrain = useMemo(() => {
    const buyable = trains.filter((t) => t.canBuy && t.prices);
    return buyable.sort((a, b) => (a.prices!.second || 0) - (b.prices!.second || 0))[0];
  }, [trains]);
  const cheapestFlight = useMemo(
    () => [...flights].sort((a, b) => a.price - b.price)[0],
    [flights],
  );

  const togglePref = (p: string) =>
    setForm((f) => ({
      ...f,
      prefs: f.prefs.includes(p) ? f.prefs.filter((x) => x !== p) : [...f.prefs, p],
    }));

  return (
    <div className="min-h-screen">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 glass">
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="font-semibold tracking-tight flex items-center gap-2">
            <span className="text-brand-500">◆</span> 旅行 AI 助手
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={toggleDark}
              className="px-3 py-1.5 rounded-full glass card-hover"
              title="切换暗色"
            >
              {dark ? '☀️' : '🌙'}
            </button>
            <button
              onClick={() => {
                loadSaved();
                setShowPlans(true);
              }}
              className="px-3 py-1.5 rounded-full glass card-hover"
            >
              我的行程
            </button>
            {user ? (
              <button onClick={logout} className="px-3 py-1.5 rounded-full glass card-hover">
                {user.email?.split('@')[0]} · 退出
              </button>
            ) : (
              <button
                onClick={login}
                className="px-3 py-1.5 rounded-full bg-brand-600 text-white card-hover"
              >
                登录
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Banner */}
      <section className="aurora">
        <div className="max-w-7xl mx-auto px-5 py-12 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-brand-600 via-purple-500 to-cyan-500"
          >
            任意城市的智能旅行规划
          </motion.h1>
          <p className="mt-3 text-slate-500 dark:text-slate-400">
            输入目的地，自动生成兼顾历史、美食、自然与夜生活的多日行程，并在地图上打点连线。
          </p>

          {plan && (
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Badge label="天数" value={`${plan.days} 天`} />
              <Badge label="POI 数" value={`${plan.pois.length}`} />
              <Badge label="总预算" value={`¥${plan.totalBudget}`} />
            </div>
          )}
          {plan?.source === 'mock' && (
            <p className="mt-3 text-xs text-amber-600">
              当前为离线估算行程（未接入实时攻略）。配置 TMAP_KEY 后自动切换为腾讯真实攻略。
            </p>
          )}
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-5 py-8 grid lg:grid-cols-2 gap-6">
        {/* 左：表单 + 时间轴 */}
        <div className="space-y-6">
          <div className="glass rounded-2xl p-5">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="目的地城市">
                <input
                  className="input"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="如 成都 / 杭州 / 西安"
                />
              </Field>
              <Field label={`天数：${form.days}`}>
                <div className="flex items-center gap-2">
                  <button className="btn" onClick={() => setForm({ ...form, days: Math.max(1, form.days - 1) })}>
                    −
                  </button>
                  <span className="w-8 text-center font-semibold">{form.days}</span>
                  <button className="btn" onClick={() => setForm({ ...form, days: Math.min(7, form.days + 1) })}>
                    +
                  </button>
                </div>
              </Field>
            </div>

            <div className="mt-3">
              <div className="text-xs text-slate-500 mb-1.5">偏好</div>
              <div className="flex flex-wrap gap-2">
                {PREF_OPTIONS.map((p) => {
                  const on = form.prefs.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => togglePref(p)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${
                        on
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'glass border-slate-200 dark:border-white/10'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <div className="text-xs text-slate-500 mb-1.5">预算档位</div>
              <div className="relative flex p-1 rounded-full glass w-fit">
                {BUDGET_OPTIONS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setForm({ ...form, budget: b.id })}
                    className="relative px-4 py-1.5 text-sm rounded-full"
                  >
                    {form.budget === b.id && (
                      <motion.span
                        layoutId="budgetPill"
                        className="absolute inset-0 rounded-full bg-brand-600"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    <span className={`relative ${form.budget === b.id ? 'text-white' : ''}`}>
                      {b.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={generate}
              disabled={loading}
              className="mt-4 w-full py-3 rounded-xl bg-brand-600 text-white font-semibold card-hover disabled:opacity-60"
            >
              {loading ? '生成中…（首次约 30–50s）' : '生成行程'}
            </button>
          </div>

          {/* Day Tab */}
          {plan && (
            <div className="flex gap-2 flex-wrap">
              {plan.days_list.map((d) => (
                <button
                  key={d.day}
                  onClick={() => setActiveDay(d.day)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium relative ${
                    activeDay === d.day ? 'text-white' : 'glass'
                  }`}
                >
                  {activeDay === d.day && (
                    <motion.span
                      layoutId="dayPill"
                      className="absolute inset-0 rounded-xl bg-brand-600"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative">DAY {d.day}</span>
                </button>
              ))}
            </div>
          )}

          {/* 时间轴 */}
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {dayItems.map((it) => {
                const c = CATEGORIES[it.category];
                const on = selected?.id === it.id;
                return (
                  <motion.button
                    key={it.id}
                    layout
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    onClick={() => flyTo(it)}
                    className={`w-full text-left glass rounded-2xl p-4 flex gap-3 card-hover ${
                      on ? 'ring-2 ring-brand-500' : ''
                    }`}
                  >
                    <div
                      className="shrink-0 w-1.5 rounded-full"
                      style={{ background: c.color }}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{it.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: c.color + '22', color: c.color }}>
                          {c.emoji} {c.label}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {it.time} · 约 {it.durationMin ?? 90} 分钟 · 约 ¥{it.cost}
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>
            {plan && !dayItems.length && (
              <div className="glass rounded-2xl p-6 text-center text-slate-400">当天暂无安排</div>
            )}
          </div>

          {plan && user && (
            <button onClick={savePlan} className="w-full py-2.5 rounded-xl glass card-hover">
              💾 保存此行程到「我的行程」
            </button>
          )}
        </div>

        {/* 右：地图 + 交通 */}
        <div className="space-y-6">
          <div className="glass rounded-2xl overflow-hidden relative">
            <div ref={mapEl} className="h-[460px] w-full">
              {mapStatus !== 'ready' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 text-center z-10">
                  <div className="text-4xl mb-3">🗺️</div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-2">
                    {mapStatus === 'error' ? '地图暂时无法显示' : '地图加载中…'}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 max-w-sm mb-4">
                    {mapStatus === 'error'
                      ? '当前未配置腾讯位置服务 Key，或 Key 无效/未绑定当前域名。'
                      : '正在初始化腾讯地图…'}
                  </p>
                  {mapStatus === 'error' && (
                    <a
                      href="https://lbs.qq.com/dev/console/application/mine"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 transition"
                    >
                      去申请腾讯地图 Key
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 交通对比 */}
          <div className="glass rounded-2xl p-5">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="出发城市">
                <input className="input" value={trainForm.from} onChange={(e) => setTrainForm({ ...trainForm, from: e.target.value })} />
              </Field>
              <Field label="到达城市">
                <input className="input" value={trainForm.to} onChange={(e) => setTrainForm({ ...trainForm, to: e.target.value })} />
              </Field>
              <Field label="日期">
                <input type="date" className="input" value={trainForm.date} onChange={(e) => setTrainForm({ ...trainForm, date: e.target.value })} />
              </Field>
            </div>
            <button onClick={queryTransport} disabled={transportLoading} className="mt-3 w-full py-2.5 rounded-xl bg-brand-600 text-white font-semibold card-hover disabled:opacity-60">
              {transportLoading ? '查询中…' : '查高铁 / 机票'}
            </button>

            {(cheapestTrain || cheapestFlight) && (
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-brand-50 dark:bg-white/5 p-3">
                  <div className="text-xs text-slate-500">高铁最便宜（二等座估算）</div>
                  <div className="font-semibold text-lg mt-1">
                    {cheapestTrain ? `¥${cheapestTrain.prices!.second}` : '—'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {cheapestTrain ? `${cheapestTrain.trainCode} ${cheapestTrain.departTime}→${cheapestTrain.arriveTime}` : '无票'}
                  </div>
                </div>
                <div className="rounded-xl bg-emerald-50 dark:bg-white/5 p-3">
                  <div className="text-xs text-slate-500">机票最便宜</div>
                  <div className="font-semibold text-lg mt-1">
                    {cheapestFlight ? `¥${cheapestFlight.price}` : '—'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {cheapestFlight ? `${cheapestFlight.airline} ${cheapestFlight.departTime}→${cheapestFlight.arriveTime}` : '无数据'}
                  </div>
                </div>
              </div>
            )}

            {trains.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left p-1">车次</th>
                      <th className="p-1">出发→到达</th>
                      <th className="p-1">耗时</th>
                      <th className="p-1">二等座</th>
                      <th className="p-1">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trains.slice(0, 8).map((t, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-white/10">
                        <td className="p-1 font-medium">{t.trainCode}</td>
                        <td className="p-1 tabular-nums">{t.departTime}→{t.arriveTime}</td>
                        <td className="p-1 tabular-nums text-slate-500">{t.duration}</td>
                        <td className="p-1 tabular-nums">{t.prices ? `¥${t.prices.second}` : '—'}</td>
                        <td className={`p-1 ${t.canBuy ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {t.canBuy ? '可购' : '售罄'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {flights.length > 0 && (
              <div className="mt-3 text-xs text-slate-500">
                共 {flights.length} 个航班（演示数据）。接入真实比价 API 后此处显示实时价格。
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 我的行程抽屉 */}
      <AnimatePresence>
        {showPlans && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPlans(false)}
              className="fixed inset-0 bg-black/30 z-40"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              className="fixed right-0 top-0 h-full w-[360px] max-w-[90vw] glass z-50 p-5 overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">我的行程</h2>
                <button onClick={() => setShowPlans(false)} className="text-slate-400">✕</button>
              </div>
              {!user && <p className="text-sm text-slate-500">登录后可查看你保存的所有旅行计划。</p>}
              <div className="space-y-3">
                {saved.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => openSaved(s.id)}
                    className="w-full text-left glass rounded-xl p-3 card-hover"
                  >
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {s.days} 天 · 总预算 ¥{s.total_budget ?? '—'} · {new Date(s.created_at).toLocaleDateString('zh-CN')}
                    </div>
                  </button>
                ))}
                {user && saved.length === 0 && (
                  <p className="text-sm text-slate-500">还没有保存的行程，生成后点「保存」即可。</p>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl px-6 py-3 min-w-[120px]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-0.5 bg-clip-text text-transparent bg-gradient-to-r from-brand-600 to-cyan-500">
        {value}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      {children}
    </label>
  );
}
