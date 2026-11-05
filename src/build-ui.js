// İnşaat sırası paneli: barbar panelinin hemen üstünde durur (yerleşim: src/dock.js), ondan bağımsızdır.
(() => {
  const IB = window.IkaBot;
  if (!window.ikariam || !ikariam.model || window.top !== window) return;
  const Q = IB.buildQueue;
  const G = IB.uiGame;

  const host = document.createElement('div');
  host.id = 'ikabot-build-host';
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
    select, option, input { color:#1d1d1d !important; background:#ffffff !important; }
    .dot { width:9px; height:9px; border-radius:50%; background:#999; flex:none; }
    .dot.run { background:#5bd16b; } .dot.err { background:#ff5a4f; } .dot.pause { background:#f0b429; }
    .onoff { display:flex; align-items:center; gap:3px; font-size:11px; cursor:pointer; }
    .body { padding:8px 10px; display:grid; gap:8px; max-height:min(60vh, var(--ikabot-body-max, 60vh)); overflow:auto; }
    .collapsed .body { display:none; }
    .add { border:1px solid #d9c49a; border-radius:6px; padding:6px 8px; display:grid; gap:5px; }
    label { display:grid; grid-template-columns: 90px 1fr; align-items:center; gap:6px; }
    select, input[type=number] { font:inherit; padding:2px 4px; border:1px solid #a58552; border-radius:4px; min-width:0; width:100%; }
    .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
    button { font:inherit; padding:3px 9px; border-radius:4px; border:1px solid #6b4c22; background:#ffffff; color:#1d1d1d; cursor:pointer; }
    button.primary { font-weight:600; border-width:2px; }
    button.danger { color:#b3392f; border-color:#b3392f; }
    button.mini { padding:0 6px; }
    button:disabled { opacity:.45; cursor:default; }
    .status { padding:5px; border:1px solid #e6d6b3; border-radius:4px; white-space:pre-wrap; font-size:11px; }
    .status.err { color:#b3392f; }
    .city { border:1px solid #d9c49a; border-radius:6px; padding:5px 8px; display:grid; gap:3px; }
    .city h4 { margin:0; font-size:12px; }
    .item { display:flex; align-items:center; gap:4px; }
    .item .t { flex:1; }
    .item.first .t { font-weight:600; }
    .cs { font-size:11px; color:#555555; white-space:pre-wrap; }
    .log { height:110px; overflow:auto; border:1px solid #d9c49a; border-radius:4px; padding:4px; font-size:11px; }
    .log div { border-bottom:1px dotted #e6d6b3; padding:1px 0; }
    .log div.warn { color:#9a5b00; } .log div.error { color:#b3392f; font-weight:600; }
    ${IB.live.CSS}
  </style>
  <div class="panel collapsed" id="panel">
    <div class="head" id="head"><span class="dot" id="dot"></span><b id="title">İnşaat Sırası</b><label class="onoff" id="onoffLbl" title="Kapatınca sadece inşaat botu duraklar; barbar ve araştırma botları çalışmaya devam eder. Hiçbir kayıt silinmez, açınca kaldığı yerden devam eder."><input type="checkbox" id="onoff"> Açık</label><span id="toggle">▲</span></div>${IB.live.HTML}
    <div class="body">
      <div class="row">
        <button class="primary" id="start">Başlat</button>
        <button id="stop">Durdur</button>
      </div>
      <div class="status" id="status"></div>
      <div class="add">
        <label>Şehir <select id="city"></select></label>
        <label>Bina <select id="building"><option value="">— önce şehir seç —</option></select></label>
        <label>Hedef seviye <input type="number" id="level" min="1" max="99"></label>
        <div class="row"><button id="add">+ Sıraya ekle</button><span id="addMsg" class="cs"></span></div>
      </div>
      <div id="queue" style="display:grid;gap:6px"></div>
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

  $('city').innerHTML =
    '<option value="">— seç —</option>' + cities().map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');

  let loadedCity = null; // seçili şehrin binaları
  $('city').addEventListener('change', async () => {
    const id = Number($('city').value);
    loadedCity = null;
    $('building').innerHTML = '<option value="">yükleniyor…</option>';
    if (!id) {
      $('building').innerHTML = '<option value="">— önce şehir seç —</option>';
      return;
    }
    try {
      const city = await G.city(id);
      if (Number($('city').value) !== id) return;
      loadedCity = city;
      const list = city.positions.filter((p) => p.level !== null && p.building && !/buildingGround/.test(p.building));
      $('building').innerHTML =
        '<option value="">— seç —</option>' +
        list
          .map((p) => `<option value="${p.index}">${esc(p.name || p.building.split(/\s+/)[0])} (sv ${p.level}${p.isBusy ? ', yapılıyor' : ''}) · yer ${p.index}</option>`)
          .join('');
    } catch (e) {
      $('building').innerHTML = '<option value="">okunamadı: ' + esc(e.message) + '</option>';
    }
  });
  $('building').addEventListener('change', () => {
    const p = loadedCity && loadedCity.positions[Number($('building').value)];
    if (p && $('building').value !== '') $('level').value = String(p.level + 1);
  });

  $('add').addEventListener('click', () => {
    const cityId = Number($('city').value);
    const pos = $('building').value;
    const target = Number($('level').value);
    const msg = (t) => { $('addMsg').textContent = t; };
    if (!cityId || pos === '' || !loadedCity || loadedCity.id !== cityId) return msg('Şehir ve bina seç.');
    const p = loadedCity.positions[Number(pos)];
    if (!p) return msg('Bina bulunamadı.');
    if (!target || target <= p.level) return msg(`Hedef seviye ${p.level}'den büyük olmalı.`);
    const c = cities().find((x) => x.id === cityId);
    Q.add({
      cityId,
      cityName: c ? c.name : String(cityId),
      position: Number(pos),
      building: p.building.split(/\s+/)[0],
      name: p.name || p.building.split(/\s+/)[0],
      targetLevel: target,
    });
    msg('Eklendi.');
    render();
  });

  $('start').addEventListener('click', () => {
    if (!window.confirm('İnşaat sırası başlasın mı? Bot sıradaki binalar için gerçek yükseltme emri verecek.')) return;
    Q.start();
    render();
  });
  $('stop').addEventListener('click', () => { Q.stop(); render(); });

  // Sadece inşaat botunun aç/kapa tiki. Tıklamak paneli açıp kapamasın.
  $('onoffLbl').addEventListener('click', (e) => e.stopPropagation());
  $('onoff').addEventListener('change', () => {
    const pause = !$('onoff').checked;
    IB.setPaused('insaat', pause);
    Q.log(pause ? 'İnşaat botu duraklatıldı; sıra ve kayıtlar korunuyor. Diğer botlar etkilenmez.' : 'İnşaat botu devam ettirildi; kaldığı yerden sürüyor.');
    render();
  });
  IB.onPauseChange((bot) => { if (bot === 'insaat') render(); });

  $('queue').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || Q.passive) return;
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'up') Q.move(id, -1);
    if (b.dataset.act === 'down') Q.move(id, 1);
    if (b.dataset.act === 'del') Q.remove(id);
    render();
  });

  function render() {
    const passive = Q.passive;
    const err = !Q.running && /^Durdu: /.test(Q.status);
    const paused = IB.isPaused('insaat');
    $('onoff').checked = !paused;
    $('dot').className = 'dot ' + (paused ? 'pause' : Q.running ? 'run' : err ? 'err' : '');
    $('title').textContent = `İnşaat Sırası (${Q.items.length} iş${Q.running ? ', çalışıyor' : ''})${paused ? ' · DURAKLATILDI' : ''}`;
    $('start').disabled = Q.running || passive;
    $('stop').disabled = !Q.running || passive;
    $('add').disabled = passive;
    $('status').textContent = passive ? 'Başka sekmede çalışıyor. Bu sekme sadece gösterir.' : Q.status;
    $('status').classList.toggle('err', err);

    $('queue').innerHTML = Q.cityIds()
      .map((cityId) => {
        const items = Q.itemsOf(cityId);
        const rows = items
          .map(
            (it, i) => `<div class="item${i === 0 ? ' first' : ''}">
              <span class="t">${i + 1}. ${esc(it.name)} → ${it.targetLevel}</span>
              <button class="mini" data-act="up" data-id="${it.id}" ${i === 0 || passive ? 'disabled' : ''}>↑</button>
              <button class="mini" data-act="down" data-id="${it.id}" ${i === items.length - 1 || passive ? 'disabled' : ''}>↓</button>
              <button class="mini danger" data-act="del" data-id="${it.id}" ${passive ? 'disabled' : ''}>✕</button>
            </div>`
          )
          .join('');
        const cs = Q.running && Q.cityStatus[cityId] ? IB.live.line(esc(Q.cityStatus[cityId]), Q.cityStatus[cityId], Q.nextAt[cityId]) : '';
        return `<div class="city"><h4>${esc(items[0].cityName)}</h4>${rows}${cs}</div>`;
      })
      .join('');

    $('log').innerHTML = Q.getLog()
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
    try { localStorage.setItem('ikabot.insaat.panelOpen', closed ? '0' : '1'); } catch (e) {}
  });
  try {
    if (localStorage.getItem('ikabot.insaat.panelOpen') === '1') {
      $('panel').classList.remove('collapsed');
      $('toggle').textContent = '▼';
    }
  } catch (e) {}

  Q.onChange(render);
  setInterval(render, 5000);
  const cityLabel = (id) => (Q.itemsOf(id)[0] || {}).cityName || String(id);
  liveTick = IB.live.attach(root, () => ({
    paused: IB.isPaused('insaat'),
    passive: Q.passive,
    running: Q.running,
    status: Q.status,
    current: Q.current ? cityLabel(Q.current) : null,
    items: Q.cityIds().map((id) => ({ label: cityLabel(id), status: Q.cityStatus[id], nextAt: Q.nextAt[id] })),
  }));
  render();
})();
