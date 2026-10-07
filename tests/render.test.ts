/**
 * Renderer tests.
 *
 * `draw` is exercised against a recording 2D context, so the whole drawing path
 * runs without a browser: every primitive kind, the device-pixel-ratio backing
 * store, and the dash reset that stops one shape's dash leaking into the next.
 */

import assert from 'node:assert/strict';
import * as C from '../src/app/render/canvas.ts';
import * as Scene from '../src/app/render/scene.ts';
import * as P from '../src/app/core/model.ts';

let checks = 0;
let failures = 0;

function check(label: string, condition: boolean, detail = '') {
	checks++;
	if (condition) {
		console.log(`  ok    ${label}`);
	} else {
		failures++;
		console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);
	}
}

// --- a recording context ----------------------------------------------------

interface Recorded {
	fill: number;
	stroke: number;
	fillRect: number;
	fillText: number;
	gradients: number;
	arcs: number;
	ellipses: number;
	dashes: number[][];
	dashAtFill: number[][];
	transforms: number[][];
	texts: string[];
}

function makeContext(rec: Recorded) {
	let currentDash: number[] = [];
	return {
		setTransform(...a: number[]) {
			rec.transforms.push(a);
		},
		save() {},
		restore() {},
		clearRect() {},
		scale() {},
		beginPath() {},
		closePath() {},
		moveTo() {},
		lineTo() {},
		arc() {
			rec.arcs++;
		},
		ellipse() {
			rec.ellipses++;
		},
		fill() {
			rec.fill++;
			rec.dashAtFill.push([...currentDash]);
		},
		stroke() {
			rec.stroke++;
		},
		fillRect() {
			rec.fillRect++;
		},
		fillText(t: string) {
			rec.fillText++;
			rec.texts.push(t);
		},
		setLineDash(d: number[]) {
			rec.dashes.push([...d]);
			currentDash = [...d];
		},
		createLinearGradient() {
			rec.gradients++;
			return { addColorStop() {} };
		},
		createRadialGradient() {
			rec.gradients++;
			return { addColorStop() {} };
		},
		strokeStyle: '',
		lineWidth: 0,
		lineCap: 'round',
		lineJoin: 'round',
		fillStyle: '',
		font: '',
		textAlign: 'left',
		textBaseline: 'alphabetic'
	};
}

function makeCanvas(rec: Recorded, w = 620, h = 720) {
	const el = {
		width: 0,
		height: 0,
		style: { height: '' } as CSSStyleDeclaration,
		getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }) as DOMRect,
		getContext: () => makeContext(rec) as unknown as CanvasRenderingContext2D
	};
	return el as unknown as HTMLCanvasElement;
}

const emptyRec = (): Recorded => ({
	fill: 0,
	stroke: 0,
	fillRect: 0,
	fillText: 0,
	gradients: 0,
	arcs: 0,
	ellipses: 0,
	dashes: [],
	dashAtFill: [],
	transforms: [],
	texts: []
});

// `draw` reads window.devicePixelRatio, which does not exist in Node.
(globalThis as unknown as { window: unknown }).window = { devicePixelRatio: 2 };

console.log('\nevery primitive draws');
{
	const rec = emptyRec();
	const scene: C.Draw = {
		w: 100,
		h: 100,
		bg: '#000',
		shapes: [
			C.rect(0, 0, 10, 10, C.solid('#111')),
			C.circle(5, 5, 2, C.solid('#222')),
			C.ellipse(5, 5, 2, 3, C.solid('#333')),
			C.polygon(
				[
					[0, 0],
					[1, 1],
					[2, 0]
				],
				C.solid('#444')
			),
			C.polyline(
				[
					[0, 0],
					[1, 1]
				],
				C.stroke('#555', 1)
			),
			C.segment(0, 0, 1, 1, C.stroke('#666', 1)),
			C.label(0, 0, 'hi', '#fff', 'left'),
			C.group([C.circle(1, 1, 1, C.solid('#777'))])
		]
	};
	C.draw(makeCanvas(rec), scene);
	check('fills issued', rec.fill >= 5, `fills=${rec.fill}`);
	check('strokes issued', rec.stroke >= 2, `strokes=${rec.stroke}`);
	check('fillRect issued for background', rec.fillRect >= 1);
	check('text issued', rec.fillText === 1, `text=${rec.fillText}`);
	check('arc used for circle', rec.arcs >= 1);
	check('ellipse used', rec.ellipses >= 1);
}

