// Yerel test sunucusu: bu klasördeki dosyaları http://localhost:5179 adresinden verir. Tarayıcıda test modu
// açıksa yükleyici botu GitHub Pages yerine buradan alır. version.json her istekte manifest.json'dan üretilir;
// sürüm, dosyaların son değişme zamanıdır (kod değişince açık sekmede "güncelleme var" uyarısı çıkar).
// Kullanım: node test-server.js   (kapatmak için pencereyi kapat ya da Ctrl+C)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5179;
const dir = __dirname;
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function version() {
  const files = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).content_scripts[0].js;
  const mtime = Math.max(...files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
  const d = new Date(mtime);
  const p = (n) => String(n).padStart(2, '0');
  return { version: `test-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`, files };
}

http
  .createServer((req, res) => {
    // Oyun sayfası (https) yerel sunucuya erişirken Chrome'un istediği başlıklar.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.end();
    const url = decodeURIComponent(req.url.split('?')[0]);
    try {
      if (url === '/version.json') {
        res.setHeader('Content-Type', TYPES['.json']);
        return res.end(JSON.stringify(version()));
      }
      const file = path.normalize(path.join(dir, url));
      if (!file.startsWith(path.join(dir, 'src') + path.sep)) throw new Error('izin yok');
      const body = fs.readFileSync(file);
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch (e) {
      res.statusCode = 404;
      res.end('yok');
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`Test sunucusu açık: http://localhost:${PORT}`);
    console.log('Oyunda test modunu açmak için adres çubuğunda adresin sonuna #ikabot-test yazıp Enter\'a bas.');
    console.log('Bu pencereyi kapatınca test biter; oyun sekmesi yenilenince ürün sürümü yüklenir.');
  });
