// İnşaat sırası botu (premium inşaat kuyruğu gibi). Barbar botundan tamamen ayrı çalışır;
// sadece api.js/game.js'teki istek katmanını paylaşır (aynı istek kuyruğu, token yarışı olmaz).
// Mantık: her şehrin kendi sırası var. Sıradaki bina hedef seviyeye gelene kadar birer seviye yükseltilir.
// Şehirde inşaat varsa bitmesi beklenir; malzeme yoksa beklenir. Sıradaki iş bitmeden sonrakine geçilmez.
(() => {
  const IB = window.IkaBot;
  const G = IB.makeGame('insaat');
  const { GameError } = IB;

  const KEY = 'ikabot.insaat.v1';
  const LOG_KEY = 'ikabot.insaat.log';
  const LOCK_KEY = 'ikabot.insaat.lock';
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
    console.log('[İnşaat]', msg);
    emit();
  };

  // Tek sekme kilidi: iki sekme aynı anda inşaat emri vermesin.
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

  const buildingKey = G.buildingKey;
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('tr-TR');

  const Q = (IB.buildQueue = {
    items: [], // { id, cityId, cityName, position, building, name, targetLevel }
    running: false,
    passive: false,
    status: 'Durdu',
    cityStatus: {}, // cityId -> metin
    nextAt: {}, // cityId -> ms
    nextId: 1,
    _looping: false,
    _wake: null,

    onChange: (fn) => listeners.add(fn),
    log,
    getLog,

    load() {
      let d = null;
      try {
        d = JSON.parse(localStorage.getItem(KEY));
      } catch (e) {}
      this.items = (d && Array.isArray(d.items)) ? d.items : [];
      this.nextId = (d && d.nextId) || 1;
      this.running = !!(d && d.running);
      if (!this.passive) this.status = this.running ? 'Çalışıyor' : 'Durdu';
      emit();
    },
    save() {
      if (this.passive) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({ items: this.items, nextId: this.nextId, running: this.running }));
      } catch (e) {}
      emit();
    },

    cityIds() {
      return [...new Set(this.items.map((i) => i.cityId))];
    },
    itemsOf(cityId) {
      return this.items.filter((i) => i.cityId === cityId);
    },

    add(item) {
      this.items.push({ ...item, id: this.nextId++ });
      this.nextAt[item.cityId] = 0;
      this.save();
      this.wake();
    },
    remove(id) {
      this.items = this.items.filter((i) => i.id !== id);
      this.save();
    },
    // Aynı şehrin sırası içinde bir yukarı/aşağı taşı.
    move(id, dir) {
      const it = this.items.find((i) => i.id === id);
      if (!it) return;
      const same = this.items.map((x, idx) => [x, idx]).filter(([x]) => x.cityId === it.cityId);
      const k = same.findIndex(([x]) => x.id === id);
      const other = same[k + dir];
      if (!other) return;
      const a = same[k][1];
      const b = other[1];
      [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
      this.nextAt[it.cityId] = 0;
      this.save();
      this.wake();
    },

    start() {
      if (this.passive) return;
      this.running = true;
      this.status = 'Çalışıyor';
      this.nextAt = {};
      this.save();
      log('İnşaat sırası başlatıldı.');
      this.loop();
    },
    stop(reason, level = 'info') {
      this.running = false;
      this.status = reason ? 'Durdu: ' + reason : 'Durdu';
      this.save();
      releaseLock();
      log(reason ? 'İnşaat sırası durdu: ' + reason : 'İnşaat sırası durduruldu.', level);
      if (reason && level === 'error' && IB.notify) IB.notify('İnşaat sırası durdu', reason);
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
          Q._wake = null;
          resolve();
        }
        this._wake = done;
      });
    },

    setCityStatus(cityId, text) {
      this.cityStatus[cityId] = text;
      emit();
    },

    // Bir şehrin sırasındaki ilk işi ilerletir. Kaç saniye sonra tekrar bakılacağını döndürür.
    async processCity(cityId) {
      const item = this.itemsOf(cityId)[0];
      if (!item) return null;
      const label = `${item.cityName}: ${item.name} → ${item.targetLevel}`;

      const city = await G.city(cityId);
      const p = city.positions[item.position];
      if (!p || buildingKey(p) !== item.building) {
        this.setCityStatus(cityId, `${label}: bina bu yerde bulunamadı. Sırayı düzelt (iş silinmeden sonrakine geçilmez).`);
        return 600;
      }

      if (p.level >= item.targetLevel && !p.isBusy) {
        log(`${label} tamamlandı (seviye ${p.level}).`);
        this.items = this.items.filter((i) => i.id !== item.id);
        this.save();
        return 2; // sıradaki işe hemen geç
      }

      // Şehirde inşaat varsa (bot ya da elle başlatılmış) bitmesini bekle.
      const untilDone = (c) => {
        const left = c.constructionEnd - Date.now() / 1000;
        return (left > 0 ? left : 120) + IB.rand(15, 45);
      };
      if (city.busy) {
        const wait = untilDone(city);
        this.setCityStatus(cityId, `${label}: şehirde inşaat var, ${fmtClock(Date.now() + wait * 1000)} civarı bitiyor.`);
        return wait;
      }

      if (p.canUpgrade === false) {
        this.setCityStatus(cityId, `${label}: malzeme yetersiz (seviye ${p.level}), bekliyor.`);
        return IB.rand(150, 300);
      }

      const errors = await G.upgradeBuilding({ cityId, position: item.position, level: p.level, building: item.building });
      if (errors.length) {
        const text = `${label}: yapılamadı (${errors.join(' / ')}), bekliyor.`;
        if (this.cityStatus[cityId] !== text) log(text, 'warn');
        this.setCityStatus(cityId, text);
        return IB.rand(150, 300);
      }

      // Oyun hata vermeden reddedebilir: şehri tekrar okuyup inşaatın başladığını doğrula.
      const after = await G.city(cityId);
      const ap = after.positions[item.position];
      if (ap && ap.isBusy) {
        log(`${label}: seviye ${p.level} → ${p.level + 1} inşaatı başladı.`);
        const wait = untilDone(after);
        this.setCityStatus(cityId, `${label}: ${p.level + 1}. seviye yapılıyor, ${fmtClock(Date.now() + wait * 1000)} civarı bitiyor.`);
        return wait;
      }
      const text = `${label}: oyun kabul etmedi (büyük ihtimalle malzeme yok), bekliyor.`;
      if (this.cityStatus[cityId] !== text) log(text, 'warn');
      this.setCityStatus(cityId, text);
      return IB.rand(150, 300);
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
            log('İnşaat sırası bu sekmede devam ediyor (önceki sekme kapandı).');
            if (!this.running) break;
          }
          // Duraklatıldı: devam ettirilene kadar bekle; sıra ve kayıtlar olduğu gibi kalır.
          if (IB.isPaused('insaat')) {
            this.status = 'Duraklatıldı';
            emit();
            await this.sleep(60000);
            continue;
          }
          this.status = 'Çalışıyor';

          for (const cityId of this.cityIds()) {
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
          // Sırası boşalan şehirlerin durum yazısını temizle.
          for (const id of Object.keys(this.cityStatus)) {
            if (!this.itemsOf(Number(id)).length) delete this.cityStatus[id];
          }
          emit();

          this.current = null;

          const nexts = this.cityIds().map((id) => this.nextAt[id] || 0);
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

  Q.load();
  IB.onPauseChange((bot) => { if (bot === 'insaat') Q.wake(); });
  window.addEventListener('beforeunload', releaseLock);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (Q.passive || !Q._looping)) Q.load();
  });
  // Sayfa yenilendiyse ve sıra çalışıyorduysa devam et.
  setTimeout(() => {
    if (Q.running && !Q._looping) Q.loop();
  }, 6000);
})();
