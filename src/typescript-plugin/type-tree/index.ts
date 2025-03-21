import type * as ts from 'typescript'

import type { TypeFunctionSignature, TypeInfo, TypeProperty, TypeTree } from './types'
import { getDescendantAtRange } from './get-ast-node'
import type { PrettifyOptions } from '../request'

let typescript: typeof ts
let checker: ts.TypeChecker

let options: PrettifyOptions = {
    hidePrivateProperties: true,
    maxDepth: 2,
    maxProperties: 100,
    maxSubProperties: 5,
    maxUnionMembers: 15,
    skippedTypeNames: [],
    unwrapArrays: true,
    unwrapFunctions: true,
    unwrapPromises: true
}

/**
 * Get TypeInfo at a position in a source file
 */
export function getTypeInfoAtPosition(
    typescriptContext: typeof ts,
    typeChecker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    position: number,
    prettifyOptions: PrettifyOptions
): TypeInfo | undefined {
    try {
        typescript = typescriptContext
        checker = typeChecker
        options = prettifyOptions

        const node = getDescendantAtRange(typescript, sourceFile, [position, position])
        if (!node || node === sourceFile || !node.parent) return undefined

        let symbol = typeChecker.getSymbolAtLocation(node)
        if (!symbol) return undefined

        // Handle ImportSpecifier
        if (symbol.flags & typescript.SymbolFlags.Alias) {
            symbol = typeChecker.getAliasedSymbol(symbol)
        }

        let type = typeChecker.getTypeOfSymbolAtLocation(symbol, node)

        let syntaxKind = symbol?.declarations?.[0]?.kind ?? typescript.SyntaxKind.ConstKeyword
        if (typescript.isVariableDeclaration(node.parent)) {
            syntaxKind = getVariableDeclarationKind(node.parent)
        }

        const name = symbol?.getName() ?? typeChecker.typeToString(type)

        // Display constructor information for classes being instantiated
        // Don't display constructor information for classes being extended, imported, or part of an import statement
        if (
            syntaxKind === typescript.SyntaxKind.ClassDeclaration && // Confirm the node is a class
            !typescript.isClassDeclaration(node.parent) && // Confirm the node is not part of a class definition
            !isPartOfImportStatement(node) && // Confirm the node is not part of an import statement
            type.getConstructSignatures().length > 0 // Confirm the class has a constructor
        ) {
            return {
                typeTree: getConstructorTypeInfo(type, typeChecker, name),
                syntaxKind: typescript.SyntaxKind.Constructor,
                name
            }
        }

        // If the symbol has a declared type, use that when available
        // Don't use declared type for variable declarations
        // TODO: Determine best method, check all or just the first
        // const shouldUseDeclaredType = symbol.declarations?.every(d => d.kind !== typescript.SyntaxKind.VariableDeclaration)
        const shouldUseDeclaredType = symbol.declarations?.[0]?.kind !== typescript.SyntaxKind.VariableDeclaration
        const declaredType = typeChecker.getDeclaredTypeOfSymbol(symbol)

        if (declaredType.flags !== typescript.TypeFlags.Any && shouldUseDeclaredType) {
            type = declaredType
        }

        const typeTree = getTypeTree(type, 0, new Set())

        return {
            typeTree,
            syntaxKind,
            name
        }
    } catch (e) {
        return undefined
    }
}

function isPartOfImportStatement(node: ts.Node): boolean {
    while (node) {
        if (typescript.isImportDeclaration(node) || typescript.isImportSpecifier(node) || typescript.isImportClause(node)) {
            return true
        }
        node = node.parent
    }
    return false
}

function getVariableDeclarationKind(node: ts.VariableDeclaration): number {
    const parent = node.parent
    if (!typescript.isVariableDeclarationList(parent)) return typescript.SyntaxKind.ConstKeyword

    if (parent.flags & typescript.NodeFlags.Let) {
        return typescript.SyntaxKind.LetKeyword
    }

    if (parent.flags & typescript.NodeFlags.Const) {
        return typescript.SyntaxKind.ConstKeyword
    }

    return typescript.SyntaxKind.VarKeyword
}

function getConstructorTypeInfo(type: ts.Type, typeChecker: ts.TypeChecker, name: string): TypeTree {
    const params = type.getConstructSignatures()[0]!.parameters
    const paramTypes = params.map(p => typeChecker.getTypeOfSymbol(p))
    const parameters = paramTypes.map((t, index) => {
        const declaration = params[index]?.declarations?.[0]
        const isRestParameter = Boolean(declaration && typescript.isParameter(declaration) && !!declaration.dotDotDotToken)
        const optional = Boolean(declaration && typescript.isParameter(declaration) && !!declaration.questionToken)

        return {
            name: params[index]?.getName() ?? `param${index}`,
            isRestParameter,
            optional,
            type: getTypeTree(t, 0, new Set())
        }
    })

    return {
        kind: 'function',
        typeName: name,
        signatures: [{
            returnType: { kind: 'reference', typeName: name },
            parameters
        }]
    }
}

