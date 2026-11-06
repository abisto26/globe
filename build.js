// Builds index.html from src/. No dependencies: `node build.js`
const fs = require('fs');
const rd = f => fs.readFileSync(f, 'utf8');
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
const logo = 'data:image/webp;base64,' + fs.readFileSync('src/logo/big.webp').toString('base64');
let body = rd('src/game.src.html')
  .replace(/<title>[^<]*<\/title>\n/, '')
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n/, '')
  .replace('__TOPO__', () => rd('src/data/countries-110m.json'))
  .replace('__FLAGS__', () => rd('src/data/flags.json'))
  .replace('__PLACES_I18N__', () => rd('src/data/places_i18n.json'))
  .replace('__COUNTRIES_I18N__', () => rd('src/data/countries_i18n.json'))
  .replace(/__LOGO_(BIG|SMALL)__/g, () => logo)
  // bundle the two libraries so the game also works offline from the home screen
  .replace(/<script src="[^"]*d3[^"]*"><\/script>/, () => '<script>' + rd('src/vendor/d3.min.js') + '</script>')
  .replace(/<script src="[^"]*topojson[^"]*"><\/script>/, () => '<script>' + rd('src/vendor/topojson-client.min.js') + '</script>');
if (/<script src=/.test(body)) throw new Error('external script left in page');
if (/__[A-Z_]+__/.test(body.replace(/__proto__/g, ''))) throw new Error('placeholder left in page');
// font links and the game's styles go in <head>; markup and scripts in <body>
const i = body.indexOf('</style>') + '</style>'.length;
fs.writeFileSync('index.html', head + body.slice(0, i) + '</head>\n<body>\n' + body.slice(i) + '\n</body>\n</html>\n');
console.log('index.html', (fs.statSync('index.html').size / 1048576).toFixed(2), 'MB');
