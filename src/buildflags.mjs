import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url + '/../flagpkg/');
const c = require('i18n-iso-countries');
const { optimize } = require('svgo');
const t = JSON.parse(fs.readFileSync('wa/node_modules/world-atlas/countries-110m.json','utf8'));
const skip = new Set(['Antarctica','W. Sahara','N. Cyprus','Somaliland']);
const out = {}; let total = 0; const sizes = [];
for (const g of t.objects.countries.geometries){
  const n = g.properties.name; if (skip.has(n)) continue;
  const a2 = n === 'Kosovo' ? 'xk' : (g.id && c.numericToAlpha2(g.id) || '').toLowerCase();
  const f = `flagpkg/node_modules/flag-icons/flags/4x3/${a2}.svg`;
  if (!a2 || !fs.existsSync(f)) { console.log('no flag', n, a2); continue; }
  const svg = optimize(fs.readFileSync(f,'utf8'), {multipass:true, floatPrecision:1, plugins:[{name:'preset-default', params:{overrides:{removeViewBox:false}}}]}).data;
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  out[n] = uri; total += uri.length; sizes.push([uri.length, n]);
}
fs.writeFileSync('flags.json', JSON.stringify(out));
sizes.sort((a,b)=>b[0]-a[0]);
console.log(Object.keys(out).length, 'flags,', (total/1024).toFixed(0), 'KB; biggest:', sizes.slice(0,5).map(s=>s[1]+' '+(s[0]/1024).toFixed(0)+'KB').join(', '));
