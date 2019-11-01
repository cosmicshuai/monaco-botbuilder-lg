/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { LanguageServiceDefaultsImpl } from './monaco.contribution';
import * as ts from './lgService';
import { LGWorker } from './lgWorker';
import * as util from './util';
import {LGTemplate, TemplateEngine, ImportResolver} from './lib/LGbundle';

import Uri = monaco.Uri;
import Position = monaco.Position;
import Range = monaco.Range;
import Thenable = monaco.Thenable;
import CancellationToken = monaco.CancellationToken;
import IDisposable = monaco.IDisposable;
import {buildInfunctionsMap} from './builtinFunctions'

//#region utils copied from typescript to prevent loading the entire typescriptServices ---

function flattenDiagnosticMessageText(messageText: string | ts.DiagnosticMessageChain, newLine: '\n'): string {
	if (typeof messageText === "string") {
		return messageText;
	} else {
		let diagnosticChain = messageText;
		let result = "";
		let indent = 0;
		while (diagnosticChain) {
			if (indent) {
				result += newLine;
				for (let i = 0; i < indent; i++) {
					result += "  ";
				}
			}
			result += diagnosticChain.messageText;
			indent++;
			diagnosticChain = diagnosticChain.next;
		}
		return result;
	}
}

function displayPartsToString(displayParts: ts.SymbolDisplayPart[]): string {
	if (displayParts) {
		return displayParts.map((displayPart) => displayPart.text).join("");
	}
	return "";
}

//#endregion

export abstract class Adapter {

	constructor(protected _worker: (first: Uri, ...more: Uri[]) => Promise<LGWorker>) {
	}

	protected _positionToOffset(uri: Uri, position: monaco.IPosition): number {
		let model = monaco.editor.getModel(uri);
		return model.getOffsetAt(position);
	}

	protected _offsetToPosition(uri: Uri, offset: number): monaco.IPosition {
		let model = monaco.editor.getModel(uri);
		return model.getPositionAt(offset);
	}

	protected _textSpanToRange(uri: Uri, span: ts.TextSpan): monaco.IRange {
		let p1 = this._offsetToPosition(uri, span.start);
		let p2 = this._offsetToPosition(uri, span.start + span.length);
		let { lineNumber: startLineNumber, column: startColumn } = p1;
		let { lineNumber: endLineNumber, column: endColumn } = p2;
		return { startLineNumber, startColumn, endLineNumber, endColumn };
	}
}

// --- diagnostics --- ---

export class DiagnostcsAdapter extends Adapter {

	private _disposables: IDisposable[] = [];
	private _listener: { [uri: string]: IDisposable } = Object.create(null);

	constructor(private _defaults: LanguageServiceDefaultsImpl, private _selector: string,
		worker: (first: Uri, ...more: Uri[]) => Promise<LGWorker>
	) {
		super(worker);

		const onModelAdd = (model: monaco.editor.IModel): void => {
			if (model.getModeId() !== _selector) {
				return;
			}

			let handle: number;
			const changeSubscription = model.onDidChangeContent(() => {
				clearTimeout(handle);
				handle = setTimeout(() => this._doValidate(model.uri, model.getLinesContent().join('\n')), 500);
			});

			this._listener[model.uri.toString()] = {
				dispose() {
					changeSubscription.dispose();
					clearTimeout(handle);
				}
			};

			this._doValidate(model.uri, model.getLinesContent().join('\n'));

		};

		const onModelRemoved = (model: monaco.editor.IModel): void => {
			monaco.editor.setModelMarkers(model, this._selector, []);
			const key = model.uri.toString();
			if (this._listener[key]) {
				this._listener[key].dispose();
				delete this._listener[key];
			}
		};

		this._disposables.push(monaco.editor.onDidCreateModel(onModelAdd));
		this._disposables.push(monaco.editor.onWillDisposeModel(onModelRemoved));
		this._disposables.push(monaco.editor.onDidChangeModelLanguage(event => {
			onModelRemoved(event.model);
			onModelAdd(event.model);
		}));

		this._disposables.push({
			dispose() {
				for (const model of monaco.editor.getModels()) {
					onModelRemoved(model);
				}
			}
		});

		const recomputeDiagostics = () => {
			// redo diagnostics when options change
			for (const model of monaco.editor.getModels()) {
				onModelRemoved(model);
				onModelAdd(model);
			}
		};
		this._disposables.push(this._defaults.onDidChange(recomputeDiagostics));
		monaco.editor.getModels().forEach(onModelAdd);
	}

