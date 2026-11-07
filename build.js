// Builds index.html from src/. No dependencies: `node build.js`
const fs = require('fs');
const rd = f => fs.readFileSync(f, 'utf8');
const config = JSON.parse(rd('site.config.json')); // convexUrl: the leaderboard's Convex deployment
const DESC = 'Globe by Abisto — a free geography game: flags, countries, capitals and cities. Three lives, no sign-up, English, French and Arabic.';
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Globe by Abisto</title>
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#8fc6ea" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c3a5e" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="Globe by Abisto">
<meta property="og:description" content="${DESC}">
<meta property="og:type" content="website">
<meta property="og:image" content="icons/share.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="icons/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Globe">
<style>
:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px system-ui,sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style>
`;
// fonts bundled with the site (no request to Google), so the game also looks right offline
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATINEXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const CYRILLICEXT = 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F';
const ARABIC = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
const face = (fam, file, w, range, extra = '') => `@font-face{font-family:"${fam}";font-style:normal;font-display:swap;font-weight:${w};${extra}src:url(fonts/${file}) format("woff2");unicode-range:${range}}`;
const fontCSS = [
  face('Bricolage Grotesque', 'bricolage-grotesque-latin-standard-normal.woff2', '200 800', LATIN, 'font-stretch:75% 100%;'),
  face('Bricolage Grotesque', 'bricolage-grotesque-latin-ext-standard-normal.woff2', '200 800', LATINEXT, 'font-stretch:75% 100%;'),
  ...[500, 600].flatMap(w => [face('IBM Plex Mono', `ibm-plex-mono-latin-${w}-normal.woff2`, w, LATIN), face('IBM Plex Mono', `ibm-plex-mono-latin-ext-${w}-normal.woff2`, w, LATINEXT),
    face('IBM Plex Mono', `ibm-plex-mono-cyrillic-${w}-normal.woff2`, w, CYRILLIC), face('IBM Plex Mono', `ibm-plex-mono-cyrillic-ext-${w}-normal.woff2`, w, CYRILLICEXT)]),
  ...[400, 500, 600, 700].map(w => face('IBM Plex Sans Arabic', `ibm-plex-sans-arabic-arabic-${w}-normal.woff2`, w, ARABIC)),
].join('\n');
// sponsor: { name, url, logo } in site.config.json; the logo file is embedded so it also shows offline
function sponsorJSON(){
  const sp = config.sponsor;
  if (!sp || !sp.url || !sp.logo) return 'null';
  const embed = f => {
    const mime = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[f.split('.').pop().toLowerCase()];
    if (!mime) throw new Error('sponsor logo must be svg, png, jpg or webp');
    return `data:${mime};base64,` + fs.readFileSync(f).toString('base64');
  };
  // logoDark (optional): a light-on-dark version for dark mode
  return JSON.stringify({ name: sp.name || '', url: sp.url, logo: embed(sp.logo), logoDark: sp.logoDark ? embed(sp.logoDark) : '' }).replace(/</g, '\\u003c');
}
const logo = 'data:image/webp;base64,' + fs.readFileSync('src/logo/big.webp').toString('base64');
let body = rd('src/game.src.html')
  .replace(/<title>[^<]*<\/title>\n/, '')
  .replace(/<link rel="preconnect"[^>]*>\n/, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis[^>]*>\n/, () => '<style>\n' + fontCSS + '\n</style>\n')
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n/, '')
  .replace('__TOPO__', () => rd('src/data/countries-110m.json'))
  .replace('__FLAGS__', () => rd('src/data/flags.json'))
  .replace('__PLACES_I18N__', () => rd('src/data/places_i18n.json'))
  .replace('__COUNTRIES_I18N__', () => rd('src/data/countries_i18n.json'))
  .replace(/__LOGO_(BIG|SMALL)__/g, () => logo)
  .replace(/__WORD_(EN|AR|RU)__/g, (_, l) => 'data:image/webp;base64,' + fs.readFileSync('src/logo/word-' + l.toLowerCase() + '.webp').toString('base64'))
  .replace('__CONVEX_URL__', () => (process.env.CONVEX_URL || config.convexUrl || '').trim())
  .replace('__SPONSOR__', () => sponsorJSON())
  // bundle the two libraries so the game also works offline from the home screen
  .replace(/<script src="[^"]*d3[^"]*"><\/script>/, () => '<script>' + rd('src/vendor/d3.min.js') + '</script>')
  .replace(/<script src="[^"]*topojson[^"]*"><\/script>/, () => '<script>' + rd('src/vendor/topojson-client.min.js') + '</script>');
if (/<script src=/.test(body)) throw new Error('external script left in page');
if (/fonts\.googleapis/.test(body)) throw new Error('Google Fonts link left in page');
if (/__[A-Z_]+__/.test(body.replace(/__proto__/g, ''))) throw new Error('placeholder left in page');
// font links and the game's styles go in <head>; markup and scripts in <body>
const i = body.indexOf('</style>') + '</style>'.length;
fs.writeFileSync('index.html', head + body.slice(0, i) + '</head>\n<body>\n' + body.slice(i) + '\n</body>\n</html>\n');
console.log('index.html', (fs.statSync('index.html').size / 1048576).toFixed(2), 'MB');

// Offline copy: sw.js lists every file the game needs. Its cache name changes with each build,
// so phones fetch the new version in the background and use it the next time the game opens.
const crypto = require('crypto');
const files = ['./', 'index.html', 'manifest.webmanifest',
  ...fs.readdirSync('icons').map(f => 'icons/' + f), ...fs.readdirSync('fonts').map(f => 'fonts/' + f)];
const hash = crypto.createHash('sha256');
for (const f of files.slice(1)) hash.update(fs.readFileSync(f));
const version = hash.digest('hex').slice(0, 12);
fs.writeFileSync('sw.js', rd('src/sw.template.js').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files, null, 2)));
console.log('sw.js', version, files.length, 'files');
