"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stringifyTypeTree = stringifyTypeTree;
exports.getSyntaxKindDeclaration = getSyntaxKindDeclaration;
exports.prettyPrintTypeString = prettyPrintTypeString;
exports.sanitizeString = sanitizeString;
const typescript_1 = require("typescript");
/**
 * Uses type info to return a string representation of the type
 *
 * Example:
 * { kind: 'union', types: [{ kind: 'primitive', type: 'string' }, { kind: 'primitive', type: 'number' }] }
 * Yields:
 * 'string | number'
 */
function stringifyTypeTree(typeTree, anonymousFunction = true) {
    if (typeTree.kind === 'union') {
        const unionString = typeTree.types.map(t => stringifyTypeTree(t)).join(' | ');
        if (typeTree.excessMembers > 0) {
            return `${unionString} | ... ${typeTree.excessMembers} more`;
        }
        return unionString;
    }
    if (typeTree.kind === 'object') {
        let propertiesString = typeTree.properties.map(p => {
            const readonly = (p.readonly) ? 'readonly ' : '';
            let optional = '';
            if (p.optional && p.type.kind === 'union') {
                optional = '?';
                // Remove undefined from union if optional
                p.type.types = p.type.types.filter(t => t.typeName !== 'undefined');
            }
            return `${readonly}${p.name}${optional}: ${stringifyTypeTree(p.type)};`;
        }).join(' ');
        if (typeTree.excessProperties > 0) {
            propertiesString += ` ... ${typeTree.excessProperties} more;`;
        }
        return `{ ${propertiesString} }`;
    }
    if (typeTree.kind === 'tuple') {
        const elementTypesString = typeTree.elementTypes.map(t => stringifyTypeTree(t)).join(', ');
        return `${typeTree.readonly ? 'readonly ' : ''}[${elementTypesString}]`;
    }
    if (typeTree.kind === 'array') {
        let elementTypeString = stringifyTypeTree(typeTree.elementType);
        if (elementTypeString.includes('|') || elementTypeString.includes('&')) {
            elementTypeString = `(${elementTypeString})`;
        }
        return `${typeTree.readonly ? 'readonly ' : ''}${elementTypeString}[]`;
    }
    if (typeTree.kind === 'function') {
        const returnTypeChar = anonymousFunction ? ' =>' : ':';
        const signatures = typeTree.signatures.map(s => {
            const { parameters, returnType } = s;
            const parametersString = parameters.map(p => {
                const rest = p.isRestParameter ? '...' : '';
                let optional = '';
                if (p.optional && p.type.kind === 'union') {
                    optional = '?';
                    // Remove undefined from union if optional
                    p.type.types = p.type.types.filter(t => t.typeName !== 'undefined');
                }
                return `${rest}${p.name}${optional}: ${stringifyTypeTree(p.type)}`;
            }).join(', ');
            return `(${parametersString})${returnTypeChar} ${stringifyTypeTree(returnType)}`;
        });
        // If there are multiple signatures, wrap them in braces with semi-colons at the end of each line
        if (signatures.length > 1) {
            return `{${signatures.join('; ')};}`;
        }
        return signatures[0];
    }
    if (typeTree.kind === 'enum') {
        return typeTree.member;
    }
    if (typeTree.kind === 'promise') {
        return `Promise<${stringifyTypeTree(typeTree.type)}>`;
    }
    // Primitive or reference type
    return typeTree.typeName;
}
/**
 * Builds a declaration string based on the syntax kind
 */
