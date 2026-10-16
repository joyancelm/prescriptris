# Prescriptris — The Night Shift

A retro pharmacy falling-block puzzle. Stack pill blocks, clear rows, and choose when to bottle matching batches. The custom block wordmark, arcade pixel font, pharmacy artwork, and medication sprites are stored locally; there are no runtime packages, external font requests, or paid API calls.

## Run locally

Use Node.js 20 or newer. No package installation is necessary.

```powershell
npm start
```

Open http://127.0.0.1:8766. To use another port, set `$env:PORT = '8767'` before starting. Serve the files over HTTP; opening `index.html` directly from disk does not support the JavaScript modules. The root remains a buildless static site compatible with GitHub Pages and the existing `CNAME`.

## Publish

The existing public site is https://www.prescriptris.com, served by GitHub Pages from this repository's `main` branch at the root. Run `npm test` and `npm run check`, then commit and push the reviewed source and assets to `main`. No package installation or production build is required. Keep `CNAME` and `.nojekyll` in the published root. After Pages finishes deploying, check that the live title, JavaScript modules, fonts, and artwork load and that a game can start.

## Play

Choose **START GAME** or press **Enter**. Nothing falls until you begin.

| Action | Keyboard | Touch / mouse |
| --- | --- | --- |
| Move | Left / Right or A / D | Arrow buttons; hold to repeat |
| Rotate clockwise | Up or X | Rotate button |
| Rotate counterclockwise | Z | — |
| Soft drop | Down or S; hold | Down button; hold |
| Hard drop and clear rows | Space | Drop button |
| Bottle and hard drop | B | Bottle + drop button |
| Hold / swap | C or Shift | Hold / swap button |
| Pause / resume | P or Escape | Pause / Resume |
| Start / continue / play again | Enter | START GAME / CONTINUE / PLAY AGAIN |
| Toggle audio | M | Sound button |

Holding and rotating are limited to deliberate presses. Hold is available once per piece. Repeated drop keys cannot restart a finished shift. The most recently held horizontal direction takes priority; releasing it resumes the other held direction. Gameplay buttons return keyboard focus to the tray, so Space remains a normal hard drop after bottling. The page pauses automatically when it loses focus or becomes hidden.

## Rules and scoring

- A full horizontal row clears regardless of pill type. Surviving rows move down without losing or overwriting pills.
- A matching square is a 2×2, 3×3, or 4×4 region containing the same pill type: red/cream capsules, scored white round tablets, or scored blue oblong caplets. Each has a distinct real-world medication shape, so matching does not depend on color alone.
- **Space / Drop** leaves matching squares on the board so you can build larger batches. It clears full rows normally.
- **B / Bottle + drop** places the current piece, collects the largest non-overlapping matching squares first, settles all loose pills down their columns, then clears full rows. There is no automatic bottle chain; new matches can be collected on a later bottle drop.
- The gold dashed outline and bottle button preview show batches available after dropping at the ghost position. The preview covers bottle points; drop, row, and prescription points are additional.
- Bottles: 2×2 = **80**, 3×3 = **240**, 4×4 = **600**, multiplied by the current level, awarded once.
- Rows: **100 / 300 / 500 / 800** for 1 / 2 / 3 / 4 at once, multiplied by the current level. Bottle collapses clearing more than four rows score groups of four plus the remainder.
- Soft drop gives **1 point per cell**; hard drop gives **2 per cell**.
- Filling the current prescription gives **200 × level** and starts the next objective. Only the current objective earns progress; excess progress is not carried to the next one.
- Every **10 cleared rows** increases the level. Gravity starts at **700 ms per cell**, gradually speeding up to a **90 ms** floor. Pieces have a **450 ms lock delay**, measured from actual ground contact, with at most **15 movement/rotation resets**, and bounded wall/floor kicks.
- Piece shapes come from shuffled seven-piece bags. The next three pieces are visible. Hold resets rotation and checks for blocked spawns on both first hold and subsequent swaps.

## Presentation and resilience

