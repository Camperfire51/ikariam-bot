// Bot menüsü: sol altta duran tek çubuk. Tıklayınca bütün bot panelleri birlikte gizlenir ya da gösterilir; paneller
// açıkken çubuğun üstüne dizilir. Kapalıyken de her botun durum rengi (bkz. src/live.js) çubukta görünür.
// Seçim (açık/kapalı) sayfa yenilense de korunur. Botlar gizliyken de çalışmaya devam eder.
(() => {
  const IB = window.IkaBot;
  if (!window.ikariam || !ikariam.model || window.top !== window) return;

  const KEY = 'ikabot.dock';
  const GAP = 6;
  // Çubuğa konan botlar: panel kutusu id'si → kısa ad (modülü kaldırılmış bot listelenmez).
  const BOTS = [
    ['ikabot-host', 'Barbar'],
    ['ikabot-build-host', 'İnşaat'],
    ['ikabot-research-host', 'Araştırma'],
    ['ikabot-deney-host', 'Deney'],
  ];

  // Paneller gizliyken sayfaya yer açılır; güncelleme uyarısı ve çubuğun kendisi gizlenmez.
  const style = document.createElement('style');
  style.textContent = 'html[data-ikabot-dock="closed"] [id^="ikabot-"]:not(#ikabot-dock):not(#ikabot-update) { display:none !important; }';
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.id = 'ikabot-dock';
  host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; color-scheme: light only; }
      * { box-sizing: border-box; }
      .bar { font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color:#1d1d1d; background:#ffffff;
        border:1px solid #a58552; border-radius:8px; box-shadow:0 4px 18px rgba(0,0,0,.35); padding:5px 10px;
        display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none; width:370px; }
      b { color:#1d1d1d; }
      .bots { flex:1; display:flex; gap:9px; flex-wrap:wrap; }
      .bot { display:flex; align-items:center; gap:4px; font-size:11px; color:#444444; }
      .d { width:8px; height:8px; border-radius:50%; background:#9a9a9a; }
      .d.good { background:#2e9e44; } .d.bad { background:#d93a2f; }
      .arrow { color:#1d1d1d; }
    </style>
    <div class="bar" id="bar" title="Bütün bot panellerini gizle / göster (botlar çalışmaya devam eder)">
      <b>Ikariam Bot</b><span class="bots" id="bots"></span><span class="arrow" id="arrow"></span>
    </div>`;
  const $ = (id) => root.getElementById(id);

  const isOpen = () => document.documentElement.getAttribute('data-ikabot-dock') !== 'closed';
  function set(open) {
    document.documentElement.setAttribute('data-ikabot-dock', open ? 'open' : 'closed');
    $('arrow').textContent = open ? '▼ gizle' : '▲ göster';
    try {
      localStorage.setItem(KEY, open ? 'open' : 'closed');
    } catch (e) {}
    // Paneller yerini yeniden hesaplasın: alttakiler önce yerleşir, üsttekiler onlara göre (birkaç adımda).
    for (const ms of [0, 60, 200, 500]) setTimeout(() => window.dispatchEvent(new Event('resize')), ms);
  }
  let saved = 'open';
  try {
    saved = localStorage.getItem(KEY) || 'open';
  } catch (e) {}
  set(saved !== 'closed');
  $('bar').addEventListener('click', () => set(!isOpen()));

  // Her botun canlı satırının rengi çubuktaki noktaya yansır; satırın yazısı noktanın ipucudur.
  function tick() {
    const html = BOTS.map(([id, name]) => {
      const h = document.getElementById(id);
      if (!h || !h.shadowRoot) return '';
      const live = h.shadowRoot.getElementById('live');
      const tone = live ? (live.className.match(/t-(good|bad|idle)/) || [])[1] || 'idle' : 'idle';
      const tip = live ? live.textContent.replace(/"/g, '&quot;') : '';
      return `<span class="bot" title="${tip}"><span class="d ${tone}"></span>${name}</span>`;
    }).join('');
    if ($('bots').innerHTML !== html) $('bots').innerHTML = html;
  }
  setInterval(tick, 1000);
  setTimeout(tick, 500);

  // En alttaki panelin oturacağı yükseklik (px): çubuğun hemen üstü.
  IB.dock = { base: () => 12 + (host.getBoundingClientRect().height || 30) + GAP };
})();