	public dispose(): void {
		this._disposables.forEach(d => d && d.dispose());
		this._disposables = [];
	}

	private _doValidate(resource: Uri, contents: string): void {
		this._worker(resource).then(worker => {
			if (!monaco.editor.getModel(resource)) {
				// model was disposed in the meantime
				return null;
			}
			const promises: Promise<ts.Diagnostic[]>[] = [];
			promises.push(worker.getLGDiagnostics(contents));
			return Promise.all(promises);
		}).then(diagnostics => {
			if (!diagnostics || !monaco.editor.getModel(resource)) {
				// model was disposed in the meantime
				return null;
			}
			const markers = diagnostics
				.reduce((p, c) => c.concat(p), [])
				.map(d => this._convertDiagnostics(resource, d));
			monaco.editor.setModelMarkers(monaco.editor.getModel(resource), this._selector, markers);
		}).then(undefined, err => {
		});
	}

	private toSeverity(lsSeverity: number): monaco.MarkerSeverity {
		switch (lsSeverity) {
			case ts.DiagnosticCategory.Error: return monaco.MarkerSeverity.Error;
			case ts.DiagnosticCategory.Warning: return monaco.MarkerSeverity.Warning;
			case ts.DiagnosticCategory.Message: return monaco.MarkerSeverity.Info;
			case ts.DiagnosticCategory.Suggestion: return monaco.MarkerSeverity.Hint;
			default:
				return monaco.MarkerSeverity.Info;
		}
	}

	private _convertDiagnostics(resource: Uri, diag: ts.Diagnostic): monaco.editor.IMarkerData {
		const { lineNumber: startLineNumber, column: startColumn } =  { lineNumber: diag.start, column: diag.startColumn }
		const { lineNumber: endLineNumber, column: endColumn } = { lineNumber: diag.end, column: diag.endColumn }

		return {
			severity: this.toSeverity(diag.category),
			startLineNumber,
			startColumn,
			endLineNumber,
			endColumn,
			message: flattenDiagnosticMessageText(diag.messageText, '\n')
		};
	}
}

// --- suggest ------
export class SuggestAdapter extends Adapter implements monaco.languages.CompletionItemProvider {

	public get triggerCharacters(): string[] {
		return ['.'];
	}

	private async matchedStates(model: monaco.editor.IReadOnlyModel, position: Position): Promise<{matched: boolean; state:string}> {
		const state : string[] = [];
		const lineContent = model.getLineContent(position.lineNumber);
		let flag = false;
		let finalState = '';
		if (lineContent.trim().indexOf('-') !== 0) {
			return {matched: flag, state:finalState}
		};

		//if the line starts with '-', will try to match
		flag = true;
		//initilize the state to plaintext
		state.push('PlainText');
		let i = 0;
		while (i < lineContent.length) {
			let char = lineContent.charAt(i);
			if (char === `'`) {
				if (state[state.length -1] === 'expression' || state[state.length -1] === 'double') {
					state.push('single')
				} else {
					state.pop()
				}
			}

			if (char === `"`) {
				if (state[state.length -1] === 'expression' || state[state.length -1] === 'single') {
					state.push('double')
				} else {
					state.pop()
				}
			}			

			if (char === '{' && i >= 1 && state[state.length -1] !== 'single' && state[state.length -1] !== 'double' ) {
				if (lineContent.charAt(i-1) === '@') {
					state.push('expression')
				}
			}

			if (char === '}' && state[state.length -1] === 'expression') {
				state.pop()
			}
			i = i + 1
	};
	finalState = state[state.length -1]
	return {matched: flag, state:finalState}
}

	private removeParamFormar(params: string): string {
		const paramArr: string[] = params.split(",");
		const resultArr: string[] = [];
		paramArr.forEach(element => { resultArr.push(element.trim().split(':')[0])});
		return resultArr.join(' ,');
	}

