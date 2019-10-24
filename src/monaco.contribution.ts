/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as mode from './lgMode';
import Emitter = monaco.Emitter;
import IEvent = monaco.IEvent;

// --- TypeScript configuration and defaults ---------

export interface IExtraLib {
	content: string;
	version: number;
}


export class LanguageServiceDefaultsImpl {

	private _onDidChange = new Emitter<void>();

	private _workerMaxIdleTime: number;
	private _eagerModelSync: boolean;

	constructor() {
		this._workerMaxIdleTime = 2 * 60 * 1000;
	}

	get onDidChange(): IEvent<void> {
		return this._onDidChange.event;
	}

	setMaximumWorkerIdleTime(value: number): void {
		// doesn't fire an event since no
		// worker restart is required here
		this._workerMaxIdleTime = value;
	}

	getWorkerMaxIdleTime() {
		return this._workerMaxIdleTime;
	}

	setEagerModelSync(value: boolean) {
		// doesn't fire an event since no
		// worker restart is required here
		this._eagerModelSync = value;
	}

	getEagerModelSync() {
		return this._eagerModelSync;
	}
}

const LGDefaults = new LanguageServiceDefaultsImpl();

// --- Registration to monaco editor ---
function getMode(): Promise<typeof mode> {
	return import('./lgMode');
}
monaco.languages.register({ id: 'botbuilderlg' });
monaco.editor.defineTheme('lgtheme', {
	base: 'vs',
	inherit: false,
	colors:{},
	rules: [
		{ token: 'template-name', foreground: '0000FF' },
		{ token: 'function-name', foreground: 'FFBB44' },
		{ token: 'keywords', foreground: '4488FF' },
		{ token: 'comments', foreground: '009F0C' },
		{ token: 'parameter', foreground: 'FF0B00'},
		{ token: 'structure-name', foreground: 'A966FF', fontStyle: 'italic' },
	]
});
monaco.languages.onLanguage('botbuilderlg', () => {
	return getMode().then(mode => mode.setupLG(LGDefaults));
});
