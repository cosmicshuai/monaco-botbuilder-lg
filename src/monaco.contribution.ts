/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as mode from './tsMode';
//import { typescriptVersion } from './lib/typescriptServicesMetadata'; // do not import the whole typescriptServices here

import Emitter = monaco.Emitter;
import IEvent = monaco.IEvent;
import IDisposable = monaco.IDisposable;

// --- TypeScript configuration and defaults ---------

export interface IExtraLib {
	content: string;
	version: number;
}


export class LanguageServiceDefaultsImpl {

	private _onDidChange = new Emitter<void>();
	private _onDidExtraLibsChange = new Emitter<void>();

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
	return import('./tsMode');
}
monaco.languages.register({ id: 'botbuilderlg' });

monaco.languages.onLanguage('botbuilderlg', () => {
	return getMode().then(mode => mode.setupLG(LGDefaults));
});
