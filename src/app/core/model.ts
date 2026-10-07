/**
 * Physics of stalactite growth.
 *
 * A direct port of the Elm model in `src/Physics.elm`. The formulas, numeric
 * literals, clamps and iteration counts are reproduced exactly so both
 * implementations agree to the last bit; `tests/physics.test.ts` pins that down
 * against values measured from the Elm build.
 *
 * Water arrives at the tip of a growing stalactite, runs back **up** its outer
 * surface as a thin gravity-driven film, loses CO2 to the cave air, and
 * precipitates calcite. Every mole of calcium taken out of the film becomes one
 * mole of calcite added to the solid, so the growth rate is fixed by the
 * calcium the drip water can deliver and by how fast the film can shed that
 * calcium as rock.
 *
 * Two limits govern the rate at which calcite can leave the film:
 *
 * **The surface reaction.** Precipitation is a surface process, so a patch of
 * surface can only give up `k (c - c_eq)` moles per square metre per second,
 * where `k` is a transport-limited exchange velocity and `c_eq` is the calcium
 * concentration at equilibrium with calcite under the cave's CO2.
 *
 * **The supply.** The water carries a finite flux of calcium, so over a stretch
 * of surface with wetted perimeter `P` the concentration falls at `k P / Q` per
 * metre travelled. Inverting that gives the **depletion length**
 *
 *     L = Q / (k P)
 *
 * the distance over which the film loses a factor of e of its excess.
 *
 * Nothing about the shape is imposed. The tapered profile emerges because the
 * water supply is fixed while the surface it must cover widens with radius.
 */

// ---------------------------------------------------------------------------
// MATERIAL CONSTANTS
// ---------------------------------------------------------------------------

/** Density of calcite, kg/m^3. */
export const rhoCalcite = 2710.0;

export const molarMassCalcite = 0.1000869;

/**
 * Molar volume of calcite, m^3/mol. One mole of calcium leaving the film
 * occupies this much rock.
 */
export const molarVolume = molarMassCalcite / rhoCalcite;

/** Kinematic viscosity of water at 10 C, m^2/s. */
export const kinematicViscosity = 1.31e-6;

/** Molecular diffusivity of dissolved CO2, m^2/s. */
export const diffusivityCO2 = 1.9e-9;

/** Surface tension of water, N/m. */
export const surfaceTension = 0.072;

export const gravity = 9.81;

export const secondsPerYear = 31556952.0;

export const gasConstant = 8.314;

/**
 * Nodes on the arc-length grid. 160 nodes resolves the apex cap and keeps a
 * full physics step cheap.
 */
export const nodeCount = 160;

/** Arc-length spacing between nodes, m. */
export const spacing = 0.008;

/**
 * Axial span the grid can resolve, m. The profile array covers the first
 * `gridSpan` metres below the ceiling and nothing beyond it, so the stalactite
 * is stopped here: growing past the end of the array would be invisible and
 * would break the agreement between the shape law and the stored profile.
 */
export const gridSpan = nodeCount * spacing;

/**
 * Deepest chamber the model will grow into, m.
 *
 * This is the ceiling-to-floor distance of the tallest cave the app offers. The
 * stalactite stops here: past this point it would be a column, which is a
 * different problem, and it also cannot exceed the span the profile grid
 * resolves.
 */
export const maxDepth = 1.6;

/** Radius of the calcite boss that seeds growth, m. */
export const seedRadius = 2.0e-3;

/**
 * Share of the incoming calcite that lengthens the formation rather than
 * thickening it. Real stalactites spend most of it on length, which is why they
 * are long and thin.
 */
export const lengthFraction = 0.35;

/**
 * Fixed taper of the walls: the radius gained per metre of descent.
 *
 * A stalactite is a cone. Measuring its shape by the rate at which it widens
 * with depth, rather than by an array of independently drifting radii, is what
 * makes the model stable across the enormous timesteps a cave timescale forces.
 */
export const tipTaper = 0.004;

/** Cube root. */
function cubeRoot(x: number): number {
	return x <= 0.0 ? 0.0 : Math.cbrt(x);
}

/** Floor on the apex radius, m, so the tip never becomes a mathematical point. */
export const tipFloor = 1.5e-4;

