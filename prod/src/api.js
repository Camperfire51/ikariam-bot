// Oyun sunucusuyla konuşan katman: istek kuyruğu, actionRequest token'ı, yanıt ayrıştırma.
(() => {
  const IB = (window.IkaBot = window.IkaBot || {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  IB.sleep = sleep;
  IB.now = () => Date.now() / 1000;
  // [min, max] aralığında rastgele tam sayı.
  IB.rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

  class GameError extends Error {
    constructor(message, kind = 'game') {
      super(message);
      this.kind = kind; // 'session' | 'http' | 'game' | 'safety' | 'paused'
    }
  }
  IB.GameError = GameError;

  IB.parseGameInt = (text) => {
    if (text === undefined || text === null) return 0;
    const s = String(text).replace(/[.,\s  ]/g, '').replace(/^-$/, '0');
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  };

  class GameResponse {
    constructor(data) {
      this.data = data;
    }
    cmd(name) {
      const c = this.data.find((x) => x[0] === name);
      return c ? c[1] : undefined;
    }
    get global() {
      return this.cmd('updateGlobalData') || {};
    }
    get header() {
      return this.global.headerData || {};
    }
    get background() {
      return this.global.backgroundData || {};
    }
    get html() {
      const v = this.cmd('changeView');
      return v ? v[1] || '' : '';
    }
    get viewScript() {
      const v = this.cmd('changeView');
      return (v && v[2]) || {};
    }
    get template() {
      return this.cmd('updateTemplateData') || {};
    }
    get feedback() {
      const f = this.cmd('provideFeedback');
      return Array.isArray(f) ? f : [];
    }
    // type 10 = başarı, 11 = hata (oyunun kendi geri bildirim kodları)
    get errors() {
      return this.feedback.filter((f) => f && f.type === 11).map((f) => stripTags(f.text));
    }
    get successes() {
      return this.feedback.filter((f) => f && f.type === 10).map((f) => stripTags(f.text));
    }
    get selectedCityId() {
      const dd = this.header.cityDropdownMenu || {};
      const m = String(dd.selectedCity || '').match(/\d+/);
      return m ? Number(m[0]) : null;
    }
    // Oyuncunun güncel şehir listesi; sömürge silindi mi kontrolü buna dayanır.
    get ownCities() {
      const dd = this.header.cityDropdownMenu;
      if (!dd) return null;
      return Object.keys(dd)
        .filter((k) => k.startsWith('city_'))
        .map((k) => dd[k])
        .filter((c) => c && c.relationship === 'ownCity')
        .map((c) => {
          const m = String(c.coords || '').match(/(\d+):(\d+)/);
          return { id: Number(c.id), name: c.name, x: m ? +m[1] : null, y: m ? +m[2] : null, tradegood: c.tradegood };
        });
    }
  }
  IB.GameResponse = GameResponse;

  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
  IB.stripTags = stripTags;

  function currentToken() {
    try {
      if (window.ikariam && ikariam.model && ikariam.model.actionRequest) return ikariam.model.actionRequest;
    } catch (e) {}
    return IB._token;
  }

  function storeToken(t) {
    if (!t) return;
    IB._token = t;
    // Sayfanın kendi arayüzü de güncel token'la çalışmaya devam etsin.
    try {
      ikariam.model.actionRequest = t;
    } catch (e) {}
  }

  // fetch ağ kopunca TypeError ("Failed to fetch") atar; bunu tekrar denenebilir hataya çevir.
  async function netFetch(url, opts) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      throw new GameError('Bağlantı kurulamadı (internet, uyku ya da sunucu erişilemez): ' + e.message, 'http');
    }
  }

  // ---------- Bot başına duraklatma ----------
  // Her bot (barbar, inşaat, araştırma, deney) kendi tikiyle anında durdurulup devam ettirilir; biri kapalıyken
  // diğerleri çalışmaya devam eder. Hiçbir ayar/kayıt silinmez; sadece o botun isteği sunucuya gitmez ve
  // döngüsü bekler. Durum tarayıcıda saklanır, tüm sekmelerde ortaktır ve yenilemede korunur.
  IB.BOTS = ['barbar', 'insaat', 'arastirma', 'deney'];
  const PAUSE_PREFIX = 'ikabot.paused.';
  const OLD_PAUSE_KEY = 'ikabot.paused';
  // Eski genel duraklatma açıksa her bot duraklatılmış olarak devralınır.
  try {
    if (localStorage.getItem(OLD_PAUSE_KEY) === '1') {
      for (const b of IB.BOTS) localStorage.setItem(PAUSE_PREFIX + b, '1');
    }
    localStorage.removeItem(OLD_PAUSE_KEY);
  } catch (e) {}
  const pauseListeners = new Set();
  IB.isPaused = (bot) => {
    if (!bot) return false;
    try {
      return localStorage.getItem(PAUSE_PREFIX + bot) === '1';
    } catch (e) {
      return false;
    }
  };
  // fn(bot, paused)
  IB.onPauseChange = (fn) => pauseListeners.add(fn);
  const pauseChanged = (bot) => pauseListeners.forEach((fn) => { try { fn(bot, IB.isPaused(bot)); } catch (e) {} });
  IB.setPaused = (bot, on) => {
    if (on === IB.isPaused(bot)) return;
    try {
      if (on) localStorage.setItem(PAUSE_PREFIX + bot, '1');
      else localStorage.removeItem(PAUSE_PREFIX + bot);
    } catch (e) {}
    pauseChanged(bot);
  };
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(PAUSE_PREFIX)) pauseChanged(e.key.slice(PAUSE_PREFIX.length));
  });
  // Duraklatılmış botun isteği gönderilmez; yarıda kalan iş devam ettirilince oyundan taze okunarak yeniden yapılır.
  // bot verilmeyen istekler (panelin şehir/bina listesini okuması gibi) hiç durdurulmaz.
  const pauseGate = (bot) => {
    if (IB.isPaused(bot)) throw new GameError('Bot duraklatıldı.', 'paused');
  };

  let lastRequestAt = 0;
  let chain = Promise.resolve();

  async function rawRequest(params, { post = false, bot = null } = {}) {
    pauseGate(bot);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) body.set(k, String(v));
    }
    body.set('ajax', '1');
    if (post) body.set('actionRequest', currentToken());

    // İstekler arasında insan benzeri, düzensiz bir boşluk bırak.
    const gap = 800 + Math.random() * 1200;
    const wait = lastRequestAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    pauseGate(bot);
    lastRequestAt = Date.now();

    const opts = { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    let url = '/index.php';
    if (post) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      opts.body = body.toString();
    } else {
      url += '?' + body.toString();
    }

    const res = await netFetch(url, opts);
    if (!res.ok) throw new GameError('Sunucu hatası: HTTP ' + res.status, 'http');
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new GameError('Oyun JSON yerine bir sayfa döndürdü: oturum düşmüş ya da captcha çıkmış olabilir.', 'session');
    }
    if (!Array.isArray(data)) throw new GameError('Beklenmeyen sunucu yanıtı.', 'session');
    const resp = new GameResponse(data);
    if (resp.global.actionRequest) storeToken(resp.global.actionRequest);
    return resp;
  }

  // Tüm istekler sıraya girer; token yarışını önler.
  IB.request = (params, opts) => {
    const run = chain.then(() => rawRequest(params, opts));
    chain = run.catch(() => {});
    return run;
  };

  // Ajax olmayan tam sayfa (ada görünümü gibi) içindeki ajax.Responder verisini döndürür.
  IB.requestFullPage = (params, { bot = null } = {}) => {
    const run = chain.then(async () => {
      pauseGate(bot);
      const gap = 800 + Math.random() * 1200;
      const wait = lastRequestAt + gap - Date.now();
      if (wait > 0) await sleep(wait);
      pauseGate(bot);
      lastRequestAt = Date.now();
      const res = await netFetch('/index.php?' + new URLSearchParams(params).toString(), { credentials: 'include' });
      if (!res.ok) throw new GameError('Sunucu hatası: HTTP ' + res.status, 'http');
      const html = await res.text();
      const m = html.match(/ajax\.Responder, (\[\[[\S\s]*?\]\])\);/);
      if (!m) throw new GameError('Sayfa verisi okunamadı: oturum düşmüş ya da captcha çıkmış olabilir.', 'session');
      const resp = new GameResponse(JSON.parse(m[1]));
      if (resp.global.actionRequest) storeToken(resp.global.actionRequest);
      return resp;
    });
    chain = run.catch(() => {});
    return run;
  };

  IB.parseHtml = (html) => new DOMParser().parseFromString(html || '', 'text/html');

  // Oyunun kendi formlarındaki alanları okur (token hariç).
  IB.readForms = (html) => {
    const doc = IB.parseHtml(html);
    return [...doc.querySelectorAll('form')].map((f) => {
      const fields = {};
      for (const el of f.querySelectorAll('input, select, textarea')) {
        if (!el.name || el.name === 'actionRequest') continue;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
        if (el.type === 'submit' || el.type === 'button') continue;
        fields[el.name] = el.value;
      }
      return { fields, text: stripTags(f.textContent) };
    });
  };
})();
