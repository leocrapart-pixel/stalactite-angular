/** Small view helpers and the dark "cave instrument" theme. */

export const paper = '#0a0c10';
export const ink = '#e8eef6';
export const dim = '#8b98a8';
export const faint = '#5a6675';
export const accent = '#e0b070';
export const accentSoft = 'rgba(224,176,112,0.14)';
export const water = '#6fb3d8';
export const panelBg = 'rgba(18,22,29,0.92)';
export const ok = '#79c98a';
export const warn = '#e0805a';

/** Inline style strings, kept as text so components stay template-only. */
export const sheetStyle = [
	'display:flex',
	'flex-direction:column',
	'gap:14px',
	'padding:14px',
	`background:${panelBg}`,
	`border:1px solid ${faint}`,
	'border-radius:10px',
	'backdrop-filter:blur(6px)'
].join(';');

export const sectionStyle = 'display:flex;flex-direction:column;gap:8px';

export const sectionTitleStyle = [
	'font:600 10px ui-monospace, monospace',
	'letter-spacing:0.16em',
	'text-transform:uppercase',
	`color:${accent}`,
	'opacity:0.85'
].join(';');

export const hintStyle = [
	'font:400 10.5px ui-sans-serif, system-ui, sans-serif',
	`color:${faint}`,
	'line-height:1.45'
].join(';');

export const rowStyle = [
	'display:flex',
	'justify-content:space-between',
	'align-items:baseline',
	'gap:10px',
	'font:11.5px ui-monospace, monospace'
].join(';');

export const rowValueStyle = 'font-weight:600;text-align:right';

/** The row-value style with an explicit colour, as one string.
 *
 * Two bindings on the same element — `[attr.style]` for the base and
 * `[style.color]` for the tint — fight each other, so the colour is folded
 * into the same value instead. */
export const rowValueColoured = (colour: string) => rowValueStyle + ';color:' + colour;

export const sliderLabelStyle = [
	'display:flex',
	'justify-content:space-between',
	'align-items:baseline',
	'gap:8px'
].join(';');

export const sliderNameStyle = 'font:500 11.5px ui-sans-serif, system-ui, sans-serif;color:' + ink;
export const sliderValueStyle = `font:600 11.5px ui-monospace, monospace;color:${accent};white-space:nowrap`;

export const buttonStyle = (active: boolean) =>
	[
		'font:600 11px ui-sans-serif, system-ui, sans-serif',
		'padding:7px 11px',
		'border-radius:7px',
		'cursor:pointer',
		`border:1px solid ${active ? accent : faint}`,
		`background:${active ? accentSoft : 'rgba(255,255,255,0.03)'}`,
		`color:${active ? accent : ink}`,
		'transition:all 120ms',
		'white-space:nowrap'
	].join(';');

export const badgeStyle = (colour: string) =>
	[
		'font:600 10px ui-monospace, monospace',
		'padding:2px 7px',
		'border-radius:999px',
		`border:1px solid ${colour}`,
		`color:${colour}`,
		'background:rgba(255,255,255,0.03)'
	].join(';');

// --- formatting -------------------------------------------------------------

const hundredths = (x: number) => Math.round(x * 100) / 100;
const thousandths = (x: number) => Math.round(x * 1000) / 1000;

export function formatYears(y: number): string {
	if (y < 1000) return `${Math.round(y)} years`;
	if (y < 1.0e6) return `${hundredths(y / 1000)} kyr`;
	return `${hundredths(y / 1.0e6)} Myr`;
}

export function formatSpeed(v: number): string {
	if (v >= 1000) return `${hundredths(v / 1000)} kyr / s`;
	return `${Math.round(v)} yr / s`;
}

export function formatRate(mmPerYear: number): string {
	if (mmPerYear >= 10) return `${hundredths(mmPerYear)} mm / yr`;
	if (mmPerYear >= 0.01) return `${thousandths(mmPerYear)} mm / yr`;
	return `${thousandths(mmPerYear * 1000)} µm / yr`;
}

export function formatSeconds(s: number): string {
	if (s < 0.001) return `${thousandths(s * 1.0e6)} µs`;
	if (s < 1) return `${thousandths(s * 1000)} ms`;
	if (s < 120) return `${hundredths(s)} s`;
	return `${hundredths(s / 60)} min`;
}

/**
 * `sim.mass` is in kilograms (`deposited * rhoCalcite`), despite the historical
 * field name in the Elm model.
 */
export function formatMass(kilograms: number): string {
	if (kilograms < 1.0e-6) return `${thousandths(kilograms * 1.0e9)} µg`;
	if (kilograms < 1.0e-3) return `${hundredths(kilograms * 1.0e6)} mg`;
	if (kilograms < 1.0) return `${hundredths(kilograms * 1000)} g`;
	return `${hundredths(kilograms)} kg`;
}

export function formatSmall(x: number): string {
	if (x === 0) return '0';
	if (Math.abs(x) < 0.001 || Math.abs(x) >= 100000) return `${thousandths(x * 1.0e3)}e-3`;
	return `${thousandths(x)}`;
}

export function formatRateText(r: number): string {
	if (r < 0.001) return `${thousandths(r * 1.0e6)} nL / min`;
	return `${thousandths(r)} mL / min`;
}

export function formatInterval(s: number): string {
	if (s < 90) return `${Math.round(s)} s`;
	if (s < 5400) return `${hundredths(s / 60)} min`;
	return `${hundredths(s / 3600)} h`;
}