/**
 * How sharply growth is concentrated at the tip. Kept for parity with the Elm
 * model, which carries it as a documented constant.
 */
export const distributionExponent = 1.0;

/** Volume of one cave drip, m^3: a 4.6 mm drop. */
export const dropVolume = 5.0e-8;

/**
 * Calcite already in the seed nub, m^3-equivalent.
 *
 * The formation is a cone whose length is inverted from the accumulated calcite,
 * so a state that starts with nothing deposited would report a length of zero
 * and the seed would vanish. Counting the seed's own volume as already deposited
 * makes the length at t = 0 come out as exactly its true 12 mm.
 */
export const seedDeposited = 3.281761541813959e-9;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** Cave conditions as a cave scientist would measure them. */
export interface Env {
	/** water and cave-air temperature, degrees Celsius */
	tempC: number;
	/** cave air CO2 partial pressure, atm (380 ppm = 3.8e-4) */
	cavePCO2: number;
	/** calcium in the arriving drip water, mol/m^3 (== mmol/L) */
	caIn: number;
	/** water supply, litres per minute */
	dripRate: number;
	/** 1.0 = film round the whole circumference, 0.05 = a narrow rivulet */
	wetness: number;
	/** calcite exchange velocity k, m/s */
	kineticK: number;
	/** fraction of the supply lost to evaporation per metre travelled */
	evaporation: number;
	/** how far the formation may grow before it meets the floor, m */
	maxDepth: number;
}

export const defaultEnv: Env = {
	tempC: 10.0,
	cavePCO2: 6.0e-4,
	caIn: 1.0,
	dripRate: 2.0e-5,
	wetness: 0.25,
	kineticK: 5.0e-8,
	evaporation: 0.0,
	maxDepth: maxDepth
};

/** Numerical parameters. */
export interface Params {
	/** substep ceiling per advance, which bounds the cost of one frame */
	maxSteps: number;
	/** substeps aimed for, so slow growth still animates smoothly */
	minSteps: number;
}

export const defaultParams: Params = {
	maxSteps: 400,
	minSteps: 24
};

/**
 * The formation.
 *
 * `radius` is indexed by depth below the ceiling, node 0 being the tip.
 * `tipDepth` is how far below the ceiling the tip has reached.
 */
export interface Sim {
	radius: Float64Array;
	tipDepth: number;
	years: number;
	deposited: number;
	mass: number;
}

/**
 * The starter: a small calcite blister hanging from the ceiling. A stalactite
 * has to nucleate somewhere, so it begins as a stubby cone.
 */
export function seedProfile(tipMm: number): Float64Array {
	const tip = tipMm / 1000;
	const ceilingRadius = Math.max(1.6 * tip, 0.006);
	const taper = 0.012;
	const out = new Float64Array(nodeCount + 1);
	for (let i = 0; i <= nodeCount; i++) {
		const s = i * spacing;
		out[i] = tip + clamp01(s / taper) * (ceilingRadius - tip);
	}
	return out;
}

export function initialSim(): Sim {
	return {
		radius: seedProfile(seedRadius * 1000),
		tipDepth: 0.012,
		years: 0,
		deposited: seedDeposited,
		mass: seedDeposited * rhoCalcite
	};
}

export function resetSim(sim: Sim): Sim {
	return { ...initialSim(), years: sim.years };
}

