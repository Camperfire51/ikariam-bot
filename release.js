// Sürüm gönderme. İki kanal var, ikisi de GitHub Pages'ten yüklenir:
//   node release.js test "ne değişti"   → test kanalı: src/ olduğu gibi gönderilir, beta.json yenilenir.
//                                          Sadece TEST yükleyicisi kurulu bilgisayar (geliştirici) bu sürümü alır.
//   node release.js yayinla "ne değişti" → ürün: src/ dosyaları prod/src/ altına kopyalanır, version.json yenilenir.
//                                          Herkes bu sürümü alır.
// Ürün dosyaları ayrı bir kopyada durduğu için test gönderimleri ürünü hiç etkilemez.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const [mode, ...rest] = process.argv.slice(2);
if (mode !== 'test' && mode !== 'yayinla') {
  console.error('Kullanım: node release.js test "ne değişti"   ya da   node release.js yayinla "ne değişti"');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;
for (const f of files) if (!fs.existsSync(path.join(dir, f))) throw new Error('Dosya yok: ' + f);

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2) + '\n');

let version;
if (mode === 'test') {
  version = 'test-' + stamp;
  write('beta.json', { version, files });
} else {
  version = stamp;
  // Ürün kopyası: eski ürün dosyaları silinip src/'nin şimdiki hâli kopyalanır.
  fs.rmSync(path.join(dir, 'prod'), { recursive: true, force: true });
  for (const f of files) {
    const to = path.join(dir, 'prod', f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(dir, f), to);
  }
  write('version.json', { version, files: files.map((f) => 'prod/' + f) });
  // Test kanalı da yayınlanan sürüme eşitlenir (test bilgisayarı "güncelleme var" görmez, aynı kodu çalıştırır).
  write('beta.json', { version: 'test-' + stamp, files });
}

const msg = rest.join(' ').trim() || (mode === 'test' ? 'Test sürümü' : 'Yeni sürüm');
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });
git('add', '-A');
git('commit', '-m', `${mode === 'test' ? 'Test' : 'Yayın'} ${version}: ${msg}`);
git('push');
console.log(
  `\n${mode === 'test' ? 'Test sürümü' : 'Ürün sürümü'} ${version} gönderildi. Birkaç dakika içinde yayında olur; ` +
    (mode === 'test' ? 'TEST yükleyicili bilgisayarda "güncelleme var" uyarısı çıkar.' : 'herkeste "güncelleme var" uyarısı çıkar.')
);
