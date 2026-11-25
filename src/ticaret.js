// Ticari rota botu. Diğer botlardan tamamen ayrı çalışır; sadece api.js/game.js'teki istek katmanını paylaşır.
// Ticari rota: her gün belirli bir saatte, kendi şehrimizden diğerine belirli bir miktar hammadde göndermek.
// Her rotanın her günkü saati bir "istek"tir. Saat gelince gönderilir. Gönderim mümkün değilse (hammadde ya da gemi
// yetmiyor, oyun reddetti…): ortak "Tekrar dene" açıksa ortak sıklıkla tekrar denenir; ertesi günün aynı saati
// gelene kadar (bir tur dolana kadar) yetişmezse o istek geçersiz olur, sıradaki günün isteği başlar.
// "Tekrar dene" kapalıysa o günkü istek ilk denemede yapılamazsa geçersizdir.
// Gönderim hep tam miktardır: yarım gönderim yapılmaz. Ücretli taşıma seçeneklerine (ambrosia) dokunulmaz.
// Başlat/Durdur yok: paneldeki Açık tiki açık olduğu sürece bot çalışır; hata olsa da durmaz, tekrar dener.
(() => {
  const IB = window.IkaBot;
  const G = IB.makeGame('ticaret');
  const { GameError } = IB;

  const KEY = 'ikabot.ticaret.v1';
  const LOG_KEY = 'ikabot.ticaret.log';
  const LOCK_KEY = 'ikabot.ticaret.lock';
  // Tekrar dene kapalıyken bot saatinde çalışmıyorduysa (sayfa kapalı, bot kapalı) en fazla bu kadar geç gönderilir.
  const GRACE_MS = 15 * 60000;
  const DEFAULT_CAPACITY = 500; // gemi kapasitesi ekrandan okunamazsa

  const RES = [
    { id: 'resource', name: 'Odun' },
    { id: '1', name: 'Şarap' },
    { id: '2', name: 'Mermer' },
    { id: '3', name: 'Kristal' },
    { id: '4', name: 'Sülfür' },
  ];
  const resName = (id) => (RES.find((r) => r.id === String(id)) || {}).name || String(id);

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
    console.log('[Ticaret]', msg);
    emit();
  };

  // Tek sekme kilidi: iki sekme aynı rotayı iki kez göndermesin.
  const lock = IB.tabLock(LOCK_KEY);

  const fmtNum = (n) => Number(n).toLocaleString('tr-TR');
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // "HH:MM" saatinin şu andan önceki (ya da şu anki) son gerçekleşmesi (ms).
  function lastOcc(time, now) {
    const [h, m] = String(time).split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  // Bir gerçekleşmeden sonraki gün aynı saat (yaz saati geçişlerinde de doğru).
  function nextDay(occ) {
    const d = new Date(occ);
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  const T = (IB.ticaret = {
    routes: [], // { id, fromId, fromName, toId, toName, res, amount, time }
    settings: { retry: true, retryMin: 10 },
    st: {}, // rota id -> { handled, tryOcc, nextTry, tries, jitter }
    nextId: 1,
    passive: false,
    status: 'Başlıyor…',
    routeStatus: {}, // rota id -> metin
    nextAt: {}, // rota id -> ms
    _err: {}, // rota id -> son hata (aynı hata günlüğe bir kez yazılır)
    _errUntil: {}, // rota id -> hatadan sonra tekrar denenecek zaman (ms)
    _looping: false,
    _wake: null,
    RES,
    resName,

    onChange: (fn) => listeners.add(fn),
    getLog,
    log,

    load() {
      let d = null;
      try {
        d = JSON.parse(localStorage.getItem(KEY));
      } catch (e) {}
      this.routes = (d && Array.isArray(d.routes)) ? d.routes : [];
      this.settings = { retry: true, retryMin: 10, ...((d && d.settings) || {}) };
      this.st = (d && d.st) || {};
      this.nextId = (d && d.nextId) || 1;
      emit();
    },
    save() {
      if (this.passive) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({ routes: this.routes, settings: this.settings, st: this.st, nextId: this.nextId }));
      } catch (e) {}
      emit();
    },
    S(id) {
      if (!this.st[id]) this.st[id] = { handled: 0, tryOcc: 0, nextTry: 0, tries: 0, jitter: IB.rand(5, 60) };
      return this.st[id];
    },
    label(r) {
      return `R${r.id} ${r.time} · ${r.fromName} → ${r.toName} · ${fmtNum(r.amount)} ${resName(r.res)}`;
    },

    // Yeni rota ilk kez bir sonraki saatinde çalışır (eklendiği an saati geçmiş olsa da hemen gönderilmez).
    add({ fromId, fromName, toId, toName, res, amount, time }) {
      if (this.passive) return;
      const r = { id: this.nextId++, fromId, fromName, toId, toName, res: String(res), amount: Math.floor(amount), time };
      this.routes.push(r);
      this.S(r.id).handled = lastOcc(time, Date.now());
      this.save();
      log(`Rota eklendi: ${this.label(r)}. İlk gönderim ${fmtDay(nextDay(lastOcc(time, Date.now())))}.`);
      this.wake();
    },
    remove(id) {
      if (this.passive) return;
      const r = this.routes.find((x) => x.id === id);
      this.routes = this.routes.filter((x) => x.id !== id);
      delete this.st[id];
      delete this.routeStatus[id];
      delete this.nextAt[id];
      delete this._err[id];
      delete this._errUntil[id];
      this.save();
      if (r) log(`Rota silindi: ${this.label(r)}.`);
      this.wake();
    },
    setSettings(s) {
      if (this.passive) return;
      const retryMin = Math.max(1, Math.min(720, Math.floor(Number(s.retryMin) || this.settings.retryMin)));
      const next = { retry: !!s.retry, retryMin };
      if (next.retry === this.settings.retry && next.retryMin === this.settings.retryMin) return;
      this.settings = next;
      // Bekleyen tekrar denemeler yeni sıklığa göre yeniden zamanlanır.
      for (const id of Object.keys(this.st)) {
        const st = this.st[id];
        if (st.nextTry) st.nextTry = Math.min(st.nextTry, Date.now() + retryMin * 60000);
      }
      this.save();
      log(next.retry ? `Tekrar dene açık: ${retryMin} dk'da bir.` : 'Tekrar dene kapalı: saatinde gönderilemeyen istek o gün için geçersiz.');
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
          T._wake = null;
          resolve();
        }
        this._wake = done;
      });
    },

    setStatus(id, text) {
      this.routeStatus[id] = text;
      emit();
    },

    // Bu rotanın bir sonraki işlem zamanı (ms): bekleyen istek varsa deneme zamanı, yoksa bir sonraki saati.
    dueAt(r, now) {
      const s = this.S(r.id);
      const occ = lastOcc(r.time, now);
      const upcoming = nextDay(occ) + s.jitter * 1000;
      if (s.handled >= occ) return upcoming;
      if (s.tryOcc === occ && s.nextTry) return Math.min(s.nextTry, upcoming);
      return occ + s.jitter * 1000;
    },

    // İstek sonuçlandı (gönderildi ya da geçersiz): bir sonraki güne geçilir.
    finish(r, occ) {
      const s = this.S(r.id);
      Object.assign(s, { handled: occ, tryOcc: 0, nextTry: 0, tries: 0, jitter: IB.rand(5, 60) });
      this.save();
    },

    // Gönderim mümkün değil: Tekrar dene açıksa sonra tekrar denenir, değilse bu günkü istek geçersiz olur.
    notPossible(r, occ, reason) {
      const s = this.S(r.id);
      const end = nextDay(occ);
      s.tries = (s.tries || 0) + 1;
      if (this.settings.retry) {
        const at = Date.now() + this.settings.retryMin * 60000;
        s.nextTry = at;
        this.save();
        if (at >= end) {
          this.setStatus(r.id, `Gönderilemedi: ${reason}. Bu istek için ${fmtClock(end)}'e kadar başka deneme kalmadı; sonra sıradaki günün isteği başlar.`);
        } else {
          this.setStatus(r.id, `Gönderilemedi: ${reason}. ${fmtClock(at)}'de tekrar denenecek (bu istek ${fmtDay(end)}'e kadar geçerli).`);
        }
        if (s.tries === 1) log(`${this.label(r)}: gönderilemedi (${reason}); ${this.settings.retryMin} dk'da bir tekrar denenecek.`, 'warn');
        return;
      }
      this.finish(r, occ);
      const msg = `${this.label(r)}: gönderilemedi (${reason}). Tekrar dene kapalı; bu günkü istek geçersiz, sıradaki ${fmtDay(end)}.`;
      log(msg, 'warn');
      if (IB.notify) IB.notify('Ticari rota gönderilemedi', msg);
      this.setStatus(r.id, `Gönderilemedi: ${reason}. Tekrar dene kapalı; sıradaki gönderim ${fmtDay(end)}.`);
    },

    // Hata (bağlantı, oturum…): bot durmaz. Durum satırına yazılır, aynı hata günlüğe ve bildirime bir kez düşer.
    fail(id, e, waitSec) {
      const msg = (e && e.message) || String(e);
      if (this._err[id] !== msg) {
        this._err[id] = msg;
        log(`Hata: ${msg} — ${Math.ceil(waitSec / 60)} dk sonra tekrar denenecek (bot durmuyor).`, 'warn');
        if (IB.notify) IB.notify('Ticari rota: sorun var, tekrar deneniyor', msg);
      }
      this.setStatus(id, `Hata: ${msg} — tekrar denenecek.`);
    },
    recovered(id) {
      if (!this._err[id]) return;
      delete this._err[id];
      log('Sorun giderildi, devam ediliyor.');
    },

    // Rotanın zamanı geldiyse işler. Hata atarsa (bağlantı vb.) döngü IB.retryWait kadar sonra tekrar dener.
    async processRoute(r) {
      const now = Date.now();
      const s = this.S(r.id);
      const occ = lastOcc(r.time, now);
      const end = nextDay(occ);

      // Önceki günün isteği hâlâ deneniyorduysa bir tur doldu: o istek geçersiz.
      if (s.tryOcc && s.tryOcc < occ && s.handled < s.tryOcc) {
        const msg = `${this.label(r)}: ${fmtDay(s.tryOcc)} isteği bir sonraki saate kadar gönderilemedi; geçersiz sayıldı.`;
        log(msg, 'warn');
        if (IB.notify) IB.notify('Ticari rota isteği geçersiz', msg);
        Object.assign(s, { tryOcc: 0, nextTry: 0, tries: 0 });
        this.save();
      }
      if (s.handled >= occ) {
        if (!/^Gönderil|^Hata/.test(this.routeStatus[r.id] || '')) this.setStatus(r.id, `Bekliyor; sıradaki gönderim ${fmtDay(end)}.`);
        return;
      }
      if (s.tryOcc !== occ) {
        // Yeni istek. Tekrar dene kapalıyken saati çoktan geçmişse (sayfa/bot kapalıydı) gönderilmez.
        if (!this.settings.retry && now - occ > GRACE_MS) {
          this.finish(r, occ);
          const msg = `${this.label(r)}: ${fmtDay(occ)} saatinde bot çalışmıyordu; tekrar dene kapalı olduğu için bu günkü gönderim yapılmadı.`;
          log(msg, 'warn');
          this.setStatus(r.id, `Saati kaçırıldı (bot çalışmıyordu). Sıradaki gönderim ${fmtDay(end)}.`);
          return;
        }
        Object.assign(s, { tryOcc: occ, nextTry: 0, tries: 0 });
        this.save();
      }
      if (s.nextTry && s.nextTry > now) return;

      if (Number(r.fromId) === Number(r.toId)) return this.notPossible(r, occ, 'kaynak ve hedef şehir aynı');
      const owned = new Set(cityIds());
      if (owned.size && !owned.has(Number(r.fromId))) return this.notPossible(r, occ, `${r.fromName} artık senin şehrin değil`);
      if (owned.size && !owned.has(Number(r.toId))) return this.notPossible(r, occ, `${r.toName} artık senin şehrin değil`);

      this.setStatus(r.id, `${r.fromName}: taşıma ekranı okunuyor…`);
      let form;
      try {
        form = await G.transportForm(r.fromId, r.toId);
      } catch (e) {
        if (e instanceof GameError && e.kind === 'noform') return this.notPossible(r, occ, e.message.replace(/\.$/, ''));
        throw e;
      }
      const key = G.CARGO[r.res].key;
      const have = Math.floor(Number(form.resources[key]) || 0);
      if (have < r.amount) return this.notPossible(r, occ, `${r.fromName} şehrinde ${resName(r.res).toLowerCase()} yetmiyor (${fmtNum(have)} var, ${fmtNum(r.amount)} gerekli)`);
      let cap = form.shipCapacity;
      if (!cap) {
        cap = DEFAULT_CAPACITY;
        if (!this._capWarned) {
          this._capWarned = true;
          log(`Gemi kapasitesi taşıma ekranından okunamadı; gemi başına ${DEFAULT_CAPACITY} sayıldı. Form alanları: ${Object.keys(form.fields).join(', ')}`, 'warn');
        }
      }
      const ships = Math.ceil(r.amount / cap);
      const free = Number.isFinite(form.freeTransporters) ? form.freeTransporters : null;
      if (free !== null && free < ships) return this.notPossible(r, occ, `${r.fromName} şehrinde boşta gemi yetmiyor (${ships} gemi gerekli, ${free} boşta)`);

      this.setStatus(r.id, `${r.fromName} → ${r.toName}: ${fmtNum(r.amount)} ${resName(r.res).toLowerCase()} gönderiliyor (${ships} gemi)…`);
      const res = await G.sendTransport({ fromCityId: r.fromId, toCityId: r.toId, form, res: r.res, amount: r.amount, ships });
      if (res.errors.length) return this.notPossible(r, occ, 'oyun reddetti: ' + res.errors.join(' / '));
      // Oyun hata vermeden reddedebilir: kaynak şehirdeki hammaddenin azaldığı doğrulanır.
      // Doğrulanamasa da (yanıtta kaynak yok) oyun hata vermediği için gönderilmiş sayılır; iki kez gönderilmesin.
      const dropped = res.after !== null ? have - res.after : null;
      if (dropped !== null && dropped < r.amount * 0.9 && !res.successes.length) {
        return this.notPossible(r, occ, `oyun gönderimi kabul etmedi (${resName(r.res).toLowerCase()} azalmadı)`);
      }
      this.finish(r, occ);
      const note = dropped === null ? ' (yanıtta kaynak görünmedi, doğrulanamadı)' : '';
      log(`${this.label(r)}: gönderildi, ${ships} gemi${note}.`);
      this.setStatus(r.id, `Gönderildi (${fmtClock(Date.now())}, ${ships} gemi). Sıradaki gönderim ${fmtDay(end)}.`);
    },

    // Döngü hiç bitmez: tik kapalıyken bekler, açıkken zamanı gelen rotaları işler. Hiçbir hata botu durdurmaz.
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
              log('Ticari rota botu bu sekmede devam ediyor (önceki sekme kapandı).');
            }
            // Kapalı (Açık tiki kaldırılmış): açılana kadar bekle; rotalar ve kayıtlar olduğu gibi kalır.
            if (IB.isPaused('ticaret')) {
              this.status = 'Kapalı';
              emit();
              await this.sleep(60000);
              continue;
            }
            this.status = this.routes.length ? 'Çalışıyor' : 'Rota yok; rota eklenince başlar.';

            for (const r of [...this.routes]) {
              if (IB.isPaused('ticaret')) break;
              if (!this.routes.includes(r)) continue; // bu arada silindi
              if (this.dueAt(r, Date.now()) > Date.now()) continue;
              if (this._errUntil[r.id] > Date.now()) continue;
              try {
                this.current = r.id; // panelde "şu an" satırı için
                emit();
                await this.processRoute(r);
                httpFailures = 0;
                this.recovered(r.id);
                delete this._errUntil[r.id];
              } catch (e) {
                // Tik kapatılınca iş yarıda kesildi: bu rota açılınca oyundan taze okunarak yeniden işlenir.
                if (e instanceof GameError && e.kind === 'paused') break;
                if (!(e instanceof GameError)) console.error(e);
                if (e instanceof GameError && e.kind === 'http') httpFailures++;
                const waitSec = IB.retryWait(e, httpFailures);
                this.fail(r.id, e, waitSec);
                this._errUntil[r.id] = Date.now() + waitSec * 1000;
                // Bağlantı/oturum sorunu bütün rotaları etkiler: hepsi aynı süre bekleyip tekrar dener.
                if (e instanceof GameError && (e.kind === 'http' || e.kind === 'session')) {
                  for (const o of this.routes) this._errUntil[o.id] = this._errUntil[r.id];
                  break;
                }
              }
            }
            this.current = null;

            const now = Date.now();
            for (const r of this.routes) {
              const errAt = this._errUntil[r.id] > now ? this._errUntil[r.id] : 0;
              this.nextAt[r.id] = errAt || this.dueAt(r, now);
            }
            emit();
            const nexts = this.routes.map((r) => this.nextAt[r.id]);
            const waitMs = nexts.length ? Math.min(...nexts) - now : 60000;
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

  // Oyuncunun kendi şehirleri (sayfadaki şehir listesinden).
  function cityIds() {
    try {
      const r = ikariam.model.relatedCityData || {};
      return Object.keys(r)
        .filter((k) => k.startsWith('city_') && r[k].relationship === 'ownCity')
        .map((k) => Number(r[k].id));
    } catch (e) {
      return [];
    }
  }

  T.load();
  IB.onPauseChange((bot) => { if (bot === 'ticaret') T.wake(); });
  window.addEventListener('beforeunload', () => lock.release());
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (T.passive || !T._looping)) T.load();
  });
  // Sayfa açılınca döngü başlar; bir sebeple biterse bekçi yeniden başlatır.
  if (IB.inGame()) {
    setTimeout(() => T.loop(), 7000);
    setInterval(() => { if (!T._looping) T.loop(); }, 120000);
  }
})();