function clamp01(x: number): number {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ---------------------------------------------------------------------------
// GEOMETRY
// ---------------------------------------------------------------------------

/** Length of the formation, m: how far the tip has descended. */
export function lengthOf(sim: Sim): number {
	return Math.min(gridSpan, sim.tipDepth);
}

/** Surface slope at a node, dr/ds. */
export function slopeAt(radius: ArrayLike<number>, i: number): number {
	const get = (k: number) => {
		const c = k < 0 ? 0 : k > nodeCount ? nodeCount : k;
		return radius[c] ?? seedRadius;
	};
	const lo = i === 0 ? get(0) : get(i - 1);
	const hi = i >= nodeCount ? get(nodeCount) : get(i + 1);
	return (lo - hi) / (2.0 * spacing);
}

/** Axial component of the surface tangent: ds_axial = cos(theta) ds_arc. */
export function cosineAt(radius: ArrayLike<number>, i: number): number {
	const s = slopeAt(radius, i);
	return 1.0 / Math.sqrt(1.0 + s * s);
}

/**
 * Lateral surface area of each frustum, m^2, indexed like `radius`.
 *
 * The apex is a rounded cap, not a flat disc: approximating its surface by the
 * full circumference would hand the tip an area several times larger than it
 * really has, and since the tip is where the film arrives with the most calcium
 * that error alone is enough to inflate the tip into a mushroom.
 */
export function cellAreas(radius: ArrayLike<number>): Float64Array {
	const out = new Float64Array(nodeCount + 1);
	for (let i = 0; i < nodeCount; i++) {
		const r0 = radius[i] ?? seedRadius;
		const r1 = radius[i + 1] ?? seedRadius;
		out[i] = 2.0 * Math.PI * Math.max(0.5 * (r0 + r1), 1.0e-5) * spacing;
	}
	out[nodeCount] = 0.0;
	return out;
}

/** Depth of each node below the ceiling, m. Nodes are spaced along the axis. */
export function axialDepths(sim: Sim): Float64Array {
	// The profile is a shallow cone (a taper of 0.004 is an angle of a quarter of
	// a degree), so axial distance and arc length differ by well under a
	// thousandth and are not worth a cosine.
	const out = new Float64Array(nodeCount + 1);
	for (let i = 0; i <= nodeCount; i++) out[i] = i * spacing;
	return out;
}

/** Lateral surface area of the whole formation, m^2. */
export function surfaceAreaOf(sim: Sim): number {
	const l = lengthOf(sim);
	const rTip = tipFloor;
	const rMouth = tipFloor + tipTaper * l;
	const slant = l * Math.sqrt(1.0 + tipTaper * tipTaper);
	return Math.PI * (rTip + rMouth) * slant;
}

/**
 * Volume of the body of revolution by conical frusta, m^3.
 *
 * Integrated only over the modelled depth, which matters near the start: the tip
 * usually falls part way between two nodes, and carrying the last stub out to the
 * end of the grid would invent calcite that is not there.
 */
export function volumeByFrusta(sim: Sim): number {
	const modelled = lengthOf(sim);
	const radiusAt = (depth: number) => tipFloor + tipTaper * depth;

	let total = 0;
	for (let i = 0; i < nodeCount; i++) {
		const z0 = i * spacing;
		const z1 = Math.min(z0 + spacing, modelled);
		if (z1 <= z0) continue;
		const r0 = radiusAt(z0);
		const r1 = radiusAt(z1);
		total += (Math.PI * (z1 - z0) * (r0 * r0 + r0 * r1 + r1 * r1)) / 3.0;
	}
	return total;
}

/** Volume of the solid, m^3. */
export function volumeOf(sim: Sim): number {
	return volumeByFrusta(sim);
}

/** Volume of water held on the surface as a film, m^3. */
export function filmVolume(env: Env, sim: Sim): number {
	const q = fluxOf(env);
	let total = 0;
	for (let i = 0; i < nodeCount; i++) {
		const r = sim.radius[i] ?? seedRadius;
		const p = perimeterOf(env, r);
		total += p * filmThickness(q, p) * spacing;
	}
	return total;
}

/** Radius of the profile at a given depth below the ceiling, m. */
export function profileAtDepth(depth: number, sim: Sim): number {
	if (depth > lengthOf(sim)) return 0.0;
	return tipFloor + tipTaper * depth;
}

/**
 * The profile as (depth below ceiling, radius) pairs, tip first.
 * Used by the renderer.
 */
export function profilePoints(sim: Sim): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let i = 0; i <= nodeCount; i++) {
		out.push([i * spacing, sim.radius[i] ?? seedRadius]);
	}
	return out;
}

// ---------------------------------------------------------------------------
// WATER FILM
// ---------------------------------------------------------------------------

/** Nusselt film thickness for volumetric flux `q` over wetted perimeter `p`. */
export function filmThickness(q: number, p: number): number {
	return Math.cbrt((3.0 * kinematicViscosity * Math.max(q, 0.0)) / (gravity * Math.max(p, 1.0e-4)));
}

