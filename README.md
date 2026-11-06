# Globe by Abisto · العالم مع Abisto

A free geography game that runs in the browser. Open it and you're playing: no sign-up, no install.

**Play:** https://abistoufisbot.github.io/Globe-by-Abisto/

## Games
| | Easy | Pro |
|---|---|---|
| **Flags** | Pick the country from 4 | Tap it on the map |
| **Countries** | Pick from 4 neighbours | — |
| **Capitals** | 4 nearby capitals | 4 cities from the same country |
| **Cities** | Map zoomed to the country | Within 1000 km |

Plus **Explore**: tap any country to see its flag, capital and biggest cities.

- Three lives. Every 10 right answers in a row gives a life back. Get 3 or more right to win the 🏅.
- English, French and Arabic (right-to-left).
- Light and dark mode. Can be added to the home screen as an app.

## Files
- `index.html`: the whole game in one file (built; don't edit it by hand).
- `src/game.src.html`: the source you edit.
- `src/data/`: map, flags and translated names. `src/vendor/`: d3 and topojson.
- `build.js`: run `node build.js` after editing `src/` to rebuild `index.html`.
- `icons/`, `manifest.webmanifest`: home-screen icons and app info.

## Notes
The leaderboard uses the claude.ai artifact runtime, so it only works in the claude.ai version. Everywhere else the game is fully playable and the leaderboard shows a short note.

## Credits
- Map: [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth, public domain), ISC
- [D3](https://d3js.org) and [topojson-client](https://github.com/topojson/topojson-client), ISC
- Flags: [flag-icons](https://github.com/lipis/flag-icons), MIT
- Fonts: Bricolage Grotesque, IBM Plex Mono and IBM Plex Sans Arabic via Google Fonts (SIL Open Font License)

Licence texts are in `licenses/`.
