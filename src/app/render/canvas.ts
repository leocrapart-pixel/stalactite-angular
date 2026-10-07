/**
 * Drawing layer over the canvas 2D context.
 *
 * A scene is built as a plain value — a list of `Shape` records — and handed to
 * a single `draw` call. This mirrors the Elm app's `Canvas` module: the scene is
 * data, so it can be inspected, logged or tested without a live canvas, and the
 * only code that touches the DOM is `draw` itself.
 */

export type Stop = [number, string];

export type Fill =
	| { k: 'flat'; c: string }
	| { k: 'linear'; stops: Stop[]; x0: number; y0: number; x1: number; y1: number }
	| {
			k: 'radial';
			stops: Stop[];
			x0: number;
			y0: number;
			r0: number;
			x1: number;
			y1: number;
			r1: number;
	  };

export interface Stroke {
	c: string;
	w: number;
	cap: string;
	dash: number[];
}

export type Shape =
	| { t: 'rect'; x: number; y: number; w: number; h: number; f: Fill }
	| { t: 'circle'; x: number; y: number; r: number; f: Fill; s: Stroke | null }
	| { t: 'ellipse'; x: number; y: number; rx: number; ry: number; f: Fill; s: Stroke | null }
	| { t: 'poly'; closed: boolean; p: Array<[number, number]>; f: Fill; s: Stroke | null }
	| { t: 'seg'; x0: number; y0: number; x1: number; y1: number; s: Stroke }
	| {
			t: 'label';
			x: number;
			y: number;
			v: string;
			font: string;
			c: string;
			align: string;
	  }
	| { t: 'group'; shapes: Shape[] };

export interface Draw {
	w: number;
	h: number;
	bg: string;
	shapes: Shape[];
}

// --- constructors -----------------------------------------------------------

export const solid = (c: string): Fill => ({ k: 'flat', c });

export const linear = (stops: Stop[], x0: number, y0: number, x1: number, y1: number): Fill => ({
	k: 'linear',
	stops,
	x0,
	y0,
	x1,
	y1
});

export const radial = (
	stops: Stop[],
	x0: number,
	y0: number,
	r0: number,
	x1: number,
	y1: number,
	r1: number
): Fill => ({ k: 'radial', stops, x0, y0, r0, x1, y1, r1 });

export const stroke = (c: string, w: number): Stroke => ({ c, w, cap: 'round', dash: [] });

export const dashed = (d: number[], s: Stroke): Stroke => ({ ...s, dash: d });

export const rect = (x: number, y: number, w: number, h: number, f: Fill): Shape => ({
	t: 'rect',
	x,
	y,
	w,
	h,
	f
});

export const circle = (x: number, y: number, r: number, f: Fill): Shape => ({
	t: 'circle',
	x,
	y,
	r,
	f,
	s: null
});

export const ellipse = (
	x: number,
	y: number,
	rx: number,
	ry: number,
	f: Fill
): Shape => ({ t: 'ellipse', x, y, rx, ry, f, s: null });

export const polygon = (p: Array<[number, number]>, f: Fill): Shape => ({
	t: 'poly',
	closed: true,
	p,
	f,
	s: null
});

export const polyline = (p: Array<[number, number]>, s: Stroke): Shape => ({
	t: 'poly',
	closed: false,
	p,
	f: solid('rgba(0,0,0,0)'),
	s
});

export const segment = (x0: number, y0: number, x1: number, y1: number, s: Stroke): Shape => ({
	t: 'seg',
	x0,
	y0,
	x1,
	y1,
	s
});

export const label = (
	x: number,
	y: number,
	v: string,
	c: string,
	align: string,
	font = '400 12px ui-sans-serif, system-ui, sans-serif'
): Shape => ({ t: 'label', x, y, v, c, align, font });

export const group = (shapes: Shape[]): Shape => ({ t: 'group', shapes });

/** `rgba()` from components, clamping alpha to a sane range. */
export function rgba(r: number, g: number, b: number, a: number): string {
	const alpha = Math.round(Math.min(Math.max(a, 0), 1) * 1000) / 1000;
	return `rgba(${r},${g},${b},${alpha})`;
}

// --- rendering --------------------------------------------------------------

function fillStyle(ctx: CanvasRenderingContext2D, f: Fill): string | CanvasGradient {
	if (f.k === 'flat') return f.c;
	if (f.k === 'linear') {
		const g = ctx.createLinearGradient(f.x0, f.y0, f.x1, f.y1);
		for (const [p, c] of f.stops) g.addColorStop(Math.min(1, Math.max(0, p)), c);
		return g;
	}
	const g = ctx.createRadialGradient(
		f.x0,
		f.y0,
		Math.max(0, f.r0),
		f.x1,
		f.y1,
		Math.max(0.01, f.r1)
	);
	for (const [p, c] of f.stops) g.addColorStop(Math.min(1, Math.max(0, p)), c);
	return g;
}

function applyStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
	ctx.strokeStyle = s.c;
	ctx.lineWidth = s.w;
	ctx.lineCap = (s.cap || 'round') as CanvasLineCap;
	ctx.lineJoin = 'round';
	ctx.setLineDash(s.dash ?? []);
}

function tracePath(ctx: CanvasRenderingContext2D, p: Array<[number, number]>, closed: boolean) {
	ctx.beginPath();
	for (let i = 0; i < p.length; i++) {
		if (i === 0) ctx.moveTo(p[i][0], p[i][1]);
		else ctx.lineTo(p[i][0], p[i][1]);
	}
	if (closed) ctx.closePath();
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
	switch (s.t) {
		case 'rect':
			ctx.fillStyle = fillStyle(ctx, s.f);
			ctx.fillRect(s.x, s.y, s.w, s.h);
			break;
		case 'circle':
			ctx.beginPath();
			ctx.arc(s.x, s.y, Math.max(0.01, s.r), 0, Math.PI * 2);
			ctx.fillStyle = fillStyle(ctx, s.f);
			ctx.fill();
			if (s.s) {
				applyStroke(ctx, s.s);
				ctx.stroke();
			}
			break;
		case 'ellipse':
			ctx.beginPath();
			ctx.ellipse(s.x, s.y, Math.max(0.01, s.rx), Math.max(0.01, s.ry), 0, 0, Math.PI * 2);
			ctx.fillStyle = fillStyle(ctx, s.f);
			ctx.fill();
			if (s.s) {
				applyStroke(ctx, s.s);
				ctx.stroke();
			}
			break;
		case 'poly':
			if (s.p.length < 2) break;
			tracePath(ctx, s.p, s.closed);
			ctx.fillStyle = fillStyle(ctx, s.f);
			ctx.fill();
			if (s.s) {
				applyStroke(ctx, s.s);
				ctx.stroke();
			}
			// reset so a dash never leaks into the next shape
			ctx.setLineDash([]);
			break;
		case 'seg':
			applyStroke(ctx, s.s);
			ctx.beginPath();
			ctx.moveTo(s.x0, s.y0);
			ctx.lineTo(s.x1, s.y1);
			ctx.stroke();
			ctx.setLineDash([]);
			break;
		case 'label':
			ctx.font = s.font;
			ctx.fillStyle = s.c;
			ctx.textAlign = s.align as CanvasTextAlign;
			ctx.textBaseline = 'alphabetic';
			ctx.fillText(s.v, s.x, s.y);
			break;
		case 'group':
			for (const inner of s.shapes) drawShape(ctx, inner);
			break;
	}
}

/**
 * Draw a scene onto a canvas.
 *
 * The backing store is matched to the CSS box times the device pixel ratio so
 * the drawing is crisp on high-density displays. The scene is authored in CSS
 * pixels, so the context is scaled instead of the geometry.
 */
export function draw(canvas: HTMLCanvasElement, scene: Draw): void {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const box = canvas.getBoundingClientRect();
	const cssW = Math.max(240, Math.round(box.width || scene.w));
	const cssH = Math.round(cssW * (scene.h / scene.w));

	const bw = Math.round(cssW * dpr);
	const bh = Math.round(cssH * dpr);
	if (canvas.width !== bw || canvas.height !== bh) {
		canvas.width = bw;
		canvas.height = bh;
	}
	canvas.style.height = `${cssH}px`;

	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, cssW, cssH);

	// the scene was authored at scene.w; scale to the actual CSS width
	const k = cssW / scene.w;
	ctx.save();
	ctx.scale(k, k);
	ctx.fillStyle = scene.bg;
	ctx.fillRect(0, 0, scene.w, scene.h);
	for (const s of scene.shapes) drawShape(ctx, s);
	ctx.restore();
	ctx.setLineDash([]);
}

/** Count primitives in a scene. Used by the tests. */
export function countShapes(shapes: Shape[]): Record<string, number> {
	const out: Record<string, number> = {};
	const walk = (list: Shape[]) => {
		for (const s of list) {
			out[s.t] = (out[s.t] ?? 0) + 1;
			if (s.t === 'group') walk(s.shapes);
		}
	};
	walk(shapes);
	return out;
}
