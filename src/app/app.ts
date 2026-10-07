import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	computed,
	effect,
	inject,
	signal,
	viewChild
} from '@angular/core';

import * as P from './core/model.ts';
import * as Scene from './render/scene.ts';
import { draw } from './render/canvas.ts';
import * as T from './ui/theme.ts';
import { Slider } from './ui/slider.ts';

interface Preset {
	name: string;
	blurb: string;
	env: P.Env;
	stalagmiteM: number;
	chamberM: number;
}

/**
 * Stalactite — how a cave formation actually grows.
 *
 * Water arrives at the tip, runs back up the surface as a thin gravity-driven
 * film, loses CO2 to the cave air, and precipitates calcite. Every mole of
 * calcium taken out of the film becomes one mole of calcite added to the solid,
 * so the growth rate is governed by the calcium the drip water can deliver and by
 * how fast the film can shed CO2.
 *
 * Nothing about the shape is imposed. The tapered profile emerges because the
 * water supply is fixed while the surface that water must cover widens with
 * radius.
 *
 * An Angular port of the Elm app. The physics in `core/model.ts` is
 * formula-for-formula the same and is pinned to it by `tests/physics.test.ts`.
 */
@Component({
	selector: 'app-root',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [Slider],
	templateUrl: './app.html'
})
export class App {
	// --- presets -------------------------------------------------------------

	readonly presets: Preset[] = [
		{
			name: 'Cave chamber',
			blurb:
				'A steady, well-fed drip: half a millimole of excess lime, one drop every 42 minutes.',
			env: {
				tempC: 10,
				cavePCO2: 6.0e-4,
				caIn: 1.0,
				dripRate: 2.0e-5,
				wetness: 0.25,
				kineticK: 5.0e-8,
				evaporation: 0,
				maxDepth: 1.6
			},
			stalagmiteM: 0.05,
			chamberM: 1.6
		},
		{
			name: 'Starving drip',
			blurb:
				'An old cave with almost no supply: dense, very hard calcite, and a very long wait.',
			env: {
				tempC: 11,
				cavePCO2: 5.0e-4,
				caIn: 0.72,
				dripRate: 3.0e-6,
				wetness: 0.15,
				kineticK: 5.0e-8,
				evaporation: 0,
				maxDepth: 1.6
			},
			stalagmiteM: 0.03,
			chamberM: 1.6
		},
		{
			name: 'Well fed',
			blurb:
				'Plenty of water and lime. This one builds a metre in a few hundred thousand years.',
			env: {
				tempC: 12,
				cavePCO2: 6.0e-4,
				caIn: 1.6,
				dripRate: 5.0e-4,
				wetness: 0.35,
				kineticK: 8.0e-8,
				evaporation: 0,
				maxDepth: 1.6
			},
			stalagmiteM: 0.1,
			chamberM: 1.6
		},
		{
			name: 'Tropical cave',
			blurb:
				'Warm water holds less CO₂ and calcite kinetics run faster, but the extra CO₂ in the air works against it.',
			env: {
				tempC: 22,
				cavePCO2: 9.0e-4,
				caIn: 1.7,
				dripRate: 1.5e-4,
				wetness: 0.3,
				kineticK: 6.0e-8,
				evaporation: 0,
				maxDepth: 1.6
			},
			stalagmiteM: 0.06,
			chamberM: 1.6
		},
		{
			name: 'Drafty passage',
			blurb: 'Dry air sweeps through, so evaporation deposits calcite alongside degassing.',
			env: {
				tempC: 9,
				cavePCO2: 3.0e-4,
				caIn: 1.1,
				dripRate: 4.0e-5,
				wetness: 0.2,
				kineticK: 5.0e-8,
				evaporation: 0.6,
				maxDepth: 1.6
			},
			stalagmiteM: 0.04,
			chamberM: 1.6
		},
		{
			name: 'Undersaturated',
			blurb: 'Drip water poorer in lime than cave air allows. Nothing can be deposited at all.',
			env: {
				tempC: 10,
				cavePCO2: 3.0e-3,
				caIn: 0.7,
				dripRate: 2.0e-5,
				wetness: 0.25,
				kineticK: 5.0e-8,
				evaporation: 0,
				maxDepth: 1.6
			},
			stalagmiteM: 0.0,
			chamberM: 1.6
		}
	];

	// --- state ---------------------------------------------------------------

	readonly presetName = signal(this.presets[0].name);
	readonly env = signal<P.Env>({ ...this.presets[0].env });
	readonly sim = signal<P.Sim>(P.initialSim());
	readonly running = signal(true);

	/** simulated years per real second */
	readonly speed = signal(80000);
	readonly clock = signal(0);
	readonly showRings = signal(true);
	readonly stalagmiteM = signal(this.presets[0].stalagmiteM);
	readonly chamberM = signal(this.presets[0].chamberM);
	readonly history = signal<Array<[number, number]>>([[0, P.seedRadius * 1000]]);

	private lastSample = 0;

	// --- derived -------------------------------------------------------------

