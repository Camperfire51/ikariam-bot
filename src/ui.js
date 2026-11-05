// Oyun ekranının üstünde duran kontrol paneli: her rotasyon için bir kart.
(() => {
  const IB = window.IkaBot;
  if (!window.ikariam || !ikariam.model || window.top !== window) return;
  const M = IB.manager;

  const host = document.createElement('div');
  host.id = 'ikabot-host';
  host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;';
  document.body.appendChild(host);
  if (IB.dock) IB.dock.add(host); // yerini bot menüsü (src/dock.js) belirler
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
  <style>
    :host { all: initial; color-scheme: light only; }
    * { color-scheme: light only; forced-color-adjust: none; box-sizing: border-box; }
    .panel { font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d1d1d; background: #ffffff;
      border: 1px solid #a58552; border-radius: 8px; box-shadow: 0 4px 18px rgba(0,0,0,.35); width: 370px; overflow: hidden; }
    .head { display:flex; align-items:center; gap:8px; padding:6px 10px; background:#ffffff; color:#1d1d1d;
      border-bottom:1px solid #d9c49a; cursor:pointer; user-select:none; }
    .head b { flex:1; font-size:12px; color:#1d1d1d; }
    label, span, div, li, h4, b { color:#1d1d1d; }
    select, option, input { color:#1d1d1d !important; background:#ffffff !important; }
    .dot { width:9px; height:9px; border-radius:50%; background:#999; flex:none; }
    .dot.run { background:#5bd16b; } .dot.err { background:#ff5a4f; } .dot.pause { background:#f0b429; }
    .onoff { display:flex; align-items:center; gap:3px; font-size:11px; cursor:pointer; }
    .body { padding:8px 10px; display:grid; gap:8px; max-height:min(75vh, var(--ikabot-body-max, 75vh)); overflow:auto; }
    .collapsed .body { display:none; }
    .card { border:1px solid #d9c49a; border-radius:6px; padding:6px 8px; display:grid; gap:5px; }
    .card.running { border-color:#5bd16b; }
    .card-head { display:flex; align-items:center; gap:6px; font-weight:600; }
    .card-head .title { flex:1; }
    label { display:grid; grid-template-columns: 120px 1fr; align-items:center; gap:6px; }
    label.chk { grid-template-columns: 18px 1fr; }
    select, input[type=number] { font:inherit; padding:2px 4px; border:1px solid #a58552; border-radius:4px; min-width:0; width:100%; }
    .row { display:flex; gap:6px; flex-wrap:wrap; }
    button { font:inherit; padding:3px 9px; border-radius:4px; border:1px solid #6b4c22; background:#ffffff; color:#1d1d1d; cursor:pointer; }
    button.primary { font-weight:600; border-width:2px; }
    button.danger { color:#b3392f; border-color:#b3392f; }
    button:disabled { opacity:.45; cursor:default; }
    .status { padding:5px; background:#ffffff; border:1px solid #e6d6b3; border-radius:4px; white-space:pre-wrap; font-size:11px; }
    .status.err { color:#b3392f; }
    .summary { font-size:11px; color:#555555; }
    .log { height:150px; overflow:auto; background:#ffffff; border:1px solid #d9c49a; border-radius:4px; padding:4px; font-size:11px; }
    .log div { border-bottom:1px dotted #e6d6b3; padding:1px 0; }
    .log div.warn { color:#9a5b00; } .log div.error { color:#b3392f; font-weight:600; }
    .tbl { border:1px solid #d9c49a; border-radius:6px; padding:6px 8px; display:grid; gap:6px; }
    .tbl-note { font-size:11px; color:#555555; }
    .tbl-note.err { color:#b3392f; }
    .lv { border:1px solid #e6d6b3; border-radius:4px; padding:4px 6px; display:grid; gap:4px; }
    .lv-head, .lv-unit { display:flex; align-items:center; gap:4px; }
    .lv-head span, .lv-unit span { font-size:11px; }
    .lv-head button { margin-left:auto; }
    .lv input[type=number] { width:50px; flex:none; }
    .lv input[data-t="level"] { width:42px; font-weight:600; }
    .lv select { width:auto; flex:1; }
    .lv button { padding:1px 6px; }
    ${IB.live.CSS}
  </style>
  <div class="panel collapsed" id="panel">
    <div class="head" id="head"><span class="dot" id="dot"></span><b id="headTitle">Barbar Rotasyonu</b><label class="onoff" id="onoffLbl" title="Kapatınca sadece barbar botu duraklar; inşaat ve araştırma botları çalışmaya devam eder. Hiçbir kayıt silinmez, açınca kaldığı yerden devam eder."><input type="checkbox" id="onoff"> Açık</label><span id="toggle">▲</span></div>${IB.live.HTML}
    <div class="body">
      <div class="row">
        <button id="add">+ Rotasyon ekle</button>
        <button class="danger" id="stopAll">Tümünü durdur</button>
        <button id="notifyBtn">Bildirimlere izin ver</button>
        <button id="tableBtn">Seviye tablosu ▸</button>
      </div>
      <div class="status" id="passiveNote" style="display:none">Bot başka bir sekmede çalışıyor. Bu sekme sadece durumu gösterir; başlatma, durdurma ve ayarları çalışan sekmeden yap.</div>
      <div class="tbl" id="tbl" style="display:none">
        <div class="tbl-note">Her seviyede tam olarak buradaki askerler gider. Kayıp: o seviyede ölmesi beklenen hoplit (asker havuzu buna göre fazladan basar). Ganimet gemisi: köyün kaynağı henüz bilinmezken kullanılır. Değişiklikler hemen kaydedilir, çalışan rotasyonlar bir sonraki turda yeni değerleri kullanır.</div>
        <div class="tbl-note" id="tblInfo"></div>
        <div id="tblRows" style="display:grid;gap:5px"></div>
        <div class="row">
          <button id="tblAdd">+ Seviye ekle</button>
          <button class="danger" id="tblReset">Varsayılana dön</button>
        </div>
      </div>
      <div id="cards" style="display:grid;gap:8px"></div>
      <div class="log" id="log"></div>
    </div>
  </div>`;

  const $ = (id) => root.getElementById(id);
  let liveTick = () => {}; // canlı satır (bkz. IB.live.attach); render sonrası geri sayımları hemen doldurur
  const FIELDS = ['originId', 'colonyId', 'maxLevel', 'leadMin', 'autoTrain', 'sendSpearmen'];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function cityOptions() {
    try {
      const r = ikariam.model.relatedCityData || {};
      return Object.keys(r)
        .filter((k) => k.startsWith('city_') && r[k].relationship === 'ownCity')
        .map((k) => ({ id: Number(r[k].id), label: `${r[k].coords.trim()} ${r[k].name}` }));
    } catch (e) {
      return [];
    }
  }

  function cardHtml(r) {
    const cities = cityOptions();
    const opts = '<option value="">— seç —</option>' + cities.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
    return `
      <div class="card" data-id="${r.id}">
        <div class="card-head"><span class="dot" data-k="dot"></span><span class="title" data-k="title"></span>
          <button class="danger" data-act="remove" title="Rotasyonu sil">✕</button></div>
        <div data-k="form" style="display:grid;gap:5px">
          <label>Kaynak şehir <select data-f="originId">${opts}</select></label>
          <label>Barbar sömürgesi <select data-f="colonyId">${opts}</select></label>
          <label>Max barbar seviyesi <input type="number" data-f="maxLevel" min="1" max="${IB.maxTableLevel()}"></label>
          <label>Erken gönderim (dk) <input type="number" data-f="leadMin" min="0" max="30"></label>
          <label class="chk"><input type="checkbox" data-f="autoTrain"> Eksik askeri otomatik bas</label>
          <label class="chk"><input type="checkbox" data-f="sendSpearmen"> Sömürgedeki mızrakçıları kaynak şehre yolla</label>
        </div>
        <div class="summary" data-k="summary"></div>
        <div class="row">
          <button class="primary" data-act="start">Başlat</button>
          <button data-act="stop">Durdur</button>
        </div>
        <div class="status" data-k="status"></div>
      </div>`;
  }

  function fillCard(el, r) {
    for (const f of FIELDS) {
      const input = el.querySelector(`[data-f="${f}"]`);
      const v = r.cfg[f];
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = v === null || v === undefined ? '' : String(v);
    }
  }

  function readCard(el) {
    const out = {};
    for (const f of FIELDS) {
      const input = el.querySelector(`[data-f="${f}"]`);
      out[f] = input.type === 'checkbox' ? input.checked : input.value;
    }
    return out;
  }

  // Kartlar sadece rotasyon listesi ya da çalışma durumu değişince yeniden kurulur;
  // durmuş karttaki düzenlemeler anında ayarlara yazıldığı için kaybolmaz.
  let cardsKey = '';
  function buildCards() {
    const key = M.rotations.map((r) => r.id + ':' + r.st.running).join(',');
    if (key === cardsKey) return;
    cardsKey = key;
    $('cards').innerHTML = M.rotations.map(cardHtml).join('');
    for (const el of $('cards').querySelectorAll('.card')) {
      const r = M.get(el.dataset.id);
      fillCard(el, r);
      el.addEventListener('change', () => {
        if (r.st.running || M.passive) return;
        const v = readCard(el);
        Object.assign(r.cfg, {
          originId: v.originId ? Number(v.originId) : null,
          colonyId: v.colonyId ? Number(v.colonyId) : null,
          maxLevel: Number(v.maxLevel) || r.cfg.maxLevel,
          leadMin: Number(v.leadMin) || 0,
          autoTrain: v.autoTrain,
          sendSpearmen: v.sendSpearmen,
        });
        M.save();
      });
      el.querySelector('[data-act="start"]').addEventListener('click', () => onStart(el, r));
      el.querySelector('[data-act="stop"]').addEventListener('click', () => r.stop());
      el.querySelector('[data-act="remove"]').addEventListener('click', () => {
        if (r.st.running) return;
        if (window.confirm(`R${r.id} rotasyonu panelden silinsin mi? (Oyunda hiçbir şey silinmez.)`)) M.remove(r.id);
      });
    }
  }

  async function onStart(el, r) {
    const input = readCard(el);
    if (window.Notification && Notification.permission === 'default') Notification.requestPermission().then(render);
    try {
      await r.start(input);
    } catch (e) {
      // Hata kartın durum satırında ve günlükte görünür.
    }
    render();
  }

  function render() {
    buildCards();
    const anyRunning = M.running;
    const anyErr = M.rotations.some((r) => !r.st.running && r.st.stopReason);
    const paused = IB.isPaused('barbar');
    $('onoff').checked = !paused;
    $('dot').className = 'dot ' + (paused ? 'pause' : anyRunning ? 'run' : anyErr ? 'err' : '');
    const runningCount = M.rotations.filter((r) => r.st.running).length;
    $('headTitle').textContent = `Barbar Rotasyonu (${runningCount}/${M.rotations.length} çalışıyor)${paused ? ' · DURAKLATILDI' : ''}`;
    const passive = M.passive;
    $('passiveNote').style.display = passive ? 'block' : 'none';
    $('stopAll').disabled = !anyRunning || passive;
    $('add').disabled = passive;
    $('notifyBtn').style.display = window.Notification && Notification.permission === 'default' ? '' : 'none';

    for (const el of $('cards').querySelectorAll('.card')) {
      const r = M.get(el.dataset.id);
      if (!r) continue;
      const { cfg, st } = r;
      el.classList.toggle('running', st.running);
      el.querySelector('[data-k="dot"]').className = 'dot ' + (st.running ? (paused ? 'pause' : 'run') : st.stopReason ? 'err' : '');
      el.querySelector('[data-k="title"]').textContent = r.label;
      el.querySelector('[data-k="form"]').style.display = st.running ? 'none' : 'grid';
      el.querySelector('[data-act="start"]').disabled = st.running || passive;
      el.querySelector('[data-act="stop"]').disabled = !st.running || passive;
      el.querySelector('[data-act="remove"]').disabled = st.running || passive;
      for (const input of el.querySelectorAll('[data-f]')) input.disabled = passive;
      el.querySelector('[data-f="maxLevel"]').max = String(IB.maxTableLevel());
      const pool = st.running && cfg.autoTrain && M.stockInfo[cfg.originId];
      const poolText = pool
        ? `\nAsker havuzu (${pool.ranges.join(', ')}): gereken ${IB.describeUnits(pool.need)}` +
          (Object.keys(pool.deficit).length ? ` · eksik ${IB.describeUnits(pool.deficit)}` : ' · hazır') +
          ` · kontrol ${new Date(pool.checkedAt).toLocaleTimeString('tr-TR')}`
        : '';
      const summaryEl = el.querySelector('[data-k="summary"]');
      summaryEl.style.whiteSpace = 'pre-wrap';
      const originName = cfg.originName || ((cityOptions().find((c) => c.id === Number(cfg.originId)) || {}).label || '?').trim();
      summaryEl.textContent =
        st.running && cfg.targetIslandName
          ? `${originName} → ${cfg.colonyName} · hedef: ${cfg.targetIslandName} · max seviye ${cfg.maxLevel}` + poolText
          : '';
      // Durum satırı renkli; sonraki kontrole kalan süre saniyede bir güncellenir (bkz. IB.live.attach).
      const statusEl = el.querySelector('[data-k="status"]');
      const text = (st.running && paused ? 'DURAKLATILDI — açınca kaldığı yerden devam eder.\n' : '') + st.status;
      const tone = !st.running ? (st.stopReason ? 'bad' : 'idle') : paused ? 'idle' : IB.live.tone(st.status);
      statusEl.className = `status t-${tone}`;
      statusEl.dataset.next = st.running && !paused && st.nextAt ? st.nextAt : 0;
      statusEl.innerHTML = `${escapeHtml(text)}<span class="cd"></span>`;
    }
    liveTick();

    const log = IB.getLog().slice(-150).reverse();
    $('log').innerHTML = log
      .map((e) => `<div class="${e.level}">${new Date(e.t).toLocaleString('tr-TR')} — ${escapeHtml(e.msg)}</div>`)
      .join('');
  }

  // ---------- Seviye tablosu düzenleyici ----------

  const unitOptions = (sel) =>
    IB.LAND_UNITS.map(([id, name]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');

  function levelHtml(r) {
    const units = Object.entries(r.units)
      .map(
        ([id, n]) => `
        <div class="lv-unit" data-u>
          <select data-t="unit">${unitOptions(id)}</select>
          <input type="number" data-t="count" min="0" value="${n}">
          <button class="danger" data-a="delUnit" title="Birimi çıkar">✕</button>
        </div>`
      )
      .join('');
    return `
      <div class="lv" data-lv>
        <div class="lv-head">
          <span>Seviye</span><input type="number" data-t="level" min="1" value="${r.level}">
          <span>Kayıp</span><input type="number" data-t="losses" min="0" value="${r.losses}">
          <span>Ganimet</span><input type="number" data-t="lootShips" min="0" value="${r.lootShips}">
          <button class="danger" data-a="delRow" title="Seviyeyi sil">✕</button>
        </div>
        ${units || '<div class="tbl-note err">Bu seviyede asker yok; seviye kullanılamaz.</div>'}
        <div><button data-a="addUnit">+ birim</button></div>
      </div>`;
  }

  // Aynı birim bir seviyede iki kez seçildiyse sayıları toplanır.
  function readTable() {
    return [...$('tblRows').querySelectorAll('[data-lv]')].map((el) => {
      const units = {};
      for (const u of el.querySelectorAll('[data-u]')) {
        const id = u.querySelector('[data-t="unit"]').value;
        units[id] = (units[id] || 0) + (Number(u.querySelector('[data-t="count"]').value) || 0);
      }
      const num = (t) => Number(el.querySelector(`[data-t="${t}"]`).value) || 0;
      return { level: num('level'), units, losses: num('losses'), lootShips: num('lootShips') };
    });
  }

  function tableInfo(rows) {
    const max = IB.maxTableLevel();
    const unused = rows.filter((r) => r.level > max + 1 || (r.level > max && Object.keys(r.units).length)).map((r) => r.level);
    $('tblInfo').classList.toggle('err', !max || unused.length > 0);
    $('tblInfo').textContent = !max
      ? 'Seviye 1 tanımlı değil (ya da askeri yok); rotasyon başlatılamaz.'
      : `Rotasyonlar seviye 1-${max} arasında çalışabilir (max seviye en fazla ${max}).` +
        (unused.length ? ` Seviye ${max + 1} eksik ya da askersiz olduğu için ${unused.join(', ')}. seviye(ler) kullanılmaz.` : '');
  }

  let tableSelfSave = false;
  function saveTable(rows) {
    tableSelfSave = true;
    IB.saveTable(rows);
    tableSelfSave = false;
  }

  function buildTable() {
    const rows = IB.getTable();
    $('tblRows').innerHTML = rows.map(levelHtml).join('');
    tableInfo(rows);
    const passive = M.passive;
    for (const el of $('tbl').querySelectorAll('input, select, button')) el.disabled = passive;
  }

  $('tableBtn').addEventListener('click', () => {
    const open = $('tbl').style.display === 'none';
    $('tbl').style.display = open ? 'grid' : 'none';
    $('tableBtn').textContent = open ? 'Seviye tablosu ▾' : 'Seviye tablosu ▸';
    if (open) buildTable();
  });

  $('tblRows').addEventListener('change', (e) => {
    if (M.passive) return;
    const rows = readTable();
    if (e.target.dataset.t === 'level') {
      const lv = Number(e.target.value);
      if (!(lv >= 1) || rows.filter((r) => r.level === lv).length > 1) {
        window.alert(lv >= 1 ? `Seviye ${lv} tabloda zaten var.` : 'Seviye 1 ya da daha büyük olmalı.');
        buildTable();
        return;
      }
      saveTable(rows);
      buildTable(); // seviye değişince sıralama yenilenir
      return;
    }
    saveTable(rows);
    tableInfo(IB.getTable());
  });

  $('tblRows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-a]');
    if (!btn || M.passive) return;
    const lvEl = btn.closest('[data-lv]');
    const idx = [...$('tblRows').querySelectorAll('[data-lv]')].indexOf(lvEl);
    const rows = readTable();
    const row = rows[idx];
    if (btn.dataset.a === 'delRow') {
      if (!window.confirm(`Seviye ${row.level} tablodan silinsin mi?`)) return;
      rows.splice(idx, 1);
    } else if (btn.dataset.a === 'addUnit') {
      const free = IB.LAND_UNITS.find(([id]) => !(id in row.units));
      if (!free) return;
      row.units[free[0]] = 1;
    } else if (btn.dataset.a === 'delUnit') {
      const uEls = [...lvEl.querySelectorAll('[data-u]')];
      const id = uEls[uEls.indexOf(btn.closest('[data-u]'))].querySelector('[data-t="unit"]').value;
      delete row.units[id];
    }
    saveTable(rows);
    buildTable();
  });

  $('tblAdd').addEventListener('click', () => {
    if (M.passive) return;
    const rows = IB.getTable();
    const last = rows[rows.length - 1];
    rows.push(last ? { ...last, level: last.level + 1, units: { ...last.units } } : { level: 1, units: { [IB.HOPLITE]: 1 }, losses: 0, lootShips: 1 });
    saveTable(rows);
    buildTable();
  });

  $('tblReset').addEventListener('click', () => {
    if (M.passive) return;
    if (!window.confirm('Seviye tablosu varsayılan değerlere dönsün mü? Yaptığın tüm değişiklikler silinir.')) return;
    tableSelfSave = true;
    IB.resetTable();
    tableSelfSave = false;
    buildTable();
  });

  // Başka sekmede değişirse yeniden kur (kendi kaydımızda kurulum yukarıda gerektiğinde yapılır).
  IB.onTableChange(() => {
    if (!tableSelfSave && $('tbl').style.display !== 'none') buildTable();
  });

  $('head').addEventListener('click', () => {
    $('panel').classList.toggle('collapsed');
    $('toggle').textContent = $('panel').classList.contains('collapsed') ? '▲' : '▼';
    try { localStorage.setItem('ikabot.panelOpen', $('panel').classList.contains('collapsed') ? '0' : '1'); } catch (e) {}
  });
  // Tik başlıkta: tıklamak paneli açıp kapamasın.
  $('onoffLbl').addEventListener('click', (e) => e.stopPropagation());
  $('onoff').addEventListener('change', () => {
    const pause = !$('onoff').checked;
    IB.setPaused('barbar', pause);
    IB.log(pause ? 'Barbar botu duraklatıldı; ayarlar ve kayıtlar korunuyor. Diğer botlar etkilenmez.' : 'Barbar botu devam ettirildi; kaldığı yerden sürüyor.');
    render();
  });
  IB.onPauseChange((bot) => { if (bot === 'barbar') render(); });
  $('add').addEventListener('click', () => { M.add(); render(); });
  $('stopAll').addEventListener('click', () => M.stopAll());
  $('notifyBtn').addEventListener('click', () => Notification.requestPermission().then(render));

  IB.onChange(render);
  setInterval(render, 5000);
  try {
    if (localStorage.getItem('ikabot.panelOpen') === '1') {
      $('panel').classList.remove('collapsed');
      $('toggle').textContent = '▼';
    }
  } catch (e) {}
  liveTick = IB.live.attach(root, () => {
    const stopped = M.rotations.find((r) => !r.st.running && r.st.stopReason);
    const cur = M.current === 'stock' ? 'asker havuzu' : M.current ? (M.get(M.current) || {}).label : null;
    return {
      paused: IB.isPaused('barbar'),
      passive: M.passive,
      running: M.running,
      status: stopped ? `Durdu: ${stopped.label}: ${stopped.st.stopReason}` : 'Durdu',
      current: cur,
      items: M.rotations.filter((r) => r.st.running).map((r) => ({ label: r.label, status: r.st.status, nextAt: r.st.nextAt })),
    };
  });
  render();

  // Sayfa yenilendiyse ve çalışan rotasyon varsa devam et.
  setTimeout(() => M.resumeIfRunning(), 5000);
})();
