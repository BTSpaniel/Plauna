// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveRealmContractOperations } from './RealmContractCapturedOperations.js';

/** Stable error codes emitted by the Virtual Realm contract foundation. */
export const REALM_CONTRACT_ERROR_CODES = Object.freeze({
    INVALID_LIMITS: 'REALM_CONTRACT_INVALID_LIMITS',
    UNKNOWN_LIMIT: 'REALM_CONTRACT_UNKNOWN_LIMIT',
    DEPTH_LIMIT: 'REALM_CONTRACT_DEPTH_LIMIT',
    NODE_LIMIT: 'REALM_CONTRACT_NODE_LIMIT',
    PROPERTY_LIMIT: 'REALM_CONTRACT_PROPERTY_LIMIT',
    TOTAL_PROPERTY_LIMIT: 'REALM_CONTRACT_TOTAL_PROPERTY_LIMIT',
    ARRAY_LENGTH_LIMIT: 'REALM_CONTRACT_ARRAY_LENGTH_LIMIT',
    STRING_BYTE_LIMIT: 'REALM_CONTRACT_STRING_BYTE_LIMIT',
    CANONICAL_BYTE_LIMIT: 'REALM_CONTRACT_CANONICAL_BYTE_LIMIT',
    INVALID_VALUE_TYPE: 'REALM_CONTRACT_INVALID_VALUE_TYPE',
    INVALID_OBJECT_PROTOTYPE: 'REALM_CONTRACT_INVALID_OBJECT_PROTOTYPE',
    INVALID_ARRAY_PROTOTYPE: 'REALM_CONTRACT_INVALID_ARRAY_PROTOTYPE',
    SYMBOL_PROPERTY: 'REALM_CONTRACT_SYMBOL_PROPERTY',
    NON_ENUMERABLE_PROPERTY: 'REALM_CONTRACT_NON_ENUMERABLE_PROPERTY',
    ACCESSOR_PROPERTY: 'REALM_CONTRACT_ACCESSOR_PROPERTY',
    INHERITED_PROPERTY: 'REALM_CONTRACT_INHERITED_PROPERTY',
    PROTOTYPE_POLLUTION_KEY: 'REALM_CONTRACT_PROTOTYPE_POLLUTION_KEY',
    SPARSE_ARRAY: 'REALM_CONTRACT_SPARSE_ARRAY',
    ARRAY_EXTRA_PROPERTY: 'REALM_CONTRACT_ARRAY_EXTRA_PROPERTY',
    CYCLE: 'REALM_CONTRACT_CYCLE',
    UNDEFINED_VALUE: 'REALM_CONTRACT_UNDEFINED_VALUE',
    FUNCTION_VALUE: 'REALM_CONTRACT_FUNCTION_VALUE',
    BIGINT_VALUE: 'REALM_CONTRACT_BIGINT_VALUE',
    SYMBOL_VALUE: 'REALM_CONTRACT_SYMBOL_VALUE',
    NON_FINITE_NUMBER: 'REALM_CONTRACT_NON_FINITE_NUMBER',
    UNSAFE_INTEGER: 'REALM_CONTRACT_UNSAFE_INTEGER',
    NEGATIVE_ZERO: 'REALM_CONTRACT_NEGATIVE_ZERO',
    MALFORMED_UNICODE: 'REALM_CONTRACT_MALFORMED_UNICODE',
    NON_NFC_STRING: 'REALM_CONTRACT_NON_NFC_STRING',
    JSON_INPUT_LIMIT: 'REALM_CONTRACT_JSON_INPUT_LIMIT',
    JSON_SYNTAX: 'REALM_CONTRACT_JSON_SYNTAX',
    JSON_DUPLICATE_KEY: 'REALM_CONTRACT_JSON_DUPLICATE_KEY',
    INVALID_DEFINITION: 'REALM_CONTRACT_INVALID_DEFINITION',
    DEFINITION_FIELD_CONFLICT: 'REALM_CONTRACT_DEFINITION_FIELD_CONFLICT',
    INVALID_SCHEMA: 'REALM_CONTRACT_INVALID_SCHEMA',
    SCHEMA_VALIDATION_FAILED: 'REALM_CONTRACT_SCHEMA_VALIDATION_FAILED',
    SEMANTIC_VALIDATION_FAILED: 'REALM_CONTRACT_SEMANTIC_VALIDATION_FAILED',
    INVALID_SEMANTIC_RESULT: 'REALM_CONTRACT_INVALID_SEMANTIC_RESULT',
    ASYNC_SEMANTIC_VALIDATOR: 'REALM_CONTRACT_ASYNC_SEMANTIC_VALIDATOR',
    REGISTRY_INVALID_BATCH: 'REALM_CONTRACT_REGISTRY_INVALID_BATCH',
    REGISTRY_DUPLICATE_DEFINITION: 'REALM_CONTRACT_REGISTRY_DUPLICATE_DEFINITION',
    REGISTRY_PARTIAL_INITIALIZATION: 'REALM_CONTRACT_REGISTRY_PARTIAL_INITIALIZATION',
    REGISTRY_COLLISION: 'REALM_CONTRACT_REGISTRY_COLLISION',
    REGISTRY_UNKNOWN_CONTRACT: 'REALM_CONTRACT_REGISTRY_UNKNOWN_CONTRACT',
    REGISTRY_AMBIGUOUS_CONTRACT: 'REALM_CONTRACT_REGISTRY_AMBIGUOUS_CONTRACT',
});