/** Mean downslope velocity of the film, m/s. */
export function filmVelocity(q: number, p: number): number {
	const h = filmThickness(q, p);
	return (gravity * h * h) / (3.0 * kinematicViscosity);
}

/** Cross-sectional area of the film, m^2. */
export function filmArea(q: number, p: number): number {
	return p * filmThickness(q, p);
}

/** First-order CO2 degassing rate constant through the film surface, 1/s. */
export function degasCoeff(h: number): number {
	return diffusivityCO2 / Math.max(h * h, 1.0e-18);
}

/** Time for the film to equilibrate its CO2 with cave air, s. */
export function degasTime(h: number): number {
	return 1.0 / degasCoeff(h);
}

/** Volumetric flux carried by a film of thickness `h` over perimeter `p`. */
export function nusseltFlux(h: number, p: number): number {
	return (gravity * Math.max(p, 1.0e-4) * h ** 3) / (3.0 * kinematicViscosity);
}

/** Mean velocity of a Nusselt film of thickness `h`. */
export function nusseltVelocity(h: number): number {
	return (gravity * h * h) / (3.0 * kinematicViscosity);
}

/**
 * Capillary length of water, m: films thinner than this are held against gravity
 * by surface tension, and it also sets the narrowest a rivulet can be.
 */
export const capillaryLength = Math.sqrt(surfaceTension / (1000.0 * gravity));

/**
 * Wetted perimeter of the surface where the local radius is `r`, m.
 *
 * A rivulet cannot be narrower than about a capillary length, so even a starving
 * stalactite keeps a wet strip a few millimetres wide at its tip.
 */
export function perimeterOf(env: Env, r: number): number {
	return Math.max(2.0 * capillaryLength, env.wetness * 2.0 * Math.PI * Math.max(r, 1.0e-5));
}

/** Wall shear stress under the film, Pa. */
export function wallStress(q: number, p: number): number {
	return 1000.0 * gravity * filmThickness(q, p);
}

/** Reynolds number of the film. */
export function reynoldsOf(q: number, p: number): number {
	return (filmVelocity(q, p) * filmThickness(q, p)) / kinematicViscosity;
}

/** Volumetric water flux, m^3/s. */
export function fluxOf(env: Env): number {
	return (env.dripRate * 1.0e-3) / 60.0;
}

// ---------------------------------------------------------------------------
// CARBONATE CHEMISTRY
// ---------------------------------------------------------------------------

/**
 * Solubility product of calcite, (mol/L)^2, against temperature.
 *
 * van 't Hoff form calibrated on the standard value at 25 C. Using a linear
 * empirical fit instead shifts the equilibrium calcium by a factor of two, which
 * is enough to turn a growing stalactite into a dissolving one.
 */
export function kEq(t: number): number {
	return 3.3e-9 * Math.exp((-15000.0 / gasConstant) * (1.0 / (t + 273.15) - 1.0 / 298.15));
}

/** Henry constant for CO2 in water, mol/(L atm). CO2 is more soluble in cold water. */
export function henryCO2(t: number): number {
	return 3.3e-2 * Math.exp((-2400.0 / gasConstant) * (1.0 / (t + 273.15) - 1.0 / 298.15));
}

/** First dissociation constant of carbonic acid: 3.75e-7 at 10 C. */
export function k1CO2(t: number): number {
	return 4.45e-7 * Math.exp((-8000.0 / gasConstant) * (1.0 / (t + 273.15) - 1.0 / 298.15));
}

/** Second dissociation constant of carbonic acid: 3.41e-11 at 10 C. */
export function k2CO2(t: number): number {
	return 4.69e-11 * Math.exp((-14900.0 / gasConstant) * (1.0 / (t + 273.15) - 1.0 / 298.15));
}