console.log('\nbacking store and device pixel ratio');
{
	const rec = emptyRec();
	const canvas = makeCanvas(rec, 620, 720);
	C.draw(canvas, { w: 620, h: 720, bg: '#000', shapes: [] });
	check('width scaled by dpr', canvas.width === 1240, `width=${canvas.width}`);
	check('height preserves aspect', canvas.height === 1440, `height=${canvas.height}`);
	check('css height set', canvas.style.height === '720px', canvas.style.height);
	check('transform applied for dpr', rec.transforms.length >= 1);
	check(
		'transform uses dpr',
		rec.transforms[0][0] === 2 && rec.transforms[0][3] === 2,
		JSON.stringify(rec.transforms[0])
	);
}

console.log('\ndash does not leak between shapes');
{
	const rec = emptyRec();
	C.draw(makeCanvas(rec), {
		w: 100,
		h: 100,
		bg: '#000',
		shapes: [
			C.segment(0, 0, 10, 10, C.dashed([2, 8], C.stroke('#fff', 1))),
			C.polygon(
				[
					[0, 0],
					[5, 5],
					[9, 0]
				],
				C.solid('#fff')
			)
		]
	});
	// The polygon fill must happen with an empty dash, or the dashed segment
	// would etch the solid body.
	const lastFillDash = rec.dashAtFill[rec.dashAtFill.length - 1];
	check('dash reset before the polygon fill', lastFillDash.length === 0, JSON.stringify(lastFillDash));
	check('dash was set at least once', rec.dashes.some((d) => d.length === 2));
}

console.log('\nchamber scene');
{
	const rec = emptyRec();
	const env = { ...P.defaultEnv, maxDepth: 1.6 };
	const sim = P.advance(P.defaultParams, env, 1000, P.initialSim());
	const scene = Scene.draw({
		w: 620,
		h: 720,
		env,
		sim,
		time: 1.5,
		chamberM: 1.6,
		showRings: true,
		stalagmiteM: 0.05
	});
	C.draw(makeCanvas(rec), scene);
	const kinds = C.countShapes(scene.shapes);
	console.log('    primitives:', JSON.stringify(kinds));
	check('scene has a body polygon', (kinds.poly ?? 0) >= 1);
	check('scene has the depth grid', (kinds.seg ?? 0) >= 1);
	check('scene has falling drops', (kinds.ellipse ?? 0) >= 1);
	check('scene has axis labels', (kinds.label ?? 0) >= 2);
	// 3 rects plus the body, lit face, rings, film, cap and drops: a full chamber
	// scene is around a dozen fills, not hundreds.
	check('scene draws without throwing', rec.fill >= 10, `fills=${rec.fill}`);
	check('gradients used', rec.gradients > 0, `gradients=${rec.gradients}`);
	check('length label rendered', rec.texts.some((t) => t.startsWith('length ')), rec.texts.join('|'));
}

console.log('\nrings toggle');
{
	const env = { ...P.defaultEnv, maxDepth: 1.6 };
	const sim = P.advance(P.defaultParams, env, 1000, P.initialSim());
	const on = Scene.draw({ w: 620, h: 720, env, sim, time: 0, chamberM: 1.6, showRings: true, stalagmiteM: 0 });
	const off = Scene.draw({ w: 620, h: 720, env, sim, time: 0, chamberM: 1.6, showRings: false, stalagmiteM: 0 });
	const onSeg = C.countShapes(on.shapes).seg ?? 0;
	const offSeg = C.countShapes(off.shapes).seg ?? 0;
	check('rings add segments', onSeg > offSeg, `on=${onSeg} off=${offSeg}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
	console.log(`${failures} FAILED`);
	process.exit(1);
}
console.log('renderer is sound\n');
