// Yükleyici: botun kendisi bu eklentide yok. Her sayfa açılışında version.json okunur ve orada listelenen bot
// dosyaları sırayla sayfaya eklenir. Yeni sürüm yayınlanınca sayfayı yenilemek yeterli.
//
// İki ortam:
//  - Ürün: GitHub Pages (herkes, her zaman).
//  - Test: geliştiricinin bilgisayarındaki yerel sunucu (http://localhost:5179). Sadece bu tarayıcıda test modu
//    açıldıysa denenir; adres çubuğuna #ikabot-test yazınca açılır, paneldeki "Ürüne dön" ile kapanır.
//    Test modu açık ama yerel sunucu kapalıysa ürün sürümü yüklenir.
(() => {
  const PROD = 'https://camperfire51.github.io/ikariam-bot/';
  const TEST = 'http://localhost:5179/';
  const FLAG = 'ikabot.test';
  if (window.top !== window) return;

  const testOn = () => {
    try {
      return localStorage.getItem(FLAG) === '1';
    } catch (e) {
      return false;
    }
  };
  // #ikabot-test: test modunu aç ve sayfayı yeniden yükle.
  function checkHash() {
    if (location.hash !== '#ikabot-test') return false;
    try {
      localStorage.setItem(FLAG, '1');
    } catch (e) {}
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
    return true;
  }
  window.addEventListener('hashchange', checkHash);
  if (checkHash()) return;

  const getVersion = (base, ms) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return fetch(base + 'version.json?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(() => clearTimeout(t));
  };

  function inject(base, v, test) {
    if (window.IkaBot) return;
    window.IkaBotLoader = { base, version: v.version, test };
    console.log(`[IkaBot] ${test ? 'TEST' : 'ürün'} sürümü ${v.version} yükleniyor (${base})`);
    for (const f of v.files) {
      const s = document.createElement('script');
      s.src = base + f + '?v=' + encodeURIComponent(v.version);
      s.async = false; // dosyalar listedeki sırayla çalışır
      document.documentElement.appendChild(s);
    }
  }

  let tries = 0;
  async function load() {
    // Geliştirici eklentisi (yerel dosyalar) de yüklüyse bot iki kez çalışmasın.
    if (window.IkaBot) return;
    if (testOn()) {
      try {
        return inject(TEST, await getVersion(TEST, 3000), true);
      } catch (e) {
        console.warn('[IkaBot] Test modu açık ama yerel test sunucusu kapalı; ürün sürümü yükleniyor.');
      }
    }
    try {
      inject(PROD, await getVersion(PROD, 15000), false);
    } catch (e) {
      // GitHub'a ulaşılamadı: bir süre sonra tekrar denenir (en fazla 10 kez, giderek seyrek).
      tries++;
      console.warn('[IkaBot] bot yüklenemedi (' + e.message + '), tekrar denenecek.');
      if (tries < 10) setTimeout(load, Math.min(300, 15 * tries) * 1000);
    }
  }
  load();
})();
