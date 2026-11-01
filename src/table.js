// Barbar köyü seviye tablosu. Panelden düzenlenir (eklenir, değiştirilir, silinir) ve localStorage'da tutulur;
// tüm sekmeler aynı tabloyu kullanır. Her seviye için gidecek askerler tam olarak tablodaki gibidir.
(() => {
  const IB = (window.IkaBot = window.IkaBot || {});

  const KEY = 'ikabot.barbar.table.v1';

  const HOPLITE = '303';
  const RAM = '307'; // Şahmerdan / Koçbaşı
  const CATAPULT = '306'; // Mancınık

  const SPEARMAN = '315'; // Mızrakçı (sömürgeden kaynak şehre yollanır)

  IB.HOPLITE = HOPLITE;
  IB.CATAPULT = CATAPULT;
  IB.SPEARMAN = SPEARMAN;
  // Kuşatma birimleri savaşta ölmez; aynı şehri kullanan rotasyonlar bunları sırayla kullanır (toplanmaz).
  IB.SIEGE_UNITS = new Set([RAM, CATAPULT]);

  // Tabloda seçilebilecek kara birimleri (oyundaki birim numaraları).
  IB.LAND_UNITS = [
    ['303', 'Hoplit'],
    ['302', 'Kılıç ustası'],
    ['315', 'Mızrakçı'],
    ['301', 'Taşçı'],
    ['313', 'Okçu'],
    ['304', 'Tüfekçi'],
    ['308', 'Buhar devi'],
    ['307', 'Koçbaşı'],
    ['306', 'Mancınık'],
    ['305', 'Havan topu'],
    ['312', 'Girokopter'],
    ['309', 'Balon bombacısı'],
    ['310', 'Aşçı'],
    ['311', 'Hekim'],
  ];
  IB.UNIT_NAMES = Object.fromEntries(IB.LAND_UNITS);

  // Varsayılan tablo: seviye, hoplit, kuşatma, kayıp (hoplit), ganimet gemisi.
  const C = (n) => [CATAPULT, n];
  const DEFAULT_ROWS = [
    [1, 2, null, 0, 1],
    [2, 3, null, 0, 2],
    [3, 6, null, 0, 2],
    [4, 9, null, 0, 2],
    [5, 33, null, 0, 3],
    [6, 43, null, 0, 4],
    [7, 54, null, 0, 4],
    [8, 72, null, 0, 5],
    [9, 72, null, 0, 7],
    [10, 72, C(12), 2, 8],
    [11, 90, C(12), 2, 10],
    [12, 90, C(12), 4, 12],
    [13, 90, C(12), 4, 15],
    [14, 102, C(12), 12, 18],
    [15, 115, C(12), 16, 21],
    [16, 164, C(12), 20, 25],
    [17, 167, C(12), 26, 29],
    [18, 187, C(12), 46, 34],
    [19, 194, C(12), 48, 38],
    [20, 206, C(12), 67, 44],
  ];

  IB.defaultTable = () =>
    DEFAULT_ROWS.map(([level, hoplites, siege, losses, lootShips]) => {
      const units = { [HOPLITE]: hoplites };
      if (siege) units[siege[0]] = siege[1];
      return { level, units, losses, lootShips };
    });

  const int = (v) => Math.max(0, Math.floor(Number(v) || 0));

  // Bozuk/eksik satırlar temizlenir; aynı seviyeden ikincisi atılır. Sonuç seviyeye göre sıralıdır.
  function normalize(rows) {
    const seen = new Set();
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const level = int(r && r.level);
      if (!level || seen.has(level)) continue;
      seen.add(level);
      const units = {};
      for (const [id, n] of Object.entries((r && r.units) || {})) if (int(n) > 0) units[String(id)] = int(n);
      out.push({ level, units, losses: int(r.losses), lootShips: int(r.lootShips) });
    }
    return out.sort((a, b) => a.level - b.level);
  }

  // Tek seferlik: kayıtlı tabloda 10-15. seviyelerdeki şahmerdanlar aynı sayıda mancınıkla değiştirilir
  // (varsayılan tablo da artık bu seviyelerde mancınık ister).
  const RAM_MIGRATED_KEY = 'ikabot.barbar.table.ramToCatapult';
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && !localStorage.getItem(RAM_MIGRATED_KEY)) {
      const rows = normalize(JSON.parse(raw));
      for (const r of rows) {
        if (r.level < 10 || r.level > 15 || !r.units[RAM]) continue;
        r.units[CATAPULT] = (r.units[CATAPULT] || 0) + r.units[RAM];
        delete r.units[RAM];
      }
      localStorage.setItem(KEY, JSON.stringify(rows));
    }
    localStorage.setItem(RAM_MIGRATED_KEY, '1');
  } catch (e) {}

  IB.getTable = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {}
    return IB.defaultTable();
  };

  const tableListeners = new Set();
  IB.onTableChange = (fn) => tableListeners.add(fn);
  const emitTable = () => tableListeners.forEach((fn) => { try { fn(); } catch (e) {} });
  window.addEventListener('storage', (e) => { if (e.key === KEY) emitTable(); });

  IB.saveTable = (rows) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(normalize(rows)));
    } catch (e) {}
    emitTable();
  };

  IB.resetTable = () => {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
    emitTable();
  };

  // Rotasyonun kullanabileceği en yüksek seviye: 1'den başlayıp arada boşluk olmadan tanımlı son seviye.
  IB.maxTableLevel = () => {
    const levels = new Set(IB.getTable().filter((r) => Object.keys(r.units).length).map((r) => r.level));
    let n = 0;
    while (levels.has(n + 1)) n++;
    return n;
  };

  IB.planForLevel = (level) => {
    const row = IB.getTable().find((r) => r.level === level);
    if (!row || !Object.keys(row.units).length) return null;
    return { level, units: { ...row.units }, expectedLosses: row.losses, lootShips: row.lootShips };
  };

  IB.describeUnits = (u) =>
    Object.entries(u)
      .map(([id, n]) => `${n} ${IB.UNIT_NAMES[id] || id}`)
      .join(' + ');
})();
