export interface Diagnostic {
    category: DiagnosticCategory;
    start: number | undefined;
    startColumn: number | undefined;
    end: number | undefined;
    endColumn: number | undefined;
    messageText: string | DiagnosticMessageChain;
}

export enum DiagnosticCategory {
    Warning = 0,
    Error = 1,
    Suggestion = 2,
    Message = 3
}

export interface DiagnosticMessageChain {
    messageText: string;
    category: DiagnosticCategory;
    code: number;
    next?: DiagnosticMessageChain;
}

export interface SymbolDisplayPart {
    text: string;
    kind: string;
}

export interface TextSpan {
    start: number;
    length: number;
}

export interface QuickInfo {
    kind: ScriptElementKind;
    kindModifiers: string;
    textSpan: TextSpan;
    displayParts?: SymbolDisplayPart[];
    documentation?: SymbolDisplayPart[];
}

enum ScriptElementKind {
    unknown = "",
    warning = "warning",
    keyword = "keyword",
    template = "template",
    function = "function"
}