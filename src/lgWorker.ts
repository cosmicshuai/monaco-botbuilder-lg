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
	getCurrentDirectory(): string {
		return '';
	}

	private convertSeverity(severity: lg.DiagnosticSeverity): ts.DiagnosticCategory {
		switch (severity) {
		  case lg.DiagnosticSeverity.Error:
			return ts.DiagnosticCategory.Error;
		  case lg.DiagnosticSeverity.Hint:
			return ts.DiagnosticCategory.Suggestion;
		  case lg.DiagnosticSeverity.Information:
			return ts.DiagnosticCategory.Message;
		  case lg.DiagnosticSeverity.Warning:
			return ts.DiagnosticCategory.Warning;
		}
	  }

	getLGDiagnostics(contents: string): Promise< ts.Diagnostic[]> {
		const staticChercher = new lg.StaticChecker();
		const LGDiagnostics: lg.Diagnostic[] = staticChercher.checkText(contents, '', lg.ImportResolver.fileResolver);
		var diagnostics: ts.Diagnostic[] = [];
		for (const diag of LGDiagnostics) {
			let diagnostic: ts.Diagnostic = {
				start: diag.Range.Start.Line,
				startColumn: diag.Range.Start.Character,
				end: diag.Range.End.Line,
				endColumn: diag.Range.End.Character,
				category: this.convertSeverity(diag.Severity),
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
