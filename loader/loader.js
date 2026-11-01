// Yükleyici: botun kendisi bu eklentide yok. Her sayfa açılışında GitHub Pages'teki version.json okunur ve
// orada listelenen bot dosyaları sırayla sayfaya eklenir. Yeni sürüm yayınlanınca sayfayı yenilemek yeterli.
// Eklenti penceresinde kapatılan modüllerin dosyaları yüklenmez (liste bridge.js'ten data-ikabot-off ile gelir).
(() => {
  const BASE = 'https://camperfire51.github.io/ikariam-bot/';
  if (window.top !== window) return;

  // Kapalı modüller. Köprü listeyi çok kısa sürede yazar; gelmezse (eski kurulum) hepsi açık sayılır.
  async function offModules() {
    for (let i = 0; i < 20 && !document.documentElement.hasAttribute('data-ikabot-off'); i++) await new Promise((r) => setTimeout(r, 100));
    try {
      return JSON.parse(document.documentElement.getAttribute('data-ikabot-off') || '[]');
    } catch (e) {
      return [];
    }
  }

  // Yüklenecek dosyalar: çekirdek + açık modüller, version.json'daki sırayla.
  function pickFiles(v, off) {
    if (!v.core || !v.modules) return v.files;
    const allowed = new Set([...v.core, ...v.modules.filter((m) => !off.includes(m.id)).flatMap((m) => m.files)]);
    return v.files.filter((f) => allowed.has(f));
  }

  let tries = 0;
  async function load() {
    // Yerel (geliştirici) eklenti de yüklüyse bot iki kez çalışmasın.
    if (window.IkaBot) return;
    try {
      const r = await fetch(BASE + 'version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const v = await r.json();
      const off = await offModules();
      if (window.IkaBot) return;
      window.IkaBotLoader = { base: BASE, version: v.version, off };
      console.log('[IkaBot] sürüm ' + v.version + ' yükleniyor' + (off.length ? ' (kapalı modüller: ' + off.join(', ') + ')' : ''));
      for (const f of pickFiles(v, off)) {
        const s = document.createElement('script');
        s.src = BASE + f + '?v=' + encodeURIComponent(v.version);
        s.async = false; // dosyalar listedeki sırayla çalışır
        document.documentElement.appendChild(s);
      }
    } catch (e) {
      // GitHub'a ulaşılamadı: bir süre sonra tekrar denenir (en fazla 10 kez, giderek seyrek).
      tries++;
      console.warn('[IkaBot] bot yüklenemedi (' + e.message + '), tekrar denenecek.');
      if (tries < 10) setTimeout(load, Math.min(300, 15 * tries) * 1000);
    }
  }
  load();
})();
