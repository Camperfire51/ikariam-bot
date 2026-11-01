// Yeni sürüm yayınlar: version.json'u manifest.json'daki dosya listesiyle ve yeni sürüm numarasıyla yazar,
// commit'ler ve GitHub'a gönderir. GitHub Pages birkaç dakika içinde yeni sürümü yayına alır.
// Kullanım: node release.js "ne değişti"
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts[0].js;
for (const f of files) if (!fs.existsSync(path.join(dir, f))) throw new Error('Dosya yok: ' + f);

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const version = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version, files }, null, 2) + '\n');

const msg = process.argv.slice(2).join(' ').trim() || 'Yeni sürüm';
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });
git('add', '-A');
git('commit', '-m', `Sürüm ${version}: ${msg}`);
git('push');
console.log(`\nSürüm ${version} gönderildi. Birkaç dakika içinde yayında olur; açık oyun sekmelerinde "Güncelleme var" uyarısı çıkar.`);
