// Güncelleme uyarısı: bot yükleyici eklentiyle geldiyse sürüm dosyası 10 dakikada bir (test kanalında 1 dakikada
// bir) okunur. Yeni sürüm varsa ekranın üstünde "Yenile" düğmeli bir uyarı çıkar. Test kanalında ekranın üstünde
// küçük bir "TEST SÜRÜMÜ" etiketi durur. Yükleyicisiz (yerel eklenti) kurulumda çalışmaz.
(() => {
  const L = window.IkaBotLoader;
  if (!L || window.top !== window) return;
  const IB = window.IkaBot;
  IB.version = L.version;

  const host = document.createElement('div');
  host.id = 'ikabot-update';
  host.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483001;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { display:grid; gap:6px; justify-items:center; }
      .bar { font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color:#1d1d1d; background:#fff8e1;
        border:1px solid #a58552; border-radius:8px; box-shadow:0 4px 18px rgba(0,0,0,.35); padding:6px 10px;
        display:flex; align-items:center; gap:8px; }
      .tag { font: 11px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color:#b3392f; background:#ffe3e0;
        border:1px solid #b3392f; border-radius:6px; padding:2px 8px; font-weight:600; }
      button { font:inherit; padding:3px 9px; border-radius:4px; border:2px solid #6b4c22; background:#fff; color:#1d1d1d; cursor:pointer; font-weight:600; }
      button.later { border-width:1px; font-weight:400; }
    </style>
    <div class="wrap">
      <div class="tag" id="tag" style="display:none">TEST SÜRÜMÜ · ${L.version}</div>
      <div class="bar" id="upd" style="display:none">
        <span id="updText"></span>
        <button id="reload">Yenile</button>
        <button class="later" id="later">Sonra</button>
      </div>
    </div>`;
  const $ = (id) => root.getElementById(id);

  if (L.test) $('tag').style.display = 'block';
  $('reload').addEventListener('click', () => location.reload());
  $('later').addEventListener('click', () => ($('upd').style.display = 'none'));

  let shown = null;
  function show(version) {
    if (shown === version) return;
    shown = version;
    $('updText').textContent = `${L.test ? 'Yeni test sürümü' : 'Bot güncellemesi'} var (${L.version} → ${version}). ` +
      'Yenileyince yeni sürüm yüklenir; çalışan botlar kaldığı yerden devam eder.';
    $('upd').style.display = 'flex';
  }

  async function check() {
    try {
      const r = await fetch(L.base + (L.versionFile || 'version.json') + '?t=' + Date.now(), { cache: 'no-store' });
      const v = await r.json();
      if (v.version && v.version !== L.version) show(v.version);
    } catch (e) {}
  }
  const every = L.test ? 60000 : 10 * 60000;
  setInterval(check, every);
  setTimeout(check, every);
})();
