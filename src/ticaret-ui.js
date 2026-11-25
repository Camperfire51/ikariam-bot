// Ticari rota paneli: deney panelinin hemen üstünde durur, diğer botlardan bağımsızdır.
(() => {
  const IB = window.IkaBot;
  if (!window.ikariam || !ikariam.model || window.top !== window) return;
  const T = IB.ticaret;

  const host = document.createElement('div');
  host.id = 'ikabot-ticaret-host';
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
    input, select { font:inherit; color:#1d1d1d !important; background:#ffffff !important; border:1px solid #b9a27a; border-radius:3px; padding:1px 3px; }
    .dot { width:9px; height:9px; border-radius:50%; background:#999; flex:none; }
    .dot.run { background:#5bd16b; } .dot.err { background:#ff5a4f; } .dot.pause { background:#f0b429; }
    .onoff { display:flex; align-items:center; gap:3px; font-size:11px; cursor:pointer; }
    .body { padding:8px 10px; display:grid; gap:8px; max-height:min(50vh, var(--ikabot-body-max, 50vh)); overflow:auto; }
    .collapsed .body { display:none; }
    .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
    button { font:inherit; padding:3px 9px; border-radius:4px; border:1px solid #6b4c22; background:#ffffff; color:#1d1d1d; cursor:pointer; }
    button.primary { font-weight:600; border-width:2px; }
    button:disabled { opacity:.45; cursor:default; }
    .status { padding:5px; border:1px solid #e6d6b3; border-radius:4px; white-space:pre-wrap; font-size:11px;
      max-height:6.6em; overflow:auto; overflow-wrap:anywhere; }
    .status.err { color:#b3392f; }
    .note { font-size:11px; color:#555555; }
    .box { border:1px solid #d9c49a; border-radius:6px; padding:6px 8px; display:grid; gap:5px; }
    .box h4 { margin:0; font-size:11px; }
    .grid { display:grid; grid-template-columns: auto 1fr; gap:4px 6px; align-items:center; }
    .grid select, .grid input { width:100%; }
    #retryMin { width:52px; }
    .routes { display:grid; gap:4px; }
    .route { border:1px solid #d9c49a; border-radius:6px; padding:4px 8px; }
    .route .top { display:flex; gap:6px; align-items:center; }
    .route .top span { flex:1; }
    .route .x { padding:0 6px; }
    .cs { font-size:11px; color:#555555; white-space:pre-wrap; max-height:4.4em; overflow:auto; overflow-wrap:anywhere; }
    .log { height:110px; overflow:auto; border:1px solid #d9c49a; border-radius:4px; padding:4px; font-size:11px; }
    .log div { border-bottom:1px dotted #e6d6b3; padding:1px 0; white-space:pre-wrap; user-select:text; }
    .log div.warn { color:#9a5b00; } .log div.error { color:#b3392f; font-weight:600; }
    ${IB.live.CSS}
  </style>
  <div class="panel collapsed" id="panel">
    <div class="head" id="head"><span class="dot" id="dot"></span><b id="title">Ticari Rota</b><label class="onoff" id="onoffLbl" title="Açıkken bot sürekli çalışır; sorun çıkarsa durmaz, tekrar tekrar dener. Kapatınca sadece ticari rota botu durur, diğer botlar çalışmaya devam eder. Hiçbir kayıt silinmez, açınca kaldığı yerden devam eder."><input type="checkbox" id="onoff"> Açık</label><span id="toggle">▲</span></div>${IB.live.HTML}
    <div class="body">
      <div class="status" id="status"></div>
      <div class="note">Her rota her gün yazılan saatte kaynak şehirden hedef şehre o miktarda hammadde gönderir (hep tam miktar, yarım gönderim yok). Gönderim mümkün değilse aşağıdaki ortak ayara göre tekrar denenir; ertesi günün aynı saatine kadar gönderilemezse o günkü istek geçersiz olur.</div>
      <div class="box">
        <h4>Ortak ayar (bütün rotalar)</h4>
        <div class="row">
          <label><input type="checkbox" id="retry"> Tekrar dene</label>
          <label>her <input type="number" id="retryMin" min="1" max="720"> dk</label>
        </div>
      </div>
      <div class="box">
        <h4>Yeni rota</h4>
        <div class="grid">
          <label for="from">Kaynak şehir</label><select id="from"></select>
          <label for="to">Hedef şehir</label><select id="to"></select>
          <label for="res">Hammadde</label><select id="res"></select>
          <label for="amount">Miktar</label><input type="number" id="amount" min="1" step="1" placeholder="örn. 5000">
          <label for="time">Saat</label><input type="time" id="time" value="08:00">
        </div>
        <div class="row"><button class="primary" id="add">+ Rota ekle</button></div>
      </div>
      <div class="routes" id="routes"></div>
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

  function fillSelects() {
    const opts = cities().map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
    for (const id of ['from', 'to']) {
      const v = $(id).value;
      $(id).innerHTML = opts;
      if (v) $(id).value = v;
    }
    if ($('to').selectedIndex === $('from').selectedIndex && $('to').options.length > 1) $('to').selectedIndex = $('from').selectedIndex === 0 ? 1 : 0;
    $('res').innerHTML = T.RES.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  }
  fillSelects();

  $('add').addEventListener('click', () => {
    const list = cities();
    const from = list.find((c) => c.id === Number($('from').value));
    const to = list.find((c) => c.id === Number($('to').value));
    const amount = Math.floor(Number($('amount').value));
    const time = $('time').value;
    if (!from || !to) return window.alert('Kaynak ve hedef şehri seç.');
    if (from.id === to.id) return window.alert('Kaynak ve hedef şehir aynı olamaz.');
    if (!(amount > 0)) return window.alert('Miktarı yaz (1 ya da daha fazla).');
    if (!/^\d{2}:\d{2}$/.test(time)) return window.alert('Saati yaz (SS:DD).');
    T.add({ fromId: from.id, fromName: from.name, toId: to.id, toName: to.name, res: $('res').value, amount, time });
    $('amount').value = '';
    render();
  });

  $('routes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-del]');
    if (!b) return;
    const id = Number(b.dataset.del);
    const r = T.routes.find((x) => x.id === id);
    if (r && window.confirm(`${T.label(r)} rotası silinsin mi?`)) T.remove(id);
    render();
  });

  const saveSettings = () => {
    T.setSettings({ retry: $('retry').checked, retryMin: $('retryMin').value });
    render();
  };
  $('retry').addEventListener('change', saveSettings);
  $('retryMin').addEventListener('change', saveSettings);

  // Ticari rota botunun tek aç/kapa düğmesi. Tıklamak paneli açıp kapamasın.
  $('onoffLbl').addEventListener('click', (e) => e.stopPropagation());
  $('onoff').addEventListener('change', () => {
    const pause = !$('onoff').checked;
    IB.setPaused('ticaret', pause);
    T.log(pause ? 'Ticari rota botu kapatıldı; rotalar ve kayıtlar korunuyor. Diğer botlar etkilenmez.' : 'Ticari rota botu açıldı; kaldığı yerden sürüyor.');
    render();
  });
  IB.onPauseChange((bot) => { if (bot === 'ticaret') render(); });

  function render() {
    const passive = T.passive;
    const paused = IB.isPaused('ticaret');
    const err = !paused && Object.keys(T._err).length > 0;
    $('onoff').checked = !paused;
    $('dot').className = 'dot ' + (paused ? 'pause' : err ? 'err' : 'run');
    $('title').textContent = `Ticari Rota (${T.routes.length} rota)${paused ? ' · KAPALI' : ''}`;
    $('status').textContent = passive ? 'Başka sekmede çalışıyor. Bu sekme sadece gösterir.' : T.status;
    $('status').classList.toggle('err', err);
    for (const id of ['add', 'retry', 'retryMin', 'from', 'to', 'res', 'amount', 'time']) $(id).disabled = passive;
    // Kullanıcı yazarken ayar kutularının üstüne yazılmasın.
    if (root.activeElement !== $('retryMin')) $('retryMin').value = T.settings.retryMin;
    $('retry').checked = T.settings.retry;
    $('retryMin').disabled = passive || !T.settings.retry;

    const html = [...T.routes]
      .sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id)
      .map((r) => {
        const st = T.routeStatus[r.id] || '';
        const cs = IB.live.line(esc(st || 'Bekliyor'), st, T.nextAt[r.id]);
        return `<div class="route"><div class="top"><span>${esc(T.label(r))}</span><button class="x" data-del="${r.id}" ${passive ? 'disabled' : ''} title="Rotayı sil">✕</button></div>${cs}</div>`;
      })
      .join('');
    if ($('routes').dataset.html !== html) {
      $('routes').innerHTML = html || '<div class="note">Henüz rota yok.</div>';
      $('routes').dataset.html = html;
    }

    $('log').innerHTML = T.getLog()
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
    try { localStorage.setItem('ikabot.ticaret.panelOpen', closed ? '0' : '1'); } catch (e) {}
    if (!closed) fillSelects();
  });
  try {
    if (localStorage.getItem('ikabot.ticaret.panelOpen') === '1') {
      $('panel').classList.remove('collapsed');
      $('toggle').textContent = '▼';
    }
  } catch (e) {}

  T.onChange(render);
  setInterval(render, 5000);
  const routeLabel = (id) => {
    const r = T.routes.find((x) => x.id === id);
    return r ? T.label(r) : `R${id}`;
  };
  liveTick = IB.live.attach(root, () => ({
    paused: IB.isPaused('ticaret'),
    passive: T.passive,
    running: T.routes.length > 0,
    status: T.status,
    current: T.current ? routeLabel(T.current) : null,
    items: T.routes.map((r) => ({ label: T.label(r), status: T.routeStatus[r.id], nextAt: T.nextAt[r.id] })),
  }));
  render();
})();
