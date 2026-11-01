// Oyun verisini okuyan ve oyun içi işlemleri yapan fonksiyonlar.
// İşlemler mümkün olduğunca oyunun kendi formları okunup doldurularak gönderilir.
(() => {
  const IB = (window.IkaBot = window.IkaBot || {});
  const { GameError } = IB;
  // Her bot kendi örneğini kullanır: istekleri o botun adıyla etiketlenir ve sadece o bot duraklatılınca durur.
  // bot = null: hiç duraklatılmayan örnek (panellerin şehir/bina listesini okuması için).
  function makeGame(bot) {
    const G = {};
    const request = (params, opts) => IB.request(params, { ...opts, bot });
    const requestFullPage = (params) => IB.requestFullPage(params, { bot });

    G.avatarId = () => {
      try {
        return Number(ikariam.model.avatarId);
      } catch (e) {
        return null;
      }
    };

    // ---------- Okuma ----------

    // Verilen nesnelerin içindeki gelecekteki zaman damgaları (saniye, en fazla 30 gün sonrası): oyunun sayaçları.
    const futureStamps = (...objs) => {
      const now = Date.now() / 1000;
      const stamps = [];
      const scan = (o, depth = 0) => {
        if (!o || depth > 5) return;
        if (typeof o === 'number' || (typeof o === 'string' && /^\d{10}$/.test(o))) {
          const n = Number(o);
          if (n > now && n < now + 30 * 86400) stamps.push(n);
        } else if (typeof o === 'object') Object.values(o).forEach((v) => scan(v, depth + 1));
      };
      objs.forEach((o) => scan(o));
      return stamps;
    };

    // Askeri danışman: şehir listesi, gemiler ve tüm filo/ordu hareketleri tek istekte gelir.
    // Oyun zaman zaman hareket listesi olmadan cevap verebiliyor: bir kez farklı biçimde (POST) tekrar sorulur.
    // İkisi de olmazsa hata 'http' türündedir; bot hemen durmaz, giderek seyrekleşen aralıklarla tekrar dener
    // (bu sürede hiçbir işlem yapılmaz). Hatada oyunun ne döndürdüğü de yazılır.
    G.snapshot = async (cityId) => {
      const attempts = [
        () =>
          request({
            view: 'militaryAdvisor',
            oldView: 'updateGlobalData',
            cityId,
            backgroundView: 'city',
            currentCityId: cityId,
            templateView: 'militaryAdvisor',
          }),
        () =>
          request(
            { view: 'militaryAdvisor', oldView: 'city', oldBackgroundView: 'city', backgroundView: 'city', currentCityId: cityId, templateView: 'militaryAdvisor' },
            { post: true }
          ),
      ];
      let r = null;
      let movements;
      const seen = [];
      for (const attempt of attempts) {
        r = await attempt();
        movements = (r.viewScript.viewScriptParams || {}).militaryAndFleetMovements;
        if (Array.isArray(movements)) break;
        const view = r.cmd('changeView');
        seen.push(
          `görünüm: ${(view && view[0]) || 'yok'}, komutlar: ${r.data.map((c) => c && c[0]).join('/')}` +
            (r.errors.length ? `, oyun: ${r.errors.join(' / ')}` : '') +
            `, liste: ${movements === undefined ? 'yok' : typeof movements}`
        );
      }
      if (!Array.isArray(movements)) {
        console.warn('[IkaBot] Askeri danışman yanıtı:', r && r.data);
        throw new GameError('Askeri hareketler okunamadı (' + seen.join(' | ') + ').', 'http');
      }
      const cities = r.ownCities;
      if (!cities || cities.length === 0) throw new GameError('Şehir listesi okunamadı.', 'session');
      return {
        cities,
        selectedCityId: r.selectedCityId,
        freeTransporters: Number(r.header.freeTransporters),
        maxTransporters: Number(r.header.maxTransporters),
        gold: Number(r.header.gold),
        movements,
      };
    };

    // Şehrin bina yerleşimi ve ada bilgisi.
    G.city = async (cityId) => {
      const r = await request({ view: 'townHall', cityId, backgroundView: 'city', currentCityId: cityId });
      const bg = r.background;
      if (!bg || String(bg.id) !== String(cityId)) throw new GameError(`Şehir ${cityId} okunamadı.`, 'session');
      // Oyun inşaattaki binayı sınıfına eklenen "constructionSite" ile bildirir; bitiş zamanı o yerin
      // "completed" alanındadır (saniye). Oyunun kendi "isBusy" alanı inşaat değildir: asker eğiten kışla
      // da isBusy=true gelir. Bu yüzden ona bakılmaz, yoksa kışla eğitim yaptıkça "inşaat var" sanılır.
      const positions = (bg.position || []).map((p, i) => ({
        index: i,
        building: (p && p.building) || '',
        name: (p && p.name) || '',
        level: p && p.level !== undefined && p.level !== null ? Number(p.level) : null,
        isBusy: !!(p && /constructionSite/.test(p.building || '')),
        completed: (p && Number(p.completed)) || 0,
        canUpgrade: p ? p.canUpgrade : undefined,
      }));
      const endUpgradeTime = Number(bg.endUpgradeTime) || 0;
      return {
        id: Number(bg.id),
        name: bg.name,
        isCapital: !!bg.isCapital,
        ownerId: Number(bg.ownerId),
        islandId: Number(bg.islandId),
        islandName: bg.islandName,
        x: Number(bg.islandXCoord),
        y: Number(bg.islandYCoord),
        underConstruction: bg.underConstruction,
        endUpgradeTime,
        positions,
        busy: positions.some((p) => p.isBusy) || endUpgradeTime > Date.now() / 1000,
        // Şehirdeki inşaatın bitiş zamanı (saniye); bilinmiyorsa 0.
        constructionEnd: Math.max(0, endUpgradeTime, ...positions.map((p) => p.completed)),
      };
    };

    G.buildingKey = (p) => (p.building || '').split(/\s+/)[0];

    // Geliştirilen binalar "barracks constructionSite" gibi ek sınıfla gelir; bu yüzden kelime olarak aranır.
    G.findBuilding = (city, name) => city.positions.find((p) => p.building.split(/\s+/).includes(name));

    G.buildingNames = (city) => city.positions.map((p) => p.building).filter(Boolean).join(', ') || 'hiç bina okunamadı';

    // Ada görünümü (barbar köyü durumu ve adadaki şehirler).
    G.island = async (islandId) => {
      const r = await requestFullPage({ view: 'island', islandId });
      const d = r.data[1] && r.data[1][1];
      if (!d || String(d.id) !== String(islandId)) throw new GameError(`Ada ${islandId} okunamadı.`, 'session');
      return {
        id: Number(d.id),
        name: d.name,
        x: Number(d.xCoord),
        y: Number(d.yCoord),
        barbarians: d.barbarians || {},
        cities: (d.cities || []).map((c, i) => ({
          position: i,
          type: c.type,
          id: Number(c.id),
          name: c.name,
          ownerId: Number(c.ownerId),
          ownerName: c.ownerName,
        })),
      };
    };

    // Barbar köyünün seviyesi, içindeki kaynaklar ve toparlanma bitiş zamanı.
    G.barbarianVillage = async (islandId) => {
      const r = await request({
        view: 'barbarianVillage',
        destinationIslandId: islandId,
        oldBackgroundView: 'city',
        cityWorldviewScale: '1',
        islandId,
        backgroundView: 'island',
        currentIslandId: islandId,
      });
      const t = r.template;
      const text = (k) => (t[k] ? t[k].text : undefined);
      if (text('js_islandBarbarianLevel') === undefined) throw new GameError('Barbar köyü bilgisi okunamadı.', 'session');
      const resources = [
        IB.parseGameInt(text('js_islandBarbarianResourceresource')),
        IB.parseGameInt(text('js_islandBarbarianResourcetradegood1')),
        IB.parseGameInt(text('js_islandBarbarianResourcetradegood2')),
        IB.parseGameInt(text('js_islandBarbarianResourcetradegood3')),
        IB.parseGameInt(text('js_islandBarbarianResourcetradegood4')),
      ];
      const cd = t.barbarianCityCooldownTimer && t.barbarianCityCooldownTimer.countdown;
      return {
        level: Math.ceil(Number(text('js_islandBarbarianLevel'))),
        resources,
        resourceTotal: resources.reduce((a, b) => a + b, 0),
        cooldownEnd: cd && cd.enddate ? Number(cd.enddate) : null,
      };
    };

    // Şehirdeki birimler. Araştırılmamış birimler null döner.
    G.units = async (cityId) => {
      const r = await request({
        view: 'cityMilitary',
        activeTab: 'tabUnits',
        cityId,
        backgroundView: 'city',
        currentCityId: cityId,
        currentTab: 'multiTab1',
      });
      const html = r.html.split('<div class="fleet')[0];
      const ids = [...html.matchAll(/<div class="army (.*?)">\s*<div class="tooltip">(.*?)<\/div>/g)];
      const amounts = [...html.matchAll(/<td>(.*?)\s*<\/td>/g)].map((m) => m[1].trim());
      if (ids.length === 0) throw new GameError('Birim listesi okunamadı.', 'session');
      const units = {};
      ids.forEach((m, i) => {
        const id = m[1].replace(/^s/, '');
        const raw = amounts[i];
        units[id] = { name: m[2], amount: raw === '-' ? null : IB.parseGameInt(raw) };
      });
      return units;
    };

    const unitInfoCache = {};
    G.unitInfo = async (unitId, cityId) => {
      if (unitInfoCache[unitId]) return unitInfoCache[unitId];
      const r = await request({
        view: 'unitdescription',
        unitId,
        helpId: 9,
        subHelpId: 0,
        backgroundView: 'city',
        currentCityId: cityId,
        templateView: 'unitdescription',
      });
      const w = r.html.match(/<li class="weight fifthpos"[^>]*>[\s\S]*?(\d+)<\/li>/);
      const sp = r.html.match(/<span class="textLabel">[\s\S]*?<\/span>\s*(\d+)\s*<br\/>/);
      if (!w) throw new GameError(`Birim ${unitId} ağırlığı okunamadı.`, 'session');
      unitInfoCache[unitId] = { weight: Number(w[1]), speed: sp ? Number(sp[1]) : null };
      return unitInfoCache[unitId];
    };

    // Var olan binayı bir seviye yükseltir (oyunun "yükselt" düğmesinin gönderdiği istek:
    // bina ekranındaki #js_buildingUpgradeButton, action=UpgradeExistingBuilding; eski CityScreen/upgradeBuilding
    // artık oyun tarafından sessizce yok sayılıyor).
    G.upgradeBuilding = async ({ cityId, position, level, building }) => {
      const r = await request(
        {
          action: 'UpgradeExistingBuilding',
          cityId,
          position,
          level,
          backgroundView: 'city',
          currentCityId: cityId,
          templateView: building,
        },
        { post: true }
      );
      return r.errors;
    };

    // ---------- Hareket filtreleri ----------

    // Barbarların bize saldırısı: kaynak bir oyuncu şehri değil, barbar köyüdür. Oyun bunu da düşman hareketi
    // olarak işaretler; adı/görev metni "barbar" içerir ya da kaynağı rotasyonların vurduğu barbar adasındadır.
    G.isBarbarianMovement = (m, barbarianIslandIds = []) => {
      const o = m.origin || {};
      const text = [o.name, o.avatarName, o.playerName, m.event && m.event.missionText, m.event && m.event.missionIconClass]
        .filter(Boolean)
        .map((s) => IB.stripTags(String(s)))
        .join(' ');
      if (/barbar/i.test(text)) return true;
      return o.islandId != null && barbarianIslandIds.some((id) => Number(id) === Number(o.islandId));
    };

    // Barbar saldırıları hariç düşman hareketleri.
    G.hostileMovements = (movements, barbarianIslandIds = []) =>
      movements.filter((m) => m.isHostile && !G.isBarbarianMovement(m, barbarianIslandIds));
    G.barbarianAttacks = (movements, barbarianIslandIds = []) =>
      movements.filter((m) => m.isHostile && G.isBarbarianMovement(m, barbarianIslandIds));

    // Hedef adaya giden ya da oradan dönen kendi hareketlerimiz.
    G.ownMovementsForIsland = (movements, islandId) =>
      movements.filter(
        (m) =>
          m.isOwnArmyOrFleet &&
          ((m.target && Number(m.target.islandId) === Number(islandId)) ||
            (m.origin && Number(m.origin.islandId) === Number(islandId)))
      );

    // Bu şehirden çıkmış yağma hareketlerindeki askerler (gidiyor, savaşıyor ya da dönüyor; hepsi şehre döner).
    // Sömürgeye konuşlandırma gibi geri dönmeyen hareketler sayılmaz.
    // Seviye tablosunda her kara birimi seçilebildiği için hepsi tanınır; bilinmeyen sınıf sayılmaz
    // (o zaman dönecek asker eksik sayılır, en kötü fazladan asker basılır).
    const ARMY_CSS = {
      slinger: '301', swordsman: '302', phalanx: '303', marksman: '304', mortar: '305', catapult: '306', ram: '307',
      steamgiant: '308', bombardier: '309', cook: '310', medic: '311', gyrocopter: '312', archer: '313', spearman: '315',
    };
    G.plunderArmyFrom = (movements, cityId) => {
      const out = {};
      for (const m of movements) {
        if (!m.isOwnArmyOrFleet || !m.origin || Number(m.origin.cityId) !== Number(cityId)) continue;
        if (!m.event || (m.event.missionIconClass !== 'plunder' && Number(m.event.mission) !== 13)) continue;
        for (const u of (m.army && m.army.units) || []) {
          const id = ARMY_CSS[u.cssClass];
          if (id) out[id] = (out[id] || 0) + IB.parseGameInt(u.amount);
        }
      }
      return out;
    };

    // Limanın toplam yükleme hızı (kaynak/dakika), oyunun liman ekranından: tüm limanlar ve bonuslar dahil.
    G.loadingSpeed = async (cityId) => {
      const city = await G.city(cityId);
      const port = G.findBuilding(city, 'port');
      if (!port) return null;
      const r = await request({ view: 'port', cityId, position: port.index, backgroundView: 'city', currentCityId: cityId });
      const t = r.template || {};
      const val = (v) => (typeof v === 'string' ? v : v && v.text);
      let perMin = IB.parseGameInt(val(t.js_loadingSpeedSumValue));
      if (!perMin) for (let i = 0; i < 4; i++) perMin += IB.parseGameInt(val(t['js_loadingSpeedPort' + i]));
      return perMin || null;
    };

    // Kaynak şehrin limanında şu an yüklenen/sırada bekleyen kendi seferlerimiz: yeni sefer bunların bitmesini bekler.
    // Saniye cinsinden kalan süre ve sefer sayısı döner.
    G.portQueue = (movements, cityId, now) => {
      let end = now;
      let count = 0;
      for (const m of movements) {
        if (!m.isOwnArmyOrFleet || !m.origin || Number(m.origin.cityId) !== Number(cityId) || !m.event) continue;
        if (Number(m.event.missionState) !== 1 || m.event.isFleetReturning) continue;
        end = Math.max(end, Number(m.eventTime));
        count++;
      }
      return { wait: Math.max(0, end - now), count };
    };

    // ---------- İşlemler ----------

    G.changeCity = async (cityId, fromCityId) => {
      const r = await request(
        {
          action: 'header',
          function: 'changeCurrentCity',
          oldView: 'city',
          cityId,
          backgroundView: 'city',
          currentCityId: fromCityId || cityId,
        },
        { post: true }
      );
      if (r.selectedCityId !== null && r.selectedCityId !== Number(cityId)) {
        throw new GameError(`Aktif şehir ${cityId} yapılamadı.`, 'game');
      }
      return r;
    };

    // Yağma formunu açar; formdaki alanları ve oyunun hesapladığı yolculuk süresini döndürür.
    G.plunderForm = async (islandId) => {
      const r = await request({
        view: 'plunder',
        destinationIslandId: islandId,
        islandId,
        barbarianVillage: 1,
        backgroundView: 'island',
        currentIslandId: islandId,
      });
      const form = IB.readForms(r.html).find(
        (f) => f.fields.action === 'transportOperations' && f.fields.function === 'attackBarbarianVillage'
      );
      if (!form) throw new GameError('Barbar saldırı formu açılmadı' + formFailReason(r), 'noform');
      return { fields: form.fields, ...missionInfo(r.html) };
    };

    // Oyun formu göstermiyor (sömürgede/adada savaş, liman bloklu vb.): oyunun yazdığı sebep.
    function formFailReason(r) {
      const doc = IB.parseHtml(r.html);
      doc.querySelectorAll('script, style').forEach((el) => el.remove());
      const reason = [...r.errors, IB.stripTags(doc.body ? doc.body.textContent : '')].filter(Boolean).join(' / ').slice(0, 300);
      return reason ? ': ' + reason : '.';
    }

    // Sefer formlarındaki missionController: boştaki gemi, gemi kapasitesi, yolculuk süresi.
    function missionInfo(html) {
      const mc = html.match(
        /new missionController\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*(true|false)\s*\)/
      );
      return {
        freeTransporters: mc ? Number(mc[1]) : null,
        shipCapacity: mc ? Number(mc[2]) : null,
        journeyTime: mc ? Number(mc[3]) : null,
        isForeignIsland: mc ? mc[7] === 'true' : null,
      };
    }

    // Formdaki asker alanlarını sıfırlayıp verilen birimlerle doldurur.
    function fillArmy(form, units, what) {
      const fields = { ...form.fields };
      for (const k of Object.keys(fields)) {
        if (/^cargo_army_\d+$/.test(k)) fields[k] = '0';
      }
      for (const [id, n] of Object.entries(units)) {
        const key = 'cargo_army_' + id;
        if (!(key in fields)) throw new GameError(`${what} formunda ${IB.UNIT_NAMES[id] || id} yok (şehirde bu birim olmayabilir).`, 'game');
        fields[key] = String(n);
      }
      return fields;
    }

    G.sendBarbarianAttack = async ({ islandId, form, units, lootShips }) => {
      const fields = fillArmy(form, units, 'Saldırı');
      fields.transporter = String(lootShips);
      Object.assign(fields, { backgroundView: 'island', currentIslandId: islandId, templateView: 'plunder' });
      const r = await request(fields, { post: true });
      if (r.errors.length) throw new GameError('Saldırı gönderilemedi: ' + r.errors.join(' / '), 'game');
      return { messages: r.successes };
    };

    // Ordu konuşlandırma formu (fromCityId'deki askerleri kendi şehrimiz toCityId'ye yollamak için).
    // İstek fromCityId'yi aktif şehir yapar; form başka bir şehirden açılmışsa kullanılmaz.
    G.deployForm = async (fromCityId, toCityId) => {
      const r = await request({
        view: 'deployment',
        deploymentType: 'army',
        destinationCityId: toCityId,
        backgroundView: 'city',
        currentCityId: fromCityId,
        templateView: 'deployment',
      });
      const form = IB.readForms(r.html).find(
        (f) => f.fields.action === 'transportOperations' && f.fields.function === 'deployArmy'
      );
      if (!form) throw new GameError('Konuşlandırma formu açılmadı' + formFailReason(r), 'noform');
      if (Number(r.background.id) !== Number(fromCityId) || Number(form.fields.destinationCityId) !== Number(toCityId))
        throw new GameError('Konuşlandırma formu yanlış şehirden açıldı; gönderilmedi.', 'noform');
      return { fields: form.fields, ...missionInfo(r.html) };
    };

    G.deployArmy = async ({ fromCityId, form, units }) => {
      const fields = fillArmy(form, units, 'Konuşlandırma');
      Object.assign(fields, { backgroundView: 'city', currentCityId: fromCityId, templateView: 'deployment' });
      const r = await request(fields, { post: true });
      if (r.errors.length) throw new GameError('Askerler gönderilemedi: ' + r.errors.join(' / '), 'game');
      return { messages: r.successes };
    };

    G.barracksView = async (cityId, position) =>
      request({ view: 'barracks', cityId, position, backgroundView: 'city', currentCityId: cityId });

    // "5dk", "1dk 22s", "1s 18dk 51s" gibi oyun sürelerini saniyeye çevirir.
    // "s" bir "dk"dan önce geliyorsa saat, sonra geliyorsa saniyedir.
    IB.parseDuration = (text) => {
      const tokens = [...String(text || '').matchAll(/(\d+)\s*(g|sa|dk|s)\b/g)].map((m) => [Number(m[1]), m[2]]);
      const dkIndex = tokens.findIndex((t) => t[1] === 'dk');
      let sec = 0;
      tokens.forEach(([n, u], i) => {
        if (u === 'g') sec += n * 86400;
        else if (u === 'sa') sec += n * 3600;
        else if (u === 'dk') sec += n * 60;
        else sec += dkIndex >= 0 && i < dkIndex ? n * 3600 : n;
      });
      return sec;
    };

    // Maliyet satırındaki sınıf adı -> headerData.currentResources anahtarı.
    const COST_KEYS = { citizens: 'citizens', wood: 'resource', wine: '1', marble: '2', glass: '3', sulfur: '4' };

    // Kışla durumu: eğitim formu, birim başına süre ve maliyet, eğitim kuyruğu, şehrin kaynakları.
    // Formdaki birim alanlarının sırası, şablondaki js_barracksCosts1..N sırasıyla aynıdır.
    G.barracksInfo = async (cityId, position) => {
      const r = await G.barracksView(cityId, position);
      const form = IB.readForms(r.html).find((f) => f.fields.action === 'BuildUnits');
      const fields = form ? { ...form.fields } : null;
      const unitIds = fields ? Object.keys(fields).filter((k) => /^\d+$/.test(k)) : [];
      // Basılamayan birimin (araştırma/kışla seviyesi eksik) alanı formda pasif gelir; oyun böyle bir
      // birim içeren emri hata vermeden tümüyle yok sayar.
      const formDoc = IB.parseHtml(r.html);
      const disabled = new Set(
        [...formDoc.querySelectorAll('input[disabled]')].map((el) => el.name).filter((n) => /^\d+$/.test(n))
      );
      const trainable = unitIds.filter((id) => !disabled.has(id));
      const unitTimes = {};
      const unitCosts = {};
      unitIds.forEach((id, i) => {
        const cost = r.template['js_barracksCosts' + (i + 1)];
        if (!cost) return;
        const doc = IB.parseHtml(cost.text);
        const time = doc.querySelector('li.time');
        if (time) unitTimes[id] = IB.parseDuration(time.textContent);
        unitCosts[id] = {};
        for (const li of doc.querySelectorAll('li')) {
          const key = COST_KEYS[li.className];
          const num = li.textContent.match(/([\d.,]+)\s*$/);
          if (key && num) unitCosts[id][key] = IB.parseGameInt(num[1]);
        }
      });

      // Eğitim kuyruğu: her blok bir eğitim emri; oyun en fazla 3 emir kabul ediyor.
      const doc = IB.parseHtml(r.html);
      const queue = [...doc.querySelectorAll('#unitConstructionList .unitConstructionBlock')].map((b) => {
        const counter = b.querySelector('[id^="counter"]');
        const units = {};
        for (const w of b.querySelectorAll('.army_wrapper')) {
          const a = w.querySelector('.army');
          const m = a && a.className.match(/\bs(\d+)\b/);
          const n = w.querySelector('.unitcounttextlabel');
          if (m && n) units[m[1]] = (units[m[1]] || 0) + IB.parseGameInt(n.textContent);
        }
        return { endsIn: counter ? IB.parseDuration(counter.textContent) : null, units };
      });

      return { fields, trainable, unitTimes, unitCosts, queue, resources: r.header.currentResources || {} };
    };

    // Elimizdeki kaynakla bu emrin ne kadarı karşılanabilir: tüm birimler aynı oranda küçültülür.
    G.affordable = (info, units) => {
      let factor = 1;
      for (const key of Object.values(COST_KEYS)) {
        let need = 0;
        for (const [id, n] of Object.entries(units)) need += n * ((info.unitCosts[id] || {})[key] || 0);
        if (need > 0) factor = Math.min(factor, Number(info.resources[key] || 0) / need);
      }
      const out = {};
      for (const [id, n] of Object.entries(units)) {
        const k = Math.floor(n * Math.max(0, factor));
        if (k > 0) out[id] = k;
      }
      return out;
    };

    // Bu emir verildikten sonra şehirde kalacak kaynaklar (sıradaki emrin hesabı için).
    G.resourcesAfter = (info, units) => {
      const left = { ...info.resources };
      for (const key of Object.values(COST_KEYS)) {
        let used = 0;
        for (const [id, n] of Object.entries(units)) used += n * ((info.unitCosts[id] || {})[key] || 0);
        if (used) left[key] = Math.max(0, Number(left[key] || 0) - used);
      }
      return left;
    };

    G.trainUnits = async ({ cityId, position, units, info }) => {
      info = info || (await G.barracksInfo(cityId, position));
      if (!info.fields) throw new GameError('Kışla eğitim formu bulunamadı.', 'game');
      const fields = { ...info.fields };
      for (const [id, n] of Object.entries(units)) {
        if (!(id in fields)) throw new GameError(`${IB.UNIT_NAMES[id] || id} bu kışlada eğitilemiyor.`, 'game');
        fields[id] = String(n);
      }
      Object.assign(fields, { backgroundView: 'city', currentCityId: cityId, templateView: 'barracks' });
      const res = await request(fields, { post: true });
      if (res.errors.length) return { ok: false, errors: res.errors };
      return { ok: true, messages: res.feedback.map((f) => IB.stripTags(f && f.text)).filter(Boolean) };
    };

    // ---------- Mucit atölyesi ----------
    // Atölye ekranının şablon verisi: completeData[birimId][offensive|defensive] = { upgradeTypeName, errorText,
    // currentLevel: { upgradeLevel }, nextLevel: { upgradeLevel, upgradeName, goldCosts, crystalCosts } | yok }.
    // Birimler ve gemiler ayrı sekmelerde gelir. Aynı anda sadece bir araştırma yürür (inProgress).
    G.workshop = async (cityId, position, tab = 'tabUnits') => {
      const r = await request({
        view: 'workshop',
        activeTab: tab,
        cityId,
        position,
        backgroundView: 'city',
        currentCityId: cityId,
      });
      const t = r.template;
      if (!t || !t.completeData) throw new GameError('Mucit atölyesi okunamadı.', 'game');
      const names = t.unitDetails || {};
      const units = Object.entries(t.completeData).map(([id, v]) => {
        const up = (k) => {
          const u = v && v[k];
          if (!u) return null;
          const next = u.nextLevel || null;
          return {
            type: k,
            typeName: u.upgradeTypeDesc || u.upgradeTypeName || k,
            level: Number((u.currentLevel && u.currentLevel.upgradeLevel) || 0),
            next: next && {
              level: Number(next.upgradeLevel),
              name: next.upgradeName || '',
              gold: IB.parseGameInt(next.goldCosts),
              crystal: IB.parseGameInt(next.crystalCosts),
              duration: next.duration || '',
            },
            error: u.errorText ? IB.stripTags(u.errorText) : null,
          };
        };
        return { id: Number(id), name: (names[id] && names[id].unitName) || id, offensive: up('offensive'), defensive: up('defensive') };
      });
      // Yürüyen araştırmanın bitişi (saniye): oyunun sayaç verisinde ya da inProgress içinde gelecekteki zaman damgası.
      const stamps = t.inProgress ? futureStamps(t.inProgress, r.cmd('ingameCounterData')) : [];
      const h = r.header;
      return {
        inProgress: t.inProgress || null,
        progressEnd: stamps.length ? Math.max(...stamps) : null,
        units,
        gold: Number(h.gold) || 0,
        crystal: Number((h.currentResources || {})['3']) || 0,
      };
    };

    // Birimler (3xx) birim sekmesinde, gemiler (2xx) gemi sekmesinde.
    G.workshopTab = (unitId) => (Number(unitId) < 300 ? 'tabShips' : 'tabUnits');

    G.startWorkshopUpgrade = async ({ cityId, position, unitId, upgradeType }) => {
      const r = await request(
        {
          action: 'StartWorkshopUpgrade',
          cityId,
          position,
          unitId,
          upgradeType,
          backgroundView: 'city',
          currentCityId: cityId,
          templateView: 'workshop',
        },
        { post: true }
      );
      return r.errors;
    };

    // ---------- Akademi deneyi ----------
    // Deney isteğinin biçimi sabit yazılmaz: akademi ekranındaki oyunun kendi deney formu/bağlantısı okunup aynen
    // gönderilir. Ekranda iki deney kutusu (.experiment) vardır; ikincisi ambrosialıdır, sadece ilki okunur.
    // Kutunun metni değil, düğmenin kendisi ve gönderdiği parametreler kontrol edilir: kristalli kutuda da
    // "Athena'nın Bilgeliği (Premium/Ambrosia)" gibi bir yazı durabildiği için kutu metnine bakmak deneyi gizliyordu.
    // Ambrosia ya da premium geçen düğme/parametre hiç seçilmez; deneyden sonra ambrosia azalırsa bot ayrıca durur.
    const PREMIUM = /ambros|premium/i;
    // Bunlar akademi ekranında duran ama deney olmayan işlemler.
    const NOT_EXPERIMENT = /^(UpgradeExistingBuilding|DowngradeBuilding|DemolishBuilding|IslandScreen|CityScreen)$/i;

    const queryParams = (url) => {
      const q = String(url || '').replace(/&amp;/g, '&').split('?')[1];
      if (!q) return null;
      const params = Object.fromEntries(new URLSearchParams(q.split('#')[0]));
      delete params.actionRequest;
      delete params.ajax;
      return params;
    };
    const isDisabled = (el) =>
      !!(el.disabled || el.closest('[disabled], .disabled, .inactive, .notAvailable') || /disabled|inactive/i.test(el.className || ''));

    // Elemanın kendi etiketi ve metni (formda bütün form değil, sadece düğmesi bakılır).
    const ownHtml = (el) => (el.tagName === 'FORM' ? el.outerHTML.split('>')[0] : el.outerHTML);
    // onclick içindeki istek adresi: ajaxHandlerCall('?action=...') ya da başka bir çağrıdaki '?view=...'/'index.php?...'.
    const onclickUrl = (el) => {
      const s = el.getAttribute('onclick') || '';
      const m = s.match(/['"]((?:index\.php)?\?[^'"]*(?:action|view)=[^'"]*)['"]/);
      return m ? m[1] : null;
    };

    // Kutunun içindeki işlemler: formlar, href'li bağlantılar ve onclick'inde istek adresi olan düğmeler.
    // needName: sadece parametresinde "experiment" geçen işlemler kabul edilir (kutu yoksa).
    // nameOrText: parametresinde "experiment" ya da düğme metninde "deney/experiment" geçenler kabul edilir (kutunun çevresi).
    // skip: bu elemanların içindeki işlemler atlanır (ambrosialı kutu).
    function experimentActions(root, { needName = false, nameOrText = false, skip = () => false } = {}) {
      const out = [];
      const add = (params, el, kind) => {
        if (skip(el)) return;
        if (!params || PREMIUM.test(JSON.stringify(params)) || PREMIUM.test(ownHtml(el))) return;
        if (!params.action && !params.view) return;
        if (params.action && NOT_EXPERIMENT.test(params.action)) return;
        if (needName && !/xperiment/i.test(JSON.stringify(params))) return;
        if (nameOrText && !/xperiment/i.test(JSON.stringify(params)) && !/deney|xperiment/i.test(el.textContent + ' ' + (el.value || ''))) return;
        out.push({ kind, params, disabled: isDisabled(el) });
      };
      const forms = root.matches && root.matches('form') ? [root] : [...root.querySelectorAll('form')];
      for (const f of forms) {
        const params = {};
        for (const el of f.querySelectorAll('input, select, textarea')) {
          if (!el.name || el.name === 'actionRequest') continue;
          if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
          if (el.type === 'submit' || el.type === 'button') continue;
          params[el.name] = el.value;
        }
        const submit = f.querySelector('[type=submit], button, .button');
        add({ ...queryParams(f.getAttribute('action')), ...params }, submit || f, 'form');
      }
      for (const a of root.querySelectorAll('a[href*="action="], a[href*="view="]')) add(queryParams(a.getAttribute('href')), a, 'link');
      for (const b of root.querySelectorAll('[onclick]')) {
        if (b.matches('a[href*="action="], a[href*="view="]')) continue;
        const url = onclickUrl(b);
        if (url) add(queryParams(url), b, 'button');
      }
      return out;
    }

    // Deney bulunamadığında günlüğe yazılan döküm: kutular, içlerindeki düğme/bağlantı/formlar ve parametreleri
    // (oturum anahtarı hariç). Gerçek deney ekranı hiç görülmediği için sorun çıkarsa buradan düzeltilir.
    function describeExperiment(doc, boxes) {
      // Kutunun içi boş olabildiği için (düğme yanında durabiliyor) iki üst kapsayıcısı dökülür.
      const around = boxes.length && boxes[0].parentElement ? boxes[0].parentElement.parentElement || boxes[0].parentElement : null;
      const roots = around ? [around] : boxes.length ? boxes : [doc.body];
      const parts = [`${boxes.length} deney kutusu`];
      roots.forEach((root, i) => {
        const items = [...root.querySelectorAll('form, a, button, input[type=submit], input[type=button], [onclick]')].slice(0, 12).map((el) => {
          const url =
            el.tagName === 'FORM'
              ? [el.getAttribute('action'), ...[...el.querySelectorAll('input[name]')].map((x) => `${x.name}=${x.value}`)].join(' ')
              : el.getAttribute('href') || onclickUrl(el) || (el.getAttribute('onclick') || '').slice(0, 80);
          const clean = String(url || '').replace(/actionRequest=[^&\s'"]*/g, 'actionRequest=…');
          return `${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().replace(/\s+/g, '.')}${isDisabled(el) ? ' [kapalı]' : ''} "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}" ${clean}`;
        });
        const name = root === doc.body ? 'sayfa' : `${root.tagName.toLowerCase()}#${root.id || ''}.${(root.className || '').toString().trim().replace(/\s+/g, '.')}`;
        parts.push(`#${i + 1} ${name}: ${items.join(' | ') || 'düğme yok'}`);
      });
      return parts.join('\n').slice(0, 2500);
    }

    function readExperiment(html) {
      const doc = IB.parseHtml(html);
      const boxes = [...doc.querySelectorAll('.experiment')];
      const pick = (actions) =>
        actions.find((a) => !a.disabled && a.params.action) ||
        actions.find((a) => !a.disabled && /xperiment/i.test(JSON.stringify(a.params))) ||
        null;
      let actions = boxes.length ? experimentActions(boxes[0]) : experimentActions(doc.body, { needName: true });
      let action = pick(actions);
      // Kutunun içinde düğme yoksa (sadece "Masraf" yazıyorsa) düğme yanındadır: üst kapsayıcılarda aranır.
      // Orada sadece deneyle ilgili olduğu belli olan düğmeler alınır; ambrosialı kutunun içi atlanır.
      if (boxes.length && !action) {
        const others = boxes.slice(1);
        const skip = (el) => others.some((b) => b.contains(el));
        for (let up = boxes[0].parentElement, i = 0; up && up !== doc.body && i < 3 && !action; up = up.parentElement, i++) {
          const found = experimentActions(up, { nameOrText: true, skip });
          if (found.length) actions = found;
          action = pick(found);
        }
      }
      const normal = boxes.slice(0, 1);
      return {
        found: normal.length > 0 || actions.length > 0,
        debug: action ? null : describeExperiment(doc, boxes),
        // Gerçek işlem (action=...) önce; sadece pencere açan bağlantı ancak adında "experiment" geçiyorsa.
        action,
        text: IB.stripTags(((normal[0] && normal[0].innerHTML) || '').replace(/</g, ' <')).slice(0, 300),
      };
    }

    // Akademi ekranı: şehirdeki kristal, ambrosia ve kristalle yapılan deneyin durumu.
    // cooldownEnd: ekrandaki en yakın sayaç (saniye); deney yapılamıyorken bekleme süresi tahmini olarak kullanılır.
    G.academy = async (cityId, position) => {
      const r = await request({ view: 'academy', cityId, position, backgroundView: 'city', currentCityId: cityId, templateView: 'academy' });
      if (!r.html) throw new GameError(`Akademi ekranı açılmadı (şehir ${cityId}).`, 'game');
      const t = r.template || {};
      const timers = Object.entries(t).filter(([k]) => /xperiment|cooldown/i.test(k)).map(([, v]) => v);
      const stamps = futureStamps(r.cmd('ingameCounterData'), timers);
      const h = r.header;
      const exp = readExperiment(r.html);
      if (exp.debug) {
        const keys = Object.keys(t).filter((k) => /xperiment/i.test(k));
        if (keys.length) exp.debug += `\nŞablon: ${keys.map((k) => `${k}=${IB.stripTags(JSON.stringify(t[k])).slice(0, 80)}`).join(' | ')}`.slice(0, 800);
      }
      return {
        ...exp,
        cooldownEnd: stamps.length ? Math.min(...stamps) : null,
        crystal: Number((h.currentResources || {})['3']) || 0,
        ambrosia: Number(h.ambrosia),
        // Ham ekran (deney düğmesi okunamazsa tanı dökümüne konur; bkz. deney.js).
        raw: { html: r.html, template: t },
      };
    };

    // Deney düğmesinin isteğini gönderir. Düğme önce bir onay penceresi açıyorsa (sadece view'li bağlantı),
    // o pencere okunup içindeki kristalli deney işlemi gönderilir.
    G.doExperiment = async (cityId, action) => {
      let params = action.params;
      if (!params.action) {
        const v = await request({ ...params, cityId: params.cityId || cityId, backgroundView: 'city', currentCityId: cityId });
        const next = v.html ? readExperiment(v.html).action : null;
        if (!next || !next.params.action) return { errors: ['Deney onay penceresinde kristalli deney düğmesi bulunamadı.'], successes: [] };
        params = next.params;
      }
      const r = await request(
        { ...params, cityId: params.cityId || cityId, backgroundView: 'city', currentCityId: cityId, templateView: 'academy' },
        { post: true }
      );
      return { errors: r.errors, successes: r.successes };
    };

    return G;
  }

  IB.makeGame = makeGame;
  IB.game = makeGame('barbar');
  IB.uiGame = makeGame(null);
})();
