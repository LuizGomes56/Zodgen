"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPrettifyRequest = isPrettifyRequest;
function isPrettifyRequest(request) {
    return !!request && typeof request === 'object' && 'meta' in request && request['meta'] === 'prettify-type-info-request';
}
//# sourceMappingURL=request.js.map