function getSyntaxKindDeclaration(syntaxKind, typeName) {
    switch (syntaxKind) {
        case typescript_1.SyntaxKind.ClassDeclaration:
        case typescript_1.SyntaxKind.NewExpression:
            return `class ${typeName} `;
        case typescript_1.SyntaxKind.ExpressionWithTypeArguments:
        case typescript_1.SyntaxKind.InterfaceDeclaration:
        case typescript_1.SyntaxKind.QualifiedName:
            return `interface ${typeName} `;
        case typescript_1.SyntaxKind.ArrayType:
        case typescript_1.SyntaxKind.ConstructorType:
        case typescript_1.SyntaxKind.ConstructSignature:
        case typescript_1.SyntaxKind.EnumDeclaration:
        case typescript_1.SyntaxKind.FunctionType:
        case typescript_1.SyntaxKind.IndexedAccessType:
        case typescript_1.SyntaxKind.IndexSignature:
        case typescript_1.SyntaxKind.IntersectionType:
        case typescript_1.SyntaxKind.MappedType:
        case typescript_1.SyntaxKind.PropertySignature:
        case typescript_1.SyntaxKind.ThisType:
        case typescript_1.SyntaxKind.TupleType:
        case typescript_1.SyntaxKind.TypeAliasDeclaration:
        case typescript_1.SyntaxKind.TypeAssertionExpression:
        case typescript_1.SyntaxKind.TypeLiteral:
        case typescript_1.SyntaxKind.TypeOperator:
        case typescript_1.SyntaxKind.TypePredicate:
        case typescript_1.SyntaxKind.TypeQuery:
        case typescript_1.SyntaxKind.TypeReference:
        case typescript_1.SyntaxKind.UnionType:
            return `type ${typeName} = `;
        case typescript_1.SyntaxKind.FunctionDeclaration:
        case typescript_1.SyntaxKind.FunctionKeyword:
        case typescript_1.SyntaxKind.MethodDeclaration:
        case typescript_1.SyntaxKind.MethodSignature:
        case typescript_1.SyntaxKind.GetAccessor:
        case typescript_1.SyntaxKind.SetAccessor:
        case typescript_1.SyntaxKind.Constructor:
            return `function ${typeName}`;
        case typescript_1.SyntaxKind.LetKeyword:
            return `let ${typeName}: `;
        case typescript_1.SyntaxKind.VarKeyword:
            return `var ${typeName}: `;
        default:
            return `const ${typeName}: `;
    }
}
function prettyPrintTypeString(typeStringInput, indentation = 2) {
    // Replace typeof import("...node_modules/MODULE_NAME") with: typeof import("MODULE_NAME")
    const typeString = typeStringInput
        .replace(/typeof import\(".*?node_modules\/(.*?)"\)/g, 'typeof import("$1")')
        .replace(/ } & { /g, ' ');
    if (indentation < 1)
        return typeString;
    // Add newline after braces and semicolons
    const splitTypeString = typeString
        .replace(/{/g, '{\n')
        .replace(/}/g, '\n}')
        .replace(/(\S); /g, '$1;\n ');
    let depth = 0;
    let result = '';
    const lines = splitTypeString.split('\n');
    for (let line of lines) {
        line = line.trim();
        // Replace true/false with boolean
        line = line.replace('false | true', 'boolean');
        const hasOpenBrace = line.includes('{');
        const hasCloseBrace = line.includes('}');
        if (hasCloseBrace) {
            depth--;
        }
        result += ' '.repeat(indentation).repeat(depth) + line + '\n';
        if (hasOpenBrace) {
            depth++;
        }
    }
    result = result
        .replace(/{\s*\n*\s*}/g, '{}') // Remove empty braces newlines
        .replace(/^\s*[\r\n]/gm, '') // Remove empty newlines
        .replace(/{\s*\.\.\.\s*([0-9]+)\s*more;\s*}/g, '{ ... $1 more }'); // Replace only excess properties into one line
    return result;
}
/**
 * Sanitizes a string by removing leading words, whitespace, newlines, and semicolons
 */
function sanitizeString(str) {
    return str
        .replace(/^[a-z]+\s/, '') // Remove the leading word, ex: type, const, interface
        .replace(/\s/g, '') // Remove all whitespace
        .replace(/\n/g, '') // Remove all newlines
        .replace(/;/g, ''); // Remove all semicolons
}
//# sourceMappingURL=stringify-type-tree.js.map