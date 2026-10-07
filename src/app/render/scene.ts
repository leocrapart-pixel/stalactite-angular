/**
 * Draws the cave chamber.
 *
 * Physical space is metres; this module maps it to canvas pixels. The chamber has
 * a fixed vertical extent, so the stalactite is seen to elongate against an
 * unchanging room rather than being rescaled on every frame. The chamber is
 * deeper than it is wide, which is how a cave passage actually looks.
 *
 * A direct port of the Elm `Scene` module.
 */

import * as C from './canvas.ts';
import * as P from '../core/model.ts';

export interface SceneOptions {
	w: number;
	h: number;
	env: P.Env;
	sim: P.Sim;
	/** seconds of wall-clock time, drives the drip animation */
	time: number;
	/** height of the modelled chamber, metres */
	chamberM: number;
	showRings: boolean;
	/** height of the floor boss below the drip, metres (0 = none) */
	stalagmiteM: number;
}

interface Layout {
	cx: number;
	ceilY: number;
	floorY: number;
	scale: number;
}

export function layout(opts: SceneOptions): Layout {
	const padTop = 52.0;
	const padBottom = 62.0;
	const usable = Math.max(120.0, opts.h - padTop - padBottom);
	return {
		cx: opts.w / 2.0,
		ceilY: padTop,
		floorY: padTop + usable,
		scale: usable / Math.max(opts.chamberM, 0.05)
	};
}

const toY = (l: Layout, depth: number) => l.ceilY + depth * l.scale;

/** Physical profile as a list of (depth below ceiling, radius). */
export function profilePoints(sim: P.Sim): Array<[number, number]> {
	return P.profilePoints(sim);
}

function gridStep(chamberM: number): number {
	if (chamberM <= 0.35) return 0.05;
	if (chamberM <= 0.9) return 0.1;
	if (chamberM <= 2.2) return 0.25;
	return 0.5;
}

const DIM = '#8b98a8';
const FAINT = '#5a6675';
const ACCENT = '#e0b070';

function chamberGlow(opts: SceneOptions, l: Layout): C.Shape {
	const cy = l.ceilY + (l.floorY - l.ceilY) * 0.45;
	return C.rect(
		0,
		0,
		opts.w,
		opts.h,
		C.radial(
			[
				[0.0, 'rgba(126,158,196,0.11)'],
				[0.6, 'rgba(90,120,150,0.03)'],
				[1.0, 'rgba(0,0,0,0)']
			],
			l.cx,
			cy,
			8,
			l.cx,
			cy,
			opts.w * 0.78
		)
	);
}

function rockCeiling(opts: SceneOptions, l: Layout): C.Shape {
	return C.rect(
		0,
		l.ceilY - 52,
		opts.w,
		52,
		C.linear(
			[
				[0.0, '#40382b'],
				[0.5, '#2c261e'],
				[1.0, '#181510']
			],
			0,
			l.ceilY - 52,
			0,
			l.ceilY
		)
	);
}

function depthGrid(opts: SceneOptions, l: Layout): C.Shape {
	const stepM = gridStep(opts.chamberM);
	const count = Math.floor(opts.chamberM / stepM);
	const out: C.Shape[] = [];
	for (let k = 1; k <= count; k++) {
		const y = toY(l, k * stepM);
		out.push(
			C.segment(0, y, opts.w, y, C.dashed([2, 8], C.stroke('rgba(255,255,255,0.06)', 1)))
		);
	}
	return C.group(out);
}

/** The side of the formation catching the cave light. */
function litFace(pts: Array<[number, number]>, l: Layout): C.Shape {
	const left: Array<[number, number]> = [];
	for (const [d, r] of pts) left.push([l.cx - r * l.scale * 0.46, toY(l, d)]);
	const right: Array<[number, number]> = [];
	for (let i = pts.length - 1; i >= 0; i--) {
		const [d, r] = pts[i];
		right.push([l.cx - r * l.scale * 0.6, toY(l, d)]);
	}
	return C.polygon([...left, ...right], C.solid('rgba(255,247,228,0.18)'));
}

/**
 * Annual layering etched across the surface. Each band is one year of deposit,
 * so their spacing is the local growth rate made visible.
 */
function growthRings(pts: Array<[number, number]>, l: Layout): C.Shape {
	const n = pts.length;
	const every = Math.max(1, Math.floor(n / 22));
	const out: C.Shape[] = [];
	for (let i = 0; i < n; i += every) {
		const [d, r] = pts[i];
		const y = toY(l, d);
		out.push(
			C.segment(
				l.cx - r * l.scale * 0.94,
				y,
				l.cx + r * l.scale * 0.94,
				y,
				C.stroke('rgba(84,66,42,0.13)', 1)
			)
		);
	}
	return C.group(out);
}

/**
 * The water film: a bright lip on each side, slightly thicker and brighter at the
 * apex where the film is thinnest and freshest.
 */
function waterFilm(pts: Array<[number, number]>, l: Layout): C.Shape {
	const right: Array<[number, number]> = [];
	const left: Array<[number, number]> = [];
	for (const [d, r] of pts) {
		right.push([l.cx + r * l.scale + 1.4, toY(l, d)]);
		left.push([l.cx - r * l.scale - 1.4, toY(l, d)]);
	}
	return C.group([
		C.polyline(right, C.stroke('rgba(152,208,240,0.60)', 1.7)),
		C.polyline(left, C.stroke('rgba(152,208,240,0.34)', 1.3))
	]);
}

