# Stalactite — Angular

An Angular port of the Elm app in the parent directory. Same physics, same scene,
same instrument panel; the model is reproduced formula-for-formula and pinned to
the Elm build by a parity test.

One of four implementations of the same thing, alongside
[Elm](https://github.com/leocrapart-pixel/stalactite),
[SvelteKit](https://github.com/leocrapart-pixel/stalactite-svelte) and
[Vue](https://github.com/leocrapart-pixel/stalactite-vue).

## Run it

```sh
npm install
npm start          # ng serve -> http://localhost:4200
npm run build      # ng build -> dist/
npm test           # physics parity + renderer tests
```

Angular 22 requires Node `^22.22.3 || ^24.15.0 || >=26`, and TypeScript 6
(`>=6.0 <6.1`) — the framework's own peer requirement, not a choice made here.

## What is ported

| Elm | Angular |
| --- | --- |
| `src/Physics.elm` | `src/app/core/model.ts` |
| `src/Canvas.elm` | `src/app/render/canvas.ts` |
| `src/Scene.elm` | `src/app/render/scene.ts` |
| `src/Ui.elm` | `src/app/ui/theme.ts`, `src/app/ui/slider.ts` |
| `src/Main.elm` | `src/app/app.ts`, `src/app/app.html` |
| `js/main.js` | folded into the component as an `effect` |

The physics and renderer modules are **byte-identical to the SvelteKit port's** —
they are plain TypeScript with no framework imports, so both projects share the
same verified core. Only the view layer differs.

Angular specifics worth noting:

- **Zoneless.** The app bootstraps with `provideZonelessChangeDetection()`. The
  animation loop writes signals, and signals are what schedule change detection,
  so `zone.js` never has to monkey-patch the browser to notice. Nothing mutates
  state behind Angular's back.
- **Signals throughout.** `signal` for state, `computed` for everything derived
  (`view`, the scene, the chart bars, the log-scale slider positions). The log
  mappings live in `setRateFromSlider` / `setIntervalFromSlider` rather than in
  the template, because they invert a cube and an exponent.
- **The scene stays a value.** `Scene.draw()` returns a list of `Shape` records
  and a single `effect` hands it to `draw()`. The template never touches a canvas
  context, which is what makes the renderer testable without a browser.
- **`OnPush`** on both components, and the two-way slider binding uses a signal
  `model()` input.

## What this version adds

The physics core is identical to the SvelteKit port's, so the three implementations
show the same cave. These are Angular-side additions on top of that shared core:

- **Shareable URLs.** The whole scenario — chemistry, chamber, time-lapse speed,
  how far the formation has grown, whether it is running — fits in the hash, so a
  link reproduces the cave exactly. The formation is restored by seeding the
  deposited volume rather than replaying history, because the shape is a pure
  function of that volume. The header shows `Custom` once a URL has overridden a
  preset.
- **Keyboard control.** `space` run/pause, `r` new stalactite, `y` year bands,
  `←`/`→` time-lapse speed. Keys are ignored while a control has focus, so typing
  in a field never triggers them.
- **A responsive canvas.** The chamber is drawn at its measured size instead of
  being stretched from a fixed 620 px, with the backing store scaled by the device
  pixel ratio.
- **The slenderness row** (`thickness ÷ length`) that the Elm version had and both
  TypeScript ports were missing.

## The parity test

`tests/physics.test.ts` compares this port against values emitted from the Elm
build, so it checks two independent implementations of the same equations rather
than the port against itself. `tests/golden.json` was generated from the Elm.

It covers the constants, the whole film family, the carbonate chemistry (the
bisection is the delicate part — a wrong bracket still converges, just to a
different root), the geometry, the integration, every `view` field, the per-frame
animation loop, and conservation:

```
96/96 checks passed
port matches the Elm model
```

Tolerances are relative and set at 1e-12. These are physics results carried
through `Math.exp` and `Math.cbrt`, so bit-exactness is not a fair bar; anything
above one part in 1e12 means the formulas differ rather than the arithmetic.

`tests/render.test.ts` exercises the renderer against a recording 2D context:
every primitive kind, the device-pixel-ratio backing store, and that a dashed
stroke does not leak into the next shape.

The built app was also loaded in a headless DOM: Angular bootstraps, the panel
renders ~3.2 kB of text, and the canvas receives ~1,100 fills, ~2,700 strokes and
~156 text draws per scene. The readouts it prints match the Elm exactly —
29.1 µm film, 5.418 mm wetted perimeter, 10.68 min residence, 0.047 Reynolds,
saturation index 0.3.

## Bugs found while porting

Comparing implementations found three real defects, all fixed in **every**
version and documented in the [SvelteKit README](../svelte/README.md):

1. The cone's stored radius array used the wrong slope, so `volumeOf` disagreed
   with the closed-form shape law.
2. The seed nub contributed no calcite, so a fresh stalactite reported a length
   of zero and the seed vanished.
3. The grid span was unbounded, so growth past 1.28 m was invisible while the
   shape law still reported a longer formation.

## Deployed

Live at **https://stalactite-angular.stalactite.workers.dev**, alongside
[Elm](https://stalactite.stalactite.workers.dev),
[SvelteKit](https://stalactite-svelte.stalactite.workers.dev) and
[Vue](https://stalactite-vue.stalactite.workers.dev).

`wrangler.jsonc` deploys it as a Worker serving static assets, the same pattern
as the other two, under its own name (`stalactite-angular`) so all three run side
by side.

```sh
export CLOUDFLARE_API_TOKEN=...      # token with the "Edit Cloudflare Workers" template
export CLOUDFLARE_ACCOUNT_ID=...     # `npx wrangler whoami` prints it
npm run build && npx wrangler deploy
npm run verify:deploy                # confirm live == dist/
```

`verify:deploy` fetches the shell and every asset it references from the live
site and compares them against `dist/`. It exists because "the deploy succeeded"
and "the deploy is correct" are different claims.

## Caveats

Same as the other versions: one stalactite receives the whole drip, so the rates
are upper bounds; `k` is a slider because the effective exchange velocity over a
whole formation is far below laboratory thin-film values; the tip profile is
tracked by radius rather than solved as a free-boundary problem; stalagmites and
columns are scenery.