/**
 * Recursively get type information by building a TypeTree object from the given type
 */
function getTypeTree(type: ts.Type, depth: number, visited: Set<ts.Type>): TypeTree {
    const typeName = checker.typeToString(type, undefined, typescript.TypeFormatFlags.NoTruncation)
    const apparentType = checker.getApparentType(type)

    if (isPrimitiveType(type) || isPrimitiveType(apparentType)) {
        return {
            kind: 'primitive',
            typeName
        }
    }

    if (options.skippedTypeNames.includes(typeName)) {
        return {
            kind: 'reference',
            typeName
        }
    }

    // Prevent infinite recursion when encountering circular references
    if (visited.has(type)) {
        if (typeName.includes('{') || typeName.includes('[') || typeName.includes('(')) {
            return {
                kind: 'reference',
                typeName: '...'
            }
        }

        return {
            kind: 'reference',
            typeName: checker.typeToString(apparentType, undefined, typescript.TypeFormatFlags.NoTruncation)
        }
    }

    visited.add(type)

    if (apparentType.isUnion()) {
        const excessMembers = Math.max(0, apparentType.types.length - options.maxUnionMembers)
        const types = apparentType.types
            .slice(0, options.maxUnionMembers)
            .sort(sortUnionTypes)
            .map(t => getTypeTree(t, depth, new Set(visited)))

        return {
            kind: 'union',
            typeName,
            excessMembers,
            types
        }
    }

    if (apparentType?.symbol?.flags & typescript.SymbolFlags.EnumMember && apparentType.symbol.parent) {
        return {
            kind: 'enum',
            typeName,
            member: `${apparentType.symbol.parent.name}.${apparentType.symbol.name}`
        }
    }

    if (typeName.startsWith('Promise<')) {
        if (!options.unwrapPromises && !typeName.includes('{')) return {
            kind: 'reference',
            typeName
        }

        const typeArgument = checker.getTypeArguments(apparentType as ts.TypeReference)[0]
        const promiseType: TypeTree = typeArgument
            ? getTypeTree(typeArgument, depth, new Set(visited))
            : { kind: 'primitive', typeName: 'void' }

        return {
            kind: 'promise',
            typeName,
            type: promiseType
        }
    }

    const callSignatures = apparentType.getCallSignatures()
    if (callSignatures.length > 0) {
        if (!options.unwrapFunctions) {
            depth = options.maxDepth
        }

        const signatures: TypeFunctionSignature[] = callSignatures.map(signature => {
            const returnType = getTypeTree(checker.getReturnTypeOfSignature(signature), depth, new Set(visited))
            const parameters = signature.parameters.map(symbol => {
                const declaration = symbol.declarations?.[0]
                const isRestParameter = Boolean(declaration && typescript.isParameter(declaration) && !!declaration.dotDotDotToken)
                const optional = Boolean(declaration && typescript.isParameter(declaration) && !!declaration.questionToken)

                return {
                    name: symbol.getName(),
                    isRestParameter,
                    optional,
                    type: getTypeTree(checker.getTypeOfSymbol(symbol), depth, new Set(visited))
                }
            })

            return { returnType, parameters }
        })

        return {
            kind: 'function',
            typeName,
            signatures
        }
    }

    if (checker.isTupleType(apparentType)) {
        const elementTypes = checker
            .getTypeArguments(apparentType as ts.TupleTypeReference)
            .map(t => getTypeTree(t, depth, new Set(visited)))
        const readonly = (apparentType as ts.TupleTypeReference)?.target?.readonly ?? false

        return {
            kind: 'tuple',
            typeName,
            readonly,
            elementTypes
        }
    }

    if (checker.isArrayType(apparentType)) {
        if (!options.unwrapArrays) {
            depth = options.maxDepth
        }

        const arrayType = checker.getTypeArguments(apparentType as ts.TypeReference)[0]
        const elementType: TypeTree = arrayType
            ? getTypeTree(arrayType, depth, new Set(visited))
            : { kind: 'primitive', typeName: 'any' }

        return {
            kind: 'array',
            typeName,
            readonly: apparentType.getSymbol()?.getName() === 'ReadonlyArray',
            elementType
        }
    }

    if (
        apparentType.isClassOrInterface() ||
        (apparentType.flags & typescript.TypeFlags.Object) ||
        apparentType.getProperties().length > 0
    ) {
        // Resolve how many properties to show based on the maxProperties option
        const depthMaxProps = depth >= 1 ? options.maxSubProperties : options.maxProperties

        let typeProperties = apparentType.getProperties()
        if (options.hidePrivateProperties) {
            typeProperties = typeProperties.filter((symbol) => isPublicProperty(symbol))
        }

        const stringIndexType = apparentType.getStringIndexType()
        const numberIndexType = apparentType.getNumberIndexType()

        if (depth >= options.maxDepth) {
            // If we've reached the max depth and has a type alias, return it as a reference type
            // Otherwise, return an object with the properties count
            // Example: { ... 3 more } or A & B
            if (!typeName.includes('{')) return {
                kind: 'reference',
                typeName
            }

            let propertiesCount = typeProperties.length
            if (stringIndexType) propertiesCount += 1
            if (numberIndexType) propertiesCount += 1

            return {
                kind: 'object',
                typeName,
                properties: [],
                excessProperties: propertiesCount // Return all properties as excess to avoid deeper nesting
            }
        }

        // Track how many properties are being cut off from the maxProperties option
        let excessProperties = typeProperties.length - depthMaxProps
        typeProperties = typeProperties.slice(0, depthMaxProps)

        const properties: TypeProperty[] = typeProperties.map(symbol => {
            const symbolType = checker.getTypeOfSymbol(symbol)
            return {
                name: symbol.getName(),
                optional: isOptional(symbol),
                readonly: isReadOnly(symbol),
                type: getTypeTree(symbolType, depth + 1, new Set(visited)) // Add depth for sub-properties
            }
        })

        if (stringIndexType) {
            // If under max properties allowance, add the string index type as a property
            if (excessProperties < 0) {
                const stringIndexIdentifierName = getIndexIdentifierName(apparentType, 'string')
                properties.push({
                    name: `[${stringIndexIdentifierName}: string]`,
                    optional: false,
                    readonly: isReadOnly(stringIndexType.symbol),
                    type: getTypeTree(stringIndexType, depth + 1, new Set(visited))
                })
            }

            excessProperties += 1 // Track the string index type as an excess property
        }

        if (numberIndexType) {
            if (excessProperties < 0) {
                const numberIndexIdentifierName = getIndexIdentifierName(apparentType, 'number')
                properties.push({
                    name: `[${numberIndexIdentifierName}: number]`,
                    optional: false,
                    readonly: isReadOnly(numberIndexType.symbol),
                    type: getTypeTree(numberIndexType, depth + 1, new Set(visited))
                })
            }

            excessProperties += 1
        }

        return {
            kind: 'object',
            typeName,
            properties,
            excessProperties: Math.max(0, excessProperties)
        }
    }

    return {
        kind: 'reference',
        typeName
    }
}