	provideCompletionItems(model: monaco.editor.IReadOnlyModel, position: Position, _context: monaco.languages.CompletionContext, token: CancellationToken): Thenable<monaco.languages.CompletionList> {
		const wordInfo = model.getWordUntilPosition(position);
		const wordRange = new Range(position.lineNumber, wordInfo.startColumn, position.lineNumber, wordInfo.endColumn);
		const resource = model.uri;

		return this._worker(resource).then(() =>this.matchedStates(model, position).then(
			(match) => {
			let suggestions: monaco.languages.CompletionItem[] = [];
			let functions = buildInfunctionsMap;
			functions.forEach((value, key) => {
				let item = {
					label: key,
					kind: monaco.languages.CompletionItemKind.Function,
					range: wordRange,
					//TODO: a little more to do to make completion more concrete
					insertText: key+ '(' + this.removeParamFormar(value.Params.toString()) + ')', 
					insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
					documentation: value.Introduction
				};
				suggestions.push(item);
			});

			const contents = model.getValue();
			const engine  = new TemplateEngine();
			try{
				engine.addText(contents, '', new ImportResolver());
			}
			catch {
				// ignore
			}
			
			const templates: LGTemplate[] = engine.templates;
			if (templates && templates.length > 0 ){
				templates.forEach(template => {
					let item = {
						label: template.Name,
						kind: monaco.languages.CompletionItemKind.Reference,
						range: wordRange,
						insertText: template.Parameters.length > 0? template.Name+ '(' + template.Parameters.join(", ") + ')' : template.Name, 
						insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
						documentation: template.Body
					};
					suggestions.push(item);
				});
			}
			if (match.matched && match.state === 'expression'){
				return {
					suggestions
				};
			}
		}));
	}
}

// export class SignatureHelpAdapter extends Adapter implements monaco.languages.SignatureHelpProvider {

// 	public signatureHelpTriggerCharacters = ['(', ','];

// 	provideSignatureHelp(model: monaco.editor.IReadOnlyModel, position: Position, token: CancellationToken): Thenable<monaco.languages.SignatureHelp> {
// 		let resource = model.uri;
// 		return this._worker(resource).then(worker => worker.getSignatureHelpItems(resource.toString(), this._positionToOffset(resource, position))).then(info => {

// 			if (!info) {
// 				return;
// 			}

// 			let ret: monaco.languages.SignatureHelp = {
// 				activeSignature: info.selectedItemIndex,
// 				activeParameter: info.argumentIndex,
// 				signatures: []
// 			};

// 			info.items.forEach(item => {

// 				let signature: monaco.languages.SignatureInformation = {
// 					label: '',
// 					documentation: null,
// 					parameters: []
// 				};

// 				signature.label += displayPartsToString(item.prefixDisplayParts);
// 				item.parameters.forEach((p, i, a) => {
// 					let label = displayPartsToString(p.displayParts);
// 					let parameter: monaco.languages.ParameterInformation = {
// 						label: label,
// 						documentation: displayPartsToString(p.documentation)
// 					};
// 					signature.label += label;
// 					signature.parameters.push(parameter);
// 					if (i < a.length - 1) {
// 						signature.label += displayPartsToString(item.separatorDisplayParts);
// 					}
// 				});
// 				signature.label += displayPartsToString(item.suffixDisplayParts);
// 				ret.signatures.push(signature);
// 			});

// 			return ret;

// 		});
// 	}
// }

// --- hover ------

export class QuickInfoAdapter extends Adapter implements monaco.languages.HoverProvider {

