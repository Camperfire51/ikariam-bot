// Panellerin canlı durum satırı: her botun o an ne yaptığı ve bir sonraki işlemine kalan süre, saniye saniye.
// Renkler: kırmızı = olumsuz (durdu, hata, eksik…), yeşil = olumlu (çalışıyor, iş yapılıyor), gri = nötr (durdu, bekliyor).
(() => {
  const IB = window.IkaBot;

  const BAD =
    /durdu:|başarısız|hata|yetersiz|yetmiyor|eksik|bulunamadı|bulunamıyor|yapılamıyor|yapılamadı|okunamadı|kabul etmedi|reddet|basılamıyor|basılamadı|açılmadı|başlatılamadı|düzelt|engel|bağlantı|kuyruğu dolu|gemi bekleniyor/i;
  const GOOD = /yapılıyor|araştırılıyor|gönderildi|yapıldı|eğitime verildi|başladı|yeterli|hazır|kontrol ediliyor/i;

  // Durum yazısının rengi.
  const tone = (text) => (BAD.test(text || '') ? 'bad' : GOOD.test(text || '') ? 'good' : 'idle');

  const dur = (ms) => {
    let s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    s %= 60;
    return (h ? h + 'sa ' : '') + (h || m ? m + 'dk ' : '') + s + 'sn';
  };
  // "sonraki işlem 2dk 05sn (14:32:10)" ya da zamanı geldiyse "sonraki işlem şimdi".
  const until = (at) => {
    if (!at) return '';
    const left = at - Date.now();
    return left <= 1000 ? 'sonraki işlem şimdi' : `sonraki işlem ${dur(left)} (${new Date(at).toLocaleTimeString('tr-TR')})`;
  };

  // Panel başlığının altındaki tek satır. s: { paused, passive, running, status, current, items: [{ label, status, nextAt }] }
  // current: o an işlenen öğenin etiketi (yoksa null).
  function summary(s) {
    if (s.paused) return { tone: 'idle', text: 'Duraklatıldı — açınca kaldığı yerden devam eder.' };
    if (s.passive) return { tone: 'idle', text: 'Başka sekmede çalışıyor; bu sekme sadece izliyor.' };
    if (!s.running) return { tone: /^durdu: /i.test(s.status || '') ? 'bad' : 'idle', text: s.status || 'Durdu' };
    if (s.current) return { tone: 'good', text: `Şu an: ${s.current} kontrol ediliyor…` };
    const items = s.items.filter((it) => it.status || it.nextAt);
    const bad = items.find((it) => tone(it.status) === 'bad');
    if (bad) return { tone: 'bad', text: `${bad.status}${bad.nextAt ? ' · ' + until(bad.nextAt) : ''}` };
    const next = items.filter((it) => it.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
    if (!next) return { tone: 'good', text: s.status || 'Çalışıyor' };
    return { tone: 'good', text: `Çalışıyor · ${until(next.nextAt)}: ${next.label}` };
  }

  const CSS = `
    .live { display:flex; align-items:flex-start; gap:6px; padding:4px 10px; font-size:11px; border-bottom:1px solid #d9c49a; background:#fafafa; }
    .live .ld { width:8px; height:8px; border-radius:50%; margin-top:3px; flex:none; background:#9a9a9a; }
    .live { cursor:pointer; }
    .live .lt { flex:1; white-space:pre-wrap; min-width:0; overflow:hidden; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
    .live.full .lt { display:block; -webkit-line-clamp:unset; max-height:140px; overflow:auto; }
    .t-good { color:#1e7d32 !important; } .t-bad { color:#b3392f !important; } .t-idle { color:#666666 !important; }
    .live.t-good .ld { background:#2e9e44; } .live.t-bad .ld { background:#d93a2f; } .live.t-idle .ld { background:#9a9a9a; }
    .cd { color:#666666 !important; font-weight:400; }
  `;
  const HTML = '<div class="live t-idle" id="live"><span class="ld"></span><span class="lt" id="liveText"></span></div>';

  // Panel kökünde (shadow root) canlı satırı ve her öğenin geri sayımını saniyede bir günceller.
  // get(): summary()'nin aldığı nesne. Öğe satırlarındaki geri sayım: data-next="ms" taşıyan elemanın .cd alt elemanı.
  // Uzun yazı 2 satırda kesilir (tamamı fareyle üstüne gelince görünür); satıra tıklayınca tamamı açılır / kapanır.
  function attach(root, get) {
    let full = false;
    const liveEl = root.getElementById('live');
    if (liveEl) liveEl.addEventListener('click', () => {
      full = !full;
      tick();
    });
    const tick = () => {
      let r;
      try {
        r = summary(get());
      } catch (e) {
        return;
      }
      const el = root.getElementById('live');
      if (!el) return;
      el.className = 'live t-' + r.tone + (full ? ' full' : '');
      const t = root.getElementById('liveText');
      if (t.textContent !== r.text) {
        t.textContent = r.text;
        el.title = r.text + '\n\n(Tıkla: tamamını göster / kısalt)';
      }
      for (const n of root.querySelectorAll('[data-next]')) {
        const cd = n.querySelector('.cd');
        if (cd) cd.textContent = Number(n.dataset.next) ? ' · ' + until(Number(n.dataset.next)) : '';
      }
    };
    tick();
    setInterval(tick, 1000);
    return tick;
  }

  // Öğe durum satırı (renkli, geri sayımlı). Metin HTML'den kaçırılmış olmalı.
  const line = (escText, rawText, nextAt, cls = 'cs') =>
    `<div class="${cls} t-${tone(rawText)}" data-next="${nextAt || 0}">${escText}<span class="cd"></span></div>`;

  IB.live = { tone, dur, until, summary, attach, line, CSS, HTML };
})();
