// Akademi deney botu. Diğer botlardan tamamen ayrı çalışır; sadece api.js/game.js'teki istek katmanını paylaşır.
// Mantık: seçili her şehrin akademisinde kristalle deney yapılabiliyorsa yapılır. Bekleme süresi (deneyden sonra
// akademinin toparlanması) ya da kristal eksikse beklenir. Bot açık olduğu sürece bu sürekli tekrar eder.
// Ambrosialı deneye hiç dokunulmaz; bir deneyden sonra ambrosia azalmışsa botun Açık tiki kapatılır (tek istisna).
// Başlat/Durdur yok: paneldeki Açık tiki açık olduğu sürece bot çalışır; hata olsa da durmaz, tekrar dener.
(() => {
  const IB = window.IkaBot;
  const G = IB.makeGame('deney');
  const { GameError } = IB;

  const KEY = 'ikabot.deney.v1';
  const LOG_KEY = 'ikabot.deney.log';
  const LOCK_KEY = 'ikabot.deney.lock';

  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) {} });

  const getLog = () => {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    } catch (e) {
      return [];
    }
  };
  const log = (msg, level = 'info') => {
    const entries = getLog();
    entries.push({ t: Date.now(), level, msg });
    while (entries.length > 300) entries.shift();
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    } catch (e) {}
    console.log('[Deney]', msg);
    emit();
  };

  // Tek sekme kilidi: iki sekme aynı anda deney yapmasın.
  const lock = IB.tabLock(LOCK_KEY);

  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('tr-TR');
  const fmtNum = (n) => Number(n).toLocaleString('tr-TR');

  // Deney düğmesi okunamayan akademi ekranının deneyle ilgili bölümü (HTML + ilgili şablon verisi), şehir başına
  // son kayıt. Sohbete yapıştırılabilecek kadar kısa tutulur: deney kutularını içeren kapsayıcının iki üstü,
  // betikler çıkarılmış, boşluklar sıkıştırılmış. Oturum anahtarı silinir. "📋 Günlük" (src/dock.js) bunu ekler.
  const DUMP_KEY = 'ikabot.deney.academyDump';
  const clean = (s) => String(s).replace(/actionRequest(["'=:\\]+)[0-9a-f]{20,}/gi, 'actionRequest$1…');
  function experimentArea(html) {
    const doc = IB.parseHtml(html);
    for (const s of doc.querySelectorAll('script, style')) s.remove();
    const boxes = [...doc.querySelectorAll('.experiment')];
    let el = null;
    if (boxes.length) {
      // Bütün kutuları içeren en yakın kapsayıcı, sonra iki üstü (düğme kutunun yanında durabiliyor).
      el = boxes[0];
      while (el.parentElement && !boxes.every((b) => el.contains(b))) el = el.parentElement;
      for (let i = 0; i < 2 && el.parentElement && el.parentElement !== doc.body; i++) el = el.parentElement;
    } else {
      // Kutu yoksa "Masraf"/deney yazan en küçük blok.
      const hits = [...doc.querySelectorAll('div, li, form, table')].filter((x) => /deney|xperiment|masraf/i.test(x.textContent));
      el = hits.sort((p, q) => p.outerHTML.length - q.outerHTML.length)[0] || null;
      if (el && el.parentElement && el.parentElement !== doc.body) el = el.parentElement.parentElement || el.parentElement;
    }
    const out = (el || doc.body).outerHTML.replace(/\s+/g, ' ');
    return out.length > 15000 ? out.slice(0, 15000) + ' …(kesildi)' : out;
  }
  function saveAcademyDump(cityId, label, a) {
    try {
      const all = JSON.parse(localStorage.getItem(DUMP_KEY) || '{}');
      const tpl = Object.fromEntries(Object.entries(a.raw.template || {}).filter(([k]) => /xperiment|cooldown|academy|crystal|glass/i.test(k)));
      all[cityId] = {
        at: new Date().toLocaleString('tr-TR'),
        city: label,
        crystal: a.crystal,
        cooldownEnd: a.cooldownEnd,
        found: a.found,
        html: clean(experimentArea(a.raw.html)),
        // Fonksiyonlu düğme: yakalanan istekler ve fonksiyonun kaynağı; kaynak bulunamadıysa deneyle ilgili betikler.
        call: a.callInfo || null,
        scripts: clean(
          (a.callSources && a.callSources.length
            ? a.callSources
            : [...IB.parseHtml(a.raw.html).querySelectorAll('script')].map((s) => s.textContent).filter((t) => /xperiment/i.test(t))
          ).join('\n----\n')
        ).slice(0, 8000),
        template: clean(JSON.stringify(tpl)).slice(0, 5000),
      };
      localStorage.setItem(DUMP_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  const D = (IB.deney = {
    cities: [], // { cityId, cityName }
    passive: false,
    status: 'Başlıyor…',
    cityStatus: {}, // cityId -> metin
    nextAt: {}, // cityId -> ms
    _err: {}, // cityId -> son hata (aynı hata günlüğe bir kez yazılır)
    _debugLogged: {}, // cityId -> son yazılan ekran dökümü
    _looping: false,
    _wake: null,

    onChange: (fn) => listeners.add(fn),
    getLog,
    log,

    load() {
      let d = null;
      try {
        d = JSON.parse(localStorage.getItem(KEY));
      } catch (e) {}
      if (d && 'running' in d) {
        IB.migrateRunning('deney', d.running, Array.isArray(d.cities) && d.cities.length > 0);
        delete d.running;
        try {
          localStorage.setItem(KEY, JSON.stringify(d));
        } catch (e) {}
      }
      this.cities = (d && Array.isArray(d.cities)) ? d.cities : [];
      emit();
    },
    save() {
      if (this.passive) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({ cities: this.cities }));
      } catch (e) {}
      emit();
    },

    has(cityId) {
      return this.cities.some((c) => c.cityId === cityId);
    },
    // Şehri deney listesine ekler ya da çıkarır; çalışırken de yapılabilir.
    setCity(cityId, cityName, on) {
      if (this.passive || on === this.has(cityId)) return;
      if (on) {
        this.cities.push({ cityId, cityName });
        this.nextAt[cityId] = 0;
      } else {
        this.cities = this.cities.filter((c) => c.cityId !== cityId);
        delete this.cityStatus[cityId];
        delete this._err[cityId];
      }
      this.save();
      this.wake();
    },

    wake() {
      if (this._wake) this._wake();
    },
    sleep(ms) {
      return new Promise((resolve) => {
        const t = setTimeout(done, ms);
        function done() {
          clearTimeout(t);
          D._wake = null;
          resolve();
        }
        this._wake = done;
      });
    },

    setCityStatus(cityId, text) {
      this.cityStatus[cityId] = text;
      emit();
    },
    warnOnce(cityId, text) {
      if (this.cityStatus[cityId] !== text) log(text, 'warn');
      this.setCityStatus(cityId, text);
    },

    // Hata: bot durmaz. Şehrin durum satırına yazılır, aynı hata günlüğe ve bildirime bir kez düşer, sonra tekrar denenir.
    fail(cityId, e, waitSec) {
      const msg = (e && e.message) || String(e);
      if (this._err[cityId] !== msg) {
        this._err[cityId] = msg;
        log(`Hata: ${msg} — ${Math.ceil(waitSec / 60)} dk sonra tekrar denenecek (bot durmuyor).`, 'warn');
        if (IB.notify) IB.notify('Deney botu: sorun var, tekrar deneniyor', msg);
      }
      this.setCityStatus(cityId, `Hata: ${msg} — tekrar denenecek.`);
    },
    recovered(cityId) {
      if (!this._err[cityId]) return;
      delete this._err[cityId];
      log('Sorun giderildi, devam ediliyor.');
    },

    // Bir şehirde deney yapılabiliyorsa yapar. Kaç saniye sonra tekrar bakılacağını döndürür (bot durduysa null).
    async processCity(cityId) {
      const c = this.cities.find((x) => x.cityId === cityId);
      if (!c) return null;
      const label = c.cityName;

      const city = await G.city(cityId);
      const ac = G.findBuilding(city, 'academy');
      if (!ac) {
        this.setCityStatus(cityId, `${label}: bu şehirde akademi yok.`);
        return 1800;
      }

      const a = await G.academy(cityId, ac.index);
      // Deney düğmesi okunamadıysa ekranın dökümü günlüğe bir kez yazılır (şehir başına, içerik değişince tekrar).
      if (a.debug && this._debugLogged[cityId] !== a.debug) {
        this._debugLogged[cityId] = a.debug;
        log(`${label}: akademi ekranında kristalli deney düğmesi okunamadı. Ekran dökümü (sorun bildirirken bunu gönder):\n${a.debug}`, 'warn');
      }
      // Akademi ekranının tamamı da saklanır; bot menüsündeki "Günlüğü kopyala" bunu da ekler.
      if (a.debug) saveAcademyDump(cityId, label, a);
      if (!a.found) {
        this.warnOnce(cityId, `${label}: akademide deney bölümü bulunamadı (Bilim → Deneyler araştırması yapılmamış olabilir), bekliyor.`);
        return IB.rand(1200, 1800);
      }
      // Düğme yok ya da kapalı: bekleme süresi sürüyor ya da kristal yetmiyor. Oyunun yazısı olduğu gibi gösterilir.
      if (!a.action) {
        const left = a.cooldownEnd ? a.cooldownEnd - Date.now() / 1000 : 0;
        const wait = (left > 0 ? left : IB.rand(1200, 1800)) + IB.rand(15, 45);
        const when = left > 0 ? `, ${fmtClock(Date.now() + wait * 1000)} civarı tekrar bakılacak` : '';
        this.setCityStatus(
          cityId,
          `${label}: deney şu an yapılamıyor (bekleme süresi, kristal eksik ya da düğme okunamadı — günlükteki ekran dökümüne bak; şehirde ${fmtNum(Math.floor(a.crystal))} kristal var)${when}.` +
            (a.text ? `\nOyun: ${a.text}` : '')
        );
        return wait;
      }
      // Masraf ekrandan okunduysa kristal yetmiyorken istek gönderilmez.
      if (a.cost && a.crystal < a.cost) {
        this.setCityStatus(cityId, `${label}: kristal yetmiyor (${fmtNum(a.cost)} gerekli, şehirde ${fmtNum(Math.floor(a.crystal))} var), bekliyor.`);
        return IB.rand(900, 1500);
      }

      if (a.action.kind === 'call' || a.action.kind === 'form') {
        // İstek oyunun düğme fonksiyonundan çıkarıldı: ne gönderildiği bir kez günlüğe yazılır (kontrol için).
        const sig = JSON.stringify(a.action.params);
        if (this._callLogged !== sig) {
          this._callLogged = sig;
          log(`${label}: kristalli deney düğmesinin isteği: ${Object.entries(a.action.params).map(([k, v]) => `${k}=${v}`).join('&')}`);
        }
      }
      const res = await G.doExperiment(cityId, a.action);
      if (res.errors.length) {
        this.warnOnce(cityId, `${label}: deney yapılamadı (${res.errors.join(' / ')}), bekliyor.`);
        return IB.rand(1200, 1800);
      }

      // Oyun hata vermeden reddedebilir: akademiyi tekrar okuyup deneyin yapıldığını doğrula.
      const after = await G.academy(cityId, ac.index);
      if (Number.isFinite(a.ambrosia) && Number.isFinite(after.ambrosia) && after.ambrosia < a.ambrosia) {
        // Tek güvenlik istisnası: ambrosia (gerçek para) harcanmış olabilir. Tekrar denemek daha fazla harcatabilir;
        // bu yüzden botun Açık tiki kapatılır (panelde görünür, kendiliğinden açılmaz).
        const msg =
          `${label}: deneyden sonra ambrosia azaldı (${a.ambrosia} → ${after.ambrosia}). Bot ambrosiaya dokunmamalı; ` +
          'güvenlik için Deney botunun Açık tiki kapatıldı. Elle harcadıysan tiki tekrar aç.';
        log(msg, 'error');
        if (IB.notify) IB.notify('Deney botu kapatıldı', msg);
        this.setCityStatus(cityId, msg);
        IB.setPaused('deney', true);
        return IB.rand(1200, 1800);
      }
      const spent = Math.floor(a.crystal - after.crystal);
      if (spent > 0 || res.successes.length || !after.action) {
        log(`${label}: deney yapıldı` + (spent > 0 ? ` (${fmtNum(spent)} kristal harcandı).` : '.'));
        this.setCityStatus(cityId, `${label}: deney yapıldı (${fmtClock(Date.now())}); bekleme süresi bekleniyor.`);
        return IB.rand(1200, 1800);
      }
      this.warnOnce(cityId, `${label}: oyun deneyi kabul etmedi (büyük ihtimalle kristal yetmiyor), bekliyor.`);
      return IB.rand(1200, 1800);
    },

    // Döngü hiç bitmez: tik kapalıyken bekler, açıkken seçili şehirleri işler. Hiçbir hata botu durdurmaz.
    async loop() {
      if (this._looping) return;
      this._looping = true;
      let httpFailures = 0;
      const heartbeat = setInterval(() => {
        if (!this.passive) lock.refresh();
      }, 30000);
      try {
        for (;;) {
          try {
            if (!(await lock.acquire())) {
              // Başka sekme çalışıyor: bu sekme sadece izler.
              if (!this.passive) {
                this.passive = true;
                this.status = 'Başka sekmede çalışıyor';
                emit();
              }
              await this.sleep(60000);
              this.load();
              continue;
            }
            if (this.passive) {
              this.passive = false;
              this.load();
              log('Deney botu bu sekmede devam ediyor (önceki sekme kapandı).');
            }
            // Kapalı (Açık tiki kaldırılmış): açılana kadar bekle; şehir listesi ve kayıtlar olduğu gibi kalır.
            if (IB.isPaused('deney')) {
              this.status = 'Kapalı';
              emit();
              await this.sleep(60000);
              continue;
            }
            this.status = this.cities.length ? 'Çalışıyor' : 'Şehir seçilmedi; listeden şehir tikleyince başlar.';

            for (const { cityId } of [...this.cities]) {
              if (IB.isPaused('deney')) break;
              if ((this.nextAt[cityId] || 0) > Date.now()) continue;
              let waitSec;
              try {
                this.current = cityId; // panelde "şu an" satırı için
                emit();
                waitSec = await this.processCity(cityId);
                httpFailures = 0;
                this.recovered(cityId);
              } catch (e) {
                // Tik kapatılınca iş yarıda kesildi: bu şehir açılınca oyundan taze okunarak yeniden işlenir.
                if (e instanceof GameError && e.kind === 'paused') break;
                if (!(e instanceof GameError)) console.error(e);
                if (e instanceof GameError && e.kind === 'http') httpFailures++;
                waitSec = IB.retryWait(e, httpFailures);
                this.fail(cityId, e, waitSec);
                // Bağlantı/oturum sorunu bütün şehirleri etkiler: hepsi aynı süre bekleyip tekrar dener.
                if (e instanceof GameError && (e.kind === 'http' || e.kind === 'session')) {
                  for (const c of this.cities) this.nextAt[c.cityId] = Date.now() + waitSec * 1000;
                  break;
                }
              }
              if (waitSec === null) continue;
              waitSec = Math.min(21600, Math.max(2, Number(waitSec) || 60));
              this.nextAt[cityId] = Date.now() + waitSec * 1000;
            }
            this.current = null;
            emit();

            const nexts = this.cities.map((c) => this.nextAt[c.cityId] || 0);
            const waitMs = nexts.length ? Math.min(...nexts) - Date.now() : 60000;
            await this.sleep(Math.min(60000, Math.max(1000, waitMs)));
          } catch (e) {
            // Beklenmeyen hata döngüyü bitirmesin: günlüğe yaz, biraz bekle, devam et.
            console.error(e);
            this.current = null;
            log(`Beklenmeyen hata: ${(e && e.message) || e}. 1 dk sonra devam edilecek.`, 'warn');
            await IB.sleep(60000);
          }
        }
      } finally {
        clearInterval(heartbeat);
        this._looping = false;
        this.current = null;
        this.passive = false;
        lock.release();
        emit();
      }
    },
  });

  D.load();
  IB.onPauseChange((bot) => { if (bot === 'deney') D.wake(); });
  window.addEventListener('beforeunload', () => lock.release());
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (D.passive || !D._looping)) D.load();
  });
  // Sayfa açılınca döngü başlar; bir sebeple biterse bekçi yeniden başlatır.
  if (IB.inGame()) {
    setTimeout(() => D.loop(), 7000);
    setInterval(() => { if (!D._looping) D.loop(); }, 120000);
  }
})();