	provideHover(model: monaco.editor.IReadOnlyModel, position: Position, token: CancellationToken): Thenable<monaco.languages.Hover> {
		let resource = model.uri;

		return this._worker(resource).then(worker => {
			return model.getWordAtPosition(position)
		}).then(wordInfo => {
			if (!wordInfo) {
				return;
			}
			let wordName = wordInfo.word;
			if (wordName.indexOf('builtin.') == 0) {
				wordName = wordName.substring('builtin.'.length);
			}

			if (buildInfunctionsMap.has(wordName)) {
				let startPostion = {lineNumber: position.lineNumber, column: wordInfo.startColumn};
				let endPostion = {lineNumber: position.lineNumber, column: wordInfo.endColumn};
				let range =  monaco.Range.fromPositions(startPostion, endPostion);
				const functionEntity = buildInfunctionsMap.get(wordName);
				const returnType = util.GetreturnTypeStrFromReturnType(functionEntity.Returntype);
				return {
					range: range,
					contents: [{
						value: `${wordName}(${functionEntity.Params.join(", ")}): ${returnType}`
					}, {
						value: functionEntity.Introduction
					}]
				}
			}

			const contents = model.getValue();
			const engine  = new TemplateEngine();
			try{
				engine.addText(contents, '', new ImportResolver());
			}
			catch {
				// ignore
			}
			
			const templates: LGTemplate[] = engine.templates;
			const templateMap: Map<string,  LGTemplate> = new Map();
			if (templates && templates.length > 0 ) {
				templates.forEach(template => {
					templateMap.set(template.Name, template);
				})

				if (templateMap.has(wordName)) {
					let startPostion = {lineNumber: position.lineNumber, column: wordInfo.startColumn};
					let endPostion = {lineNumber: position.lineNumber, column: wordInfo.endColumn};
					let range =  monaco.Range.fromPositions(startPostion, endPostion);
					const templateEntity = templateMap.get(wordName);
					return {
						range: range,
						contents: [{
							value: `${templateEntity.Name}${templateEntity.Parameters.length > 0 ?'(' + templateEntity.Parameters.join(", ") + ')' : ""}: ${templateEntity.Body}`
						}, {
							value: templateEntity.Source
						}]
					}
				}
			}




			;
		});
	}
}

// // --- occurrences ------

// export class OccurrencesAdapter extends Adapter implements monaco.languages.DocumentHighlightProvider {

// 	public provideDocumentHighlights(model: monaco.editor.IReadOnlyModel, position: Position, token: CancellationToken): Thenable<monaco.languages.DocumentHighlight[]> {
// 		const resource = model.uri;

// 		return this._worker(resource).then(worker => {
// 			return worker.getOccurrencesAtPosition(resource.toString(), this._positionToOffset(resource, position));
// 		}).then(entries => {
// 			if (!entries) {
// 				return;
// 			}
// 			return entries.map(entry => {
// 				return <monaco.languages.DocumentHighlight>{
// 					range: this._textSpanToRange(resource, entry.textSpan),
// 					kind: entry.isWriteAccess ? monaco.languages.DocumentHighlightKind.Write : monaco.languages.DocumentHighlightKind.Text
// 				};
// 			});
// 		});
// 	}
// }

// // --- definition ------

// export class DefinitionAdapter extends Adapter {

// 	public provideDefinition(model: monaco.editor.IReadOnlyModel, position: Position, token: CancellationToken): Thenable<monaco.languages.Definition> {
// 		const resource = model.uri;

// 		return this._worker(resource).then(worker => {
// 			return worker.getDefinitionAtPosition(resource.toString(), this._positionToOffset(resource, position));
// 		}).then(entries => {
// 			if (!entries) {
// 				return;
// 			}
// 			const result: monaco.languages.Location[] = [];
// 			for (let entry of entries) {
// 				const uri = Uri.parse(entry.fileName);
// 				if (monaco.editor.getModel(uri)) {
// 					result.push({
// 						uri: uri,
// 						range: this._textSpanToRange(uri, entry.textSpan)
// 					});
// 				}
// 			}
// 			return result;
// 		});
// 	}
// }

// // --- references ------

// export class ReferenceAdapter extends Adapter implements monaco.languages.ReferenceProvider {

// 	provideReferences(model: monaco.editor.IReadOnlyModel, position: Position, context: monaco.languages.ReferenceContext, token: CancellationToken): Thenable<monaco.languages.Location[]> {
// 		const resource = model.uri;

// 		return this._worker(resource).then(worker => {
// 			return worker.getReferencesAtPosition(resource.toString(), this._positionToOffset(resource, position));
// 		}).then(entries => {
// 			if (!entries) {
// 				return;
// 			}
// 			const result: monaco.languages.Location[] = [];
// 			for (let entry of entries) {
// 				const uri = Uri.parse(entry.fileName);
// 				if (monaco.editor.getModel(uri)) {
// 					result.push({
// 						uri: uri,
// 						range: this._textSpanToRange(uri, entry.textSpan)
// 					});
// 				}
// 			}
// 			return result;
// 		});
// 	}
// }

// // --- outline ------

// export class OutlineAdapter extends Adapter implements monaco.languages.DocumentSymbolProvider {

// 	public provideDocumentSymbols(model: monaco.editor.IReadOnlyModel, token: CancellationToken): Thenable<monaco.languages.DocumentSymbol[]> {
// 		const resource = model.uri;

