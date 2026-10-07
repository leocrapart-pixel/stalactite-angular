import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * A labelled range input with a live value readout.
 *
 * `value` is an Angular signal model, so the parent binds it two-way with
 * `[(value)]`. The displayed text comes from the `format` callback so each
 * caller picks its own units.
 */
@Component({
	selector: 'app-slider',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div style="display:flex;flex-direction:column;gap:3px">
			<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
				<span style="font:500 11.5px ui-sans-serif, system-ui, sans-serif;color:#e8eef6">{{
					label()
				}}</span>
				<span style="font:600 11.5px ui-monospace, monospace;color:#e0b070;white-space:nowrap">{{
					format()(value())
				}}</span>
			</div>
			<input
				type="range"
				[min]="min()"
				[max]="max()"
				[step]="step()"
				[value]="value()"
				(input)="onInput($event)"
				style="width:100%;height:18px;accent-color:#e0b070;cursor:pointer;background:transparent"
			/>
			@if (note()) {
				<div
					style="font:400 10.5px ui-sans-serif, system-ui, sans-serif;color:#5a6675;line-height:1.45"
				>
					{{ note() }}
				</div>
			}
		</div>
	`
})
export class Slider {
	readonly label = input.required<string>();
	readonly min = input.required<number>();
	readonly max = input.required<number>();
	readonly step = input.required<number>();
	readonly format = input.required<(v: number) => string>();
	readonly note = input<string>('');

	/** Two-way bound: the parent writes `[(value)]`. */
	readonly value = model.required<number>();

	protected onInput(event: Event): void {
		const el = event.target as HTMLInputElement;
		this.value.set(Number(el.value));
	}
}
