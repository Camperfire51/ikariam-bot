// Mucit atölyesi araştırma botu. Barbar ve inşaat botlarından tamamen ayrı çalışır;
// sadece api.js/game.js'teki istek katmanını paylaşır (aynı istek kuyruğu, token yarışı olmaz).
// Mantık: her şehrin kendi sırası var. Sıradaki birimin seçili araştırması (saldırı/zırh) hedef seviyeye gelene
// kadar birer seviye yapılır. Atölyede araştırma varsa bitmesi beklenir; altın/kristal yoksa beklenir.
// Sıradaki iş bitmeden sonrakine geçilmez.
// Başlat/Durdur yok: paneldeki Açık tiki açık olduğu sürece bot çalışır; hata olsa da durmaz, tekrar dener.
(() => {
  const IB = window.IkaBot;
  const G = IB.makeGame('arastirma');
  const { GameError } = IB;

  const KEY = 'ikabot.arastirma.v1';
  const LOG_KEY = 'ikabot.arastirma.log';
  const LOCK_KEY = 'ikabot.arastirma.lock';

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
    console.log('[Araştırma]', msg);
    emit();
  };

  // Tek sekme kilidi: iki sekme aynı anda araştırma emri vermesin.
  const lock = IB.tabLock(LOCK_KEY);

  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('tr-TR');
  const fmtNum = (n) => Number(n).toLocaleString('tr-TR');

  // Atölye ekranında aynı birim hangi şehirden açılırsa açılsın görünür; bu yüzden şehri doğrulamak için
  // önce bina yerinin hâlâ atölye olduğuna bakılır.
  async function findWorkshop(cityId) {
    const city = await G.city(cityId);
    return G.findBuilding(city, 'workshop') || null;
  }

  const R = (IB.research = {
    items: [], // { id, cityId, cityName, position, unitId, unitName, upgradeType, typeName, targetLevel }
    passive: false,
    status: 'Başlıyor…',
    cityStatus: {}, // cityId -> metin
    nextAt: {}, // cityId -> ms
    _err: {}, // cityId -> son hata (aynı hata günlüğe bir kez yazılır)
    nextId: 1,
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
        IB.migrateRunning('arastirma', d.running, Array.isArray(d.items) && d.items.length > 0);
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
          R._wake = null;
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
        if (IB.notify) IB.notify('Araştırma sırası: sorun var, tekrar deneniyor', msg);
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
      const label = `${item.cityName}: ${item.unitName} ${item.typeName} → ${item.targetLevel}`;

      const ws = await findWorkshop(cityId);
      if (!ws || ws.index !== item.position) {
        this.setCityStatus(cityId, `${label}: bu şehirde mucit atölyesi bulunamadı. Sırayı düzelt (iş silinmeden sonrakine geçilmez).`);
        return 1800;
      }

      const tab = G.workshopTab(item.unitId);
      const w = await G.workshop(cityId, item.position, tab);
      const unit = w.units.find((u) => u.id === item.unitId);
      const up = unit && unit[item.upgradeType];
      if (!up) {
        this.setCityStatus(cityId, `${label}: bu araştırma atölyede bulunamadı. Sırayı düzelt.`);
        return 1800;
      }

      // Atölyede araştırma varsa (bot ya da elle başlatılmış) bitmesini bekle.
      const untilDone = (x) => {
        const left = x.progressEnd ? x.progressEnd - Date.now() / 1000 : 0;
        return (left > 0 ? left : IB.rand(1800, 2700)) + IB.rand(15, 45);
      };
      if (w.inProgress) {
        const wait = untilDone(w);
        const when = w.progressEnd ? `${fmtClock(Date.now() + wait * 1000)} civarı bitiyor` : 'bitmesi bekleniyor';
        this.setCityStatus(cityId, `${label}: atölyede araştırma var, ${when}.`);
        return wait;
      }

      if (up.level >= item.targetLevel) {
        log(`${label} tamamlandı (seviye ${up.level}).`);
        this.items = this.items.filter((i) => i.id !== item.id);
        this.save();
        return 2; // sıradaki işe hemen geç
      }
      if (!up.next) {
        log(`${label}: en yüksek seviyeye ulaşıldı (seviye ${up.level}), iş silindi.`, 'warn');
        this.items = this.items.filter((i) => i.id !== item.id);
        this.save();
        return 2;
      }

      if (up.error) {
        this.warnOnce(cityId, `${label}: ${up.error} (seviye ${up.level}), bekliyor.`);
        return IB.rand(1200, 1800);
      }
      if (w.gold < up.next.gold || w.crystal < up.next.crystal) {
        this.setCityStatus(
          cityId,
          `${label}: kaynak yetersiz (seviye ${up.next.level} için ${fmtNum(up.next.gold)} altın, ${fmtNum(up.next.crystal)} kristal gerekiyor; ` +
            `şehirde ${fmtNum(Math.floor(w.crystal))} kristal, toplam ${fmtNum(Math.floor(w.gold))} altın var), bekliyor.`
        );
        return IB.rand(900, 1800);
      }

      const errors = await G.startWorkshopUpgrade({ cityId, position: item.position, unitId: item.unitId, upgradeType: item.upgradeType });
      if (errors.length) {
        this.warnOnce(cityId, `${label}: yapılamadı (${errors.join(' / ')}), bekliyor.`);
        return IB.rand(900, 1800);
      }

      // Oyun hata vermeden reddedebilir: atölyeyi tekrar okuyup araştırmanın başladığını doğrula.
      const after = await G.workshop(cityId, item.position, tab);
      const au = after.units.find((u) => u.id === item.unitId);
      const aup = au && au[item.upgradeType];
      if (after.inProgress || (aup && aup.level > up.level)) {
        log(`${label}: ${up.next.name || 'araştırma'} (seviye ${up.level} → ${up.next.level}) başladı.`);
        const wait = untilDone(after);
        const when = after.progressEnd ? `${fmtClock(Date.now() + wait * 1000)} civarı bitiyor` : 'bitmesi bekleniyor';
        this.setCityStatus(cityId, `${label}: ${up.next.level}. seviye araştırılıyor, ${when}.`);
        return wait;
      }
      this.warnOnce(cityId, `${label}: oyun kabul etmedi (büyük ihtimalle kaynak yok), bekliyor.`);
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
              log('Araştırma sırası bu sekmede devam ediyor (önceki sekme kapandı).');
            }
            // Kapalı (Açık tiki kaldırılmış): açılana kadar bekle; sıra ve kayıtlar olduğu gibi kalır.
            if (IB.isPaused('arastirma')) {
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

  R.load();
  IB.onPauseChange((bot) => { if (bot === 'arastirma') R.wake(); });
  window.addEventListener('beforeunload', () => lock.release());
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (R.passive || !R._looping)) R.load();
  });
  // Sayfa açılınca döngü başlar; bir sebeple biterse bekçi yeniden başlatır.
  if (IB.inGame()) {
    setTimeout(() => R.loop(), 7000);
    setInterval(() => { if (!R._looping) R.loop(); }, 120000);
  }
})();
