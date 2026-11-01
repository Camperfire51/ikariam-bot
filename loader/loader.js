// Yükleyici: botun kendisi bu eklentide yok. Her sayfa açılışında GitHub Pages'teki sürüm dosyası okunur ve orada
// listelenen bot dosyaları sırayla sayfaya eklenir. Yeni sürüm gönderilince sayfayı yenilemek yeterli.
//
// İki kanal:
//  - urun: version.json → yayınlanmış sürüm (herkes).
//  - test: beta.json → henüz yayınlanmamış en son kod (sadece geliştiricinin bilgisayarı). TEST yükleyicisinde
//    aşağıdaki CHANNEL 'test' yazılıdır; test sürüm dosyası okunamazsa ürün sürümü yüklenir.
(() => {
  const CHANNEL = 'urun';
  const BASE = 'https://camperfire51.github.io/ikariam-bot/';
  if (window.top !== window) return;

  const getVersion = (file) =>
    fetch(BASE + file + '?t=' + Date.now(), { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });

  function inject(v, file, test) {
    if (window.IkaBot) return;
    window.IkaBotLoader = { base: BASE, versionFile: file, version: v.version, test };
    console.log(`[IkaBot] ${test ? 'TEST' : 'ürün'} sürümü ${v.version} yükleniyor`);
    for (const f of v.files) {
      const s = document.createElement('script');
      s.src = BASE + f + '?v=' + encodeURIComponent(v.version);
      s.async = false; // dosyalar listedeki sırayla çalışır
      document.documentElement.appendChild(s);
    }
  }

  let tries = 0;
  async function load() {
    // Yerel (geliştirici) eklenti de yüklüyse bot iki kez çalışmasın.
    if (window.IkaBot) return;
    if (CHANNEL === 'test') {
      try {
        return inject(await getVersion('beta.json'), 'beta.json', true);
      } catch (e) {
        console.warn('[IkaBot] Test sürümü okunamadı (' + e.message + '); ürün sürümü yükleniyor.');
      }
    }
    try {
      inject(await getVersion('version.json'), 'version.json', false);
    } catch (e) {
      // GitHub'a ulaşılamadı: bir süre sonra tekrar denenir (en fazla 10 kez, giderek seyrek).
      tries++;
      console.warn('[IkaBot] bot yüklenemedi (' + e.message + '), tekrar denenecek.');
      if (tries < 10) setTimeout(load, Math.min(300, 15 * tries) * 1000);
    }
  }
  load();
})();
