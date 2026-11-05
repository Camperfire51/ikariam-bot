// Deney botu paneli: araştırma panelinin hemen üstünde durur, diğer botlardan bağımsızdır.
(() => {
  const IB = window.IkaBot;
  if (!window.ikariam || !ikariam.model || window.top !== window) return;
  const D = IB.deney;

  const host = document.createElement('div');
  host.id = 'ikabot-deney-host';
  host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  if (IB.dock) IB.dock.add(host); // yerini bot menüsü (src/dock.js) belirler

  root.innerHTML = `
  <style>
    :host { all: initial; color-scheme: light only; }
    * { color-scheme: light only; forced-color-adjust: none; box-sizing: border-box; }
    .panel { font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d1d1d; background: #ffffff;
      border: 1px solid #a58552; border-radius: 8px; box-shadow: 0 4px 18px rgba(0,0,0,.35); width: 370px; overflow: hidden; }
    .head { display:flex; align-items:center; gap:8px; padding:6px 10px; background:#ffffff; border-bottom:1px solid #d9c49a;
      cursor:pointer; user-select:none; }
    .head b { flex:1; font-size:12px; }
    label, span, div, li, b { color:#1d1d1d; }
    input { color:#1d1d1d !important; background:#ffffff !important; }
    .dot { width:9px; height:9px; border-radius:50%; background:#999; flex:none; }
    .dot.run { background:#5bd16b; } .dot.err { background:#ff5a4f; } .dot.pause { background:#f0b429; }
    .onoff { display:flex; align-items:center; gap:3px; font-size:11px; cursor:pointer; }
    .body { padding:8px 10px; display:grid; gap:8px; max-height:min(50vh, var(--ikabot-body-max, 50vh)); overflow:auto; }
    .collapsed .body { display:none; }
    .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
    button { font:inherit; padding:3px 9px; border-radius:4px; border:1px solid #6b4c22; background:#ffffff; color:#1d1d1d; cursor:pointer; }
    button.primary { font-weight:600; border-width:2px; }
    button:disabled { opacity:.45; cursor:default; }
    .status { padding:5px; border:1px solid #e6d6b3; border-radius:4px; white-space:pre-wrap; font-size:11px; }
    .status.err { color:#b3392f; }
    .note { font-size:11px; color:#555555; }
    .cities { border:1px solid #d9c49a; border-radius:6px; padding:5px 8px; display:grid; gap:4px; }
    .city label { display:flex; align-items:center; gap:6px; cursor:pointer; }
    .cs { font-size:11px; color:#555555; white-space:pre-wrap; margin-left:22px; }
    .log { height:110px; overflow:auto; border:1px solid #d9c49a; border-radius:4px; padding:4px; font-size:11px; }
    .log div { border-bottom:1px dotted #e6d6b3; padding:1px 0; white-space:pre-wrap; user-select:text; }
    .log div.warn { color:#9a5b00; } .log div.error { color:#b3392f; font-weight:600; }
    ${IB.live.CSS}
  </style>
  <div class="panel collapsed" id="panel">
    <div class="head" id="head"><span class="dot" id="dot"></span><b id="title">Deney Botu</b><label class="onoff" id="onoffLbl" title="Kapatınca sadece deney botu duraklar; diğer botlar çalışmaya devam eder. Hiçbir kayıt silinmez, açınca kaldığı yerden devam eder."><input type="checkbox" id="onoff"> Açık</label><span id="toggle">▲</span></div>${IB.live.HTML}
    <div class="body">
      <div class="row">
        <button class="primary" id="start">Başlat</button>
        <button id="stop">Durdur</button>
      </div>
      <div class="status" id="status"></div>
      <div class="note">Seçili şehirlerin akademisinde kristalle deney yapılır; bekleme süresi ya da kristal eksikse beklenir. Ambrosialı deneye dokunulmaz. Şehir seçimi çalışırken de değiştirilebilir.</div>
      <div class="cities" id="cities"></div>
      <div class="log" id="log"></div>
    </div>
  </div>`;

  const $ = (id) => root.getElementById(id);
  let liveTick = () => {}; // canlı satır (bkz. IB.live.attach); render sonrası geri sayımları hemen doldurur
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function cities() {
    try {
      const r = ikariam.model.relatedCityData || {};
      return Object.keys(r)
        .filter((k) => k.startsWith('city_') && r[k].relationship === 'ownCity')
        .map((k) => ({ id: Number(r[k].id), label: `${String(r[k].coords || '').trim()} ${r[k].name}`, name: r[k].name }));
    } catch (e) {
      return [];
    }
  }

  $('cities').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-city]');
    if (!cb) return;
    const id = Number(cb.dataset.city);
    const c = cities().find((x) => x.id === id);
    D.setCity(id, c ? c.name : String(id), cb.checked);
    render();
  });

  $('start').addEventListener('click', () => {
    if (!D.cities.length) {
      window.alert('Önce en az bir şehir seç.');
      return;
    }
    if (!window.confirm('Deney botu başlasın mı? Seçili şehirlerde imkan oldukça kristal harcanarak deney yapılacak. Ambrosia kullanılmaz.')) return;
    D.start();
    render();
  });
  $('stop').addEventListener('click', () => { D.stop(); render(); });

  // Sadece deney botunun aç/kapa tiki. Tıklamak paneli açıp kapamasın.
  $('onoffLbl').addEventListener('click', (e) => e.stopPropagation());
  $('onoff').addEventListener('change', () => {
    const pause = !$('onoff').checked;
    IB.setPaused('deney', pause);
    D.log(pause ? 'Deney botu duraklatıldı; şehir listesi ve kayıtlar korunuyor. Diğer botlar etkilenmez.' : 'Deney botu devam ettirildi; kaldığı yerden sürüyor.');
    render();
  });
  IB.onPauseChange((bot) => { if (bot === 'deney') render(); });

  function render() {
    const passive = D.passive;
    const err = !D.running && /^Durdu: /.test(D.status);
    const paused = IB.isPaused('deney');
    $('onoff').checked = !paused;
    $('dot').className = 'dot ' + (paused ? 'pause' : D.running ? 'run' : err ? 'err' : '');
    $('title').textContent = `Deney Botu (${D.cities.length} şehir${D.running ? ', çalışıyor' : ''})${paused ? ' · DURAKLATILDI' : ''}`;
    $('start').disabled = D.running || passive;
    $('stop').disabled = !D.running || passive;
    $('status').textContent = passive ? 'Başka sekmede çalışıyor. Bu sekme sadece gösterir.' : D.status;
    $('status').classList.toggle('err', err);

    // Kullanıcı tıklarken listenin yeniden çizilip tıklamayı yutmaması için sadece içerik değiştiyse yazılır.
    const html = cities()
      .map((c) => {
        const on = D.has(c.id);
        const cs = D.running && on && D.cityStatus[c.id] ? IB.live.line(esc(D.cityStatus[c.id]), D.cityStatus[c.id], D.nextAt[c.id]) : '';
        return `<div class="city"><label><input type="checkbox" data-city="${c.id}" ${on ? 'checked' : ''} ${passive ? 'disabled' : ''}>${esc(c.label)}</label>${cs}</div>`;
      })
      .join('');
    if ($('cities').dataset.html !== html) {
      $('cities').innerHTML = html || '<div class="note">Şehir listesi okunamadı.</div>';
      $('cities').dataset.html = html;
    }

    $('log').innerHTML = D.getLog()
      .slice(-100)
      .reverse()
      .map((e) => `<div class="${e.level}">${new Date(e.t).toLocaleString('tr-TR')} — ${esc(e.msg)}</div>`)
      .join('');
    liveTick();
  }

  $('head').addEventListener('click', () => {
    $('panel').classList.toggle('collapsed');
    const closed = $('panel').classList.contains('collapsed');
    $('toggle').textContent = closed ? '▲' : '▼';
    try { localStorage.setItem('ikabot.deney.panelOpen', closed ? '0' : '1'); } catch (e) {}
  });
  try {
    if (localStorage.getItem('ikabot.deney.panelOpen') === '1') {
      $('panel').classList.remove('collapsed');
      $('toggle').textContent = '▼';
    }
  } catch (e) {}

  D.onChange(render);
  setInterval(render, 5000);
  const cityLabel = (id) => (D.cities.find((c) => c.cityId === id) || {}).cityName || String(id);
  liveTick = IB.live.attach(root, () => ({
    paused: IB.isPaused('deney'),
    passive: D.passive,
    running: D.running,
    status: D.status,
    current: D.current ? cityLabel(D.current) : null,
    items: D.cities.map((c) => ({ label: c.cityName, status: D.cityStatus[c.cityId], nextAt: D.nextAt[c.cityId] })),
  }));
  render();
})();