	readonly view = computed(() => P.view(this.env(), this.sim()));
	readonly warning = computed(() => this.view().saturationIndex <= 0.05);
	readonly dripInterval = computed(() => P.dripIntervalFromRate(this.env().dripRate));

	// --- log-scale slider mappings, matching the Elm -------------------------

	private static readonly rateMin = 5.0e-7;
	private static readonly rateMax = 2.0e-3;
	private static readonly intervalMin = 100.0;
	private static readonly intervalMax = 8.0e5;

	readonly rateSlider = computed(() => {
		const r = this.env().dripRate;
		const clamped = Math.min(Math.max(r, App.rateMin), App.rateMax);
		return Math.min(Math.max((clamped / App.rateMin) ** (1 / 3) - 1, 0), 1);
	});

	readonly intervalSlider = computed(() => {
		const s = this.dripInterval();
		const clamped = Math.min(Math.max(s, App.intervalMin), App.intervalMax);
		return Math.min(
			Math.max(Math.log10(clamped / App.intervalMin) / Math.log10(App.intervalMax / App.intervalMin), 0),
			1
		);
	});

	/** Field updates keep the env object immutable so signals fire. */
	setField<K extends keyof P.Env>(key: K, value: P.Env[K]): void {
		this.env.update((e) => ({ ...e, [key]: value }));
	}

	setRateFromSlider(x: number): void {
		this.setField('dripRate', App.rateMin * (1 + Math.min(Math.max(x, 0), 1)) ** 3);
	}

	setIntervalFromSlider(x: number): void {
		const seconds = App.intervalMin * (App.intervalMax / App.intervalMin) ** Math.min(Math.max(x, 0), 1);
		this.setField('dripRate', P.dripRateFromInterval(seconds));
	}

	// --- animation -----------------------------------------------------------

	private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('stage');

	/**
	 * The scene's authored width, in CSS pixels. The canvas fills its column and
	 * this tracks the measured size, so the chamber is drawn at native resolution
	 * instead of being stretched from a fixed 620 px.
	 */
	private readonly sceneW = signal(620);
	private readonly sceneH = signal(720);

	constructor() {
		// The scene is a value, rebuilt whenever anything it depends on changes.
		const scene = computed(() =>
			Scene.draw({
				w: this.sceneW(),
				h: this.sceneH(),
				env: this.env(),
				sim: this.sim(),
				time: this.clock(),
				chamberM: this.chamberM(),
				showRings: this.showRings(),
				stalagmiteM: this.stalagmiteM()
			})
		);

		// Draw whenever the scene changes. An effect runs after the view is
		// updated, so the canvas element exists by the time this reads it.
		effect(() => {
			const el = this.canvasRef()?.nativeElement;
			if (el) draw(el, scene());
		});

		// Track the canvas box so the chamber is drawn at the size it is shown at.
		// The height follows from a fixed aspect ratio rather than from the current
		// width and height: deriving it from both would compound on every resize,
		// because each measurement would use the ratio it had just changed.
		const SCENE_ASPECT = this.sceneH() / this.sceneW();

		effect((onCleanup) => {
			const el = this.canvasRef()?.nativeElement;
			if (!el) return;

			const measure = () => {
				const box = el.getBoundingClientRect();
				const w = Math.max(320, Math.round(box.width));
				if (w === this.sceneW()) return;
				this.sceneW.set(w);
				this.sceneH.set(Math.round(w * SCENE_ASPECT));
			};

			const observer = new ResizeObserver(measure);
			observer.observe(el);
			measure();
			onCleanup(() => observer.disconnect());
		});

		const destroyRef = inject(DestroyRef);
		this.installUrlSync();
		this.installKeyboardShortcuts();
		let raf = 0;
		let last = performance.now();

		const frame = (now: number) => {
			const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
			last = now;
			this.clock.update((c) => c + dt);

			if (this.running()) {
				const slice = Math.min(this.speed() * dt, 40000);
				const next = P.advance(P.defaultParams, this.env(), slice, this.sim());
				this.sim.set(next);

				const grain = Math.max(500.0, next.years / 140);
				if (next.years - this.lastSample >= grain) {
					this.lastSample = next.years;
					const point: [number, number] = [
						next.years,
						P.profileAtDepth(P.lengthOf(next), next) * 1000
					];
					this.history.update((h) => [...h, point].slice(-140));
				}
			}
			raf = requestAnimationFrame(frame);
		};

		raf = requestAnimationFrame(frame);
		destroyRef.onDestroy(() => cancelAnimationFrame(raf));
	}

	// --- actions -------------------------------------------------------------

	applyPreset(p: Preset): void {
		this.presetName.set(p.name);
		this.env.set({ ...p.env });
		this.sim.set(P.initialSim());
		this.history.set([[0, P.seedRadius * 1000]]);
		this.lastSample = 0;
		this.stalagmiteM.set(p.stalagmiteM);
		this.chamberM.set(p.chamberM);
	}

	newStalactite(): void {
		this.sim.update((s) => P.resetSim(s));
		this.history.set([[0, P.seedRadius * 1000]]);
		this.lastSample = 0;
	}

	// --- growth chart --------------------------------------------------------

	readonly chartYMax = computed(() => Math.max(3.0, ...this.history().map((h) => h[1])));

