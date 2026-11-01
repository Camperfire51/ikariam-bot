// Araştırma sırası paneli: inşaat panelinin hemen üstünde durur, diğer botlardan bağımsızdır.
(() => {
  const IB = window.IkaBot;
  if (!window.ikariam || !ikariam.model || window.top !== window) return;
  const R = IB.research;
  const G = IB.uiGame;

  const host = document.createElement('div');
  host.id = 'ikabot-research-host';
  host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  // Alttaki panellerin (inşaat, o da barbarın üstünde) üstüne otur; onlar büyüyüp küçüldükçe yer değiştir.
  const below = ['ikabot-build-host', 'ikabot-host'].map((id) => document.getElementById(id)).filter(Boolean);
  function place() {
    requestAnimationFrame(() => {
      const top = Math.min(...below.map((el) => el.getBoundingClientRect().top), window.innerHeight - 4);
      host.style.bottom = (below.length ? window.innerHeight - top + 8 : 12) + 'px';
    });
  }
  if (window.ResizeObserver) below.forEach((el) => new ResizeObserver(place).observe(el));
  window.addEventListener('resize', place);
  place();

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
    .body { padding:8px 10px; display:grid; gap:8px; max-height:50vh; overflow:auto; }
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
  </style>
  <div class="panel collapsed" id="panel">
    <div class="head" id="head"><span class="dot" id="dot"></span><b id="title">Araştırma Sırası</b><label class="onoff" id="onoffLbl" title="Kapatınca sadece araştırma botu duraklar; barbar ve inşaat botları çalışmaya devam eder. Hiçbir kayıt silinmez, açınca kaldığı yerden devam eder."><input type="checkbox" id="onoff"> Açık</label><span id="toggle">▲</span></div>
    <div class="body">
      <div class="row">
        <button class="primary" id="start">Başlat</button>
        <button id="stop">Durdur</button>
      </div>
      <div class="status" id="status"></div>
      <div class="add">
        <label>Şehir <select id="city"></select></label>
        <label>Birim <select id="unit"><option value="">— önce şehir seç —</option></select></label>
        <label>Araştırma <select id="type"><option value="">— önce birim seç —</option></select></label>
        <label>Hedef seviye <input type="number" id="level" min="1" max="99"></label>
        <div class="row"><button id="add">+ Sıraya ekle</button><span id="addMsg" class="cs"></span></div>
      </div>
      <div id="queue" style="display:grid;gap:6px"></div>
      <div class="log" id="log"></div>
    </div>
  </div>`;

  const $ = (id) => root.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TYPES = ['offensive', 'defensive'];

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

  // Seçili şehrin atölyesi: { cityId, position, units } (birimler ve gemiler birlikte, oyundan okunur).
  let loaded = null;
  const selectedUnit = () => loaded && loaded.units.find((u) => u.id === Number($('unit').value));
  const upLabel = (up) =>
    `${up.typeName} (sv ${up.level}` +
    (up.next ? ` → ${up.next.level}${up.next.name ? ' ' + up.next.name : ''}` : ', en yüksek') +
    (up.error ? ` · ${up.error}` : '') +
    ')';

  $('city').addEventListener('change', async () => {
    const id = Number($('city').value);
    loaded = null;
    $('unit').innerHTML = '<option value="">yükleniyor…</option>';
    $('type').innerHTML = '<option value="">— önce birim seç —</option>';
    if (!id) {
      $('unit').innerHTML = '<option value="">— önce şehir seç —</option>';
      return;
    }
    try {
      const city = await G.city(id);
      const ws = G.findBuilding(city, 'workshop');
      if (Number($('city').value) !== id) return;
      if (!ws) {
        $('unit').innerHTML = '<option value="">bu şehirde mucit atölyesi yok</option>';
        return;
      }
      // Araştırması olmayanlar (kargo gemisi gibi) listelenmez.
      const researchable = (w) => w.units.filter((u) => u.offensive || u.defensive);
      const units = { units: researchable(await G.workshop(id, ws.index, 'tabUnits')) };
      const ships = { units: researchable(await G.workshop(id, ws.index, 'tabShips')) };
      if (Number($('city').value) !== id) return;
      const all = [...units.units, ...ships.units];
      loaded = { cityId: id, position: ws.index, units: all };
      const lv = (u) => TYPES.map((k) => (u[k] ? u[k].level : '-')).join('/');
      const opt = (u) => `<option value="${u.id}">${esc(u.name)} (saldırı/zırh sv ${lv(u)})</option>`;
      $('unit').innerHTML =
        '<option value="">— seç —</option>' +
        (units.units.length ? `<optgroup label="Birimler">${units.units.map(opt).join('')}</optgroup>` : '') +
        (ships.units.length ? `<optgroup label="Gemiler">${ships.units.map(opt).join('')}</optgroup>` : '');
      if (!all.length) $('unit').innerHTML = '<option value="">atölyede araştırılabilecek birim yok</option>';
    } catch (e) {
      $('unit').innerHTML = '<option value="">okunamadı: ' + esc(e.message) + '</option>';
    }
  });

  $('unit').addEventListener('change', () => {
    const u = selectedUnit();
    if (!u) {
      $('type').innerHTML = '<option value="">— önce birim seç —</option>';
      return;
    }
    $('type').innerHTML =
      '<option value="">— seç —</option>' +
      TYPES.filter((k) => u[k]).map((k) => `<option value="${k}">${esc(upLabel(u[k]))}</option>`).join('');
  });
  $('type').addEventListener('change', () => {
    const u = selectedUnit();
    const up = u && u[$('type').value];
    if (up) $('level').value = String(up.level + 1);
  });

  $('add').addEventListener('click', () => {
    const cityId = Number($('city').value);
    const msg = (t) => { $('addMsg').textContent = t; };
    const u = selectedUnit();
    const type = $('type').value;
    const up = u && u[type];
    const target = Number($('level').value);
    if (!cityId || !loaded || loaded.cityId !== cityId || !up) return msg('Şehir, birim ve araştırma seç.');
    if (!target || target <= up.level) return msg(`Hedef seviye ${up.level}'den büyük olmalı.`);
    if (!up.next) return msg('Bu araştırma zaten en yüksek seviyede.');
    const c = cities().find((x) => x.id === cityId);
    R.add({
      cityId,
      cityName: c ? c.name : String(cityId),
      position: loaded.position,
      unitId: u.id,
      unitName: u.name,
      upgradeType: type,
      typeName: up.typeName,
      targetLevel: target,
    });
    msg('Eklendi.');
    render();
  });

  $('start').addEventListener('click', () => {
    if (!window.confirm('Araştırma sırası başlasın mı? Bot sıradaki araştırmalar için gerçek emir verecek (altın ve kristal harcanır).')) return;
    R.start();
    render();
  });
  $('stop').addEventListener('click', () => { R.stop(); render(); });

  // Sadece araştırma botunun aç/kapa tiki. Tıklamak paneli açıp kapamasın.
  $('onoffLbl').addEventListener('click', (e) => e.stopPropagation());
  $('onoff').addEventListener('change', () => {
    const pause = !$('onoff').checked;
    IB.setPaused('arastirma', pause);
    R.log(pause ? 'Araştırma botu duraklatıldı; sıra ve kayıtlar korunuyor. Diğer botlar etkilenmez.' : 'Araştırma botu devam ettirildi; kaldığı yerden sürüyor.');
    render();
  });
  IB.onPauseChange((bot) => { if (bot === 'arastirma') render(); });

  $('queue').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || R.passive) return;
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'up') R.move(id, -1);
    if (b.dataset.act === 'down') R.move(id, 1);
    if (b.dataset.act === 'del') R.remove(id);
    render();
  });

  function render() {
    const passive = R.passive;
    const err = !R.running && /^Durdu: /.test(R.status);
    const paused = IB.isPaused('arastirma');
    $('onoff').checked = !paused;
    $('dot').className = 'dot ' + (paused ? 'pause' : R.running ? 'run' : err ? 'err' : '');
    $('title').textContent = `Araştırma Sırası (${R.items.length} iş${R.running ? ', çalışıyor' : ''})${paused ? ' · DURAKLATILDI' : ''}`;
    $('start').disabled = R.running || passive;
    $('stop').disabled = !R.running || passive;
    $('add').disabled = passive;
    $('status').textContent = passive ? 'Başka sekmede çalışıyor. Bu sekme sadece gösterir.' : R.status;
    $('status').classList.toggle('err', err);

    $('queue').innerHTML = R.cityIds()
      .map((cityId) => {
        const items = R.itemsOf(cityId);
        const rows = items
          .map(
            (it, i) => `<div class="item${i === 0 ? ' first' : ''}">
              <span class="t">${i + 1}. ${esc(it.unitName)} · ${esc(it.typeName)} → ${it.targetLevel}</span>
              <button class="mini" data-act="up" data-id="${it.id}" ${i === 0 || passive ? 'disabled' : ''}>↑</button>
              <button class="mini" data-act="down" data-id="${it.id}" ${i === items.length - 1 || passive ? 'disabled' : ''}>↓</button>
              <button class="mini danger" data-act="del" data-id="${it.id}" ${passive ? 'disabled' : ''}>✕</button>
            </div>`
          )
          .join('');
        const cs = R.running && R.cityStatus[cityId] ? `<div class="cs">${esc(R.cityStatus[cityId])}</div>` : '';
        return `<div class="city"><h4>${esc(items[0].cityName)}</h4>${rows}${cs}</div>`;
      })
      .join('');

    $('log').innerHTML = R.getLog()
      .slice(-100)
      .reverse()
      .map((e) => `<div class="${e.level}">${new Date(e.t).toLocaleString('tr-TR')} — ${esc(e.msg)}</div>`)
      .join('');
  }

  $('head').addEventListener('click', () => {
    $('panel').classList.toggle('collapsed');
    const closed = $('panel').classList.contains('collapsed');
    $('toggle').textContent = closed ? '▲' : '▼';
    try { localStorage.setItem('ikabot.arastirma.panelOpen', closed ? '0' : '1'); } catch (e) {}
  });
  try {
    if (localStorage.getItem('ikabot.arastirma.panelOpen') === '1') {
      $('panel').classList.remove('collapsed');
      $('toggle').textContent = '▼';
    }
  } catch (e) {}

  R.onChange(render);
  setInterval(render, 5000);
  render();
})();