/**
 * Check if a type is a primitive type
 */
function isPrimitiveType(type: ts.Type): boolean {
    const typeFlags = type.flags

    if (typeFlags & typescript.TypeFlags.EnumLike) return false

    return Boolean(
        typeFlags & typescript.TypeFlags.String ||
        typeFlags & typescript.TypeFlags.StringLiteral ||
        typeFlags & typescript.TypeFlags.Number ||
        typeFlags & typescript.TypeFlags.NumberLiteral ||
        typeFlags & typescript.TypeFlags.Boolean ||
        typeFlags & typescript.TypeFlags.BooleanLike ||
        typeFlags & typescript.TypeFlags.BooleanLiteral ||
        typeFlags & typescript.TypeFlags.Undefined ||
        typeFlags & typescript.TypeFlags.Null ||
        typeFlags & typescript.TypeFlags.Void ||
        typeFlags & typescript.TypeFlags.BigInt ||
        typeFlags & typescript.TypeFlags.BigIntLiteral ||
        typeFlags & typescript.TypeFlags.ESSymbol ||
        typeFlags & typescript.TypeFlags.UniqueESSymbol ||
        typeFlags & typescript.TypeFlags.Never ||
        typeFlags & typescript.TypeFlags.Unknown ||
        typeFlags & typescript.TypeFlags.Any
    )
}

/**
 * Check if a type is an intrinsic type
 */
function isIntrinsicType(type: ts.Type): type is ts.IntrinsicType {
    return (type.flags & typescript.TypeFlags.Intrinsic) !== 0
}

/**
 * Sort union types by intrinsic types order, following ts quick info order
 * Ex.
 * string, number, bigint, { a: string }, null, undefined
 */
