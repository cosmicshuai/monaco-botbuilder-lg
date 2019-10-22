/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { WorkerManager } from './workerManager';
import { LGWorker } from './lgWorker';
import { LanguageServiceDefaultsImpl } from './monaco.contribution';
import * as languageFeatures from './languageFeatures';

import Uri = monaco.Uri;

let lgWorker: (first: Uri, ...more: Uri[]) => Promise<LGWorker>;

export function setupLG(defaults: LanguageServiceDefaultsImpl): void {
	lgWorker = setupMode(
		defaults,
		'botbuilderlg'
	);
}

export function getLGWorker(): Promise<(first: Uri, ...more: Uri[]) => Promise<LGWorker>> {
	return new Promise((resolve, reject) => {
		if (!lgWorker) {
			return reject("LG not registered!");
		}

		resolve(lgWorker);
	});
}

function setupMode(defaults: LanguageServiceDefaultsImpl, modeId: string): (first: Uri, ...more: Uri[]) => Promise<LGWorker> {

	const client = new WorkerManager(modeId, defaults);
	const worker = (first: Uri, ...more: Uri[]): Promise<LGWorker> => {
		return client.getLanguageServiceWorker(...[first].concat(more));
	};

	monaco.languages.setMonarchTokensProvider('botbuilderlg', {
		ignoreCase: true,
		tokenizer: {
			root: [
			  //keywords
			  [/(if|else|else\s*if|switch|case|default)\s*:/, {token: 'keywords'}],
	
			  // template name line
			  [/^\s*#[\s\S]+\s*$/,  'template-name'],
	  
			  // template body
			  [/^\s*-/, 'template-body'],
			
			  //comments
			  [/^\s*>[\s\S]*/, 'comments'],
	  
			  //fence block
			  [/^\s*`{3}/, {token: 'fence-block', next: '@fence_block'}],
			  
			  //inline string
			  [/^\s*\"/,  {token: 'inline-string', next: '@inline_string'}],
	  
			  //template-ref 
			  [/\[(.*?)(\(.*?(\[.+\])?\))?\]/,  'template-ref'],
	  
			  // import statement in lg
			  [/\[.*\]/, 'imports'],
	  
			  // structure_lg
			  [/^\s*\[/, {token: 'structure-lg', next:'@structure_lg'}], 
			  
			  //expression
			  [/\{/,  {token: 'expression', next: '@expression'}],

			  //expression
			  [/\(/,  {token: 'parameters', next: '@parameters'}],
			],

			fence_block: [
				[/`{3}\s*$/, 'fence-block', '@pop'],
				[/\([\s\S]*?\)\s*/,  {token: 'parameters'}],
				[/\{[\s\S]+?}/,  {token: 'expression'}],
				[/./, 'fence-block.content']
				
			], 

			inline_string: [
				[/\"\s*$/, 'inline-string', '@pop'],
				[/\([\s\S]*?\)\s*/,  {token: 'parameters'}],
				[/\{[\s\S]+?}/,  {token: 'expression'}],
				[/./, 'inline-string.content']
				
				
			], 

			expression: [
				[/}/, 'expression', '@pop'],
				[/\([\s\S]*?\)\s*/,  {token: 'parameters'}],
				[/./, 'expression.content']
				
			],

			parameters: [
				[/\)/, 'parameters', '@pop'],
				[/./, 'parameters.content']
			],

			structure_lg: [
			[/^\]\s*$/, 'structure-lg', '@pop'],
			[/([a-zA-Z0-9_]+\s*)=([\s\S]+)/, 'structure-expression'],
			[/\s*[a-zA-Z0-9_]\s*/, {token: 'structure-name'}]
			
			]
		}
	});
	
	// Define a new theme that contains only rules that match this language
	monaco.languages.registerCompletionItemProvider(modeId, new languageFeatures.SuggestAdapter(worker));
	monaco.languages.registerHoverProvider(modeId, new languageFeatures.QuickInfoAdapter(worker));
	new languageFeatures.DiagnostcsAdapter(defaults, modeId, worker);
	return worker;
}