// 		return this._worker(resource).then(worker => worker.getNavigationBarItems(resource.toString())).then(items => {
// 			if (!items) {
// 				return;
// 			}

// 			const convert = (bucket: monaco.languages.DocumentSymbol[], item: ts.NavigationBarItem, containerLabel?: string): void => {
// 				let result: monaco.languages.DocumentSymbol = {
// 					name: item.text,
// 					detail: '',
// 					kind: <monaco.languages.SymbolKind>(outlineTypeTable[item.kind] || monaco.languages.SymbolKind.Variable),
// 					range: this._textSpanToRange(resource, item.spans[0]),
// 					selectionRange: this._textSpanToRange(resource, item.spans[0]),
// 					containerName: containerLabel
// 				};

// 				if (item.childItems && item.childItems.length > 0) {
// 					for (let child of item.childItems) {
// 						convert(bucket, child, result.name);
// 					}
// 				}

// 				bucket.push(result);
// 			}

// 			let result: monaco.languages.DocumentSymbol[] = [];
// 			items.forEach(item => convert(result, item));
// 			return result;
// 		});
// 	}
// }

// // --- formatting ----

// export abstract class FormatHelper extends Adapter {
// 	protected static _convertOptions(options: monaco.languages.FormattingOptions): ts.FormatCodeOptions {
// 		return {
// 			ConvertTabsToSpaces: options.insertSpaces,
// 			TabSize: options.tabSize,
// 			IndentSize: options.tabSize,
// 			IndentStyle: IndentStyle.Smart,
// 			NewLineCharacter: '\n',
// 			InsertSpaceAfterCommaDelimiter: true,
// 			InsertSpaceAfterSemicolonInForStatements: true,
// 			InsertSpaceBeforeAndAfterBinaryOperators: true,
// 			InsertSpaceAfterKeywordsInControlFlowStatements: true,
// 			InsertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
// 			InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
// 			InsertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
// 			InsertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
// 			PlaceOpenBraceOnNewLineForControlBlocks: false,
// 			PlaceOpenBraceOnNewLineForFunctions: false
// 		};
// 	}

// 	protected _convertTextChanges(uri: Uri, change: ts.TextChange): monaco.editor.ISingleEditOperation {
// 		return <monaco.editor.ISingleEditOperation>{
// 			text: change.newText,
// 			range: this._textSpanToRange(uri, change.span)
// 		};
// 	}
// }

// export class FormatAdapter extends FormatHelper implements monaco.languages.DocumentRangeFormattingEditProvider {

// 	provideDocumentRangeFormattingEdits(model: monaco.editor.IReadOnlyModel, range: Range, options: monaco.languages.FormattingOptions, token: CancellationToken): Thenable<monaco.editor.ISingleEditOperation[]> {
// 		const resource = model.uri;

// 		return this._worker(resource).then(worker => {
// 			return worker.getFormattingEditsForRange(resource.toString(),
// 				this._positionToOffset(resource, { lineNumber: range.startLineNumber, column: range.startColumn }),
// 				this._positionToOffset(resource, { lineNumber: range.endLineNumber, column: range.endColumn }),
// 				FormatHelper._convertOptions(options));
// 		}).then(edits => {
// 			if (edits) {
// 				return edits.map(edit => this._convertTextChanges(resource, edit));
// 			}
// 		});
// 	}
// }

// export class FormatOnTypeAdapter extends FormatHelper implements monaco.languages.OnTypeFormattingEditProvider {

// 	get autoFormatTriggerCharacters() {
// 		return [';', '}', '\n'];
// 	}

// 	provideOnTypeFormattingEdits(model: monaco.editor.IReadOnlyModel, position: Position, ch: string, options: monaco.languages.FormattingOptions, token: CancellationToken): Thenable<monaco.editor.ISingleEditOperation[]> {
// 		const resource = model.uri;

// 		return this._worker(resource).then(worker => {
// 			return worker.getFormattingEditsAfterKeystroke(resource.toString(),
// 				this._positionToOffset(resource, position),
// 				ch, FormatHelper._convertOptions(options));
// 		}).then(edits => {
// 			if (edits) {
// 				return edits.map(edit => this._convertTextChanges(resource, edit));
// 			}
// 		});
// 	}
//}
