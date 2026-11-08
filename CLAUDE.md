# CLAUDE.md

Ikariam için Chrome eklentisi olarak çalışan bot (barbar rotasyonu, inşaat sırası, araştırma sırası, deney botu).
Kullanıcı Türkçe konuşur; arayüz metinleri, günlükler, kod yorumları ve commit mesajları Türkçedir.
Özellikler ve davranışların ayrıntılı tarifi **README.md**'de; bir davranışı değiştirince README'yi de güncelle.

## Mimari
- Bot kodu GitHub Pages'ten sunulur (https://camperfire51.github.io/ikariam-bot/, bu depo, herkese açık).
- Kullanıcılar sadece `loader/` klasöründeki küçük yükleyici eklentiyi kurar (`ikariam-yukleyici.zip` olarak dağıtılır,
  zip depoda değil). `loader/loader.js` her sayfa açılışında `version.json`'ı okur ve listelenen `src/*.js` dosyalarını
  sırayla sayfaya (MAIN world) ekler. `loader/bridge.js` + `popup.js`: eklenti penceresinden modül açıp kapama.
- Tüm dosyalar `window.IkaBot` (kısaca `IB`) nesnesine bağlanan IIFE'lerdir; derleme/bundle/npm yok, saf JS.
- Çekirdek (`modules.json` → `core`):
  - `src/api.js` — sunucuyla konuşma: istek kuyruğu, actionRequest token'ı, tek sekme kilidi, bot başına duraklatma.
  - `src/game.js` — oyun verisini okuma ve işlemler; mümkün olduğunca oyunun kendi formları okunup gönderilir.
  - `src/table.js` — barbar seviye tablosu (localStorage). `src/live.js` — panellerin canlı durum satırı/renkleri.
  - `src/dock.js` — sol alttaki bot çubuğu, 📋 Günlük kopyalama. `src/update.js` — "Bot güncellemesi var" uyarısı.
- Modüller: barbar (`rotation.js`, `ui.js`), inşaat (`build.js`, `build-ui.js`), araştırma (`research.js`,
  `research-ui.js`), deney (`deney.js`, `deney-ui.js`). Botlar birbirinden bağımsızdır, sadece istek katmanını paylaşır.
- Kalıcı durum oyun sayfasının localStorage'ında, `ikabot.*` anahtarlarıyla tutulur.
- Kök `manifest.json` eski yöntemle yerel eklenti olarak da yüklenebilir; dosya listesinin asıl kaynağı odur.

## Yeni dosya eklerken
`manifest.json` → `content_scripts[0].js` listesine (yükleme sırasına dikkat) ve `modules.json`'da ya `core`'a ya da
tam olarak bir modüle ekle. `release.js` ikisinin tutarlı olduğunu kontrol eder.

## Yayınlama (önemli)
- Test kanalı / staging **yok** ve istenmiyor (kullanıcı açıkça reddetti). Değişiklikler doğrudan herkese gider.
- Bot koduna (`src/`, `manifest.json`, `modules.json`) dokunan her değişiklik bitince, sormadan yayınla:
  `node release.js "ne değişti (Türkçe, kullanıcının anlayacağı dille)"`
  Bu `version.json`'ı yeni sürüm numarası ve dosya listesiyle yazar, `git add -A`, commit (`Sürüm YYYY.MM.DD-HHMM: ...`)
  ve push yapar. Sonra kullanıcıya açık oyun sekmelerinde "Bot güncellemesi var → Yenile" çıkacağını söyle
  (10 dk'da bir bakılır; sayfayı yenilemek de yeter).
- Sadece belge/araç değişikliği (README, CLAUDE.md vb.) için `release.js` gerekmez; normal commit + push yeterli.
- `loader/` değişirse kullanıcılar yükleyiciyi yeniden kurmalı; `loader/manifest.json` sürümünü artır ve yeni zip gerekir.
- Depo herkese açık ve buradaki kod herkesin oyununda çalışır: şifre, oturum bilgisi, kişisel veri koyma.

## Hata ayıklama
Tarayıcıda oyun olmadan test ortamı yok. Kullanıcıdan bot çubuğundaki **📋 Günlük** dökümünü iste (bütün botların
günlükleri, canlı durumları, ayarları; gerekiyorsa akademi ekranının ham HTML'i). Botlar her kontrolde durumu
oyundan taze okur, kendi kaydına güvenmez; bu ilkeyi koru.

## Açık notlar
- **Deney botu canlıda henüz doğrulanmadı.** Deney isteği, bir arkadaşın Günlük dökümündeki gerçek HTML'den kuruldu:
  akademide `form#accelResearchForm` (action=CityScreen, function=buyResearch, useAthenasScroll, payWithAmbrosia,
  cityId, position), içinde iki `.experiment` kutusu; `conductExperiment(0)` = "Deney yap" (kristal),
  `conductExperiment(1)` = Athena'nın parşömeni (ambrosia ile satın alınabilir — asla seçilmez). Maliyet `.cost-info`
  içinde, bekleme ~4 saat. Bot (`experimentForm` in `src/game.js`, `G.doExperiment`) formu useAthenasScroll=0 ve
  payWithAmbrosia=0 zorlanarak POST eder. Kullanıcının kendi hesabında Deneyler araştırması yok. Doğrulanmamış:
  bekleme süresinde ekranın nasıl göründüğü ve POST yanıtı. Sorun çıkarsa Günlük dökümünü ve `ikabot.deney.log`'u iste.
