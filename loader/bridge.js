// Köprü (eklenti tarafı): eklenti penceresinde kapatılan modüllerin listesini oyun sayfasına iletir.
// Liste sayfanın kök elemanına data-ikabot-off olarak yazılır; loader.js oradan okur.
// Pencerede bir modül eklenip kaldırılınca açık oyun sekmeleri yenilenir (ayarlar silinmez, sadece kod yüklenmez).
(() => {
  if (window.top !== window) return;
  const root = document.documentElement;
  chrome.storage.local.get({ off: [] }, ({ off }) => {
    root.setAttribute('data-ikabot-off', JSON.stringify(off || []));
  });
  let timer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.off) return;
    root.setAttribute('data-ikabot-off', JSON.stringify(changes.off.newValue || []));
    // Art arda birkaç değişiklik tek yenilemeyle uygulanır.
    clearTimeout(timer);
    timer = setTimeout(() => location.reload(), 1500);
  });
})();
