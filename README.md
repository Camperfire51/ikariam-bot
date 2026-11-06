# Ikariam Barbar Rotasyonu (Chrome eklentisi)

## Kurulum
Bot kodu GitHub Pages'te durur (https://camperfire51.github.io/ikariam-bot/). Chrome'a sadece küçük bir yükleyici kurulur (`loader` klasörü, `ikariam-yukleyici.zip` olarak gönderilir; zip depoda değil); her sayfa açılışında güncel sürüm oradan gelir. Herkes, geliştiricinin bilgisayarı dahil, aynı yükleyiciyi ve aynı sürümü kullanır. Eski yükleyici sürümleri (TEST olanı dahil) de çalışmaya devam eder.

1. Zip'i açıp çıkan klasörü bilgisayarda kalıcı bir yere koy. Klasörü silme/taşıma.
2. Chrome'da `chrome://extensions` adresini aç, sağ üstten **Geliştirici modu**nu aç.
3. Eski bot eklentisi ya da eski yükleyici yüklüyse **kaldır** (ayarlar ve kayıtlar silinmez, oyunun sayfasında durur).
4. **Paketlenmemiş öğe yükle** → o klasörü seç (içinde `manifest.json`, `loader.js`, `bridge.js`, `popup.html`, `popup.js` olmalı). Aynı Chrome'a iki yükleyiciyi birden kurma.
5. Oyun sekmesini yenile. Sol altta bot panelleri çıkar.
6. Ayarlar → Performans → Bellek Tasarrufu'nda `ikariam.gameforge.com` adresini "her zaman etkin tut" listesine ekle (sekme uyutulursa bot durur).

Güncelleme: yeni sürüm yayınlanınca açık oyun sekmesinin üstünde **"Bot güncellemesi var"** uyarısı çıkar (10 dakikada bir bakılır). **Yenile**'ye basmak ya da sayfayı yenilemek yeterli; çalışan botlar kaldığı yerden devam eder.

## Modüller (eklenti penceresi)
Chrome'un sağ üstündeki eklenti simgesine (yapboz → Ikariam Bot; sabitlemek için raptiye) tıklayınca modül listesi açılır: Barbar Rotasyonu, İnşaat Sırası, Araştırma Sırası, Deney Botu. **Kaldır** ile modül oyundan tamamen kalkar (paneli görünmez, hiç çalışmaz); **Ekle** ile geri gelir. Ayarlar, sıralar ve kayıtlar silinmez; eklenince kaldığı yerden devam eder. Değişince açık oyun sekmeleri kendiliğinden yenilenir. Seçim o bilgisayardaki Chrome'a özeldir. (Bu pencere yükleyici 1.4.0 ve sonrasında var.)

Modüllerin dosyaları `modules.json`'da tanımlıdır; her dosya ya çekirdekte (`core`) ya da tek bir modülde olmalı (`release.js` kontrol eder).

## Bot menüsü
Sol altta **Ikariam Bot** çubuğu durur; bütün bot panelleri onun üstüne dizilir. Çubuğa tıklayınca bütün paneller birlikte gizlenir (ekranda sadece çubuk kalır), tekrar tıklayınca geri gelir. Botlar gizliyken de çalışır. Çubukta her botun durum noktası (kırmızı/yeşil/gri) görünür; üzerine gelince o botun canlı durum yazısı çıkar. Seçim sayfa yenilense de korunur. Çubuktaki **📋 Günlük** düğmesi bütün botların günlüklerini, canlı durumlarını, ayarlarını ve (deney düğmesi okunamadıysa) akademi ekranının ham hâlini tek metin olarak panoya kopyalar; sorun bildirirken bunu yapıştır. Oturum anahtarı eklenmez (`src/dock.js`).