	readonly bars = computed(() => {
		const yMax = this.chartYMax();
		const h = this.history();
		return h.map((p, i) => ({
			heightPct: Math.max(1, Math.min(Math.max(p[1] / yMax, 0), 1) * 100),
			alpha: 0.25 + 0.6 * ((i + 1) / h.length)
		}));
	});

	// --- shareable URL -------------------------------------------------------
	//
	// The whole scenario fits in a few numbers, so the hash carries it: a link
	// reproduces the cave exactly, including how far the formation had grown.
	// Nothing here touches the physics; it only reads and writes signals.

	private static readonly HASH_KEY = 'c';

	/** Serialise: env in a fixed order, then the run-level settings. */
	private toHash(): string {
		const e = this.env();
		return [
			e.tempC,
			e.cavePCO2,
			e.caIn,
			e.dripRate,
			e.wetness,
			e.kineticK,
			e.evaporation,
			this.chamberM(),
			this.speed(),
			Math.round(this.sim().years),
			this.running() ? 1 : 0,
			this.showRings() ? 1 : 0
		].join(',');
	}

	private fromHash(raw: string): boolean {
		const parts = raw.split(',').map(Number);
		if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) return false;

		const [tempC, cavePCO2, caIn, dripRate, wetness, kineticK, evaporation, chamberM, speed, years, running, rings] =
			parts;

		this.env.set({
			tempC,
			cavePCO2,
			caIn,
			dripRate,
			wetness,
			kineticK,
			evaporation,
			maxDepth: 1.6
		});
		this.chamberM.set(chamberM);
		this.speed.set(speed);
		this.running.set(running !== 0);
		this.showRings.set(rings !== 0);
		this.presetName.set('Custom');

		// Rewind the formation to the shared length rather than replaying history:
		// the shape is a pure function of the deposited volume, so seeding it
		// directly gives the identical stalactite.
		if (years > 0) {
			this.sim.set(P.advance(P.defaultParams, this.env(), years, P.initialSim()));
		}
		return true;
	}

	private installUrlSync(): void {
		const read = () => {
			const hash = location.hash.replace(/^#/, '');
			if (!hash) return;
			const value = new URLSearchParams(hash).get(App.HASH_KEY);
			if (value) this.fromHash(value);
		};
		read();
		// Back/forward should restore the scenario the URL describes.
		const onPop = () => read();
		window.addEventListener('popstate', onPop);

		// Write back on change. Replacing rather than pushing keeps the back button
		// useful instead of filling history with every slider tick.
		let raf = 0;
		effect(() => {
			const payload = this.toHash();
			if (raf) cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const next = `#${App.HASH_KEY}=${payload}`;
				if (location.hash !== next) history.replaceState(null, '', next);
			});
		});

		inject(DestroyRef).onDestroy(() => {
			window.removeEventListener('popstate', onPop);
			if (raf) cancelAnimationFrame(raf);
		});
	}

	// --- keyboard ------------------------------------------------------------

	private installKeyboardShortcuts(): void {
		const onKey = (event: KeyboardEvent) => {
			const el = event.target as HTMLElement | null;
			// Never steal keys from a control the user is operating.
			if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;

			switch (event.key) {
				case ' ':
				case 'k':
					event.preventDefault();
					this.running.update((r) => !r);
					break;
				case 'r':
					this.newStalactite();
					break;
				case 'y':
					this.showRings.update((v) => !v);
					break;
				case 'ArrowRight':
					event.preventDefault();
					this.speed.update((s) => Math.min(s * 1.5, 2000000));
					break;
				case 'ArrowLeft':
					event.preventDefault();
					this.speed.update((s) => Math.max(s / 1.5, 1000));
					break;
			}
		};
		window.addEventListener('keydown', onKey);
		inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', onKey));
	}

	// --- template helpers ----------------------------------------------------
	//
	// The template reads live values through these, so they are plain fields
	// rather than pipes: a pipe would be re-created on every change detection
	// pass and would need to be pure to behave.

	readonly T = T;

	readonly pct = (x: number) => `${Math.min(Math.max(x, 0), 1) * 100}%`;
	readonly round2 = (x: number) => Math.round(x * 100) / 100;
	readonly round3 = (x: number) => Math.round(x * 1000) / 1000;

	/** Slider readouts. Several ignore the slider value and show the mapped one. */
	readonly metres = (x: number) => `${this.round2(x)} m`;
	readonly rateText = (_x: number) => T.formatRateText(this.env().dripRate);
	readonly intervalText = (_x: number) => T.formatInterval(this.dripInterval());
	readonly wetnessText = (x: number) => `${Math.round(x * 100)} % of circumference`;
	readonly calciumText = (x: number) => `${this.round2(x)} mmol / L`;
	readonly ppmText = (x: number) => `${Math.round(x * 1.0e6)} ppm`;
	readonly tempText = (x: number) => `${this.round2(x)} °C`;
	readonly kText = (x: number) => `${this.round3(x * 1.0e9)} nm / s`;
	readonly percentText = (x: number) => `${Math.round(x * 100)} %`;
}
