// İnşaat sırası botu (premium inşaat kuyruğu gibi). Barbar botundan tamamen ayrı çalışır;
// sadece api.js/game.js'teki istek katmanını paylaşır (aynı istek kuyruğu, token yarışı olmaz).
// Mantık: her şehrin kendi sırası var. Sıradaki bina hedef seviyeye gelene kadar birer seviye yükseltilir.
// Şehirde inşaat varsa bitmesi beklenir; malzeme yoksa beklenir. Sıradaki iş bitmeden sonrakine geçilmez.
// Başlat/Durdur yok: paneldeki Açık tiki açık olduğu sürece bot çalışır; hata olsa da durmaz, tekrar dener.
(() => {
  const IB = window.IkaBot;
  const G = IB.makeGame('insaat');
  const { GameError } = IB;

  const KEY = 'ikabot.insaat.v1';
  const LOG_KEY = 'ikabot.insaat.log';
  const LOCK_KEY = 'ikabot.insaat.lock';

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
  const lock = IB.tabLock(LOCK_KEY);

  const buildingKey = G.buildingKey;
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('tr-TR');

  const Q = (IB.buildQueue = {
    items: [], // { id, cityId, cityName, position, building, name, targetLevel }
    passive: false,
    status: 'Başlıyor…',
    cityStatus: {}, // cityId -> metin
    nextAt: {}, // cityId -> ms
    _err: {}, // cityId -> son hata (aynı hata günlüğe bir kez yazılır)
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
      if (d && 'running' in d) {
        IB.migrateRunning('insaat', d.running, Array.isArray(d.items) && d.items.length > 0);
        delete d.running;
        try {
          localStorage.setItem(KEY, JSON.stringify(d));
        } catch (e) {}
      }
      this.items = (d && Array.isArray(d.items)) ? d.items : [];
      this.nextId = (d && d.nextId) || 1;
      emit();
    },
    save() {
      if (this.passive) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({ items: this.items, nextId: this.nextId }));
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

    // Hata: bot durmaz. Şehrin durum satırına yazılır, aynı hata günlüğe ve bildirime bir kez düşer, sonra tekrar denenir.
    fail(cityId, e, waitSec) {
      const msg = (e && e.message) || String(e);
      if (this._err[cityId] !== msg) {
        this._err[cityId] = msg;
        log(`Hata: ${msg} — ${Math.ceil(waitSec / 60)} dk sonra tekrar denenecek (bot durmuyor).`, 'warn');
        if (IB.notify) IB.notify('İnşaat sırası: sorun var, tekrar deneniyor', msg);
      }
      this.setCityStatus(cityId, `Hata: ${msg} — tekrar denenecek.`);
    },
    recovered(cityId) {
      if (!this._err[cityId]) return;
      delete this._err[cityId];
      log('Sorun giderildi, devam ediliyor.');
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
        return 1800;
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
        return IB.rand(900, 1800);
      }

      const errors = await G.upgradeBuilding({ cityId, position: item.position, level: p.level, building: item.building });
      if (errors.length) {
        const text = `${label}: yapılamadı (${errors.join(' / ')}), bekliyor.`;
        if (this.cityStatus[cityId] !== text) log(text, 'warn');
        this.setCityStatus(cityId, text);
        return IB.rand(900, 1800);
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
      return IB.rand(900, 1800);
    },

    // Döngü hiç bitmez: tik kapalıyken bekler, açıkken sırayı işler. Hiçbir hata botu durdurmaz.
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
              log('İnşaat sırası bu sekmede devam ediyor (önceki sekme kapandı).');
            }
            // Kapalı (Açık tiki kaldırılmış): açılana kadar bekle; sıra ve kayıtlar olduğu gibi kalır.
            if (IB.isPaused('insaat')) {
              this.status = 'Kapalı';
              emit();
              await this.sleep(60000);
              continue;
            }
            this.status = this.items.length ? 'Çalışıyor' : 'Sıra boş; iş eklenince başlar.';

            for (const cityId of this.cityIds()) {
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
                  for (const id of this.cityIds()) this.nextAt[id] = Date.now() + waitSec * 1000;
                  break;
                }
              }
              if (waitSec === null) continue;
              waitSec = Math.min(21600, Math.max(2, Number(waitSec) || 60));
              this.nextAt[cityId] = Date.now() + waitSec * 1000;
            }
            // Sırası boşalan şehirlerin durum yazısını temizle.
            for (const id of Object.keys(this.cityStatus)) {
              if (!this.itemsOf(Number(id)).length) {
                delete this.cityStatus[id];
                delete this._err[id];
              }
            }
            this.current = null;
            emit();

            const nexts = this.cityIds().map((id) => this.nextAt[id] || 0);
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

  Q.load();
  IB.onPauseChange((bot) => { if (bot === 'insaat') Q.wake(); });
  window.addEventListener('beforeunload', () => lock.release());
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (Q.passive || !Q._looping)) Q.load();
  });
  // Sayfa açılınca döngü başlar; bir sebeple biterse bekçi yeniden başlatır.
  if (IB.inGame()) {
    setTimeout(() => Q.loop(), 6000);
    setInterval(() => { if (!Q._looping) Q.loop(); }, 120000);
  }
})();
