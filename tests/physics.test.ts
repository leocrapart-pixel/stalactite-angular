/**
 * Parity test: the TypeScript port must reproduce the Elm model exactly.
 *
 * `tests/golden.json` is emitted from the Elm build (`src/Golden.elm`), so this
 * compares two independent implementations of the same equations rather than
 * checking the port against itself. Run with `npm test`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import * as P from '../src/app/core/model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden.json'), 'utf8'));

const env: P.Env = {
	tempC: 10,
	cavePCO2: 6.0e-4,
	caIn: 1.0,
	dripRate: 2.0e-5,
	wetness: 0.25,
	kineticK: 5.0e-8,
	evaporation: 0,
	maxDepth: 1.6
};

let checks = 0;
let failures = 0;

/**
 * Compare against the Elm value. Floats are compared relatively: these are
 * physics results carried through `Math.exp` and `Math.cbrt`, so bit-exactness
 * is not a fair bar, but anything above one part in 1e12 means the formulas
 * differ rather than the arithmetic.
 */
function near(actual: number, expected: number, label: string, relTol = 1e-12) {
	checks++;
	const scale = Math.max(Math.abs(expected), 1e-300);
	const err = Math.abs(actual - expected) / scale;
	if (!(err <= relTol)) {
		failures++;
		console.log(`  FAIL  ${label}\n        elm=${expected}  ts=${actual}  rel=${err.toExponential(3)}`);
	} else {
		console.log(`  ok    ${label.padEnd(34)} ${actual}`);
	}
}

function eq(actual: unknown, expected: unknown, label: string) {
	checks++;
	try {
		assert.deepEqual(actual, expected);
		console.log(`  ok    ${label.padEnd(34)} ${JSON.stringify(actual)}`);
	} catch {
		failures++;
		console.log(`  FAIL  ${label}\n        elm=${JSON.stringify(expected)}  ts=${JSON.stringify(actual)}`);
	}
}

console.log('\nconstants');
near(P.molarVolume, golden.constants.molarVolume, 'molarVolume');
near(P.capillaryLength, golden.constants.capillaryLength, 'capillaryLength');
near(P.seedRadius, golden.constants.seedRadius, 'seedRadius');

console.log('\nwater film');
near(P.filmThickness(1.0e-9, 0.005), golden.film.thickness_10um_flux, 'filmThickness');
near(P.filmVelocity(1.0e-9, 0.005), golden.film.velocity_10um_flux, 'filmVelocity');
near(P.degasCoeff(1.0e-4), golden.film.degas_h, 'degasCoeff');
near(P.degasTime(1.0e-4), golden.film.degasTime_h, 'degasTime');
near(P.perimeterOf(env, 0.002), golden.film.perimeter_r2mm, 'perimeterOf(0.002)');
near(P.reynoldsOf(1.0e-9, 0.005), golden.film.reynolds, 'reynoldsOf');
near(P.fluxOf(env), golden.film.flux, 'fluxOf');

console.log('\nchemistry');
near(P.kEq(10), golden.chemistry.kEq_10, 'kEq(10)');
near(P.kEq(25), golden.chemistry.kEq_25, 'kEq(25)');
near(P.henryCO2(10), golden.chemistry.henry_10, 'henryCO2(10)');
near(P.k1CO2(10), golden.chemistry.k1_10, 'k1CO2(10)');
near(P.k2CO2(10), golden.chemistry.k2_10, 'k2CO2(10)');

// The bisection is the delicate part: a wrong bracket or a non-geometric
// midpoint still converges, but to a different root.
near(P.caEq(10, 6.0e-4), golden.chemistry.caEq_10_600, 'caEq(10, 600ppm)');
near(P.caEq(10, 4.0e-4), golden.chemistry.caEq_10_400, 'caEq(10, 400ppm)');
near(P.caEq(10, 3.0e-3), golden.chemistry.caEq_10_3000, 'caEq(10, 3000ppm)');
near(P.caEq(0, 6.0e-4), golden.chemistry.caEq_0_600, 'caEq(0, 600ppm)');
near(P.caEq(20, 6.0e-4), golden.chemistry.caEq_20_600, 'caEq(20, 600ppm)');
near(P.caEq(22, 9.0e-4), golden.chemistry.caEq_22_900, 'caEq(22, 900ppm)');
near(P.caEq(25, 4.0e-4), golden.chemistry.caEq_25_400, 'caEq(25, 400ppm)');
near(P.saturationIndex(env), golden.chemistry.si, 'saturationIndex');
near(P.supersaturationOf(env), golden.chemistry.supersaturation, 'supersaturationOf');

console.log('\ngeometry');
const s1 = P.advance(P.defaultParams, env, 1000, P.initialSim());
near(P.surfaceAreaOf(s1), golden.geometry.surfaceArea, 'surfaceAreaOf');
near(P.volumeOf(s1), golden.geometry.volume, 'volumeOf');
near(P.filmVolume(env, s1), golden.geometry.filmVolume, 'filmVolume');
near(P.lengthOf(s1), golden.geometry.length, 'lengthOf');