/**
 * Equilibrium calcium concentration, mol/m^3, for water in contact with both
 * calcite and an atmosphere of CO2 partial pressure `pCO2`.
 *
 * Derivation, all concentrations in mol/L. Henry's law fixes the dissolved CO2,
 * the two dissociation constants fix the carbonate speciation, and calcite
 * solubility fixes the calcium:
 *
 *     C         = KH pCO2
 *     [HCO3-]   = K1 C / h
 *     [CO3^2-]  = K1 K2 C / h^2
 *     [Ca^2+]   = Kc / [CO3^2-]
 *
 * Electroneutrality closes the system:
 *
 *     2 [Ca^2+] + h = [HCO3-] + 2 [CO3^2-] + Kw/h
 *
 * which after clearing denominators is a quadratic in the hydrogen ion
 * concentration. It is solved by bisection on a fixed bracket of pH 10 down to
 * pH 6, which always contains the physical root for cave conditions and needs no
 * starting guess. At 10 C and 600 ppm the answer is 0.44 mM calcium at pH 8.3.
 */
export function caEq(t: number, pCO2: number): number {
	if (pCO2 <= 0.0) return 0.0;

	const c = henryCO2(t) * pCO2;
	const k1 = k1CO2(t);
	const k2 = k2CO2(t);
	const kc = kEq(t);
	const k1c = k1 * c;

	const residual = (x: number): number => {
		const trialCarbonate = (k1 * k2 * c) / (x * x);
		const trialCalcium = kc / trialCarbonate;
		return 2.0 * trialCalcium + x - k1c / x - 2.0 * trialCarbonate - 1.0e-14 / x;
	};

	const protons = bisect(residual, 1.0e-10, 1.0e-6, 60);
	const carbonate = (k1 * k2 * c) / (protons * protons);
	return (1000.0 * kc) / Math.max(carbonate, 1.0e-30);
}

/**
 * Geometric bisection. Sixty halvings of a ten-thousand-fold bracket resolve the
 * root to well under a part in a million, and the fixed iteration count keeps
 * the physics step allocation-free and predictable.
 *
 * Note the bracket is halved geometrically (`sqrt(lo * hi)`), not arithmetically:
 * the root spans ten orders of magnitude, so an arithmetic midpoint would
 * converge on the wrong end.
 */
