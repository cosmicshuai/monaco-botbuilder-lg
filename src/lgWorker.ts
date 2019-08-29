/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as ts from './lgService';
import * as lg from './lib/LGbundle';

import IWorkerContext = monaco.worker.IWorkerContext;

export class LGWorker {

	// --- model sync -----------------------

	private _ctx: IWorkerContext;

	constructor(ctx: IWorkerContext) {
		this._ctx = ctx;
	}

	// --- language service host ---------------
	private _getModel(fileName: string): monaco.worker.IMirrorModel {
		let models = this._ctx.getMirrorModels();
		for (let i = 0; i < models.length; i++) {
			if (models[i].uri.toString() === fileName) {
				return models[i];
			}
		}
		return null;
	}

	getCurrentDirectory(): string {
		return '';
	}

	// // --- language features
	// getQuickInfoAtPosition(fileName: string, position: number): Promise<ts.QuickInfo> {
	// 	return Promise.resolve(this._languageService.getQuickInfoAtPosition(fileName, position));
	// }


	getLGDiagnostics(contents: string): Promise< ts.Diagnostic[]> {
		const LGDiagnostics: lg.Diagnostic[] = lg.StaticChecker.checkText(contents);
		var diagnostics: ts.Diagnostic[] = [];
		for (const diag of LGDiagnostics) {
			let diagnostic: ts.Diagnostic = {
				start: diag.Range.Start.Line,
				startColumn: diag.Range.Start.Character,
				endColumn: diag.Range.End.Character,
				end: diag.Range.End.Character,
				category: diag.Severity.valueOf(),
				messageText: diag.Message
			}
			diagnostics.push(diagnostic);
		}
        return Promise.resolve(diagnostics);
	}
}


export function create(ctx: IWorkerContext): LGWorker {
	return new LGWorker(ctx);
}
