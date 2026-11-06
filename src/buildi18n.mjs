import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url + '/../flagpkg/');
const c = require('i18n-iso-countries');
c.registerLocale(require('i18n-iso-countries/langs/fr.json'));
c.registerLocale(require('i18n-iso-countries/langs/ar.json'));
const t = JSON.parse(fs.readFileSync('wa/node_modules/world-atlas/countries-110m.json','utf8'));
const manual = { // not ISO-coded in the map data, or better-known short names
  'Kosovo': ['Kosovo','كوسوفو'], 'N. Cyprus': ['Chypre du Nord','شمال قبرص'], 'Somaliland': ['Somaliland','أرض الصومال'],
  'W. Sahara': ['Sahara occidental','الصحراء الغربية'],
};
const out = {};
for (const g of t.objects.countries.geometries){
  const n = g.properties.name;
  if (manual[n]) { out[n] = manual[n]; continue; }
  const a2 = g.id && c.numericToAlpha2(g.id);
  if (!a2) { console.log('no code', n); continue; }
  out[n] = [c.getName(a2, 'fr', {select:'alias'}) || c.getName(a2,'fr'), c.getName(a2, 'ar', {select:'alias'}) || c.getName(a2,'ar')];
}
fs.writeFileSync('countries_i18n.json', JSON.stringify(out));
for (const k of ['United States of America','United Kingdom','Russia','Dem. Rep. Congo','Congo','Côte d\'Ivoire','Morocco','eSwatini','Macedonia','Czechia','Iran','Syria','Vietnam','Laos','South Korea','North Korea','Bolivia','Venezuela','Tanzania','Moldova','Bosnia and Herz.','Central African Rep.','Palestine','Taiwan','Myanmar','Timor-Leste','Netherlands','Falkland Is.','Turkey','Brunei']) console.log(k, '→', out[k]);
