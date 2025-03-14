// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { generateSchema } from './generator';
import * as ts from 'typescript';

export type TypeExtractor = {
	name: string,
	file: string,
	rename?: string,
	expand?: boolean,
	export?: boolean
}[]

export type ZodgenConfig = {
	input: TypeExtractor,
	output: string
}[]

async function ExtractDefinition(typeName: string, filePath: vscode.Uri): Promise<string | null> {
	try {
		const fileContentUint8 = await vscode.workspace.fs.readFile(filePath);
		const fileContent = Buffer.from(fileContentUint8).toString('utf8');
		const sourceFile = ts.createSourceFile(
			path.basename(filePath.fsPath),
			fileContent,
			ts.ScriptTarget.Latest,
			true
		);
		let typeNode: ts.Node | undefined;
		let isExported = false;
		function visit(node: ts.Node) {
			if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
				node.name.text === typeName) {
				typeNode = node;
				if (node.modifiers) {
					isExported = node.modifiers.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
				}
				return;
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
		if (!typeNode) {
			vscode.window.showWarningMessage(`Type ou interface '${typeName}' não encontrado em '${filePath.fsPath}'.`);
			return null;
		}
		const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
		const result = printer.printNode(ts.EmitHint.Unspecified, typeNode, sourceFile);
		return isExported ? result : `export ${result}`;
	} catch (e) {
		vscode.window.showErrorMessage(`Erro ao extrair o tipo '${typeName}': ${e instanceof Error ? e.message : String(e)}`);
		return null;
	}
}

async function ExtractType(tfile: TypeExtractor[number], workspace: vscode.Uri, array: string[], index: number) {
	const typeName = tfile.name;
	const typeFile = tfile.file;
	const expansible = tfile.expand;
	const typePath = vscode.Uri.joinPath(workspace, typeFile);
	await vscode.workspace.fs.stat(typePath);
	try {
		if (expansible) {
			const document = await vscode.workspace.openTextDocument(typePath);
			const typeExists = await typeExistsInDocument(document, typeName);
			if (!typeExists) {
				array[index] = `// [Error: Type ${typeName} not found in ${typeFile}]`;
				return;
			}
			// Expand type definition
			const expandedType = await getExpandedType(document.uri, typeName);
			if (expandedType) {
				array[index] = expandedType;
			} else {
				array[index] = `// [Error: Couldn't expand the type ${typeName} from ${typeFile}]`;
			}
		}
		else {
			const definition = await ExtractDefinition(typeName, typePath);
			if (definition) {
				array[index] = definition;
			}
		}
	} catch (e) {
		array[index] = `// [Can't Expand type (${typeName} from ${typeFile})\n// Error: ${e instanceof Error ? e.message : String(e)}]`;
	}
	return array;
}

async function findAndReadZodgenSchemas() {
	try {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage("No workspace open!");
			return;
		}

		// find zodgen.config.ts
		const configPath = vscode.Uri.joinPath(workspaceFolder.uri, "zodgen.config.json");

		// Check if file exists
		try {
			await vscode.workspace.fs.stat(configPath);
		}
		catch {
			vscode.window.showErrorMessage("'zodgen.config.json' not found!");
			return;
		}
		// read the data in the file
		const data = await vscode.workspace.fs.readFile(configPath);

		const config: ZodgenConfig = JSON.parse(Buffer.from(data).toString('utf8'));

		for (const source of config) {
			let extractedTypes: string[] = [];
			// check all files specified in input.types and input.interfaces
			if (source.input) {
				let index = 0;
				for (const tfile of source.input) {
					await ExtractType(tfile, workspaceFolder.uri, extractedTypes, index);
					index++;
				}
			}
			for (let i = 0; i < extractedTypes.length; i++) {
				if (!extractedTypes[i]) continue;
				extractedTypes[i] = extractedTypes[i]
					.replace(/JsonValue/g, "any")
					.replace(/JsonObject|JsonArray/g, "any");
				const tpath = source.input[i];
				if (tpath) {
					// check exports
					if (tpath.export) {
						// Add "export" if not present
						extractedTypes[i] = extractedTypes[i].replace(
							/^(const|type|interface|enum|class)\s+/m,
							"export $1 "
						);
					} else {
						// Remove "export" if it exists
						extractedTypes[i] = extractedTypes[i].replace(/^export\s+/m, "");
					}
					// Rename type if needed
					if (tpath.rename) {
						extractedTypes[i] = extractedTypes[i].replace(
							new RegExp(`\\b${tpath.name}\\b`, "g"),
							tpath.rename
						);
					}
				}
			}
			const schema = generateSchema(
				extractedTypes.join('\n\n'),
				source.input
			);
			await saveSchemaFile(
				vscode.Uri.joinPath(workspaceFolder.uri, source.output),
				schema
			)
		}
	}
	catch (e) {
		vscode.window.showErrorMessage(`Error processing schemas: ${e instanceof Error ? e.message : String(e)}`);
		console.error("Error processing schemas:", e);
		return;
	}
}