The interface takes its visual cues from early console falling-block games: original block lettering with a warm face and blue extrusion, a black well, silver and blue panel frames, pixel score digits, a line counter above the tray, and READY / PAUSED / GAME OVER screens. Starting a game compacts the marquee to give the playfield more vertical room. The frame accent cycles through four restrained palettes as levels increase; medication colors remain consistent.

The STATISTICS panel counts completed placements of the seven piece shapes. Holding does not increase these counts, and a new game resets them. NEXT emphasizes the immediate upcoming piece and shows two smaller previews below it. The current prescription remains visible in a compact Rx panel; the bottling recipe is under How to play. On phones and tablets up to 820 CSS pixels wide, hold, score, and next stay beside the tray, while the prescription and help move below. Detailed statistics are hidden at these widths. Phone controls use two rows with targets at least 44 pixels tall. The page scrolls instead of clipping, and the pharmacist has a separate space. Starting a new shift returns to the top after compacting the marquee; pause and game-over hints describe the relevant action.

Pills fill about 98% of the available cell interior along their widest visible dimension, retaining their capsule, round tablet, or oblong caplet shapes. A 12-frame pixel-art spin makes one turn every 1.8 seconds across active, locked, ghost, hold, and next pieces. Rotations are cached once and fitted using their visible alpha bounds, so pills stay large without overlapping neighboring cells. Spin freezes on pause or game over and switches off with CRT/motion effects or the system's reduced-motion preference. The animation does not affect piece rotation or collisions.

Sound defaults off and initializes only after an interaction. CRT effects can be toggled on all screen sizes. The operating system's reduced-motion preference disables CRT and motion effects, including their toggle, on all screen sizes. Scores and preferences are stored locally when storage is available; blocked storage does not prevent play. The existing `prescriptris_high` record is preserved, and open tabs synchronize it without replacing a newer record with an older score. High scores are saved at piece locks, game over, and page exit, rather than each animation frame. Pharmacist and bottle effects retain the source artwork's aspect ratio.

Image loading has error and timeout handling. Missing art falls back to simple tiles and an Rx emblem with a visible notice. The game does not wait for art to become playable. Production analytics retain the existing measurement ID and load only on the two `prescriptris.com` hostnames, never in the local preview.

## Source and art

- `game-engine.js`: rendering-independent board, collision, timing, scoring, and prescription rules.
- `game-input.js`: horizontal key/pointer repeat timing and held-direction priority.
- `game.js`: canvas rendering, DOM UI, keyboard/pointer controls, sound, storage, and asset fallbacks.
- `styles.css`: responsive layout and retro pharmacy presentation.
- `assets/v2/prescriptris-wordmark.svg`: original vector block wordmark, generated by `npm run art:logo` from `scripts/build-wordmark.js`.
- `assets/fonts/`: locally bundled [Press Start 2P](https://github.com/google/fonts/tree/main/ofl/pressstart2p), with its SIL Open Font License and FONTLOG. The title uses original vector glyphs rather than this body font.
- `assets/v2/`: active replacement artwork. See `assets/v2/ART.md` for generation prompts and atlas details.
- `assets/sprites/` and `old.html`: retained legacy material; the current game does not load these images.
- `scripts/serve.js`: a loopback-only development server.

## Verification

```powershell
npm test
npm run check
```

The engine and input suites cover row preservation, multiple-row clears, both blocked hold paths, placement statistics, defensive locking, manual bottle scoring, 4×4 construction, matching rules, gravity after bottling, orders, levels, seven-piece bags, wall kicks, frame-independent lock timing, paused input, large collapses, randomized play, directional handoff, pointer/keyboard overlap, and clearing held input on pause.

For browser QA: start a game with Enter or START GAME; exercise movement, rotate, hold, both drop actions, pause/continue, sound, and touch buttons. Check placement statistics against locked pieces. Finish a game and verify an arrow key does not restart it; choose PLAY AGAIN. Check both desktop and narrow layouts for overlap and horizontal overflow. The engine is intentionally not exposed as a mutable browser debug global.
