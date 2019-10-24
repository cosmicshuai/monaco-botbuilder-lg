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
		brackets: [
			{ open: '{', close: '}', token: 'delimiter.curly' },
			{ open: '[', close: ']', token: 'delimiter.bracket' },
			{ open: '(', close: ')', token: 'delimiter.parenthesis' }
		],
		tokenizer: {
			root: [
				// template name line
				[/^\s*#/, { token: 'template-name-identifier', next: '@template_name' }],
				// template body
				[/^\s*-/, { token: 'template-body-identifier', goBack: 1, next: '@template_body' }],
				//comments
				[/^\s*>/, { token: 'comments', next: '@comments' }],
				// import statement in lg
				[/\[.*\]/, 'imports'],
				//inline string
				[/^\s*\"/, { token: 'inline-string', next: '@inline_string' }],
				//bracktets
				[/[{}()\[\]]/, '@brackets']

			],
			comments: [
				[/^\s*#/, { token: 'template-name-identifier', next: '@template_name' }],
				[/^\s*-/, { token: 'template-body-identifier', next: '@template_body' }],
				[/./, 'comments']
			],
			template_name: [
				//comments
				[/^\s*>/, { token: 'comments', next: '@comments' }],
				//template_body
				[/^\s*-/, { token: 'template-body-identifier', goBack: 1, next: '@template_body' }],
				// structure_lg
				[/^\s*\[/, { token: 'structure-lg', next: '@structure_lg' }],
				//parameter in template name
				[/([a-zA-Z0-9_.' ]+)(,|\))/, ['parameter', 'delimeter']],
				// other
				[/./, 'template-name']
			],
			template_body: [
				//pop 
				[/[/s/S]*$/, '@pop'],
				//comments
				[/^\s*>/, { token: 'comments', next: '@comments' }],
				//template name
				[/^\s*#/, { token: 'template-name-identifier', next: '@template_name' }],
				//keywords
				[/(-\s*)(if|else|else\s*if|switch|case|default)(\s*:)/, ['identifier', 'keywords', 'colon']],
				//template_body
				[/^\s*-/, { token: 'template-body-identifier', next: '@template_body' }],
				//fence block
				[/`{3}/, { token: 'fence-block', next: '@fence_block' }],
				//template-ref 
				[/\[/, {token : 'template-ref', next: 'template_ref'}],
				//expression
				[/\{/, { token: 'expression', next: '@expression' }],
			],

			template_ref:
			[
				[/\]/, 'template-ref', '@pop'],
				[/([a-zA-Z0-9_.]+)(\()/,[{token:'function-name'}, {token:'param_identifier'}]],
				[/([a-zA-Z0-9_.' ]+)(,|\))/, ['parameter', 'delimeter']],
			],

			fence_block: [
				[/`{3}\s*$/, 'fence-block', '@pop'],
				[/\{/, { token: 'expression', next: '@expression' }],
				[/./, 'fence-block.content']
			],
			inline_string: [
				[/\"\s*$/, 'inline-string', '@pop'],
				[/\{/, { token: 'expression', next: '@expression' }],
				[/./, 'inline-string.content']
			],
			expression: [
				[/\}/, 'expression', '@pop'],
				[/([a-zA-Z0-9_.]+)(\()/,[{token:'function-name'}, {token:'param_identifier'}]],
				[/([a-zA-Z0-9_.' ]+)(,|\))/, ['parameter', 'delimeter']],
				[/./, 'expression.content']
			],
			structure_lg: [
				[/^\s*\]\s*$/, 'structure-lg', '@pop'],
				[/^\s*>[\s\S]*$/, 'comments'],
				[/(=|\|)([a_zA-Z0-9@ ]|\@)*\{/, { token: 'expression', next: '@expression' }],
				[/^\s*\{/, { token: 'expression', next: '@expression' }],
				[/=\s*[\s\S]+\s*$/, { token: 'structure-property' }],
				[/\s*[a-zA-Z0-9_ ]+\s*$/, { token: 'structure-name' }],
				[/./, 'structure-lg.content']
			],
		}
	});
	
	// Define a new theme that contains only rules that match this language
	monaco.languages.registerCompletionItemProvider(modeId, new languageFeatures.SuggestAdapter(worker));
	monaco.languages.registerHoverProvider(modeId, new languageFeatures.QuickInfoAdapter(worker));
	new languageFeatures.DiagnostcsAdapter(defaults, modeId, worker);
	return worker;
}