async function getTypeInfoViaApi(document: vscode.TextDocument, position: vscode.Position): Promise<string> {
	const config = vscode.workspace.getConfiguration('prettify-ts');

	const MAX_SETTINGS = 999999999999;

	let options: any = {
		hidePrivateProperties: true,
		indentation: config.get('typeIndentation', 4),
		skippedTypeNames: config.get('skippedTypeNames', [
			"Array", "ArrayBuffer", "Buffer", "Date", "Element", "Error",
			"Map", "Number", "RegExp", "Set", "String", "Symbol",
			"JsonValue", "JsonObject", "JsonArray", "Decimal",
			"AbortController", "AbortSignal",
		]),
		maxDepth: MAX_SETTINGS,
		maxProperties: MAX_SETTINGS,
		maxSubProperties: MAX_SETTINGS,
		maxUnionMembers: MAX_SETTINGS,
		unwrapArrays: true,
		unwrapFunctions: true,
		unwrapPromises: true
	};

	const request: any = {
		meta: 'prettify-type-info-request',
		options
	};

	const location = {
		file: document.uri.fsPath,
		line: position.line + 1,
		offset: position.character + 7
	};

	// Call TypeScript server directly without activating editor UI
	const response: any = await vscode.commands.executeCommand(
		'typescript.tsserverRequest',
		'completionInfo',
		{
			...location,
			triggerCharacter: request
		}
	);

	// Give 400 extra milliseconds for the server to respond
	await threadSleep(400);

	const prettifyResponse: any = response?.body?.__prettifyResponse;
	if (!prettifyResponse || !prettifyResponse.typeTree) {
		return 'No type information found.';
	}
	const { typeTree, name } = prettifyResponse;

	// Convert the JSON structure to TypeScript syntax
	const typeDefinition = convertJsonTypeToTypeScript(typeTree);

	return `type ${name} = ${typeDefinition};`;
}

async function saveSchemaFile(fileName: vscode.Uri, fileContent: string) {
	try {
		await vscode.workspace.fs.writeFile(fileName, Buffer.from(fileContent, 'utf8'));
	}
	catch (e) {
		vscode.window.showErrorMessage(`Error saving schema file '${fileName}': ${e instanceof Error ? e.message : String(e)}`);
	}
}

function threadSleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function getExpandedType(filePath: vscode.Uri, typeName: string): Promise<string> {
	try {
		// Open the document where the type is defined (invisibly)
		const document = await vscode.workspace.openTextDocument(filePath);

		// Find the type definition in the file
		const docText = document.getText();
		const typeRegex = new RegExp(`(type|interface)\\s+${typeName}\\s*[=:]`, 'g');
		const typeMatch = typeRegex.exec(docText);
		if (!typeMatch) {
			return `// [Error: Type '${typeName}' not found]`;
		}
		// Find the position of the type in the document
		const typePos = document.positionAt(typeMatch.index);
		// Get type information directly via TypeScript language service
		const expandedType = await getTypeInfoViaApi(document, typePos);
		return expandedType || `// [Error: Type info not available]`;
	} catch (e) {
		console.error(`Error expanding type ${typeName}:`, e);
		return `// [Error: ${e instanceof Error ? e.message : String(e)}]`;
	}
}

