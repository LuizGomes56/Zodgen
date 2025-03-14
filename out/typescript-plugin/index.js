"use strict";
const request_1 = require("./request");
const type_tree_1 = require("./type-tree");
function init(modules) {
    const ts = modules.typescript;
    function create(info) {
        info.project.projectService.logger.info('Prettify LSP is starting');
        // Set up decorator object
        const proxy = Object.create(null);
        for (const k of Object.keys(info.languageService)) {
            const x = info.languageService[k];
            // @ts-expect-error - JS runtime trickery which is tricky to type tersely
            proxy[k] = (...args) => x.apply(info.languageService, args);
        }
        /**
         * Override getCompletionsAtPosition to provide prettify type information
         */
        proxy.getCompletionsAtPosition = (fileName, position, options) => {
            const requestBody = options?.triggerCharacter;
            if (!(0, request_1.isPrettifyRequest)(requestBody)) {
                return info.languageService.getCompletionsAtPosition(fileName, position, options);
            }
            const program = info.project['program'];
            if (!program)
                return undefined;
            const sourceFile = program.getSourceFile(fileName);
            if (!sourceFile)
                return undefined;
            const checker = program.getTypeChecker();
            const prettifyResponse = (0, type_tree_1.getTypeInfoAtPosition)(ts, checker, sourceFile, position, requestBody.options);
            const response = {
                isGlobalCompletion: false,
                isMemberCompletion: false,
                isNewIdentifierLocation: false,
                entries: [],
                __prettifyResponse: prettifyResponse
            };
            return response;
        };
        return proxy;
    }
    return { create };
}
module.exports = init;
//# sourceMappingURL=index.js.map