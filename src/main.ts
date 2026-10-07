import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { App } from './app/app';

/**
 * Zoneless: nothing here mutates state from outside Angular's knowledge, because
 * the animation loop runs in a signal-driven `effect`. That keeps change
 * detection tied to actual state changes instead of patch-everything.
 */
bootstrapApplication(App, {
	providers: [provideZonelessChangeDetection()]
}).catch((err) => console.error(err));
