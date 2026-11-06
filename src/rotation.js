// Barbar saldırı botu: aynı anda birden fazla rotasyon.
// Her rotasyon bir barbar sömürgesinin adasındaki köyü max seviyeye kadar vurur, sonra uyarı verip durur
// (sömürge silme/kurma elle yapılır). Tek bir zamanlayıcı, zamanı gelen rotasyonları sırayla çalıştırır;
// böylece istekler çakışmaz ve her gönderimden önce asker/gemi durumu taze okunur.
(() => {
  const IB = window.IkaBot;
  const G = IB.game;
  const { GameError } = IB;

  const KEY = 'ikabot.barbar.v2';
  const OLD_KEY = 'ikabot.barbar.v1';
  const LOG_KEY = 'ikabot.barbar.log';
  const LOCK_KEY = 'ikabot.barbar.lock';
  const STOCK_CHECK_MS = [900000, 1500000]; // asker havuzunun düzenli kontrol aralığı: rastgele 15-25 dk
  const SPEAR_CHECK_MS = [1800000, 3000000]; // sömürgedeki mızrakçılara bakma aralığı: rastgele 30-50 dk
  // Bir rotasyonun iki kontrolü arasındaki en uzun bekleme. Zamanı bilinen işler (gönderim anı, dönen gemiler)
  // tam vaktinde yapılır; bu sınır sadece arada boşuna bakılmasını önler.
  const MAX_WAIT_SEC = 1800;
  const AHEAD_ROUNDS = 3; // asker havuzu: sıradaki saldırı dahil bu kadar turun askeri, tur başına bir kışla emriyle basılır
  const QUEUE_MAX = 3; // kışla kuyruğu en fazla 3 emir alır

  const CFG_DEFAULTS = {
    originId: null,
    originName: null,
    colonyId: null,
    colonyName: null,
    targetIslandId: null,
    targetIslandName: null,
    maxLevel: 12,
    leadMin: 8,
    autoTrain: true,
    sendSpearmen: true, // sömürgede basılan mızrakçıların hepsi kaynak şehre yollanır
  };

  const ST_DEFAULTS = {
    running: false,
    status: 'Durdu',
    nextAt: null, // ms
    lastAttack: null,
    lastLooted: null,
    nextLevel: null, // sadece bilgi amaçlı; kararlar her seferinde oyundan okunan seviyeyle verilir
    notified: {},
    stopReason: null,
    journey: null,
    shipCapacity: null,
    followUp: null, // son ek sefer: { key: seviye:toparlanma, count, sentAt }
    followUpGaveUp: null, // bu toparlanmada ek sefere zaman yetmedi
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmtTime = (sec) => new Date(sec * 1000).toLocaleTimeString('tr-TR');
  const fmtDur = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return (h ? h + 'sa ' : '') + (h || m ? m + 'dk ' : '') + s + 'sn';
  };
  IB.fmtTime = fmtTime;
  IB.fmtDur = fmtDur;

  // ---------- Günlük ve bildirim ----------

  const listeners = new Set();
  IB.onChange = (fn) => listeners.add(fn);
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) {} });

  IB.getLog = () => {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    } catch (e) {
      return [];
    }
  };

  IB.log = (msg, level = 'info') => {
    const entries = IB.getLog();
    entries.push({ t: Date.now(), level, msg });
    while (entries.length > 400) entries.shift();
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    } catch (e) {}
    console.log('[IkaBot]', msg);
    emit();
  };

  // ---------- Tek sekme kilidi (iki sekme aynı anda saldırı göndermesin) ----------

  const lock = IB.tabLock(LOCK_KEY);

  // ---------- Tek bir rotasyon ----------

  class Rotation {
    constructor(data, mgr) {
      this.id = data.id;
      this.cfg = { ...CFG_DEFAULTS, ...(data.cfg || {}) };
      this.st = { ...ST_DEFAULTS, ...(data.st || {}) };
      this.mgr = mgr;
    }

    toJSON() {
      return { id: this.id, cfg: this.cfg, st: this.st };
    }

    get label() {
      const island = this.cfg.targetIslandName ? ' ' + this.cfg.targetIslandName.split(' [')[0] : '';
      return `R${this.id}${island}`;
    }

    get others() {
      return this.mgr.rotations.filter((r) => r !== this);
    }

    log(msg, level) {
      IB.log(`[${this.label}] ${msg}`, level);
    }

    save() {
      this.mgr.save();
    }

    setStatus(text) {
      if (this.st.status !== text) {
        this.st.status = text;
        this.save();
      }
    }

    // Başlatmadan önce ayarları doğrular.
    async prepare(input) {
      const originId = Number(input.originId);
      const colonyId = Number(input.colonyId);
      const maxLevel = Number(input.maxLevel);
      if (!originId || !colonyId) throw new GameError('Kaynak şehir ve barbar sömürgesi seçilmeli.', 'config');
      if (originId === colonyId) throw new GameError('Kaynak şehir ile barbar sömürgesi aynı olamaz.', 'config');
      const tableMax = IB.maxTableLevel();
      if (!tableMax) throw new GameError('Seviye tablosu boş ya da 1. seviye tanımlı değil; önce tabloyu düzenle.', 'config');
      if (!(maxLevel >= 1 && maxLevel <= tableMax))
        throw new GameError(`Seviye 1-${tableMax} arasında olmalı (tabloda 1'den itibaren boşluksuz tanımlı son seviye ${tableMax}).`, 'config');

      // Çakışma sadece çalışan rotasyonlarla aranır; durmuş bir rotasyonun eski ayarı engel olmaz
      // (o rotasyon tekrar başlatılmak istenirse kontrol onda yapılır).
      const active = this.others.filter((o) => o.st.running);
      for (const o of active) {
        if (!o.cfg.colonyId) continue;
        if (Number(o.cfg.colonyId) === colonyId) throw new GameError(`Bu sömürge zaten R${o.id} rotasyonunda kullanılıyor.`, 'config');
        if (Number(o.cfg.colonyId) === originId) throw new GameError(`Kaynak şehir, R${o.id} rotasyonunun barbar sömürgesi.`, 'config');
        if (Number(o.cfg.originId) === colonyId) throw new GameError(`Bu şehir R${o.id} rotasyonunun kaynak şehri; sömürge olarak seçilemez.`, 'config');
      }

      const snap = await G.snapshot(originId);
      const origin = await G.city(originId);
      const colony = await G.city(colonyId);
      if (colony.isCapital) throw new GameError('Başkent barbar sömürgesi olarak seçilemez.', 'config');
      if (origin.islandId === colony.islandId)
        throw new GameError('Kaynak şehir barbar adasında olamaz; aksi halde sömürge silinince barbar seviyesi sıfırlanmaz.', 'config');
      if (!G.findBuilding(origin, 'barracks') && input.autoTrain)
        throw new GameError(`Kaynak şehirde (${origin.name}) kışla bulunamadı; otomatik asker basımı yapılamaz. Okunan binalar: ${G.buildingNames(origin)}`, 'config');
      for (const o of active) {
        if (o.cfg.colonyId && Number(o.cfg.targetIslandId) === colony.islandId)
          throw new GameError(`Bu ada zaten R${o.id} rotasyonunun hedefi.`, 'config');
      }

      const island = await G.island(colony.islandId);
      const me = G.avatarId();
      const mineOnIsland = island.cities.filter((c) => c.type === 'city' && c.ownerId === me);
      if (mineOnIsland.length !== 1 || mineOnIsland[0].id !== colonyId)
        throw new GameError('Barbar adasında yalnızca seçilen sömürge bulunmalı.', 'config');

      // Araştırılmamış birim engel değil (oyunda satın alınabiliyor): sadece bilgi verilir. Kışla basamazsa
      // asker havuzu bunu bir kez yazar; birimler elle alınınca rotasyon devam eder.
      const units = await G.units(originId);
      const unresearched = new Set();
      for (let lv = 1; lv <= maxLevel; lv++) {
        for (const id of Object.keys(IB.planForLevel(lv).units)) if (!units[id] || units[id].amount === null) unresearched.add(id);
      }
      for (const id of Object.keys(IB.getFollowUnits())) if (!units[id] || units[id].amount === null) unresearched.add(id);
      if (unresearched.size)
        this.log(
          `Bilgi: ${[...unresearched].map((id) => IB.UNIT_NAMES[id] || id).join(', ')} araştırılmamış görünüyor; kışla basamayabilir, gerekirse elle satın al. Şehirde yeterince olunca saldırı gider.`
        );

      return {
        ...this.cfg,
        originId,
        originName: origin.name,
        colonyId,
        colonyName: colony.name,
        targetIslandId: colony.islandId,
        targetIslandName: `${colony.islandName} [${colony.x}:${colony.y}]`,
        maxLevel,
        // 0 geçerli bir değer (erken gönderim yok); sadece boş/geçersiz girişte varsayılan kullanılır.
        leadMin: input.leadMin !== '' && Number.isFinite(Number(input.leadMin)) ? Math.max(0, Math.min(30, Number(input.leadMin))) : 8,
        autoTrain: !!input.autoTrain,
        sendSpearmen: !!input.sendSpearmen,
      };
    }

    plan(level) {
      return IB.planForLevel(level);
    }

    // Ana saldırının gemisi. Köy ayaktaysa kaynak oyundan (köy penceresi, arka planda) okunur ve gereken gemi
    // hesaplanır: askerler + köydeki yağmanın tamamı, askerlerin son gemisindeki boş yere de yağma yüklenir,
    // toplam yukarı yuvarlanır (örn. 500'lük gemide 200 asker yükü + 5000 kaynak = 5200 → 11 gemi).
    // Erken gönderimde köy yıkık, yeni seviyenin kaynağı oyunda görünmez: tablodaki elle girilen ganimet gemisi kullanılır.
    // Kalan kaynağı ek seferler köyden gerçek değeri okuyarak alır (bkz. followUp).
    // troopsOnShips: false ise (aynı ada) askerler gemiye binmez.
    shipPlan(plan, destroyed, bv, weight, cap, troopsOnShips) {
      const troopShips = troopsOnShips ? Math.ceil(weight / cap) : 0;
      if (destroyed) {
        const extra = plan.lootShips || 0;
        return { troopShips, need: troopShips + extra, desc: `${troopShips} taşıma + ${extra} ganimet (tablodan; köy henüz kurulmadı)` };
      }
      const loot = bv.resourceTotal;
      const carried = troopsOnShips ? weight : 0;
      const need = Math.max(troopShips, Math.ceil((carried + loot) / cap));
      return {
        troopShips,
        need,
        desc: `${troopShips} taşıma + ${need - troopShips} ganimet, köyde ${loot} kaynak (oyundan)`,
      };
    }

    // Limanın toplam yükleme hızı (kaynak/dakika); 10 dk önbellekli, kaynak şehre bağlı.
    async loadSpeed() {
      const { cfg } = this;
      if (!this._speedAt || this._speedOrigin !== cfg.originId || Date.now() - this._speedAt > 10 * 60000) {
        this._speed = await G.loadingSpeed(cfg.originId);
        this._speedAt = Date.now();
        this._speedOrigin = cfg.originId;
      }
      return this._speed;
    }

    async unitsWeight(units) {
      let weight = 0;
      for (const [id, n] of Object.entries(units)) weight += n * (await G.unitInfo(id, this.cfg.originId)).weight;
      return weight;
    }

    async start(input) {
      if (this.st.running) return;
      this.setStatus('Ayarlar doğrulanıyor…');
      let cfg;
      try {
        cfg = await this.prepare(input);
      } catch (e) {
        this.st.status = 'Başlatılamadı: ' + e.message;
        this.save();
        this.log('Başlatılamadı: ' + e.message, 'error');
        throw e;
      }
      // Kaynak şehir ya da sömürge değiştiyse eski saldırı/eğitim kayıtları bu kuruluma ait değildir.
      const setupKey = `${cfg.originId}:${cfg.colonyId}`;
      this.cfg = cfg;
      if (this.st.setupKey !== setupKey) this.st = { ...clone(ST_DEFAULTS), setupKey };
      // Kaldırılan sömürge kurulumu özelliğinden kalmış olabilecek alanlar.
      delete this.st.phase;
      delete this.st.pending;
      delete this.st.setup;
      delete this.cfg.colonyAuto;
      delete this.cfg.autoSetup;
      // Kaldırılan yükseltmeli/yükseltmesiz ve koçbaşı→mancınık ayarlarından kalmış olabilecek alanlar.
      delete this.cfg.troopMode;
      delete this.cfg.resolvedTroopMode;
      delete this.cfg.catapult;
      delete this.cfg.sendSwordsmen;
      this.st.running = true;
      this.st.stopReason = null;
      this.st.notified = {};
      this.st.nextAt = 0;
      this.save();
      this.log(
        `Başladı. ${cfg.originName} → ${cfg.colonyName}, hedef: ${cfg.targetIslandName}, en fazla seviye ${cfg.maxLevel}; askerler seviye tablosundaki gibi gider.`
      );
      this.mgr.kick();
    }

    stop(reason, level = 'info') {
      this.st.running = false;
      this.st.nextAt = null;
      this.st.stopReason = reason || null;
      this.st.status = reason ? 'DURDU: ' + reason : 'Durdu';
      this.save();
      if (reason) {
        this.log('Durduruldu: ' + reason, level);
        IB.notify(`Barbar botu durdu (${this.label})`, reason);
      } else {
        this.log('Durduruldu.');
      }
      this.mgr.kick();
    }

    // ---------- Köyün güncel durumu (oyundan) ----------
    // Seviye, yıkık mı, köye giden saldırımız var mı: hepsi oyundan okunur, kayda bakılmaz.
    // next: bir sonraki saldırının vuracağı seviye. Köye giden/savaşan bir saldırımız varsa o seviye
    // vurulmuş sayılır; sıradaki onun bir üstüdür.
    async readVillage(movements) {
      const { cfg } = this;
      const bv = await G.barbarianVillage(cfg.targetIslandId);
      const island = await G.island(cfg.targetIslandId);
      const b = island.barbarians;
      const destroyed = Number(b.destroyed) === 1;
      // Köy yıkıkken ekrandaki seviye son yağmalanan seviyedir; köy bir üst seviyede yeniden kurulur.
      const level = destroyed ? bv.level + 1 : bv.level;
      const outgoing = G.ownMovementsForIsland(movements, cfg.targetIslandId).filter(
        (m) => m.event && !m.event.isFleetReturning && (m.event.missionIconClass === 'plunder' || Number(m.event.mission) === 13)
      );
      const attacking = !destroyed && outgoing.length > 0;
      return { bv, b, destroyed, level, attacking, next: attacking ? level + 1 : level };
    }

    // ---------- Saldırı ----------
    // Bir sonraki tura kadar beklenecek saniyeyi döndürür.

    async tick(snap, ids) {
      const { cfg, st } = this;
      const now = IB.now();
      if (!ids.has(Number(cfg.colonyId))) throw new GameError('Barbar sömürgesi şehir listesinde yok.', 'safety');

      // Sömürgede mızrakçı varsa kaynak şehre yolla; yollandıysa sonraki tur taze hareket listesiyle başlasın.
      if ((await this.sendSpearmen()).sent) return 15;

      // Sömürgeye giden/sömürgeden çıkan yağma dışı seferler (kaynak taşıma, mızrakçı konuşlandırma)
      // köyü ilgilendirmez; saldırıyı bekletmez.
      const touchesColony = (m) => [m.origin, m.target].some((c) => c && Number(c.cityId) === Number(cfg.colonyId));
      const isPlunder = (m) => m.event && (m.event.missionIconClass === 'plunder' || Number(m.event.mission) === 13);
      const own = G.ownMovementsForIsland(snap.movements, cfg.targetIslandId).filter((m) => isPlunder(m) || !touchesColony(m));
      if (own.length) {
        const next = Math.min(...own.map((m) => Number(m.eventTime)));
        this.setStatus(`Barbar adasında ${own.length} hareketimiz var; ${fmtTime(next)} bekleniyor.`);
        return next - now + 5;
      }

      const { bv, b, destroyed, level } = await this.readVillage(snap.movements);

      // Son saldırının sonucunu değerlendir. Kayıt sadece bu güvenlik kontrolü için tutulur ve yalnızca
      // yakın zamanda bu sekmeden gönderilmiş, oyundaki köy seviyesiyle uyumlu bir saldırıysa dikkate alınır.
      const la = st.lastAttack;
      if (la && !la.evaluated && (now - la.sentAt > 2 * (la.journey || 3600) + 1800 || la.level < bv.level - 1)) {
        la.evaluated = true; // eski ya da oyunla uyuşmayan kayıt: yok say
        this.save();
      }
      if (la && !la.evaluated) {
        if (destroyed || bv.level > la.level) {
          la.evaluated = true;
          st.lastLooted = { level: la.level, at: now };
          this.log(
            `Seviye ${la.level} yağmalandı.` +
              (bv.resourceTotal > 0 ? ` Köyde ${bv.resourceTotal} kaynak kaldı; köy yıkıkken ek seferlerle alınacak.` : '')
          );
          this.save();
        } else if (now - la.sentAt < (la.journey || 600)) {
          throw new GameError('Saldırı gönderildi ama hareket listesinde görünmüyor.', 'safety');
        } else {
          throw new GameError(`Seviye ${la.level} saldırısı başarısız görünüyor (köy yıkılmadı).`, 'safety');
        }
      }

      const limit = Math.min(cfg.maxLevel, IB.maxTableLevel());

      // Köy yıkık (barbar ordusu yok edilmiş) ama içinde kaynak kalmış: ek seferle al (max seviyede de).
      if (destroyed && bv.resourceTotal > 0 && Number(b.underAttack) !== 1) {
        const wait = await this.followUp(snap, bv, level, limit);
        if (wait) return wait;
      }

      // Max seviye ya da tablonun sınırı aşıldıysa uyar ve dur.
      if (level > limit) {
        // Durmadan önce sömürgede mızrakçı kalmadığından emin ol (kontrol aralığı beklenmez).
        const spear = await this.sendSpearmen(true);
        if (spear.sent) return 15;
        if (spear.left) {
          this.setStatus(`Max seviye ${limit} tamamlandı; sömürgedeki ${spear.left} mızrakçı yollanmadan durulmayacak, tekrar denenecek.`);
          return 120;
        }
        this.stop(
          `Max seviye ${limit} tamamlandı (köy bir sonraki kurulumda seviye ${level} olacak). Sömürgeyi elle sil/yeniden kur, sonra bu rotasyonu yeniden başlat.`,
          'warn'
        );
        return 60;
      }

      const units = await G.units(cfg.originId);
      const plan = this.plan(level);
      if (!plan) throw new GameError(`Seviye ${level} tabloda yok.`, 'safety');
      if (st.nextLevel !== level) {
        st.nextLevel = level;
        this.save();
      }

      if (Number(b.underAttack) === 1) {
        this.setStatus('Barbar köyünde savaş sürüyor; bekleniyor.');
        return 120;
      }

      const weight = await this.unitsWeight(plan.units);

      // Erken gönderim: askerler köy toparlandıktan hemen sonra (rastgele 30-90 sn) varacak şekilde yola çıkar.
      // Gönderimden varışa geçen süre = limandaki sıra + bizim yüklememiz + yolculuk.
      let sendAt = now;
      let timing = null;
      if (destroyed) {
        if (!bv.cooldownEnd) {
          this.setStatus('Toparlanma süresi okunamadı; tekrar denenecek.');
          return 120;
        }
        timing = await this.sendTiming(snap, weight, bv.cooldownEnd);
        sendAt = bv.cooldownEnd - timing.lead;
      }

      // Asker kontrolü (gerekirse eğitim) gönderim zamanından önce yapılır.
      const missing = {};
      for (const [id, n] of Object.entries(plan.units)) {
        const u = units[id];
        // Araştırılmamış birim oyunda "-" görünür: şehirde 0 sayılır (satın alınabilir).
        const have = (u && u.amount) || 0;
        if (have < n) missing[id] = n - have;
      }
      if (Object.keys(missing).length) return this.handleMissingUnits(missing, level);
      if (st.notified.missingUnits) {
        st.notified.missingUnits = false;
        this.save();
      }

      const capacity = st.shipCapacity || 500;
      const est = this.shipPlan(plan, destroyed, bv, weight, capacity, true);

      if (sendAt - now > 90) {
        this.setStatus(
          `Seviye ${level}: ${IB.describeUnits(plan.units)}, ~${est.need} gemi (${est.desc}). Gönderim ${fmtTime(sendAt)} (${fmtDur(sendAt - now)} sonra).` +
            (timing ? `\n${timing.desc}` : '')
        );
        return sendAt - now - 60;
      }

      // Gönderim zamanı: kaynak şehri aktif yap, oyunun saldırı formunu oku.
      await G.changeCity(cfg.originId, snap.selectedCityId);
      let form;
      try {
        form = await G.plunderForm(cfg.targetIslandId);
      } catch (e) {
        if (!(e instanceof GameError) || e.kind !== 'noform') throw e;
        // Geçici durum (savaş, blokaj vb.): bot durmaz, birkaç dakika sonra tekrar dener.
        if (!st.notified.noForm) {
          st.notified.noForm = true;
          this.save();
          this.log(e.message + ' Bot durmuyor, tekrar denenecek.', 'warn');
          IB.notify(`Saldırı şu an gönderilemiyor (${this.label})`, e.message);
        }
        this.setStatus(`Seviye ${level}: saldırı formu açılmadı, ${fmtTime(IB.now() + 180)} tekrar denenecek.\n${e.message}`);
        return 180;
      }
      if (st.notified.noForm) {
        st.notified.noForm = false;
        this.log('Saldırı formu yeniden açıldı, devam ediliyor.');
        this.save();
      }
      if (form.shipCapacity) st.shipCapacity = form.shipCapacity;
      if (form.journeyTime) st.journey = form.journeyTime;
      const ships = this.shipPlan(plan, destroyed, bv, weight, form.shipCapacity || capacity, form.isForeignIsland !== false);
      const troopShips = ships.troopShips;
      const free = form.freeTransporters !== null ? form.freeTransporters : snap.freeTransporters;
      // Formdaki yolculuk süresi tahminden farklıysa gönderim zamanını oyunun verdiği süreyle yeniden hesapla.
      if (timing && form.journeyTime && form.journeyTime !== timing.journey) {
        timing = await this.sendTiming(snap, weight, bv.cooldownEnd);
        sendAt = bv.cooldownEnd - timing.lead;
      }

      if (now < sendAt - 5) {
        this.setStatus(`Seviye ${level} gönderimine ${fmtDur(sendAt - now)} kaldı.`);
        return sendAt - now;
      }

      // Gemi yetmiyorsa beklenmez: boştaki gemilerin hepsiyle gidilir, köyde kalan kaynağı ek seferler alır
      // (bkz. followUp). Sadece askerleri taşıyacak kadar gemi yoksa gemiler dönene kadar beklenir (bot durmaz).
      if (free < troopShips) {
        const returning = snap.movements.filter((m) => m.isOwnArmyOrFleet).map((m) => Number(m.eventTime));
        const next = returning.length ? Math.min(...returning) : now + 300;
        this.setStatus(`Seviye ${level}: askerler için gemi bekleniyor: ${troopShips} gerekli, ${free} boşta.`);
        return next - now + 5;
      }
      delete st.notified.fewShips; // eski sürümden kalan alan
      const total = Math.min(ships.need, free);
      const lootShips = total - troopShips;
      const short = free < ships.need;

      const sent = { ...plan.units };
      await G.sendBarbarianAttack({
        islandId: cfg.targetIslandId,
        form,
        units: sent,
        lootShips,
      });
      const desc =
        `Seviye ${level}: ${IB.describeUnits(sent)}, ${troopShips} taşıma + ${lootShips} ganimet gemisi (${ships.desc})` +
        (short ? `; gemi yetmedi (${ships.need} gerekli, ${free} boşta), kalan kaynak ek seferlerle alınacak` : '') +
        `, yolculuk ${fmtDur(form.journeyTime || 0)}`;
      st.lastAttack = {
        level,
        sentAt: now,
        journey: form.journeyTime,
        evaluated: false,
        units: sent,
        expectedLosses: plan.expectedLosses,
      };
      this.save();
      this.log('Saldırı gönderildi → ' + desc);
      this.needStockCheck = true;
      await this.checkLoading(timing);
      return 60;
    }

    // ---------- Ek seferler (2., 3. …) ----------
    // Ana saldırının gemisi yetmediyse köyde kaynak kalır. Köy yıkıkken (barbar ordusu yok edilmiş) kalan kaynak,
    // tablodaki "Ek seferler" askerleriyle alınır; gemi sayısı kalana göre hesaplanır, boşta o kadar yoksa hepsi gider.
    // Kaynak her seferde oyundan (köy penceresi, arka planda) okunur, kayıt kullanılmaz. Biri dönmeden diğeri
    // gitmez (barbar adasında hareketimiz varken tick bekler); dönünce köy yeniden okunur ve kaynak bitene kadar
    // gerektiği kadar ek sefer yapılır, sayı sınırı yoktur.
    // Güvenlik: ek sefer köy yeniden kurulmadan varmalı (asla barbar ordusuyla savaşmaz) ve arkasından saldırı
    // gidecekse o saldırının gönderiminden önce dönmüş olmalı. Zaman yetmiyorsa kalan kaynak bırakılır.
    // Döner: beklenecek saniye; null ise ek sefer yok, ana akış sürer.
    async followUp(snap, bv, nextLevel, limit) {
      const { cfg, st } = this;
      const now = IB.now();
      const left = bv.resourceTotal;
      const key = `${bv.level}:${bv.cooldownEnd}`;
      const n = st.followUp && st.followUp.key === key ? st.followUp.count + 1 : 1;
      const label = 'ek sefer';
      // Bu toparlanma için kalıcı vazgeçme: günlüğe bir kez yazılır, ana akış sürer.
      const skip = (msg) => {
        if (st.notified.followUp !== key + msg) {
          st.notified.followUp = key + msg;
          this.save();
          this.log(`Seviye ${bv.level} köyünde ${left} kaynak kaldı; ${msg}`, 'warn');
        }
        return null;
      };
      if (!bv.cooldownEnd || st.followUpGaveUp === key) return null;
      const units = IB.getFollowUnits();
      if (!Object.keys(units).length) return skip('ek sefer askeri tanımlı değil (Seviye tablosu → Ek seferler), alınmayacak.');

      const MARGIN = 180;
      const weight = await this.unitsWeight(units);
      const speed = await this.loadSpeed();
      const loading = speed ? Math.ceil((weight / speed) * 60) : 0;
      const queue = G.portQueue(snap.movements, cfg.originId, now);
      let mainSendAt = null;
      if (nextLevel <= limit) {
        const plan = this.plan(nextLevel);
        if (plan) mainSendAt = bv.cooldownEnd - (await this.sendTiming(snap, await this.unitsWeight(plan.units), bv.cooldownEnd)).lead;
      }
      const fits = (journey) => {
        const arrive = now + queue.wait + loading + journey;
        if (arrive > bv.cooldownEnd - MARGIN) return false;
        return mainSendAt === null || arrive + journey + MARGIN <= mainSendAt;
      };
      const noTime = `Ek sefer köy yeniden kurulmadan varamaz${mainSendAt !== null ? ' ya da sıradaki saldırıdan önce dönemez' : ''}; alınmayacak.`;
      const giveUp = () => {
        st.followUpGaveUp = key; // bu toparlanmada zaman bir daha yetmez: tekrar hesaplanmaz
        return skip(noTime);
      };
      if (!fits(st.journey || cfg.leadMin * 60 + 60)) return giveUp();

      // Askerler şehirde mi? Değilse kısa süre sonra tekrar bakılır (zaman yettiği sürece).
      const home = await G.units(cfg.originId);
      const missing = {};
      for (const [id, c] of Object.entries(units)) {
        const have = (home[id] && home[id].amount) || 0; // araştırılmamışsa 0 (satın alınabilir)
        if (have < c) missing[id] = c - have;
      }
      if (Object.keys(missing).length) {
        this.setStatus(`Seviye ${bv.level} köyünde ${left} kaynak kaldı; ${label} için şehirde ${IB.describeUnits(missing)} eksik, bekleniyor.`);
        if (cfg.autoTrain) this.needStockCheck = true;
        return 300;
      }

      await G.changeCity(cfg.originId, snap.selectedCityId);
      let form;
      try {
        form = await G.plunderForm(cfg.targetIslandId);
      } catch (e) {
        if (!(e instanceof GameError) || e.kind !== 'noform') throw e;
        this.setStatus(`Seviye ${bv.level} köyünde ${left} kaynak kaldı; ${label} formu açılmadı, tekrar denenecek.\n${e.message}`);
        return 180;
      }
      if (form.shipCapacity) st.shipCapacity = form.shipCapacity;
      if (form.journeyTime) st.journey = form.journeyTime;
      if (form.journeyTime && !fits(form.journeyTime)) return giveUp();

      const cap = form.shipCapacity || st.shipCapacity || 500;
      const foreign = form.isForeignIsland !== false;
      const troopShips = foreign ? Math.ceil(weight / cap) : 0;
      const need = Math.max(troopShips, Math.ceil(((foreign ? weight : 0) + left) / cap));
      const free = form.freeTransporters !== null ? form.freeTransporters : snap.freeTransporters;
      if (free < Math.max(1, troopShips)) {
        const returning = snap.movements.filter((m) => m.isOwnArmyOrFleet).map((m) => Number(m.eventTime));
        const next = returning.length ? Math.min(...returning) : now + 300;
        this.setStatus(`Seviye ${bv.level} köyünde ${left} kaynak kaldı; ${label} için gemi bekleniyor (${Math.max(1, troopShips)} gerekli, ${free} boşta).`);
        return Math.min(300, next - now + 5);
      }
      const total = Math.min(need, free);
      const lootShips = total - troopShips;
      await G.sendBarbarianAttack({ islandId: cfg.targetIslandId, form, units: { ...units }, lootShips });
      st.followUp = { key, count: n, sentAt: now };
      this.save();
      this.log(
        `Ek sefer gönderildi (bu köy için ${n}.) → seviye ${bv.level} köyünde kalan ${left} kaynak için ${IB.describeUnits(units)}, ${troopShips} taşıma + ${lootShips} ganimet gemisi` +
          (total < need ? `; gemi yetmedi (${need} gerekli, ${free} boşta), kalanı sonraki sefere` : '') +
          `, yolculuk ${fmtDur(form.journeyTime || 0)}.`
      );
      this.needStockCheck = true;
      return 60;
    }

    // Gönderim zamanlaması. Hepsi oyundan okunur:
    //  - yolculuk: saldırı formunun hesapladığı süre (formu en son açtığımızda okunan değer)
    //  - yükleme: askerlerin toplam ağırlığı / limanın toplam yükleme hızı (liman seviyeleri ve bonuslar dahil)
    //  - liman sırası: kaynak şehrin limanında yüklenmekte olan kendi seferlerimizin kalan süresi
    // Erken gönderim ayarı yolculuk kısmının üst sınırıdır; yükleme ve sıra süresi bunun üstüne eklenir.
    // Varış, köyün toparlanmasından rastgele 30-90 sn sonraya denk getirilir.
    async sendTiming(snap, weight, cooldownEnd) {
      const { cfg, st } = this;
      const now = IB.now();
      const speed = await this.loadSpeed(); // kaynak/dakika
      const loading = speed ? Math.ceil((weight / speed) * 60) : 0;
      const queue = G.portQueue(snap.movements, cfg.originId, now);
      const journey = st.journey || cfg.leadMin * 60 + 60;
      // Aynı toparlanma için rastgele pay bir kez seçilir; her kontrolde değişmez.
      if (!this._margin || this._margin.key !== cooldownEnd) this._margin = { key: cooldownEnd, sec: IB.rand(30, 90) };
      const margin = this._margin.sec;
      const travelLead = Math.min(cfg.leadMin * 60, Math.max(0, journey - margin));
      const lead = queue.wait + loading + travelLead;
      const desc =
        `Zamanlama: yolculuk ${fmtDur(journey)}, yükleme ${speed ? fmtDur(loading) + ` (${weight} yük / ${speed} dk başına)` : 'bilinmiyor (liman okunamadı)'}` +
        (queue.count ? `, limanda sıradaki ${queue.count} sefer ${fmtDur(queue.wait)}` : '') +
        `, varış toparlanmadan ${fmtDur(journey + loading + queue.wait - lead)} sonra.`;
      return { lead, loading, wait: queue.wait, journey, speed, weight, desc };
    }

    // ---------- Sömürgedeki mızrakçılar ----------
    // Sömürgede ne kadar mızrakçı basılmışsa hepsi kaynak şehre konuşlandırılır. Başka hiçbir şey yapılmaz.
    // 30-50 dk'da bir bakılır. Gemi yetmezse ya da oyun reddederse rotasyon durmaz, sonra tekrar denenir.
    // force: kontrol aralığını beklemeden bak (durmadan önce). Döner: { sent, left } — left: sömürgede kalan mızrakçı.
    async sendSpearmen(force = false) {
      const { cfg, st } = this;
      const none = { sent: false, left: 0 };
      if (!cfg.sendSpearmen) return none;
      if (!force && Date.now() - (this._spearAt || 0) < (this._spearGap || 0)) return none;
      this._spearAt = Date.now();
      this._spearGap = IB.rand(...SPEAR_CHECK_MS);

      const amount = (u) => (u[IB.SPEARMAN] && u[IB.SPEARMAN].amount) || 0;
      const n = amount(await G.units(cfg.colonyId));
      if (!n) return none;
      const warnOnce = (msg) => {
        if (st.notified.spearmen === msg) return;
        st.notified.spearmen = msg;
        this.save();
        this.log(msg + ' Tekrar denenecek.', 'warn');
      };
      try {
        const form = await G.deployForm(cfg.colonyId, cfg.originId);
        await G.deployArmy({ fromCityId: cfg.colonyId, form, units: { [IB.SPEARMAN]: n } });
      } catch (e) {
        if (!(e instanceof GameError) || (e.kind !== 'game' && e.kind !== 'noform')) throw e;
        warnOnce(`${cfg.colonyName} sömürgesindeki ${n} mızrakçı ${cfg.originName} şehrine yollanamadı: ${e.message}`);
        return { sent: false, left: n };
      }
      // Oyun hata vermeden reddedebilir: sömürgeyi tekrar okuyup askerlerin çıktığını doğrula.
      const left = amount(await G.units(cfg.colonyId));
      if (left >= n) {
        warnOnce(`${cfg.colonyName} sömürgesindeki ${n} mızrakçı için konuşlandırma gönderildi ama askerler sömürgede duruyor; oyun kabul etmemiş.`);
        return { sent: false, left };
      }
      st.notified.spearmen = null;
      this.save();
      this.log(`${cfg.colonyName} sömürgesindeki ${n - left} mızrakçı ${cfg.originName} şehrine yollandı.`);
      return { sent: true, left };
    }

    // Gönderimden hemen sonra oyundaki yükleme bitişini tahminle karşılaştırır (günlüğe yazar).
    async checkLoading(timing) {
      if (!timing) return;
      try {
        const now = IB.now();
        const snap = await G.snapshot(this.cfg.originId);
        const q = G.portQueue(snap.movements, this.cfg.originId, now);
        const expected = timing.wait + timing.loading;
        this.log(
          `Limanda yükleme: tahmin ${fmtDur(expected)}, oyunda ${fmtDur(q.wait)}.` +
            (Math.abs(q.wait - expected) > 60 ? ' Fark 1 dakikadan büyük; hesap gözden geçirilmeli.' : ''),
          Math.abs(q.wait - expected) > 60 ? 'warn' : 'info'
        );
      } catch (e) {}
    }

    // ---------- Asker ihtiyacı ----------
    // Sıradaki saldırı (from) ve ondan sonraki 2 tur (max seviyeyle sınırlı) için gereken stok, tur tur.
    // tiers[k]: from..from+k seviyelerinin hepsine yetecek stok. Seviye L için: tablodaki sayı +
    // from..L-1 seviyelerinde beklenen toplam kayıp (kayıp hoplitten düşer).
    // Kışla kuyruğu 3 emir aldığı için her tur ayrı emirde basılır; ilk turun askeri büyük bir emri beklemez.
    // from oyundan okunur (bkz. readVillage); yoldaki askerler ensureStock'ta hareket listesinden sayılır.
    stockPlan(from) {
      const { cfg } = this;
      const limit = Math.min(cfg.maxLevel, IB.maxTableLevel());
      const to = from ? Math.min(limit, from + AHEAD_ROUNDS - 1) : null;
      const tiers = [];
      if (from && from <= limit) {
        const need = {};
        let lost = 0;
        for (let L = from; L <= to; L++) {
          const p = this.plan(L);
          for (const [id, n] of Object.entries(p.units)) {
            need[id] = Math.max(need[id] || 0, n + (id === IB.HOPLITE ? lost : 0));
          }
          lost += p.expectedLosses || 0;
          tiers.push({ ...need });
        }
      }
      return { tiers, from, to, limit };
    }

    // Gönderim zamanı geldi ama asker eksik: basımı asker havuzu yapar (bkz. Manager.ensureStock),
    // burada sadece durum gösterilir ve beklenir.
    async handleMissingUnits(missing, level) {
      const { cfg, st } = this;
      const desc = IB.describeUnits(missing);
      if (!cfg.autoTrain) {
        this.setStatus(`Seviye ${level} için eksik asker: ${desc}. Otomatik basım kapalı; askerler tamamlanınca devam edilecek.`);
        if (!st.notified.missingUnits) {
          st.notified.missingUnits = true;
          this.save();
          IB.notify(`Eksik asker (${this.label})`, `Seviye ${level} için: ${desc}`);
        }
        return 900;
      }
      this.needStockCheck = true;
      const pool = this.mgr.stockInfo[cfg.originId];
      const q = pool && pool.queueEndsIn ? ` Eğitim kuyruğu ${fmtDur(pool.queueEndsIn)} sonra bitiyor.` : '';
      const why = pool && pool.problem ? ` Basım yapılamadı: ${pool.problem}` : '';
      const wait = pool && pool.queueEndsIn ? 'eğitimdekiler bekleniyor' : 'basım bekleniyor';
      this.setStatus(`Seviye ${level} için eksik asker: ${desc}; ${wait}.${q}${why}`);
      const nextBatch = pool && pool.nextBatchIn ? pool.nextBatchIn + 10 : 900;
      return Math.min(MAX_WAIT_SEC, nextBatch);
    }
  }

  // ---------- Rotasyon yöneticisi ve ortak zamanlayıcı ----------

  const Manager = (IB.manager = {
    rotations: [],
    passive: false, // bot başka sekmede çalışıyor; bu sekme sadece izler, kayda yazmaz
    stockInfo: {}, // kaynak şehir -> son asker havuzu hesabı (panel ve durum metinleri için)
    _stockAt: {},
    _stockGap: {},
    _stockMsg: {},
    _wake: null,
    _looping: false,

    // Kayıttaki güncel durumu mevcut nesnelerin üzerine yükler (panel kartları aynı nesneleri tutar).
    reload() {
      let data = null;
      try {
        data = JSON.parse(localStorage.getItem(KEY));
      } catch (e) {}
      if (!data) return;
      this.rotations = (data.rotations || []).map((d) => {
        const r = this.get(d.id) || new Rotation(d, this);
        r.cfg = { ...CFG_DEFAULTS, ...(d.cfg || {}) };
        r.st = { ...ST_DEFAULTS, ...(d.st || {}) };
        return r;
      });
      emit();
    },

    load() {
      let data = null;
      try {
        data = JSON.parse(localStorage.getItem(KEY));
      } catch (e) {}
      if (!data) {
        // Tek rotasyonlu eski sürümün ayarlarını ilk rotasyon olarak taşı.
        try {
          const old = JSON.parse(localStorage.getItem(OLD_KEY));
          if (old && old.cfg) {
            const st = { ...old.st };
            delete st.phase;
            delete st.trainOrder;
            st.setupKey = `${old.cfg.originId}:${old.cfg.colonyId}`;
            data = { rotations: [{ id: 1, cfg: old.cfg, st: { ...st, nextAt: 0 } }] };
          }
        } catch (e) {}
      }
      data = data || { rotations: [] };
      this.rotations = (data.rotations || []).map((r) => new Rotation(r, this)).sort((a, b) => a.id - b.id);
      if (!this.rotations.length) this.add();
    },

    save() {
      localStorage.setItem(KEY, JSON.stringify({ rotations: this.rotations.map((r) => r.toJSON()) }));
      emit();
    },

    get(id) {
      return this.rotations.find((r) => r.id === Number(id));
    },

    add() {
      const last = this.rotations[this.rotations.length - 1];
      const cfg = last
        ? { ...CFG_DEFAULTS, maxLevel: last.cfg.maxLevel, leadMin: last.cfg.leadMin, autoTrain: last.cfg.autoTrain, sendSpearmen: last.cfg.sendSpearmen, originId: last.cfg.originId }
        : clone(CFG_DEFAULTS);
      // Silinen rotasyonların numaraları yeniden kullanılır: en küçük boş numara verilir.
      let id = 1;
      while (this.get(id)) id++;
      const r = new Rotation({ id, cfg, st: clone(ST_DEFAULTS) }, this);
      this.rotations.push(r);
      this.rotations.sort((a, b) => a.id - b.id);
      this.save();
      return r;
    },

    remove(id) {
      const r = this.get(id);
      if (!r || r.st.running) return;
      this.rotations = this.rotations.filter((x) => x !== r);
      IB.log(`[${r.label}] Rotasyon silindi.`);
      this.save();
    },

    get running() {
      return this.rotations.some((r) => r.st.running);
    },

    stopAll(reason, level = 'info') {
      for (const r of this.rotations) {
        if (!r.st.running) continue;
        r.st.running = false;
        r.st.nextAt = null;
        r.st.stopReason = reason || null;
        r.st.status = reason ? 'DURDU: ' + reason : 'Durdu';
      }
      this.save();
      lock.release();
      if (reason) {
        IB.log('Tüm rotasyonlar durduruldu: ' + reason, level);
        IB.notify('Ikariam barbar botu durdu', reason);
      } else {
        IB.log('Tüm rotasyonlar durduruldu.');
      }
      if (this._wake) this._wake();
    },

    // Bir rotasyon başlatıldı/durduruldu: zamanlayıcıyı uyandır ya da başlat.
    kick() {
      if (!this.running) lock.release();
      if (this._wake) this._wake();
      if (this.running) this.loop();
    },

    resumeIfRunning() {
      if (this.running) {
        IB.log('Sayfa yüklendi; çalışan rotasyonlar kaldığı yerden devam ediyor.');
        this.loop();
      }
    },

    sleep(ms) {
      return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        this._wake = () => { clearTimeout(t); this._wake = null; resolve(); };
      });
    },

    // Tüm rotasyonları ilgilendiren güvenlik kontrolleri; sorun varsa hepsi durur.
    globalChecks(snap) {
      const desc = (list) =>
        list
          .map((m) => `${(m.origin && m.origin.name) || '?'} → ${(m.target && m.target.name) || '?'} (${IB.stripTags(m.event && m.event.missionText)})`)
          .join('; ');
      // Barbarların bize saldırısı botu durdurmaz; sadece bir kez kayda geçer.
      const barbarianIslands = this.rotations.map((r) => r.cfg.targetIslandId).filter(Boolean);
      const barb = G.barbarianAttacks(snap.movements, barbarianIslands);
      const barbKey = desc(barb);
      if (barb.length && barbKey !== this._barbLogged) IB.log('Barbar saldırısı var, bot devam ediyor: ' + barbKey, 'warn');
      this._barbLogged = barbKey;
      const hostile = G.hostileMovements(snap.movements, barbarianIslands);
      if (hostile.length) throw new GameError('Düşman hareketi tespit edildi: ' + desc(hostile), 'global');
      return new Set(snap.cities.map((c) => c.id));
    },

    // ---------- Asker havuzu ----------
    // Aynı kaynak şehri kullanan tüm çalışan rotasyonların önümüzdeki turları için gereken askerleri toplar;
    // şehirdeki + kışla kuyruğundaki + yolda olup dönecek askerlerle karşılaştırır, eksiği tur başına ayrı emirle
    // (kışla en fazla 3 emir alır) sırayla basar: önce sıradaki saldırının, sonra ondan sonraki 2 turun eksiği.
    // Kuyruk oyundan okunduğu için daha önce verilen emirler tekrar basılmaz.
    // Bu kaynak şehrin bir sonraki kontrolüne kadar beklenecek süre (her kontrolden sonra yeniden rastgele seçilir).
    stockGap(originId) {
      if (!this._stockGap[originId]) this._stockGap[originId] = IB.rand(...STOCK_CHECK_MS);
      return this._stockGap[originId];
    },

    stockOrigins() {
      return [...new Set(this.rotations.filter((r) => r.st.running && r.cfg.autoTrain).map((r) => Number(r.cfg.originId)))];
    },

    // Düzenli veri kontrolü: zamanı gelen her kaynak şehrin asker havuzunu kontrol eder.
    async checkStocks() {
      for (const originId of this.stockOrigins()) {
        if (!this.running) return;
        if (Date.now() - (this._stockAt[originId] || 0) < this.stockGap(originId)) continue;
        try {
          await this.ensureStock(originId);
        } catch (e) {
          if (e instanceof GameError && e.kind === 'paused') return;
          if (!(e instanceof GameError)) console.error(e);
          IB.log(`[Asker havuzu] Kontrol yapılamadı, sonra tekrar denenecek: ${e.message || e}`, 'warn');
        }
      }
    },

    async ensureStock(originId) {
      originId = Number(originId);
      const rots = this.rotations.filter((r) => r.st.running && Number(r.cfg.originId) === originId && r.cfg.autoTrain);
      if (!rots.length) return;
      this._stockAt[originId] = Date.now();
      this._stockGap[originId] = IB.rand(...STOCK_CHECK_MS);

      // tiers[k]: tüm rotasyonların ilk k+1 turu için gereken stok. Turu daha az kalan rotasyon (max seviyeye
      // yaklaşmış) son turunun ihtiyacıyla devam eder.
      const tiers = Array.from({ length: AHEAD_ROUNDS }, () => ({}));
      const ranges = [];
      // Asker ihtiyaçları toplanır. Kuşatma birimleri (şahmerdan/mancınık) hiç ölmez; rotasyonlar aynı
      // birimleri sırayla kullanır, bu yüzden toplanmaz, en büyük ihtiyaç alınır.
      const merge = (into, from) => {
        for (const [id, n] of Object.entries(from)) into[id] = IB.SIEGE_UNITS.has(id) ? Math.max(into[id] || 0, n) : (into[id] || 0) + n;
      };
      // Her şey oyundan okunur: köylerin seviyesi, yoldaki askerler, şehirdekiler ve kışla kuyruğu.
      // Yoldaki askerler hareket listesinden sayılır (rotasyon yeniden başlatılsa ya da sömürge değişse de görünür).
      const snap = await G.snapshot(originId);
      const returning = G.plunderArmyFrom(snap.movements, originId);
      for (const r of rots) {
        const v = await r.readVillage(snap.movements);
        // Köye giden saldırı henüz savaşmadı: o seviyenin beklenen hoplit kaybı dönecek askerden düşülür.
        if (v.attacking && returning[IB.HOPLITE]) {
          const cur = r.plan(v.level);
          if (cur) returning[IB.HOPLITE] = Math.max(0, returning[IB.HOPLITE] - (cur.expectedLosses || 0));
        }
        const p = r.stockPlan(v.next);
        if (!p.tiers.length) continue;
        tiers.forEach((t, k) => merge(t, p.tiers[Math.min(k, p.tiers.length - 1)]));
        ranges.push(`R${r.id} sv ${p.from}${p.to > p.from ? '-' + p.to : ''}`);
      }
      // Ek sefer askerleri de şehirde hazır olmalı; ek sefer sıradaki saldırıdan önce döndüğü için toplanmaz.
      if (ranges.length) {
        for (const [id, n] of Object.entries(IB.getFollowUnits())) for (const t of tiers) t[id] = Math.max(t[id] || 0, n);
      }
      const need = tiers[tiers.length - 1];
      if (!Object.keys(need).length) return;

      const city = await G.city(originId);
      const barracks = G.findBuilding(city, 'barracks');
      const blocked = !barracks
        ? `Kışla bulunamadı (okunan binalar: ${G.buildingNames(city)}); basım yapılamıyor.`
        : barracks.building.includes('constructionSite')
        ? 'Kışla geliştiriliyor; bitince asker basılacak.'
        : null;
      if (blocked) {
        if (this._stockMsg[originId] !== blocked) IB.log(`[Asker havuzu ${city.name}] ${blocked}`, 'warn');
        this._stockMsg[originId] = blocked;
        return;
      }
      const info = await G.barracksInfo(originId, barracks.index);
      const home = await G.units(originId);
      const queued = {};
      for (const b of info.queue) for (const [id, n] of Object.entries(b.units)) queued[id] = (queued[id] || 0) + n;

      const deficit = {};
      const have = {};
      const parts = [];
      for (const [id, n] of Object.entries(need)) {
        const h = (home[id] && home[id].amount) || 0;
        have[id] = h + (queued[id] || 0) + (returning[id] || 0);
        if (have[id] < n) deficit[id] = n - have[id];
        parts.push(`${IB.UNIT_NAMES[id] || id}: gereken ${n}, elde ${have[id]} (şehirde ${h}, eğitimde ${queued[id] || 0}, dönecek ${returning[id] || 0})`);
      }
      parts.unshift(`Hedef: ${ranges.join(', ')}`);
      const ends = info.queue.map((b) => b.endsIn).filter((x) => x !== null);
      this.stockInfo[originId] = {
        need,
        have,
        deficit,
        ranges,
        checkedAt: Date.now(),
        queueEndsIn: ends.length ? Math.max(...ends) : null,
        nextBatchIn: ends.length ? Math.min(...ends) : null,
      };

      const prefix = `[Asker havuzu ${city.name}] `;
      const say = (msg, level = 'info') => {
        // Basım yapılamadıysa sebebi rotasyonun durum metninde de görünsün.
        if (level === 'warn') this.stockInfo[originId].problem = msg;
        // Aynı mesajı her kontrolde tekrar yazma.
        if (this._stockMsg[originId] === msg) return;
        this._stockMsg[originId] = msg;
        IB.log(prefix + msg, level);
      };

      if (!Object.keys(deficit).length) {
        say(`Önümüzdeki turlar için asker yeterli. ${parts.join('; ')}.`);
        return;
      }
      if (info.queue.length >= QUEUE_MAX) {
        say(`Eksik ${IB.describeUnits(deficit)} var ama kışla kuyruğu dolu (en fazla ${QUEUE_MAX} emir); sıra açılınca basılacak. ${parts.join('; ')}.`, 'warn');
        return;
      }
      // Kışlada basılamayan birimler (formda pasif) emre konmaz: oyun böyle bir emri tümüyle yok sayıyor.
      const blockedUnits = {};
      for (const id of Object.keys(deficit)) {
        if (!info.fields || info.trainable.includes(id)) continue;
        blockedUnits[id] = deficit[id];
        delete deficit[id];
      }
      const blockedNote = Object.keys(blockedUnits).length
        ? ` ${IB.describeUnits(blockedUnits)} bu kışlada basılamıyor (araştırma ya da kışla seviyesi eksik olabilir); elle basılmalı.`
        : '';
      if (!Object.keys(deficit).length) {
        say(`Eksik asker basılamıyor.${blockedNote} ${parts.join('; ')}.`, 'warn');
        return;
      }

      const total = (q) => q.reduce((s, b) => s + Object.values(b.units).reduce((a, n) => a + n, 0), 0);
      // Emri verir; oyun hata vermeden yok sayabildiği için kuyruğu yeniden okuyup emrin girdiğini doğrular.
      const train = async (units, before) => {
        let res;
        try {
          res = await G.trainUnits({ cityId: originId, position: barracks.index, units, info: before });
        } catch (e) {
          if (e instanceof GameError && e.kind === 'game') res = { ok: false, errors: [e.message] };
          else throw e;
        }
        if (!res.ok) return { ok: false, why: res.errors.join(' / '), info: before };
        const after = await G.barracksInfo(originId, barracks.index);
        if (after.queue.length > before.queue.length || total(after.queue) > total(before.queue)) return { ok: true, info: after };
        const msg = (res.messages || []).join(' / ');
        return { ok: false, why: `kışla kuyruğunda görünmüyor, oyun kabul etmemiş${msg ? ' (' + msg + ')' : ''}`, info: after };
      };

      // Tur tur basım: her tur kendi emrinde, sadece önceki turların üstüne o turun ek ihtiyacı kadar.
      // Böylece sıradaki saldırının askeri küçük bir emirle hemen eğitime girer, ileriki turlarınki arkasından.
      // Bir tur basılamazsa (kaynak, kuyruk, oyun reddi) sonrakiler denenmez; bir sonraki kontrolde tekrar bakılır.
      let cur = info;
      const ordered = {};
      const done = [];
      const failed = [];
      for (let k = 0; k < tiers.length; k++) {
        const want = {};
        for (const [id, n] of Object.entries(tiers[k])) {
          if (blockedUnits[id]) continue;
          const d = n - (have[id] || 0) - (ordered[id] || 0);
          if (d > 0) want[id] = d;
        }
        if (!Object.keys(want).length) continue;
        const label = `${k + 1}. tur`;
        if (cur.queue.length >= QUEUE_MAX) {
          failed.push(`${label} ${IB.describeUnits(want)}: kışla kuyruğu dolu`);
          break;
        }
        const order = G.affordable(cur, want);
        if (!Object.keys(order).length) {
          failed.push(`${label} ${IB.describeUnits(want)}: şehirde kaynak/vatandaş yetmiyor`);
          break;
        }
        let r = await train(order, cur);
        cur = r.info;
        const got = {};
        if (r.ok) Object.assign(got, order);
        else if (Object.keys(order).length > 1) {
          // Karışık emir reddedildi: birimleri tek tek dene ki biri diğerlerini engellemesin.
          for (const id of Object.keys(order)) {
            if (cur.queue.length >= QUEUE_MAX) {
              failed.push(`${label} ${IB.describeUnits({ [id]: order[id] })}: kışla kuyruğu doldu`);
              continue;
            }
            r = await train({ [id]: order[id] }, cur);
            cur = r.info;
            if (r.ok) got[id] = order[id];
            else failed.push(`${label} ${IB.describeUnits({ [id]: order[id] })}: ${r.why}`);
          }
        } else failed.push(`${label} ${IB.describeUnits(order)}: ${r.why}`);
        for (const [id, n] of Object.entries(got)) ordered[id] = (ordered[id] || 0) + n;
        if (Object.keys(got).length) {
          const short = IB.describeUnits(got) !== IB.describeUnits(want) ? ` (gereken ${IB.describeUnits(want)}, kaynak bu kadarına yetti)` : '';
          done.push(`${label} ${IB.describeUnits(got)}${short}`);
        }
        if (IB.describeUnits(got) !== IB.describeUnits(want)) break;
      }

      if (done.length) {
        this._stockMsg[originId] = null;
        IB.log(`${prefix}Önden basım: ${done.join(' / ')} eğitime verildi.${blockedNote} ${parts.join('; ')}.`);
      }
      if (failed.length) say(`Basılamadı: ${failed.join(' / ')}. Tekrar denenecek, bot devam ediyor.${blockedNote} ${parts.join('; ')}.`, 'warn');
    },

    async loop() {
      if (this._looping) return;
      this._looping = true;
      let httpFailures = 0;
      const heartbeat = setInterval(() => {
        if (this.running) lock.refresh();
      }, 30000);
      try {
        while (this.running) {
          if (!(await lock.acquire())) {
            // Başka sekme çalışıyor: kayda yazma (onun güncel verisini ezer), sadece izle.
            if (!this.passive) {
              this.passive = true;
              this.reload();
            }
            await this.sleep(60000);
            continue;
          }
          if (this.passive) {
            // Çalışan sekme kapandı, görev bu sekmeye geçti: önce onun bıraktığı güncel durumu yükle.
            this.passive = false;
            this.reload();
            IB.log('Bot bu sekmede devam ediyor (önceki sekme kapandı).');
            if (!this.running) break;
          }

          // Duraklatıldı: hiçbir şey yapma, devam ettirilene kadar bekle. Zamanı geçen işler devamda hemen yapılır.
          if (IB.isPaused('barbar')) {
            await this.sleep(60000);
            continue;
          }

          const due = this.rotations.filter((r) => r.st.running && (r.st.nextAt || 0) <= Date.now());
          for (const r of due) {
            if (!r.st.running) continue;
            let waitSec = 60;
            try {
              this.current = r.id; // panelde "şu an" satırı için
              emit();
              // Önceki rotasyon işlem yapmış olabilir: her rotasyon taze durumla çalışır.
              const snap = await G.snapshot(r.cfg.originId);
              const ids = this.globalChecks(snap);
              waitSec = await r.tick(snap, ids);
              // Saldırı gönderildi ya da asker eksik: bu kaynak şehrin havuzunu beklemeden kontrol et.
              if (r.needStockCheck) {
                r.needStockCheck = false;
                this._stockAt[Number(r.cfg.originId)] = 0;
              }
              httpFailures = 0;
            } catch (e) {
              if (e instanceof GameError && e.kind === 'paused') {
                // İş yarıda kesildi: kayıt değiştirilmez, devam ettirilince bu rotasyon oyundan taze okunarak yeniden çalışır.
                break;
              } else if (e instanceof GameError && e.kind === 'http' && ++httpFailures <= 15) {
                // Bağlantı hatalarında ~1 saat boyunca, giderek seyrekleşen aralıklarla tekrar dene.
                waitSec = Math.min(300, 30 * httpFailures);
                IB.log(`Bağlantı hatası (${httpFailures}/15), ${waitSec} sn sonra tekrar denenecek: ${e.message}`, 'warn');
              } else if (e instanceof GameError && (e.kind === 'global' || e.kind === 'session' || e.kind === 'http')) {
                this.stopAll(e.message, 'error');
                break;
              } else {
                // Sadece bu rotasyona ait sorun: diğerleri devam eder.
                if (!(e instanceof GameError)) console.error(e);
                r.stop(e.message || String(e), 'error');
                continue;
              }
            }
            if (!r.st.running) continue;
            waitSec = Math.min(MAX_WAIT_SEC, Math.max(10, Number(waitSec) || 60));
            // Uzun beklemeler rastgele en fazla 1 dk kısaltılır (asla uzatılmaz; gönderim anı kaçmasın).
            if (waitSec > 90) waitSec -= Math.random() * Math.min(60, waitSec * 0.15);
            r.st.nextAt = Date.now() + waitSec * 1000;
            this.save();
          }
          if (!this.running) break;

          this.current = 'stock';

          emit();

          await this.checkStocks();

          this.current = null;
          if (!this.running) break;

          const nexts = this.rotations.filter((r) => r.st.running).map((r) => r.st.nextAt || 0);
          for (const o of this.stockOrigins()) nexts.push((this._stockAt[o] || 0) + this.stockGap(o));
          const waitMs = Math.min(MAX_WAIT_SEC * 1000, Math.max(1000, Math.min(...nexts) - Date.now()));
          await this.sleep(waitMs);
        }
      } finally {
        clearInterval(heartbeat);
        this._looping = false;
        this.current = null;
        if (!this.running) lock.release();
      }
    },
  });

  Manager.load();
  // Duraklatma açılıp kapanınca bekleyen döngüyü uyandır (devam ettirilince beklemeden sürsün).
  IB.onPauseChange((bot) => {
    if (bot === 'barbar' && Manager._wake) Manager._wake();
  });
  window.addEventListener('beforeunload', () => lock.release());
  // Başka sekme kayda yazdıysa ve bu sekme çalışan sekme değilse, güncel durumu göster.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && (Manager.passive || !Manager._looping)) Manager.reload();
  });
})();