const EMPTY_DETAILS = Object.freeze(Object.create(null));

function freezeDetails(details) {
    if (details === undefined || details === null) return EMPTY_DETAILS;
    if (typeof details !== 'object' || Array.isArray(details)) {
        return Object.freeze({ value: details });
    }
    return Object.freeze({ ...details });
}

// Diagnostic data is not authority. The opt-in profile copies bounded own data
// without invoking accessors or retaining caller-owned nested objects.
function capturedDetails(details, ops) {
    if (details === undefined || details === null) return EMPTY_DETAILS;
    const ancestors = ops.setCreate();
    let nodes = 0;
    function copy(value, depth) {
        nodes += 1;
        if (nodes > 64 || depth > 4) return '[diagnostic limit]';
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.length <= 1024 ? value : ops.slice(value, 0, 1024);
        if (typeof value === 'number') return ops.finite(value) ? value : '[non-finite number]';
        if (typeof value !== 'object') return '[non-data value]';
        if (ops.setHas(ancestors, value)) return '[diagnostic cycle]';
        const prototype = ops.getPrototypeOf(value);
        const array = ops.isArray(value);
        if (prototype !== null && prototype !== (array ? ops.arrayPrototype : ops.objectPrototype)) {
            return '[non-plain diagnostic]';
        }
        const result = array ? ops.newArray() : ops.create(null);
        const names = ops.ownNames(value);
        ops.setAdd(ancestors, value);
        try {
            for (let index = 0; index < names.length && index < 32; index += 1) {
                const key = names[index];
                if (array && key === 'length') continue;
                const descriptor = ops.descriptor(value, key);
                if (!descriptor?.enumerable || !ops.hasOwn(descriptor, 'value')) continue;
                const accepted = copy(descriptor.value, depth + 1);
                if (array) ops.append(result, accepted);
                else ops.defineData(result, key, accepted);
            }
        } finally {
            ops.setDelete(ancestors, value);
        }
        return ops.freeze(result);
    }
    try {
        if (typeof details === 'object' && !ops.isArray(details)) return copy(details, 0);
        const record = ops.create(null);
        ops.defineData(record, 'value', copy(details, 0));
        return ops.freeze(record);
    } catch {
        return EMPTY_DETAILS;
    }
}

function capturedError(code, message, path, details, ops) {
    if (typeof code !== 'string' || code.length === 0) {
        throw ops.typeError('RealmContractError code must be a non-empty string');
    }
    if (typeof message !== 'string' || message.length === 0) {
        throw ops.typeError('RealmContractError message must be a non-empty string');
    }
    if (typeof path !== 'string' || path.length === 0) {
        throw ops.typeError('RealmContractError path must be a non-empty string');
    }
    const error = ops.error(`${path}: ${message}`);
    ops.defineData(error, 'name', 'RealmContractError');
    ops.defineData(error, 'code', code);
    ops.defineData(error, 'path', path);
    ops.defineData(error, 'details', capturedDetails(details, ops));
    return ops.freeze(error);
}

/**
 * Path-aware failure raised at every Virtual Realm contract boundary.
 *
 * `code` is stable and machine-readable. `message` and `details` are diagnostic
 * and may become more specific without changing the failure category.
 */
export class RealmContractError extends Error {
    constructor(code, message, path = '$', details = undefined, operationProfile = undefined) {
        const ops = resolveRealmContractOperations(operationProfile);
        if (ops.captured) return capturedError(code, message, path, details, ops);
        if (typeof code !== 'string' || code.length === 0) {
            throw new TypeError('RealmContractError code must be a non-empty string');
        }
        if (typeof message !== 'string' || message.length === 0) {
            throw new TypeError('RealmContractError message must be a non-empty string');
        }
        if (typeof path !== 'string' || path.length === 0) {
            throw new TypeError('RealmContractError path must be a non-empty string');
        }
        super(`${path}: ${message}`);
        this.name = 'RealmContractError';
        this.code = code;
        this.path = path;
        this.details = freezeDetails(details);
    }
}

/** Raise a path-aware RealmContractError without repeating constructor syntax. */
export function throwRealmContractError(code, message, path = '$', details = undefined, operationProfile = undefined) {
    const ops = resolveRealmContractOperations(operationProfile);
    if (ops.captured) throw capturedError(code, message, path, details, ops);
    throw new RealmContractError(code, message, path, details);
}

export default RealmContractError;
