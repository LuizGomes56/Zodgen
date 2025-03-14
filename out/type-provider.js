"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.copyType = copyType;
const vscode = __importStar(require("vscode"));
const stringify_type_tree_1 = require("./stringify-type-tree");
async function copyType(full = false) {
    const config = vscode.workspace.getConfiguration('prettify-ts');
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    const indentation = config.get('typeIndentation', 4);
    const options = {
        hidePrivateProperties: config.get('hidePrivateProperties', true),
        maxDepth: config.get('maxDepth', 2),
        maxProperties: config.get('maxProperties', 100),
        maxSubProperties: config.get('maxSubProperties', 5),
        maxUnionMembers: config.get('maxUnionMembers', 15),
        skippedTypeNames: config.get('skippedTypeNames', [
            "Array",
            "ArrayBuffer",
            "Buffer",
            "Date",
            "Element",
            "Error",
            "Map",
            "Number",
            "RegExp",
            "Set",
            "String",
            "Symbol",
            "JsonValue",
            "JsonObject",
            "JsonArray",
            "Decimal",
            "AbortController",
            "AbortSignal",
        ]),
        unwrapArrays: config.get('unwrapArrays', true),
        unwrapFunctions: config.get('unwrapFunctions', true),
        unwrapPromises: config.get('unwrapPromises', true)
    };
    const request = {
        meta: 'prettify-type-info-request',
        options
    };
    const cursorPosition = editor.selection.active;
    const location = {
        file: editor.document.uri.fsPath,
        line: cursorPosition.line + 1,
        offset: cursorPosition.character + 1
    };
    const response = await vscode.commands.executeCommand('typescript.tsserverRequest', 'completionInfo', {
        ...location,
        triggerCharacter: request
    });
    const prettifyResponse = response?.body?.__prettifyResponse;
    if (!prettifyResponse || !prettifyResponse.typeTree) {
        await vscode.window.showErrorMessage('No type information found at cursor position');
        return;
    }
    const { typeTree, syntaxKind, name } = prettifyResponse;
    const typeString = (0, stringify_type_tree_1.stringifyTypeTree)(typeTree, false);
    const prettyTypeString = (0, stringify_type_tree_1.prettyPrintTypeString)(typeString, indentation);
    const declaration = (0, stringify_type_tree_1.getSyntaxKindDeclaration)(syntaxKind, name);
    await vscode.env.clipboard.writeText(declaration + prettyTypeString);
}
//# sourceMappingURL=type-provider.js.map