function convertJsonTypeToTypeScript(typeJson: any): string {
	if (!typeJson) return 'any';

	switch (typeJson.kind) {
		case 'object':
			if (typeJson.properties && typeJson.properties.length > 0) {
				const props = typeJson.properties.map((prop: any) => {
					const optional = prop.optional ? '?' : '';
					const readonly = prop.readonly ? 'readonly ' : '';
					const propType = convertJsonTypeToTypeScript(prop.type);
					return `${readonly}${JSON.stringify(prop.name)}${optional}: ${propType}`;
				});

				return `{\n  ${props.join(';\n  ')}${props.length > 0 ? ';' : ''}\n}`;
			} else if (typeJson.typeName) {
				// Don't check for non-braces here, return typeName as is
				return typeJson.typeName;
			} else {
				return '{}';
			}

		case 'array':
			const elementType = convertJsonTypeToTypeScript(typeJson.elementType);
			return `${elementType}[]`;

		case 'union':
			if (typeJson.types && typeJson.types.length > 0) {
				const unionTypes = typeJson.types.map((t: any) => {
					const typeStr = convertJsonTypeToTypeScript(t);
					// Wrap object and intersection types in parentheses for better readability
					return t.kind === 'object' || t.kind === 'intersection'
						? `(${typeStr})`
						: typeStr;
				});
				return unionTypes.join(' | ');
			}
			return 'any';

		case 'intersection':
			if (typeJson.types && typeJson.types.length > 0) {
				const intersectionTypes = typeJson.types.map((t: any) => {
					const typeStr = convertJsonTypeToTypeScript(t);
					// Wrap union types in parentheses to maintain correct precedence
					return t.kind === 'union' ? `(${typeStr})` : typeStr;
				});
				return intersectionTypes.join(' & ');
			}
			return 'any';

		case 'literal':
			if (typeof typeJson.value === 'string') {
				return `"${typeJson.value.replace(/"/g, '\\"')}"`;
			}
			return String(typeJson.value);

		case 'function':
			const params = typeJson.parameters?.map((p: any) =>
				`${p.name}${p.optional ? '?' : ''}: ${convertJsonTypeToTypeScript(p.type)}`
			).join(', ') || '';

			const returnType = convertJsonTypeToTypeScript(typeJson.returnType) || 'void';
			return `(${params}) => ${returnType}`;

		default:
			if (typeJson.typeName) {
				return typeJson.typeName;
			}
			return 'any';
	}
}

async function typeExistsInDocument(document: vscode.TextDocument, typeName: string): Promise<boolean> {
	const text = document.getText();
	const patterns = [
		new RegExp(`(type|interface)\\s+${typeName}\\s*[=:]`, 'g'),
		new RegExp(`(export\\s+)?(type|interface)\\s+${typeName}\\s*[=:]`, 'g'),
		new RegExp(`(export\\s+)?declare\\s+(type|interface)\\s+${typeName}\\s*[=:]`, 'g'),
		new RegExp(`const\\s+${typeName}\\s*=\\s*z\\.`, 'g')
	];

	return patterns.some(pattern => pattern.test(text));
}

export function activate(context: vscode.ExtensionContext) {
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('zodgen.newSchema', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		// vscode.window.showInformationMessage('Hello World from zodgen!');

		/*
		const text = await getTypeDefinition();
		await threadSleep(2000);
		const schema = generateSchema(text || "");
		console.log(schema);
		*/
		await findAndReadZodgenSchemas();
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
