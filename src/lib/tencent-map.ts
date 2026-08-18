// 动态加载腾讯地图 JSAPI GL（需 TMAP_KEY）
declare global {
  interface Window {
    TMap?: any;
    _tmapReady?: Promise<any>;
  }
}

export function loadTMap(key: string): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.TMap) return Promise.resolve(window.TMap);
  if (window._tmapReady) return window._tmapReady;

  window._tmapReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://map.qq.com/api/gljs?v=1&key=${key}`;
    script.async = true;
    script.onload = () => resolve(window.TMap);
    script.onerror = () => reject(new Error('腾讯地图脚本加载失败，请检查 TMAP_KEY'));
    document.head.appendChild(script);
  });
  return window._tmapReady;
}

// 生成带序号 + 类别色的圆形 SVG 图钉（data URI）
export function makePin(color: string, num: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'>
    <circle cx='17' cy='17' r='15' fill='${color}' stroke='white' stroke-width='3'/>
    <text x='17' y='22' font-size='15' font-weight='700' fill='white' text-anchor='middle' font-family='system-ui'>${num}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
