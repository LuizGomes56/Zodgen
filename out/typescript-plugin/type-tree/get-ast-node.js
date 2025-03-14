"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDescendantAtRange = getDescendantAtRange;
/**
 * https://github.com/dsherret/ts-ast-viewer/blob/b4be8f2234a1c3c099296bf5d0ad6cc14107367c/site/src/compiler/getDescendantAtRange.ts
 * https://github.com/mxsdev/ts-type-explorer/blob/main/packages/api/src/util.ts#L763
 */
function getDescendantAtRange(typescript, sourceFile, range) {
    let bestMatch = {
        node: sourceFile,
        start: sourceFile.getStart(sourceFile),
        end: sourceFile.getEnd()
    };
    searchDescendants(sourceFile);
    return bestMatch.node;
    function searchDescendants(node) {
        const start = node.getStart(sourceFile);
        const end = node.getEnd();
        if (start <= range[0] && end >= range[1]) {
            if (start >= bestMatch.start && end <= bestMatch.end) {
                bestMatch = { node, start, end };
            }
        }
        node.forEachChild(child => { searchDescendants(child); });
    }
}
//# sourceMappingURL=get-ast-node.js.map