/** A dome drawn over the apex, so the tip reads as a rounded cap. */
function capArc(pts: Array<[number, number]>, l: Layout): Array<[number, number]> {
	const [d0, r0] = pts[0] ?? [0, P.seedRadius];
	const second = pts[4] ?? [d0, r0];
	const drop = Math.max(0.00015, second[0] - d0);
	const steps = 18;
	const out: Array<[number, number]> = [];
	for (let k = 0; k <= steps; k++) {
		const a = (Math.PI * k) / steps;
		out.push([l.cx + r0 * l.scale * Math.cos(a), toY(l, d0) - drop * l.scale * Math.sin(a) * 0.85]);
	}
	return out;
}

/**
 * Falling drops. The rhythm follows the drip rate; the acceleration follows
 * gravity, so a slow drip visibly spaces the stream out.
 */
function fallingDrops(opts: SceneOptions, l: Layout, apex: [number, number]): C.Shape {
	const [apexDepth, apexR] = apex;
	const period = Math.min(Math.max(P.dripIntervalFromRate(opts.env.dripRate) / 24.0, 0.12), 12.0);
	const fall = Math.max(0.05, opts.chamberM - apexDepth);
	const count = 8;
	const out: C.Shape[] = [];
	for (let k = 0; k < count; k++) {
		const raw = ((opts.time / period + k * 0.41) * 1000) % 1000;
		const phase = Math.round(raw) / 1000.0;
		// constant acceleration: distance ~ phase^2
		const frac = phase * phase;
		const y = toY(l, apexDepth + fall * frac);
		const stretch = 1.0 + phase * 1.4;
		const alpha = Math.min(Math.max(0.9 - phase * 0.6, 0.05), 0.9);
		out.push(
			C.ellipse(
				l.cx + apexR * l.scale * 0.05,
				y,
				1.7 / Math.sqrt(stretch),
				2.4 * stretch,
				C.solid(C.rgba(158, 210, 242, alpha))
			)
		);
	}
	return C.group(out);
}

/** The stalagmite growing on the floor below. */
function stalagmite(opts: SceneOptions, l: Layout): C.Shape {
	if (opts.stalagmiteM <= 0.002) return C.group([]);

	const h = Math.min(opts.stalagmiteM, opts.chamberM * 0.5);
	const w = h * 0.9;
	const steps = 18;
	const outline: Array<[number, number]> = [];
	for (let k = 0; k <= steps; k++) {
		const a = (Math.PI * k) / steps;
		outline.push([l.cx + w * l.scale * Math.cos(a), l.floorY - h * l.scale * Math.sin(a)]);
	}
	const closed: Array<[number, number]> = [
		...outline,
		[l.cx - w * l.scale, l.floorY + 10],
		[l.cx + w * l.scale, l.floorY + 10]
	];
	return C.polygon(
		closed,
		C.linear(
			[
				[0.0, 'rgba(214,192,152,0.92)'],
				[1.0, 'rgba(104,88,66,0.92)']
			],
			l.cx,
			l.floorY - h * l.scale,
			l.cx,
			l.floorY
		)
	);
}

function axisLegend(opts: SceneOptions, l: Layout): C.Shape {
	const barM = gridStep(opts.chamberM);
	const px = barM * l.scale;
	const x = 20.0;
	const y = l.floorY + 30;
	const lengthText = `${(Math.round(P.lengthOf(opts.sim) * 100 * 100) / 100).toFixed(2)} cm`;

	return C.group([
		C.segment(x, y, x + px, y, C.stroke(DIM, 1.5)),
		C.segment(x, y - 4, x, y + 4, C.stroke(DIM, 1.5)),
		C.segment(x + px, y - 4, x + px, y + 4, C.stroke(DIM, 1.5)),
		C.label(x + px + 8, y + 4, `${barM} m`, DIM, 'left'),
		C.label(opts.w - 18, y + 4, `length ${lengthText}`, ACCENT, 'right')
	]);
}

/** Build the whole canvas scene as a value. */
export function draw(opts: SceneOptions): C.Draw {
	const l = layout(opts);
	const pts = profilePoints(opts.sim);

	const body: Array<[number, number]> = [];
	for (const [d, r] of pts) body.push([l.cx + r * l.scale, toY(l, d)]);
	for (let i = pts.length - 1; i >= 0; i--) {
		const [d, r] = pts[i];
		body.push([l.cx - r * l.scale, toY(l, d)]);
	}

	const apex: [number, number] = pts[0] ?? [0, P.seedRadius];

	const shapes: C.Shape[] = [
		C.rect(
			0,
			0,
			opts.w,
			opts.h,
			C.linear(
				[
					[0.0, '#0e141c'],
					[0.5, '#0a0e14'],
					[1.0, '#06080b']
				],
				0,
				0,
				0,
				opts.h
			)
		),
		chamberGlow(opts, l),
		rockCeiling(opts, l),
		depthGrid(opts, l),
		C.polygon(
			body,
			C.linear(
				[
					[0.0, '#dcc7a0'],
					[0.2, '#c4ad86'],
					[0.65, '#9e8867'],
					[1.0, '#79664c']
				],
				l.cx - 60,
				toY(l, 0.0),
				l.cx + 60,
				toY(l, opts.chamberM)
			)
		),
		litFace(pts, l),
		opts.showRings ? growthRings(pts, l) : C.group([]),
		waterFilm(pts, l),
		C.polyline(capArc(pts, l), C.stroke('rgba(255,248,232,0.30)', 1.3)),
		fallingDrops(opts, l, apex),
		stalagmite(opts, l),
		axisLegend(opts, l)
	];

	return { w: opts.w, h: opts.h, bg: '#070a0e', shapes };
}