export function bisect(
	f: (x: number) => number,
	lo: number,
	hi: number,
	iterations: number
): number {
	for (let i = 0; i < iterations; i++) {
		const mid = Math.sqrt(lo * hi);
		if (f(mid) < 0.0) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return Math.sqrt(lo * hi);
}

/** Saturation index of the arriving drip water. Above 0 calcite can be deposited. */
export function saturationIndex(env: Env): number {
	const eq = caEq(env.tempC, env.cavePCO2);
	if (eq <= 0.0) return 0.0;
	return Math.log10(Math.max(env.caIn, 1.0e-9) / eq);
}

/** Calcium excess carried by the drip water above cave-air equilibrium, mol/m^3. */
export function supersaturationOf(env: Env): number {
	return Math.max(0.0, env.caIn - caEq(env.tempC, env.cavePCO2));
}

/**
 * The exchange velocity that applies.
 *
 * `kineticK` is the transport-limited calcite exchange velocity. For every film
 * this simulation produces (tens to hundreds of micrometres thick) the CO2
 * degassing time `h^2 / (pi^2 D)` is a second or less, while the water spends
 * minutes on the surface, so the film is always fully equilibrated with cave air
 * and degassing never limits the rate. The reaction rate is what limits it.
 */
export function effectiveK(env: Env): number {
	return Math.max(0.0, env.kineticK);
}

/** Driving force the drip water carries as it reaches the surface, mol/m^3. */
export function excessAtApex(env: Env, _sim: Sim): number {
	return supersaturationOf(env);
}

/**
 * Depletion length of the film, m: how far the water must travel for its calcium
 * excess to fall by a factor of e. When this greatly exceeds the formation, the
 * whole surface grows at nearly one rate; when it is shorter, the deposit piles
 * up near where the water enters and the lower shaft starves.
 */
export function depletionLengthOf(env: Env, sim: Sim): number {
	const apexR = sim.radius[0] ?? seedRadius;
	return fluxOf(env) / Math.max(effectiveK(env) * perimeterOf(env, apexR), 1.0e-30);
}

/** Convert a drip interval in seconds into a drip rate in litres/minute. */
export function dripRateFromInterval(secondsBetweenDrops: number): number {
	return (dropVolume / Math.max(secondsBetweenDrops, 1.0e-3)) * 6.0e4;
}

/** Convert a drip rate in litres/minute into an interval in seconds. */
export function dripIntervalFromRate(litresPerMinute: number): number {
	return (dropVolume * 6.0e4) / Math.max(litresPerMinute, 1.0e-9);
}

// ---------------------------------------------------------------------------
// TIME STEP
// ---------------------------------------------------------------------------

/**
 * Advance the surface by `dt` seconds.
 *
 * The budget for the step is the calcium the water delivers: `q * excess * dt`
 * moles, and the volume of rock that represents. This is the only material the
 * formation ever gets.
 *
 * The formation is a cone of fixed taper hung from the ceiling, so its radius at
 * depth z is `tipFloor + gamma z`. Everything about its size follows from one
 * number: how much calcite has accumulated. Inverting the cone volume for the
 * length is exact and needs no timestep at all:
 *
 *     V = (pi/3) ( (a + gL)^3 - a^3 ) / g      where a = tipFloor
 *
 * Solving that for L means the geometry is a function of the deposited volume,
 * so mass is conserved by construction and no step, however long, can outrun the
 * supply.
 */
export function step(dt: number, env: Env, sim: Sim): Sim {
	const q = fluxOf(env);
	const excess0 = Math.max(0.0, env.caIn - caEq(env.tempC, env.cavePCO2));

	// The budget for this step, and the volume of rock it represents.
	const volume = q * excess0 * molarVolume * dt;
	const deposited = sim.deposited + volume;

	const base = tipFloor;

	// (a + gL)^3 = a^3 + 3 g V / pi
	const outer = cubeRoot(base ** 3 + (3.0 * tipTaper * (lengthFraction * deposited)) / Math.PI);

	const length = clamp(Math.min(gridSpan, (outer - base) / tipTaper), 0.0, env.maxDepth);
	const newTipR = base;

	// The profile is the cone the shape law describes, anchored to the depth
	// actually modelled: the radius at depth z is `base + tipTaper * z`, and
	// nodes below the tip carry nothing. Stretching the profile across the whole
	// grid instead would both draw a stalactite longer than it is and make
	// `volumeOf` disagree with the closed form.
	const newRadius = new Float64Array(nodeCount + 1);
	for (let i = 0; i <= nodeCount; i++) {
		const z = i * spacing;
		newRadius[i] = z > length ? 1.0e-5 : newTipR + tipTaper * z;
	}

	return {
		radius: newRadius,
		tipDepth: length,
		years: sim.years + dt / secondsPerYear,
		deposited: deposited,
		mass: deposited * rhoCalcite
	};
}

function clamp(x: number, lo: number, hi: number): number {
	return x < lo ? lo : x > hi ? hi : x;
}

export function stepMany(count: number, dt: number, env: Env, sim: Sim): Sim {
	let s = sim;
	for (let i = 0; i < count; i++) s = step(dt, env, s);
	return s;
}

/**
 * Advance by `yearSlice` years.
 *
 * The substep is bounded so the fastest-growing cell moves less than a fifth of
 * a node in one step, and at least `minSteps` substeps are used so slow growth
 * still animates smoothly.
 */
export function advance(params: Params, env: Env, yearSlice: number, sim: Sim): Sim {
	// Guard on the chamber depth only, never on `gridSpan`: the grid cap is a
	// resolution limit, not the end of the simulation, so time must keep
	// accumulating once the tip reaches it. Freezing here would stop the clock
	// at 1.28 m while the panel still showed a growing formation.
	if (sim.tipDepth >= env.maxDepth) return sim;

	const q = fluxOf(env);
	const ceq = caEq(env.tempC, env.cavePCO2);
	const excess0 = Math.max(0.0, env.caIn - ceq);
	const apexR = sim.radius[0] ?? seedRadius;

	// Substep from the fastest rate the model can express: the whole supply
	// landing on the apex.
	const apexVolumePerSecond = q * excess0 * molarVolume;
	const tipRate = apexVolumePerSecond / Math.max(Math.PI * apexR * apexR, 1.0e-12);

	const nodeTime =
		tipRate <= 1.0e-24 ? 1.0e13 : (0.002 * apexR) / tipRate;

	const target = yearSlice * secondsPerYear;
	const wanted = Math.max(params.minSteps, Math.ceil(target / clamp(nodeTime, 1.0e-3, 1.0e13)));
	const count = clamp(wanted, 1, params.maxSteps);
	const dt = target / count;

	return stepMany(count, dt, env, sim);
}

// ---------------------------------------------------------------------------
// READOUTS
// ---------------------------------------------------------------------------

/**
 * How fast the tip is descending, mm/year, at the formation's current size.
 *
 * Differentiating the shape law, the calcite arriving in a second lengthens the
 * cone by `dV/dt / (pi (a + gamma L)^2)`, and only `lengthFraction` of it goes to
 * length at all. So
 *
 *     dL/dt = lengthFraction * Q (c - c_eq) Omega / (pi (a + gamma L)^2)
 *
 * which carries its own slowing: as the cone widens, the same supply buys less
 * length. A stalactite therefore grows quickly while it is thin and then appears
 * to stall, which is exactly what dating shows.
 */
export function tipGrowthMmPerYear(env: Env, sim: Sim): number {
	const l = lengthOf(sim);
	const halfWidth = tipFloor + tipTaper * l;
	return (
		((lengthFraction * fluxOf(env) * supersaturationOf(env) * molarVolume) /
			(Math.PI * halfWidth * halfWidth)) *
		secondsPerYear *
		1000.0
	);
}

/**
 * Radial thickening of any section, mm/year. With a fixed taper the whole profile
 * widens at `gamma` times the rate at which the tip descends.
 */
export function wallGrowthMmPerYear(env: Env, sim: Sim): number {
	return tipTaper * tipGrowthMmPerYear(env, sim);
}

/** Everything the renderer and the instrument panel need. */
export interface View {
	points: Array<[number, number]>;
	length: number;
	apexRadius: number;
	filmMicrons: number;
	filmVelocityMmS: number;
	degasSeconds: number;
	residenceSeconds: number;
	supersaturationIn: number;
	apexExcess: number;
	caIn: number;
	caEq: number;
	saturationIndex: number;
	tipGrowthMmPerYear: number;
	wallGrowthMmPerYear: number;
	depletionLengthM: number;
	surfaceAreaM2: number;
	waterFilmVolumeMl: number;
	volumeCm3: number;
	massGrams: number;
	reynolds: number;
	wettedPerimeterMm: number;
	dripIntervalSeconds: number;
}

export function view(env: Env, sim: Sim): View {
	const q = fluxOf(env);
	const apexR = sim.radius[0] ?? seedRadius;
	const p0 = perimeterOf(env, apexR);
	const h0 = filmThickness(q, p0);

	let residence = 0.0;
	for (let i = 0; i < nodeCount; i++) {
		const r = sim.radius[i] ?? seedRadius;
		residence += spacing / Math.max(filmVelocity(q, perimeterOf(env, r)), 1.0e-9);
	}

	return {
		points: profilePoints(sim),
		length: lengthOf(sim),
		apexRadius: apexR,
		filmMicrons: h0 * 1.0e6,
		filmVelocityMmS: filmVelocity(q, p0) * 1000.0,
		degasSeconds: degasTime(h0),
		residenceSeconds: residence,
		supersaturationIn: supersaturationOf(env),
		apexExcess: excessAtApex(env, sim),
		caIn: env.caIn,
		caEq: caEq(env.tempC, env.cavePCO2),
		saturationIndex: saturationIndex(env),
		tipGrowthMmPerYear: tipGrowthMmPerYear(env, sim),
		wallGrowthMmPerYear: wallGrowthMmPerYear(env, sim),
		depletionLengthM: depletionLengthOf(env, sim),
		surfaceAreaM2: surfaceAreaOf(sim),
		waterFilmVolumeMl: filmVolume(env, sim) * 1.0e6,
		volumeCm3: volumeByFrusta(sim) * 1.0e6,
		massGrams: sim.mass,
		reynolds: reynoldsOf(q, p0),
		wettedPerimeterMm: p0 * 1000.0,
		dripIntervalSeconds: dripIntervalFromRate(env.dripRate)
	};
}
