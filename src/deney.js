// Akademi deney botu. Diğer botlardan tamamen ayrı çalışır; sadece api.js/game.js'teki istek katmanını paylaşır.
// Mantık: seçili her şehrin akademisinde kristalle deney yapılabiliyorsa yapılır. Bekleme süresi (deneyden sonra
// akademinin toparlanması) ya da kristal eksikse beklenir. Bot açık olduğu sürece bu sürekli tekrar eder.
// Ambrosialı deneye hiç dokunulmaz; bir deneyden sonra ambrosia azalmışsa bot hemen durur.
(() => {
  const IB = window.IkaBot;
  const G = IB.makeGame('deney');
  const { GameError } = IB;

  const KEY = 'ikabot.deney.v1';
  const LOG_KEY = 'ikabot.deney.log';
  const LOCK_KEY = 'ikabot.deney.lock';
  const TAB_ID = Math.random().toString(36).slice(2);

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
  function acquireLock() {
    let l = null;
    try {
      l = JSON.parse(localStorage.getItem(LOCK_KEY));
    } catch (e) {}
    if (l && l.owner !== TAB_ID && Date.now() - l.ts < 90000) return false;
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ owner: TAB_ID, ts: Date.now() }));
    } catch (e) {}
    return true;
  }
  function releaseLock() {
    try {
      const l = JSON.parse(localStorage.getItem(LOCK_KEY));
      if (l && l.owner === TAB_ID) localStorage.removeItem(LOCK_KEY);
    } catch (e) {}
  }

  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('tr-TR');
  const fmtNum = (n) => Number(n).toLocaleString('tr-TR');

  const D = (IB.deney = {
    cities: [], // { cityId, cityName }
    running: false,
    passive: false,
    status: 'Durdu',
    cityStatus: {}, // cityId -> metin
    nextAt: {}, // cityId -> ms
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
      this.cities = (d && Array.isArray(d.cities)) ? d.cities : [];
      this.running = !!(d && d.running);
      if (!this.passive) this.status = this.running ? 'Çalışıyor' : 'Durdu';
      emit();
    },
    save() {
      if (this.passive) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({ cities: this.cities, running: this.running }));
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
      }
      this.save();
      this.wake();
    },

    start() {
      if (this.passive) return;
      this.running = true;
      this.status = 'Çalışıyor';
      this.nextAt = {};
      this.save();
      log('Deney botu başlatıldı.');
      this.loop();
    },
    stop(reason, level = 'info') {
      this.running = false;
      this.status = reason ? 'Durdu: ' + reason : 'Durdu';
      this.save();
      releaseLock();
      log(reason ? 'Deney botu durdu: ' + reason : 'Deney botu durduruldu.', level);
      if (reason && level === 'error' && IB.notify) IB.notify('Deney botu durdu', reason);
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
      if (!a.found) {
        this.warnOnce(cityId, `${label}: akademide deney bölümü bulunamadı (Bilim → Deneyler araştırması yapılmamış olabilir), bekliyor.`);
        return IB.rand(1200, 1800);
      }
      // Düğme yok ya da kapalı: bekleme süresi sürüyor ya da kristal yetmiyor. Oyunun yazısı olduğu gibi gösterilir.
      if (!a.action) {
        const left = a.cooldownEnd ? a.cooldownEnd - Date.now() / 1000 : 0;
        const wait = (left > 0 ? left : IB.rand(600, 1200)) + IB.rand(15, 45);
        const when = left > 0 ? `, ${fmtClock(Date.now() + wait * 1000)} civarı tekrar bakılacak` : '';
        this.setCityStatus(
          cityId,
          `${label}: deney şu an yapılamıyor (bekleme süresi, kristal eksik ya da düğme okunamadı — günlükteki ekran dökümüne bak; şehirde ${fmtNum(Math.floor(a.crystal))} kristal var)${when}.` +
            (a.text ? `\nOyun: ${a.text}` : '')
        );
        return wait;
      }

      const res = await G.doExperiment(cityId, a.action);
      if (res.errors.length) {
        this.warnOnce(cityId, `${label}: deney yapılamadı (${res.errors.join(' / ')}), bekliyor.`);
        return IB.rand(600, 1200);
      }

      // Oyun hata vermeden reddedebilir: akademiyi tekrar okuyup deneyin yapıldığını doğrula.
      const after = await G.academy(cityId, ac.index);
      if (Number.isFinite(a.ambrosia) && Number.isFinite(after.ambrosia) && after.ambrosia < a.ambrosia) {
        this.stop(
          `${label}: deneyden sonra ambrosia azaldı (${a.ambrosia} → ${after.ambrosia}). Bot ambrosiaya dokunmamalı; ` +
            'elle harcadıysan botu tekrar başlat.',
          'error'
        );
        return null;
      }
      const spent = Math.floor(a.crystal - after.crystal);
      if (spent > 0 || res.successes.length || !after.action) {
        log(`${label}: deney yapıldı` + (spent > 0 ? ` (${fmtNum(spent)} kristal harcandı).` : '.'));
        this.setCityStatus(cityId, `${label}: deney yapıldı (${fmtClock(Date.now())}); bekleme süresi bekleniyor.`);
        return IB.rand(1200, 1800);
      }
      this.warnOnce(cityId, `${label}: oyun deneyi kabul etmedi (büyük ihtimalle kristal yetmiyor), bekliyor.`);
      return IB.rand(600, 1200);
    },

    async loop() {
      if (this._looping) return;
      this._looping = true;
      let httpFailures = 0;
      const heartbeat = setInterval(() => {
        if (this.running && !this.passive) acquireLock();
      }, 30000);
      try {
        while (this.running) {
          if (!acquireLock()) {
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
            if (!this.running) break;
          }
          // Duraklatıldı: devam ettirilene kadar bekle; şehir listesi ve kayıtlar olduğu gibi kalır.
          if (IB.isPaused('deney')) {
            this.status = 'Duraklatıldı';
            emit();
            await this.sleep(60000);
            continue;
          }
          this.status = 'Çalışıyor';

          for (const { cityId } of [...this.cities]) {
            if (!this.running) break;
            if ((this.nextAt[cityId] || 0) > Date.now()) continue;
            let waitSec;
            try {
              this.current = cityId; // panelde "şu an" satırı için
              emit();
              waitSec = await this.processCity(cityId);
              httpFailures = 0;
            } catch (e) {
              // Duraklatma işi yarıda kesti: bu şehir devam ettirilince oyundan taze okunarak yeniden işlenir.
              if (e instanceof GameError && e.kind === 'paused') break;
              if (e instanceof GameError && e.kind === 'http' && ++httpFailures <= 15) {
                waitSec = Math.min(300, 30 * httpFailures);
                log(`Bağlantı hatası (${httpFailures}/15), ${waitSec} sn sonra tekrar: ${e.message}`, 'warn');
              } else if (e instanceof GameError && (e.kind === 'session' || e.kind === 'http')) {
                this.stop(e.message, 'error');
                break;
              } else {
                if (!(e instanceof GameError)) console.error(e);
                waitSec = 300;
                log(`Hata: ${e.message || e}. 5 dk sonra tekrar denenecek.`, 'warn');
              }
            }
            if (waitSec === null) continue;
            waitSec = Math.min(1800, Math.max(2, Number(waitSec) || 60));
            this.nextAt[cityId] = Date.now() + waitSec * 1000;
          }
          if (!this.running) break;
          emit();

          this.current = null;

          const nexts = this.cities.map((c) => this.nextAt[c.cityId] || 0);
          const waitMs = nexts.length ? Math.min(...nexts) - Date.now() : 60000;
          await this.sleep(Math.min(60000, Math.max(1000, waitMs)));
        }
      } finally {
        clearInterval(heartbeat);
        this._looping = false;
        this.current = null;
        this.passive = false;
        if (!this.running) releaseLock();
        emit();
      }
    },
  });

  D.load();
  IB.onPauseChange((bot) => { if (bot === 'deney') D.wake(); });
  window.addEventListener('beforeunload', releaseLock);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (D.passive || !D._looping)) D.load();
  });
  // Sayfa yenilendiyse ve bot çalışıyorduysa devam et.
  setTimeout(() => {
    if (D.running && !D._looping) D.loop();
  }, 7000);
})();