console.log('\nintegration');
const steps = [
	P.initialSim(),
	s1,
	P.advance(P.defaultParams, env, 50000, P.initialSim()),
	P.advance(P.defaultParams, env, 1000000, P.initialSim())
];
for (let i = 0; i < steps.length; i++) {
	const g = golden.steps[i];
	const s = steps[i];
	near(s.years, g.years, `steps[${i}].years`);
	near(s.tipDepth, g.tipDepth, `steps[${i}].tipDepth`);
	near(s.deposited, g.deposited, `steps[${i}].deposited`);
	near(s.mass, g.mass, `steps[${i}].mass`);
	near(P.profileAtDepth(s.tipDepth, s), g.radius0, `steps[${i}].radiusAtTip`, 1e-9);
	near(P.profileAtDepth(0, s), g.radiusCeil, `steps[${i}].radiusAtCeiling`, 1e-9);
	near(P.tipGrowthMmPerYear(env, s), g.tipGrowth, `steps[${i}].tipGrowth`);
	near(P.wallGrowthMmPerYear(env, s), g.wallGrowth, `steps[${i}].wallGrowth`);
	near(P.depletionLengthOf(env, s), g.depletion, `steps[${i}].depletion`);
}

console.log('\nview');
const v = P.view(env, s1);
const gv = golden.view1;
near(v.filmMicrons, gv.filmMicrons, 'view.filmMicrons');
near(v.filmVelocityMmS, gv.filmVelocityMmS, 'view.filmVelocityMmS');
near(v.residenceSeconds, gv.residenceSeconds, 'view.residenceSeconds');
near(v.reynolds, gv.reynolds, 'view.reynolds');
near(v.wettedPerimeterMm, gv.wettedPerimeterMm, 'view.wettedPerimeterMm');
near(v.depletionLengthM, gv.depletionLengthM, 'view.depletionLengthM');
near(v.caEq, gv.caEq, 'view.caEq');
near(v.saturationIndex, gv.saturationIndex, 'view.saturationIndex');
near(v.waterFilmVolumeMl, gv.waterFilmVolumeMl, 'view.waterFilmVolumeMl');
near(v.volumeCm3, gv.volumeCm3, 'view.volumeCm3');
near(v.massGrams, gv.massGrams, 'view.massGrams');

console.log('\nanimation loop');
{
	// Reproduce the app's per-frame call exactly: the page advances by
	// `speed * dtSeconds` each frame, clamped, with speed = 800 kyr/s and
	// dt = 10 ms, so each frame slices 800 years.
	const frame = (sim: P.Sim) => P.advance(P.defaultParams, env, 800.0, sim);
	const run = (n: number) => {
		let s = P.initialSim();
		for (let i = 0; i < n; i++) s = frame(s);
		return s;
	};
	for (const [i, frames] of [1, 10, 60, 300].entries()) {
		const g = golden.loop[i];
		const s = run(frames);
		near(s.years, g.years, `loop[${frames} frames].years`);
		near(s.deposited, g.deposited, `loop[${frames} frames].deposited`);
		near(s.tipDepth, g.tipDepth, `loop[${frames} frames].tipDepth`);
		near(s.mass, g.mass, `loop[${frames} frames].mass`);
	}
}

console.log('\nconservation');
{
	// Mass must never be overstated: the solid can never hold more calcite than
	// the water delivered. Before the length hits the chamber ceiling the two
	// should agree exactly, because the length is derived from the deposit.
	let worst = 0;
	for (const years of [1000, 5000, 20000, 400000]) {
		const sim = P.advance(P.defaultParams, env, years, P.initialSim());
		const over = P.volumeOf(sim) / sim.deposited - 1;
		worst = Math.max(worst, over);
	}
	checks++;
	if (worst < 1e-6) {
		console.log('  ok    solid volume never exceeds delivered calcite');
	} else {
		failures++;
		console.log(`  FAIL  solid volume exceeds delivered calcite by ${worst}`);
	}

	{
		// The stored profile and the closed-form shape law must describe the same
		// cone: the solid's measured volume equals the volume the law predicts.
		let worst = 0;
		for (const years of [100, 1000, 10000]) {
			const sim = P.advance(P.defaultParams, env, years, P.initialSim());
			// Compare only over the depth actually modelled: beyond the tip the
			// profile holds nothing, so the closed form must be taken to the same
			// depth rather than to the grid limit.
			const modelled = P.lengthOf(sim);
			const a = P.tipFloor;
			const g = P.tipTaper;
			const closed = (Math.PI / 3) * ((a + g * modelled) ** 3 - a ** 3) / g;
			worst = Math.max(worst, Math.abs(P.volumeOf(sim) / closed - 1));
		}
		checks++;
		if (worst < 1e-9) {
			console.log(`  ok    profile matches the shape law        rel=${worst.toExponential(1)}`);
		} else {
			failures++;
			console.log(`  FAIL  profile vs shape law                rel=${worst}`);
		}
	}

	// Growth must be monotonic and bounded by the chamber.
	let prev = 0;
	let monotone = true;
	for (const years of [1000, 10000, 100000, 400000]) {
		const sim = P.advance(P.defaultParams, env, years, P.initialSim());
		if (sim.tipDepth < prev) monotone = false;
		if (sim.tipDepth > env.maxDepth + 1e-12) monotone = false;
		prev = sim.tipDepth;
	}
	checks++;
	if (monotone) console.log('  ok    length monotonic and within the chamber');
	else {
		failures++;
		console.log('  FAIL  length not monotonic or exceeded the chamber');
	}

	// Below equilibrium nothing may be deposited at all.
	const dry = P.advance(P.defaultParams, { ...env, cavePCO2: 3.0e-3, caIn: 0.7 }, 1e6, P.initialSim());
	// The seed's own calcite is carried in `deposited`, so nothing may be added.
	eq(dry.deposited, P.seedDeposited, 'undersaturated deposits nothing');
	eq(dry.tipDepth, P.initialSim().tipDepth, 'undersaturated does not grow');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
	console.log(`${failures} FAILED`);
	process.exit(1);
}
console.log('port matches the Elm model\n');
