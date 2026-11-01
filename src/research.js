// Mucit atölyesi araştırma botu. Barbar ve inşaat botlarından tamamen ayrı çalışır;
// sadece api.js/game.js'teki istek katmanını paylaşır (aynı istek kuyruğu, token yarışı olmaz).
// Mantık: her şehrin kendi sırası var. Sıradaki birimin seçili araştırması (saldırı/zırh) hedef seviyeye gelene
// kadar birer seviye yapılır. Atölyede araştırma varsa bitmesi beklenir; altın/kristal yoksa beklenir.
// Sıradaki iş bitmeden sonrakine geçilmez.
(() => {
  const IB = window.IkaBot;
  const G = IB.makeGame('arastirma');
  const { GameError } = IB;

  const KEY = 'ikabot.arastirma.v1';
  const LOG_KEY = 'ikabot.arastirma.log';
  const LOCK_KEY = 'ikabot.arastirma.lock';
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
    console.log('[Araştırma]', msg);
    emit();
  };

  // Tek sekme kilidi: iki sekme aynı anda araştırma emri vermesin.
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

  // Atölye ekranında aynı birim hangi şehirden açılırsa açılsın görünür; bu yüzden şehri doğrulamak için
  // önce bina yerinin hâlâ atölye olduğuna bakılır.
  async function findWorkshop(cityId) {
    const city = await G.city(cityId);
    return G.findBuilding(city, 'workshop') || null;
  }

  const R = (IB.research = {
    items: [], // { id, cityId, cityName, position, unitId, unitName, upgradeType, typeName, targetLevel }
    running: false,
    passive: false,
    status: 'Durdu',
    cityStatus: {}, // cityId -> metin
    nextAt: {}, // cityId -> ms
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
      log('Araştırma sırası başlatıldı.');
      this.loop();
    },
    stop(reason, level = 'info') {
      this.running = false;
      this.status = reason ? 'Durdu: ' + reason : 'Durdu';
      this.save();
      releaseLock();
      log(reason ? 'Araştırma sırası durdu: ' + reason : 'Araştırma sırası durduruldu.', level);
      if (reason && level === 'error' && IB.notify) IB.notify('Araştırma sırası durdu', reason);
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

    // Bir şehrin sırasındaki ilk işi ilerletir. Kaç saniye sonra tekrar bakılacağını döndürür.
    async processCity(cityId) {
      const item = this.itemsOf(cityId)[0];
      if (!item) return null;
      const label = `${item.cityName}: ${item.unitName} ${item.typeName} → ${item.targetLevel}`;

      const ws = await findWorkshop(cityId);
      if (!ws || ws.index !== item.position) {
        this.setCityStatus(cityId, `${label}: bu şehirde mucit atölyesi bulunamadı. Sırayı düzelt (iş silinmeden sonrakine geçilmez).`);
        return 600;
      }

      const tab = G.workshopTab(item.unitId);
      const w = await G.workshop(cityId, item.position, tab);
      const unit = w.units.find((u) => u.id === item.unitId);
      const up = unit && unit[item.upgradeType];
      if (!up) {
        this.setCityStatus(cityId, `${label}: bu araştırma atölyede bulunamadı. Sırayı düzelt.`);
        return 600;
      }

      // Atölyede araştırma varsa (bot ya da elle başlatılmış) bitmesini bekle.
      const untilDone = (x) => {
        const left = x.progressEnd ? x.progressEnd - Date.now() / 1000 : 0;
        return (left > 0 ? left : IB.rand(600, 900)) + IB.rand(15, 45);
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
        return IB.rand(300, 600);
      }
      if (w.gold < up.next.gold || w.crystal < up.next.crystal) {
        this.setCityStatus(
          cityId,
          `${label}: kaynak yetersiz (seviye ${up.next.level} için ${fmtNum(up.next.gold)} altın, ${fmtNum(up.next.crystal)} kristal gerekiyor; ` +
            `şehirde ${fmtNum(Math.floor(w.crystal))} kristal, toplam ${fmtNum(Math.floor(w.gold))} altın var), bekliyor.`
        );
        return IB.rand(150, 300);
      }

      const errors = await G.startWorkshopUpgrade({ cityId, position: item.position, unitId: item.unitId, upgradeType: item.upgradeType });
      if (errors.length) {
        this.warnOnce(cityId, `${label}: yapılamadı (${errors.join(' / ')}), bekliyor.`);
        return IB.rand(150, 300);
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
            log('Araştırma sırası bu sekmede devam ediyor (önceki sekme kapandı).');
            if (!this.running) break;
          }
          // Duraklatıldı: devam ettirilene kadar bekle; sıra ve kayıtlar olduğu gibi kalır.
          if (IB.isPaused('arastirma')) {
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

          const nexts = this.cityIds().map((id) => this.nextAt[id] || 0);
          const waitMs = nexts.length ? Math.min(...nexts) - Date.now() : 60000;
          await this.sleep(Math.min(60000, Math.max(1000, waitMs)));
        }
      } finally {
        clearInterval(heartbeat);
        this._looping = false;
        this.passive = false;
        if (!this.running) releaseLock();
        emit();
      }
    },
  });

  R.load();
  IB.onPauseChange((bot) => { if (bot === 'arastirma') R.wake(); });
  window.addEventListener('beforeunload', releaseLock);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (R.passive || !R._looping)) R.load();
  });
  // Sayfa yenilendiyse ve sıra çalışıyorduysa devam et.
  setTimeout(() => {
    if (R.running && !R._looping) R.loop();
  }, 7000);
})();
