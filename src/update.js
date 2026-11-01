// Güncelleme uyarısı: bot yükleyici eklentiyle (GitHub Pages) geldiyse 10 dakikada bir version.json okunur.
// Yeni sürüm yayınlanmışsa ekranın üstünde "Yenile" düğmeli bir uyarı çıkar. Yerel eklenti kurulumunda çalışmaz.
(() => {
  const L = window.IkaBotLoader;
  if (!L || window.top !== window) return;
  const IB = window.IkaBot;
  IB.version = L.version;

  let shown = null;
  function show(version) {
    if (shown === version) return;
    shown = version;
    let host = document.getElementById('ikabot-update');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ikabot-update';
      host.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483001;';
      document.body.appendChild(host);
      host.attachShadow({ mode: 'open' });
    }
    host.shadowRoot.innerHTML = `
      <style>
        :host { all: initial; }
        .bar { font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color:#1d1d1d; background:#fff8e1;
          border:1px solid #a58552; border-radius:8px; box-shadow:0 4px 18px rgba(0,0,0,.35); padding:6px 10px;
          display:flex; align-items:center; gap:8px; }
        button { font:inherit; padding:3px 9px; border-radius:4px; border:2px solid #6b4c22; background:#fff; color:#1d1d1d; cursor:pointer; font-weight:600; }
        button.later { border-width:1px; font-weight:400; }
      </style>
      <div class="bar">
        <span>Bot güncellemesi var (${L.version} → ${version}). Yenileyince yeni sürüm yüklenir; çalışan botlar kaldığı yerden devam eder.</span>
        <button id="reload">Yenile</button>
        <button class="later" id="later">Sonra</button>
      </div>`;
    host.shadowRoot.getElementById('reload').addEventListener('click', () => location.reload());
    host.shadowRoot.getElementById('later').addEventListener('click', () => host.remove());
  }

  async function check() {
    try {
      const r = await fetch(L.base + 'version.json?t=' + Date.now(), { cache: 'no-store' });
      const v = await r.json();
      if (v.version && v.version !== L.version) show(v.version);
    } catch (e) {}
  }
  setInterval(check, 10 * 60000);
  setTimeout(check, 60000);
})();
