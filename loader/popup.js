// Eklenti penceresi: bot modüllerini ekleyip kaldırır. Liste GitHub Pages'teki version.json'dan okunur (yeni modüller
// yükleyici değişmeden görünür); okunamazsa aşağıdaki bilinen liste gösterilir. Seçim chrome.storage'da tutulur.
const BASE = 'https://camperfire51.github.io/ikariam-bot/';
const FALLBACK = [
  { id: 'barbar', name: 'Barbar Rotasyonu' },
  { id: 'insaat', name: 'İnşaat Sırası' },
  { id: 'arastirma', name: 'Araştırma Sırası' },
  { id: 'deney', name: 'Deney Botu' },
];

const $ = (id) => document.getElementById(id);
let modules = FALLBACK;
let off = [];

function render() {
  $('list').innerHTML = '';
  for (const m of modules) {
    const isOff = off.includes(m.id);
    const li = document.createElement('li');
    li.className = isOff ? 'off' : 'on';
    li.innerHTML = '<span class="name"></span><span class="pill"></span><button></button>';
    li.querySelector('.name').textContent = m.name;
    li.querySelector('.pill').textContent = isOff ? 'kaldırıldı' : 'yüklü';
    const b = li.querySelector('button');
    b.textContent = isOff ? 'Ekle' : 'Kaldır';
    b.addEventListener('click', () => {
      off = isOff ? off.filter((x) => x !== m.id) : [...off, m.id];
      chrome.storage.local.set({ off }, () => {
        $('msg').textContent = `${m.name} ${isOff ? 'eklendi' : 'kaldırıldı'}; oyun sekmeleri yenileniyor.`;
        render();
      });
    });
    $('list').appendChild(li);
  }
}

chrome.storage.local.get({ off: [] }, (d) => {
  off = d.off || [];
  render();
});

fetch(BASE + 'version.json?t=' + Date.now(), { cache: 'no-store' })
  .then((r) => r.json())
  .then((v) => {
    $('ver').textContent = 'Bot sürümü ' + v.version;
    if (Array.isArray(v.modules) && v.modules.length) {
      modules = v.modules.map((m) => ({ id: m.id, name: m.name }));
      render();
    }
  })
  .catch(() => {
    $('ver').textContent = 'Sürüm okunamadı (internet?)';
  });