function sortUnionTypes(a: ts.Type, b: ts.Type): number {
    const primitiveTypesOrder = ['string', 'number', 'bigint', 'boolean', 'symbol']
    const falsyTypesOrder = ['null', 'undefined']

    const aIntrinsicName = isIntrinsicType(a) ? a.intrinsicName : ''
    const bIntrinsicName = isIntrinsicType(b) ? b.intrinsicName : ''

    const aPrimitiveIndex = primitiveTypesOrder.indexOf(aIntrinsicName)
    const bPrimitiveIndex = primitiveTypesOrder.indexOf(bIntrinsicName)
    const aFalsyIndex = falsyTypesOrder.indexOf(aIntrinsicName)
    const bFalsyIndex = falsyTypesOrder.indexOf(bIntrinsicName)

    // If both types are primitive, sort based on the order in primitiveTypesOrder
    if (aPrimitiveIndex !== -1 && bPrimitiveIndex !== -1) {
        return aPrimitiveIndex - bPrimitiveIndex
    }

    // If one type is primitive and the other is not, the primitive type should come first
    if (aPrimitiveIndex !== -1) {
        return -1
    }

    if (bPrimitiveIndex !== -1) {
        return 1
    }

    // If both types are falsy, sort based on the order in falsyTypesOrder
    if (aFalsyIndex !== -1 && bFalsyIndex !== -1) {
        return aFalsyIndex - bFalsyIndex
    }

    // If one type is falsy and the other is not, the falsy type should come last
    if (aFalsyIndex !== -1) {
        return 1
    }
    if (bFalsyIndex !== -1) {
        return -1
    }

    // If neither type is primitive or falsy, maintain the original order
    return 0
}

/**
 * Check if an object property is public
 */
function isPublicProperty(symbol: ts.Symbol): boolean {
    const declarations = symbol.getDeclarations()
    if (!declarations) return true

    const name = symbol.getName()
    if (name.startsWith('_') || name.startsWith('#')) return false

    return declarations.every(declaration => {
        if (!(
            typescript.isMethodDeclaration(declaration) ||
            typescript.isMethodSignature(declaration) ||
            typescript.isPropertyDeclaration(declaration) ||
            typescript.isPropertySignature(declaration)
        )) return true

        const modifiers = declaration.modifiers ?? []
        const hasPrivateOrProtectedModifier = modifiers.some(modifier => {
            return modifier.kind === typescript.SyntaxKind.PrivateKeyword || modifier.kind === typescript.SyntaxKind.ProtectedKeyword
        })

        return !hasPrivateOrProtectedModifier
    })
}

/**
 * Check if an object property is readonly
 */
function isReadOnly(symbol: ts.Symbol | undefined): boolean {
    if (!symbol) return false

    const declarations = symbol.getDeclarations()
    if (!declarations) return false

    return declarations.some(declaration => (
        (
            typescript.isPropertyDeclaration(declaration) ||
            typescript.isMethodDeclaration(declaration)
        ) &&
        declaration.modifiers?.some(modifier => modifier.kind === typescript.SyntaxKind.ReadonlyKeyword)))
}

/**
 * Check if an object property is optional
 */
function isOptional(symbol: ts.Symbol | undefined): boolean {
    if (!symbol) return false

    const declarations = symbol.getDeclarations()
    if (!declarations) return false

    return declarations.some(declaration => (
        typescript.isPropertySignature(declaration) ||
        typescript.isPropertyDeclaration(declaration)
    ) && !!declaration.questionToken)
}

/**
 * Check if a declaration has members
 */
function hasMembers(declaration: ts.Declaration): declaration is ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeLiteralNode {
    return typescript.isInterfaceDeclaration(declaration) || typescript.isClassDeclaration(declaration) || typescript.isTypeLiteralNode(declaration)
}

/**
 * Get the name of the identifier used in index signatures
 * Example: { [key: string]: string } => 'key'
 */
function getIndexIdentifierName(type: ts.Type | undefined, signature: 'string' | 'number'): string {
    const declarations = type?.getSymbol()?.getDeclarations()?.filter(hasMembers) ?? []
    const members = declarations.flatMap(declaration => declaration.members as ts.NodeArray<ts.Node>)
    if (!members.length) return 'key'

    const indexSignatures = members.filter(typescript.isIndexSignatureDeclaration)

    for (const indexSignature of indexSignatures) {
        const parameter = indexSignature.parameters[0]
        if (!parameter) continue

        const signatureKind = parameter.getChildren()?.[2]?.getText()
        if (signatureKind !== signature) continue

        return parameter?.name?.getText() ?? 'key'
    }

    return 'key'
}