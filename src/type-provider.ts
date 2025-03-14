import { type TypeInfo } from './typescript-plugin/type-tree/types'
import * as vscode from 'vscode'
import { stringifyTypeTree, prettyPrintTypeString, getSyntaxKindDeclaration } from './stringify-type-tree'
import { type PrettifyRequest } from './types'

export async function copyType(full = false): Promise<void> {
    const config = vscode.workspace.getConfiguration('prettify-ts')
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    const indentation = config.get('typeIndentation', 4)
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
    }

    const request: PrettifyRequest = {
        meta: 'prettify-type-info-request',
        options
    }

    const cursorPosition = editor.selection.active
    const location = {
        file: editor.document.uri.fsPath,
        line: cursorPosition.line + 1,
        offset: cursorPosition.character + 1
    }

    const response: any = await vscode.commands.executeCommand(
        'typescript.tsserverRequest',
        'completionInfo',
        {
            ...location,
            triggerCharacter: request
        }
    )

    const prettifyResponse: TypeInfo | undefined = response?.body?.__prettifyResponse
    if (!prettifyResponse || !prettifyResponse.typeTree) {
        await vscode.window.showErrorMessage('No type information found at cursor position')
        return
    }

    const { typeTree, syntaxKind, name } = prettifyResponse

    const typeString = stringifyTypeTree(typeTree, false)
    const prettyTypeString = prettyPrintTypeString(typeString, indentation)
    const declaration = getSyntaxKindDeclaration(syntaxKind, name)

    await vscode.env.clipboard.writeText(declaration + prettyTypeString)
}