## Canlı durum
Her panelin başlığının hemen altında, panel kapalıyken de görünen bir satır var: botun o an ne yaptığı ("Şu an: Nokron kontrol ediliyor…") ya da bir sonraki işleme kalan süre (saniye saniye geri sayım, saatiyle). Şehir/rotasyon satırlarında da aynı geri sayım durur. Renkler: **kırmızı** olumsuz (durdu, hata, kaynak/asker eksik, bulunamadı…), **yeşil** olumlu (çalışıyor, iş yapılıyor, gönderildi), **gri** nötr (durdu, duraklatıldı, bekliyor). Renk durum yazısından seçilir (`src/live.js`).

## Değişiklik ve yayınlama
Her değişiklik bittiğinde doğrudan yayınlanır: `node release.js "ne değişti"` (ya da `YAYINLA.cmd`'ye çift tıkla). `version.json` yeni sürüm numarası ve `manifest.json`'daki dosya listesiyle yazılır, commit'lenip GitHub'a gönderilir. GitHub Pages birkaç dakika içinde yayına alır; herkesin açık oyun sekmesinde "Bot güncellemesi var → Yenile" çıkar. Ayrı bir test sürümü yoktur.

Notlar:
- Yeni bir `src/*.js` dosyası eklenirse `manifest.json`'daki listeye ve `modules.json`'da çekirdeğe ya da bir modüle eklenir; yükleyici listeyi `version.json`'dan okur.
- `manifest.json` (kök klasör) eski yöntemle yerel eklenti olarak da yüklenebilir, ama yükleyiciyle aynı tarayıcıda kullanma.
- Depo herkese açıktır; içine şifre, oturum bilgisi ya da kişisel veri koyma. GitHub hesabında iki adımlı doğrulama açık olsun: buraya konan kod herkesin oyununda çalışır.

## Kullanım
Panelde her barbar rotasyonu için ayrı bir kart var. **+ Rotasyon ekle** ile istediğin kadar rotasyon açabilir, her birini ayrı başlatıp durdurabilirsin. Rotasyonlar aynı anda çalışır.

- Her rotasyonun kendi barbar sömürgesi ve adası olmalı. Aynı sömürge ya da aynı ada iki rotasyonda kullanılamaz.
- İki rotasyon aynı kaynak şehri kullanabilir; o zaman askerleri ve kışlayı paylaşırlar.
- Sorun tek bir rotasyona aitse (saldırı başarısız, sömürge kayboldu, max seviye bitti vb.) sadece o durur.
- Düşman hareketi, oturum düşmesi ya da korunan şehrin kaybolması **tüm** rotasyonları durdurur.

Her kartta şu ayarlar var:
- **Kaynak şehir:** askerlerin çıkacağı ana şehir.
- **Barbar sömürgesi:** barbar köyü vurulacak adadaki geçici sömürge.
- **Max barbar seviyesi:** bu seviye dahil vurulur, sonra bot uyarı verip durur.
- Max seviye başlatırken doğrulanır. Araştırılmamış birim engel değil (oyunda satın alınabiliyor): başlatınca günlüğe bilgi düşer, kışla basamıyorsa elle alırsın; şehirde yeterince olunca saldırı gider. Sonradan yükseltmek için rotasyonu durdurup yeniden başlat.

## Seviye tablosu
Paneldeki **Seviye tablosu** düğmesi tabloyu açar. Her seviyede tam olarak tablodaki askerler gider; yükseltme durumu ya da koçbaşı→mancınık gibi otomatik bir hesap yoktur.

- **+ Seviye ekle:** son seviyenin bir üstünü, son seviyenin askerleriyle ekler. ✕ ile seviye silinir.
- Her seviyede **+ birim** ile istediğin kara birimini (hoplit, kılıç ustası, koçbaşı, mancınık vb.) ekleyip sayısını yazarsın; birimin yanındaki ✕ onu çıkarır.
- **Kayıp:** o seviyede ölmesi beklenen hoplit; asker havuzu bu kadar fazlasını basar ve yoldaki askerlerden düşer.
- **Ganimet:** erken gönderimde askerlerin gemisine ek giden ganimet gemisi. Köy o an henüz kurulmadığı için yeni seviyenin kaynağı oyunda görünmez; bu yüzden ilk saldırıda bu değer kullanılır. Köy ayaktayken gönderilen saldırıda gemi köyün kaynağından otomatik hesaplanır.
- **Ek seferler:** tablonun üstündeki bu bölüme eklenen askerler, ilk saldırıdan sonra köyde kalan kaynağı almaya gider (bkz. Akış). Birim yoksa ek sefer yapılmaz. Varsayılan: 1 hoplit.
- Rotasyonlar 1. seviyeden başlayıp boşluksuz tanımlı son seviyeye kadar kullanabilir; arada eksik ya da askersiz seviye varsa tablo üstünde uyarı çıkar.
- Değişiklik anında kaydedilir, tüm sekmeler aynı tabloyu kullanır; çalışan rotasyonlar bir sonraki turda yeni değerleri kullanır. **Varsayılana dön** ilk tabloyu (yükseltmesiz değerler) geri yükler.

## Akış
- **Gönderim zamanı:** Askerler köy toparlandıktan rastgele 30-90 sn sonra varacak şekilde yola çıkar. Hesaba oyundan okunan üç süre girer: limandaki sıra (kaynak şehirde yüklenmekte olan kendi seferlerin), yükleme (askerlerin toplam ağırlığı / liman ekranındaki toplam yükleme hızı; liman seviyeleri ve bonuslar dahil) ve yolculuk (saldırı formunun süresi). "Erken gönderim" ayarı yolculuk kısmının üst sınırıdır; yükleme ve sıra bunun üstüne eklenir. Gönderimden sonra günlüğe tahmini ve oyundaki yükleme süresi yazılır.
- **Rastgelelik:** İstekler arası 0,8-2 sn, varış payı 30-90 sn, asker havuzu kontrolü 15-25 dk, uzun beklemeler en fazla 1 dk kısa. Bir rotasyon zamanı bilinen bir iş yoksa en fazla 30 dk'da bir kontrol edilir.
- Köy toparlanmadan "erken gönderim" kadar önce, tablodaki askerlerin tam sayısı ve ganimet gemileriyle saldırır. Erken gönderimde köy henüz kurulmadığı için gemi sayısı tablodaki **Ganimet** değeridir (askerlerin taşıma gemilerine ek). Köy ayaktayken gönderilirse kaynak oyundan (barbar köyü penceresi, arka planda) okunur: (asker yükü + köydeki kaynak) / gemi kapasitesi, yukarı yuvarlanır (örn. 200 asker yükü + 5000 kaynak, 500'lük gemi → 11 gemi). Kayıtlı/eski değer kullanılmaz. Bu kadar gemi boşta değilse beklemez, boştaki gemilerin hepsiyle saldırır; sadece askerleri taşıyacak kadar gemi yoksa gemiler dönene kadar bekler (bot durmaz).
- **Ek seferler:** Saldırı kazanılıp köy yıkıldıktan (barbar ordusu yok edildikten) sonra köyde kaynak kaldıysa, gemiler dönünce "Ek seferler" askerleriyle ek sefer gider. Kalan kaynak her seferde oyundan okunur ve gemi ona göre hesaplanır; boşta o kadar yoksa hepsi gider. Kaynak bitene kadar gerektiği kadar ek sefer yapılır, sayı sınırı yok (biri dönmeden diğeri gitmez). Ek sefer sadece köy yeniden kurulmadan varabilecekse ve arkasından saldırı gidecekse o saldırının gönderiminden önce dönebilecekse gönderilir; zaman yetmezse kalan kaynak bırakılır ve günlüğe yazılır. Otomatik basım açıksa asker havuzu ek sefer askerlerini de hazır tutar.
- **Asker havuzu (önden basım):** Bot, sıradaki saldırı dahil önündeki 3 tur (max seviyeyle sınırlı) için gereken askeri hep hazır tutar; ayarı yoktur. Her seviye için tablodaki sayıya, aradaki seviyelerde beklenen kayıplar eklenir. Pencere her saldırıda bir ileri kayar. Aynı kaynak şehri kullanan rotasyonların asker ihtiyaçları toplanır; şahmerdan/mancınık ölmediği için toplanmaz, rotasyonlar aynı kuşatma birimlerini sırayla kullanır.
- Bot kendi kaydına güvenmez; her kontrolde her şeyi oyundan okur: köyün seviyesi ve yıkık olup olmadığı, köye giden saldırımız var mı, şehirdeki askerler, kışla kuyruğu ve hareket listesindeki yağma seferlerinde dönecek askerler (henüz savaşmamış saldırıda o seviyenin beklenen kaybı düşülerek).
- Bu ihtiyaç; şehirdeki askerler, kışla kuyruğunda eğitimde olanlar ve yolda olup dönecekler ile karşılaştırılır. Kontrol 15-25 dakikada bir kendiliğinden yapılır (saldırı gönderilince ya da asker eksik kalınca hemen). Kışla en fazla 3 emir aldığı için eksik tur tur ayrı emirlerle basılır: 1. emir sıradaki saldırının eksiği, 2. emir bir sonraki turun ek ihtiyacı, 3. emir ondan sonrakinin. Böylece ilk tur büyük bir emrin bitmesini beklemez. Kaynak sadece bir kısmına yetiyorsa o kadarı basılır; sonraki turlar basılamazsa bot durmaz, bir sonraki kontrolde tekrar dener. Fazladan asker kalabilir; bu bilerek yapılıyor.
- Kışla kuyruğu oyundan okunduğu için aynı asker iki kez basılmaz. Kuyruk doluysa (en fazla 3 emir) ya da kaynak/vatandaş yetmiyorsa, yetecek kadarı basılır, kalanı sonra.
- Gönderim anında yine de eksik varsa durmaz; eğitimdeki askerleri bekler.
- **Sömürgedeki mızrakçılar:** "Sömürgedeki mızrakçıları kaynak şehre yolla" açıksa (varsayılan açık), rotasyon çalışırken 30-50 dk'da bir barbar sömürgesine bakılır. Orada ne kadar mızrakçı varsa hepsi o rotasyonun kaynak şehrine konuşlandırılır. Bu özellik başka hiçbir şey yapmaz: mızrakçı basmaz, bina kurmaz, başka asker yollamaz. Gemi yetmezse ya da oyun reddederse rotasyon durmaz; sebep günlüğe bir kez yazılır, sonra tekrar denenir.
- Max seviye vurulup askerler dönünce uyarı verip durur. Sömürgeyi silme ve yeniden kurma elle yapılır; yeni sömürgeyle botu tekrar başlat.

## İnşaat Sırası (ayrı bot)
Barbar panelinin üstündeki **İnşaat Sırası** paneli, barbar botundan tamamen ayrı başlatılıp durdurulur.

- Şehir seç → bina seç → hedef seviye yaz → **+ Sıraya ekle**. ↑ ↓ ile sırayı değiştir, ✕ ile sil.
- Her şehrin kendi sırası vardır; şehirler birbirini beklemez.
- Bir şehirde sadece sıranın **ilk** işi yapılır: bina hedef seviyeye gelene kadar birer seviye yükseltilir, sonra iş silinip sıradakine geçilir.
- Şehirde inşaat varsa bitmesi beklenir. Malzeme yoksa beklenir (15-30 dk'da bir bakılır); sıradaki işe **atlanmaz**.
- Her yükseltme emrinden sonra şehir tekrar okunup inşaatın gerçekten başladığı doğrulanır.
- Sadece var olan binalar yükseltilir; boş arsaya yeni bina kurmaz.
- Oturum düşerse/captcha çıkarsa durur. Sayfa yenilenirse kaldığı yerden devam eder.

## Araştırma Sırası (ayrı bot)
İnşaat panelinin üstündeki **Araştırma Sırası** paneli mucit atölyesinde birim/gemi araştırması yapar; diğer iki bottan tamamen ayrı başlatılıp durdurulur.

- Şehir seç → birim seç → araştırma seç (Zarar ya da Zırh) → hedef seviye yaz → **+ Sıraya ekle**. Listeler oyundan okunur: sadece o şehirde mucit atölyesi varsa birimler gelir; her birimin şu anki seviyesi, sonraki seviyenin adı ve oyunun engel mesajı (örn. "Bina kademesi yeterli değil!") görünür. Araştırması olmayan birimler (kargo gemisi) listelenmez.
- Her şehrin kendi sırası vardır. Sadece sıranın **ilk** işi yapılır: araştırma hedef seviyeye gelene kadar birer seviye yapılır, sonra iş silinip sıradakine geçilir. En yüksek seviyeye ulaşılmışsa iş silinir.
- Atölyede araştırma varsa bitmesi beklenir. Altın ya da kristal yetmiyorsa veya oyun engel gösteriyorsa beklenir (15-30 dk'da bir bakılır); sıradaki işe **atlanmaz**.
- Her emirden sonra atölye tekrar okunup araştırmanın gerçekten başladığı doğrulanır.
- Oturum düşerse/captcha çıkarsa durur. Sayfa yenilenirse kaldığı yerden devam eder.

## Deney Botu (ayrı bot)
Araştırma panelinin üstündeki **Deney Botu** paneli akademide kristalle deney yapar; diğer botlardan tamamen ayrı başlatılıp durdurulur.

- Tek ayar şehir seçimidir: listede deney yapılacak şehirleri tikle, **Başlat**'a bas. Seçim çalışırken de değiştirilebilir.
- Bot açık olduğu sürece seçili her şehirde imkan oldukça deney yapılır. Akademinin bekleme süresi (her deneyden sonra yaklaşık 4 saat) sürüyorsa ya da kristal yetmiyorsa beklenir (20-30 dk'da bir bakılır; bekleme süresinin bitişi biliniyorsa tam o saatte), sonra tekrar dener. Şehirler birbirini beklemez.
- Deney kristali o şehrin deposundan harcanır; o şehirde optik varsa maliyet düşer. Bu yüzden optiği yüksek şehirleri seçmek daha ucuzdur.
- Ambrosialı deneye hiç dokunulmaz: ekranda ambrosia/premium geçen hiçbir düğme seçilmez. Bir deneyden sonra ambrosia azalmış görünürse bot hemen durur ve uyarır.
- Deney, oyunun akademi ekranındaki kendi deney düğmesi okunup gönderilerek yapılır; her deneyden sonra akademi tekrar okunup kristalin harcandığı doğrulanır.
- Deney yapmak için **Bilim → Deneyler** araştırması gerekir; yapılmamışsa bot "deney bölümü bulunamadı" yazıp bekler.
- Oturum düşerse/captcha çıkarsa durur. Sayfa yenilenirse kaldığı yerden devam eder.

## Botları ayrı ayrı açıp kapama
Her panelin başlığında kendi **Açık** tiki var (barbar, inşaat, araştırma, deney). Birinin tikini kaldırınca sadece o bot anında duraklar; diğerleri çalışmaya devam eder. Duraklatılan botun hiçbir isteği sunucuya gitmez, ayarları ve sırası silinmez; tik tekrar açılınca kaldığı yerden, oyundan taze okuyarak devam eder. Tikler tüm sekmelerde ortaktır ve sayfa yenilense de korunur. (Başlat/Durdur ise botu tamamen başlatır ya da bitirir.)

## Botun durduğu durumlar
- Max seviyeye ulaşıldığında.
- Düşman oyuncu hareketi (saldırı, blokaj vb.). Barbarların bize saldırısı botu durdurmaz.
- Oturum düşerse ya da captcha çıkarsa.

Saldırı formu açılmazsa (ör. liman bloklu) bot durmaz; sebebi loga yazar ve birkaç dakika sonra tekrar dener.
- Saldırı başarısız olursa.
