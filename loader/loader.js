// Yükleyici: botun kendisi bu eklentide yok. Her sayfa açılışında GitHub Pages'teki version.json okunur ve
// orada listelenen bot dosyaları sırayla sayfaya eklenir. Yeni sürüm yayınlanınca sayfayı yenilemek yeterli.
(() => {
  const BASE = 'https://camperfire51.github.io/ikariam-bot/';
  if (window.top !== window) return;

  let tries = 0;
  function load() {
    // Geliştirici eklentisi (yerel dosyalar) de yüklüyse bot iki kez çalışmasın.
    if (window.IkaBot) return;
    fetch(BASE + 'version.json?t=' + Date.now(), { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((v) => {
        if (window.IkaBot) return;
        window.IkaBotLoader = { base: BASE, version: v.version };
        console.log('[IkaBot] sürüm ' + v.version + ' yükleniyor');
        for (const f of v.files) {
          const s = document.createElement('script');
          s.src = BASE + f + '?v=' + encodeURIComponent(v.version);
          s.async = false; // dosyalar listedeki sırayla çalışır
          document.documentElement.appendChild(s);
        }
      })
      .catch((e) => {
        // GitHub'a ulaşılamadı: bir süre sonra tekrar denenir (en fazla 10 kez, giderek seyrek).
        tries++;
        console.warn('[IkaBot] bot yüklenemedi (' + e.message + '), tekrar denenecek.');
        if (tries < 10) setTimeout(load, Math.min(300, 15 * tries) * 1000);
      });
  }
  load();
})();
