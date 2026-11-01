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
      .arrow { color:#1d1d1d; white-space:nowrap; }
      button { font:inherit; font-size:11px; padding:1px 7px; border-radius:4px; border:1px solid #6b4c22; background:#ffffff;
        color:#1d1d1d; cursor:pointer; white-space:nowrap; }
      button.ok { color:#1e7d32; border-color:#1e7d32; } button.fail { color:#b3392f; border-color:#b3392f; }
    </style>
    <div class="bar" id="bar" title="Bütün bot panellerini gizle / göster (botlar çalışmaya devam eder)">
      <b>Ikariam Bot</b><span class="bots" id="bots"></span>
      <button id="copy" title="Bütün botların günlüklerini, durumlarını ve ayarlarını tek metin olarak panoya kopyalar (sorun bildirmek için). Oturum anahtarı eklenmez.">📋 Günlük</button>
      <span class="arrow" id="arrow"></span>
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

  // ---------- Tanı dökümü ("📋 Günlük") ----------
  // Sorun bildirmek için tek metin: sürüm, her botun canlı durumu ve bu oyun sayfasındaki bütün bot kayıtları
  // (günlükler, ayarlar, sıralar, deney botunun sakladığı akademi ekranı). Oturum anahtarı ve kilitler eklenmez.
  const scrub = (s) => String(s).replace(/actionRequest(["'=:\\]+)[0-9a-f]{20,}/gi, 'actionRequest$1…');
  function report() {
    const L = window.IkaBotLoader || {};
    const out = [
      `Ikariam Bot tanı dökümü — ${new Date().toLocaleString('tr-TR')}`,
      `Sürüm: ${L.version || 'yerel eklenti'} · kapalı modüller: ${(L.off || []).join(', ') || 'yok'} · sunucu: ${location.host}`,
      `Tarayıcı: ${navigator.userAgent}`,
      '',
      '== Canlı durum ==',
    ];
    for (const [id, name] of BOTS) {
      const h = document.getElementById(id);
      if (!h || !h.shadowRoot) {
        out.push(`${name}: (yüklü değil)`);
        continue;
      }
      const live = h.shadowRoot.getElementById('live');
      out.push(`${name}: ${live ? live.textContent : '?'}`);
      // Panel içindeki şehir/rotasyon durum satırları.
      for (const el of h.shadowRoot.querySelectorAll('.cs, [data-k="status"]')) {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push(`   · ${t}`);
      }
    }
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ikabot.') && !/\.lock$/.test(k)) keys.push(k);
    }
    // Sohbete yapıştırılınca kesilmesin diye kısa tutulur (~40 KB): önce deney ekranı ve deney günlüğü (en çok
    // sorun çıkan yer), sonra diğer günlüklerin son kayıtları, en son ayarlar (her biri kısaltılmış).
    const rank = (k) => (k === 'ikabot.deney.academyDump' ? 0 : k === 'ikabot.deney.log' ? 1 : /\.log$/.test(k) ? 2 : 3);
    keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    for (const k of keys) {
      const v = localStorage.getItem(k) || '';
      let list = null;
      try {
        list = /\.log$/.test(k) ? JSON.parse(v) : null;
      } catch (e) {}
      if (Array.isArray(list)) {
        const last = list.slice(-LOG_LINES);
        out.push('', `== ${k} (son ${last.length} / ${list.length} kayıt) ==`);
        for (const e of last) out.push(`${new Date(e.t).toLocaleString('tr-TR')} [${e.level}] ${e.msg}`);
      } else {
        const max = rank(k) === 0 ? 20000 : 1500;
        out.push('', `== ${k} (${v.length} karakter) ==`, v.length > max ? v.slice(0, max) + ' …(kesildi)' : v);
      }
    }
    return scrub(out.join('\n'));
  }
  const LOG_LINES = 40;

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Pano izni yoksa eski yöntem.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  $('copy').addEventListener('click', async (e) => {
    e.stopPropagation(); // çubuğa tıklama sayılmasın (panelleri gizleyip göstermesin)
    const b = $('copy');
    const text = report();
    const ok = await copyText(text);
    b.className = ok ? 'ok' : 'fail';
    b.textContent = ok ? `✓ kopyalandı (${Math.ceil(text.length / 1024)} KB)` : '✕ kopyalanamadı';
    setTimeout(() => {
      b.className = '';
      b.textContent = '📋 Günlük';
    }, 4000);
  });

  // En alttaki panelin oturacağı yükseklik (px): çubuğun hemen üstü.
  IB.dock = { base: () => 12 + (host.getBoundingClientRect().height || 30) + GAP };
})();
