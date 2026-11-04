// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    REALM_CONTRACT_ERROR_CODES as ERROR,
    throwRealmContractError,
} from './RealmContractError.js';
import {
    REALM_CONTRACT_LIMIT_KEYS,
    REALM_CONTRACT_LIMITS,
    resolveRealmContractLimits,
} from './RealmContractLimits.js';
import { resolveRealmContractOperations } from './RealmContractCapturedOperations.js';

const UTF8 = new TextEncoder();

export const REALM_CONTRACT_FORBIDDEN_KEYS = Object.freeze([
    '__proto__',
    'constructor',
    'prototype',
]);

const FORBIDDEN_KEYS = new Set(REALM_CONTRACT_FORBIDDEN_KEYS);
const LIMIT_OPTION_ALIASES = Object.freeze([
    'maxPropertiesPerObject',
    'maxArrayItems',
    'maxStringBytes',
    'maxCanonicalBytes',
]);
const OPTION_KEYS = new Set([
    'freeze',
    'requireNfc',
    'limits',
    ...REALM_CONTRACT_LIMIT_KEYS,
    ...LIMIT_OPTION_ALIASES,
]);

function isPlainRecord(value, ops) {
    if (!value || typeof value !== 'object' || ops.isArray(value)) return false;
    const prototype = ops.getPrototypeOf(value);
    return prototype === ops.objectPrototype || prototype === null;
}

function propertyPath(path) {
    return `${path}.*`;
}

function readOptions(options, ops, operationProfile) {
    const fail = (code, message, path, details = undefined) => throwRealmContractError(code, message, path, details, operationProfile);
    if (options === undefined || options === null) {
        return ops.freeze({ freeze: true, requireNfc: false, limits: resolveRealmContractLimits(undefined, operationProfile) });
    }
    if (!isPlainRecord(options, ops)) {
        fail(
            ERROR.INVALID_VALUE_TYPE,
            'preflight options must be a plain or null-prototype object',
            '$.options',
        );
    }
    if (ops.ownSymbols(options).length !== 0) {
        fail(ERROR.SYMBOL_PROPERTY, 'preflight options cannot contain symbols', '$.options');
    }
    for (const key in options) {
        if (!ops.hasOwn(options, key)) {
            fail(
                ERROR.INHERITED_PROPERTY,
                'an inherited option is not allowed',
                propertyPath('$.options', key),
                undefined,
            );
        }
    }

    const values = ops.create(null);
    const optionNames = ops.ownNames(options);
    for (let index = 0; index < optionNames.length; index += 1) {
        const key = optionNames[index];
        if (!ops.setHas(OPTION_KEYS, key)) {
            fail(ERROR.UNKNOWN_LIMIT, 'unknown preflight option', '$.options');
        }
        const descriptor = ops.descriptor(options, key);
        if (!descriptor?.enumerable) {
            fail(ERROR.NON_ENUMERABLE_PROPERTY, 'preflight options must be enumerable', propertyPath('$.options', key));
        }
        if (!ops.hasOwn(descriptor, 'value')) {
            fail(ERROR.ACCESSOR_PROPERTY, 'preflight options cannot contain accessors', propertyPath('$.options', key));
        }
        if (ops.captured) ops.defineData(values, key, descriptor.value);
        else values[key] = descriptor.value;
    }

    const freeze = values.freeze === undefined ? true : values.freeze;
    const requireNfc = values.requireNfc === undefined ? false : values.requireNfc;
    if (typeof freeze !== 'boolean') {
        fail(ERROR.INVALID_VALUE_TYPE, 'freeze must be boolean', '$.options.freeze');
    }
    if (typeof requireNfc !== 'boolean') {
        fail(ERROR.INVALID_VALUE_TYPE, 'requireNfc must be boolean', '$.options.requireNfc');
    }

    const directLimits = ops.create(null);
    const limitOptionCount = REALM_CONTRACT_LIMIT_KEYS.length + LIMIT_OPTION_ALIASES.length;
    for (let index = 0; index < limitOptionCount; index += 1) {
        const key = index < REALM_CONTRACT_LIMIT_KEYS.length
            ? REALM_CONTRACT_LIMIT_KEYS[index]
            : LIMIT_OPTION_ALIASES[index - REALM_CONTRACT_LIMIT_KEYS.length];
        if (ops.hasOwn(values, key)) {
            if (ops.captured) ops.defineData(directLimits, key, values[key]);
            else directLimits[key] = values[key];
        }
    }
    let limitOverrides = values.limits;
    if (limitOverrides !== undefined && ops.keys(directLimits).length !== 0) {
        fail(
            ERROR.INVALID_LIMITS,
            'supply limit overrides either inside limits or as direct options, not both',
            '$.options.limits',
        );
    } else if (limitOverrides === undefined) {
        limitOverrides = directLimits;
    }

    return ops.freeze({
        freeze,
        requireNfc,
        limits: resolveRealmContractLimits(limitOverrides, operationProfile),
    });
}

function createState(options, ops, operationProfile) {
    return {
        options,
        nodes: 0,
        totalProperties: 0,
        canonicalUtf8Bytes: 0,
        ancestors: ops.setCreate(),
        ops,
        fail: (code, message, path, details = undefined) => throwRealmContractError(code, message, path, details, operationProfile),
    };
}

function addCanonicalBytes(state, count, path) {
    state.canonicalUtf8Bytes += count;
    if (state.canonicalUtf8Bytes > state.options.limits.maxCanonicalUtf8Bytes) {
        state.fail(
            ERROR.CANONICAL_BYTE_LIMIT,
            `canonical UTF-8 size exceeds ${state.options.limits.maxCanonicalUtf8Bytes} bytes`,
            path,
            {
                actual: state.canonicalUtf8Bytes,
                maximum: state.options.limits.maxCanonicalUtf8Bytes,
            },
        );
    }
}

function assertWellFormedUnicode(value, path, state) {
    for (let index = 0; index < value.length; index += 1) {
        const unit = state.ops.charCodeAt(value, index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = state.ops.charCodeAt(value, index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                state.fail(
                    ERROR.MALFORMED_UNICODE,
                    'string contains an unpaired high surrogate',
                    path,
                    { codeUnitOffset: index },
                );
            }
            index += 1;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            state.fail(
                ERROR.MALFORMED_UNICODE,
                'string contains an unpaired low surrogate',
                path,
                { codeUnitOffset: index },
            );
        }
    }
}

function canonicalTextByteLength(text, state, path) {
    if (!state.ops.captured) return UTF8.encode(text).byteLength;
    const maximum = state.ops.min(state.options.limits.maxCanonicalUtf8Bytes, REALM_CONTRACT_LIMITS.maxCanonicalUtf8Bytes);
    try {
        return state.ops.byteLength(state.ops.encode(text, maximum));
    } catch {
        state.fail(ERROR.CANONICAL_BYTE_LIMIT, `canonical UTF-8 size exceeds ${maximum} bytes`, path, { maximum });
    }
}

function inspectString(value, state, path) {
    const ops = state.ops;
    assertWellFormedUnicode(value, path, state);
    let utf8Bytes;
    if (ops.captured) {
        const maximum = ops.min(state.options.limits.maxStringUtf8Bytes, REALM_CONTRACT_LIMITS.maxCanonicalUtf8Bytes);
        try {
            utf8Bytes = ops.byteLength(ops.encode(value, maximum));
        } catch {
            state.fail(ERROR.STRING_BYTE_LIMIT, `string exceeds ${maximum} UTF-8 bytes`, path, { maximum });
        }
    } else {
        utf8Bytes = UTF8.encode(value).byteLength;
    }
    if (utf8Bytes > state.options.limits.maxStringUtf8Bytes) {
        state.fail(
            ERROR.STRING_BYTE_LIMIT,
            `string exceeds ${state.options.limits.maxStringUtf8Bytes} UTF-8 bytes`,
            path,
            { actual: utf8Bytes, maximum: state.options.limits.maxStringUtf8Bytes },
        );
    }
    if (state.options.requireNfc && ops.normalize(value, 'NFC') !== value) {
        state.fail(ERROR.NON_NFC_STRING, 'string must already be normalized to Unicode NFC', path);
    }
    return canonicalTextByteLength(ops.jsonStringify(value), state, path);
}

function inspectInheritedEnumerableProperties(value, path, state) {
    for (const key in value) {
        if (!state.ops.hasOwn(value, key)) {
            state.fail(
                ERROR.INHERITED_PROPERTY,
                'an inherited enumerable property is not contract data',
                propertyPath(path, key),
                undefined,
            );
        }
    }
}

function inspectSymbols(value, path, state) {
    const symbols = state.ops.ownSymbols(value);
    if (symbols.length !== 0) {
        state.fail(
            ERROR.SYMBOL_PROPERTY,
            'symbol properties are not valid contract data',
            path,
            { count: symbols.length },
        );
    }
}

function isCanonicalArrayIndex(key, length, ops) {
    const pattern = ops.captured ? /^(0|[1-9]\d*)(?![\s\S])/ : /^(0|[1-9]\d*)$/;
    if (!ops.regexTest(pattern, key)) return false;
    const index = ops.number(key);
    return ops.safeInteger(index) && index >= 0 && index < length && ops.string(index) === key;
}

function copyArray(value, state, path, depth) {
    const ops = state.ops;
    if (ops.getPrototypeOf(value) !== ops.arrayPrototype) {
        state.fail(ERROR.INVALID_ARRAY_PROTOTYPE, 'arrays must use Array.prototype', path);
    }
    inspectInheritedEnumerableProperties(value, path, state);
    inspectSymbols(value, path, state);

    const { maxArrayLength } = state.options.limits;
    if (value.length > maxArrayLength) {
        state.fail(
            ERROR.ARRAY_LENGTH_LIMIT,
            `array length exceeds ${maxArrayLength}`,
            path,
            { actual: value.length, maximum: maxArrayLength },
        );
    }

    const names = ops.ownNames(value);
    for (let index = 0; index < names.length; index += 1) {
        const key = names[index];
        if (key === 'length') continue;
        if (!isCanonicalArrayIndex(key, value.length, ops)) {
            state.fail(
                ERROR.ARRAY_EXTRA_PROPERTY,
                'an array property is not a canonical element index',
                propertyPath(path, key),
                undefined,
            );
        }
    }

    addCanonicalBytes(state, 2 + ops.max(0, value.length - 1), path);
    const copy = ops.newArray(value.length);
    ops.setAdd(state.ancestors, value);
    try {
        for (let index = 0; index < value.length; index++) {
            const elementPath = `${path}[${index}]`;
            const descriptor = ops.descriptor(value, ops.string(index));
            if (!descriptor) {
                state.fail(ERROR.SPARSE_ARRAY, 'sparse arrays are not valid contract data', elementPath);
            }
            if (!descriptor.enumerable) {
                state.fail(ERROR.NON_ENUMERABLE_PROPERTY, 'array elements must be enumerable', elementPath);
            }
            if (!ops.hasOwn(descriptor, 'value')) {
                state.fail(ERROR.ACCESSOR_PROPERTY, 'array elements must be data properties', elementPath);
            }
            const element = copyValue(descriptor.value, state, elementPath, depth + 1);
            if (ops.captured) ops.defineData(copy, ops.string(index), element);
            else copy[index] = element;
        }
    } finally {
        ops.setDelete(state.ancestors, value);
    }
    return state.options.freeze ? ops.freeze(copy) : copy;
}

function copyObject(value, state, path, depth) {
    const ops = state.ops;
    const prototype = ops.getPrototypeOf(value);
    if (prototype !== ops.objectPrototype && prototype !== null) {
        state.fail(
            ERROR.INVALID_OBJECT_PROTOTYPE,
            'objects must use Object.prototype or a null prototype',
            path,
        );
    }
    inspectInheritedEnumerableProperties(value, path, state);
    inspectSymbols(value, path, state);

    const keys = ops.sort(ops.ownNames(value));
    if (keys.length > state.options.limits.maxProperties) {
        state.fail(
            ERROR.PROPERTY_LIMIT,
            `object property count exceeds ${state.options.limits.maxProperties}`,
            path,
            { actual: keys.length, maximum: state.options.limits.maxProperties },
        );
    }
    state.totalProperties += keys.length;
    if (state.totalProperties > state.options.limits.maxTotalProperties) {
        state.fail(
            ERROR.TOTAL_PROPERTY_LIMIT,
            `total property count exceeds ${state.options.limits.maxTotalProperties}`,
            path,
            { actual: state.totalProperties, maximum: state.options.limits.maxTotalProperties },
        );
    }

    addCanonicalBytes(state, 2 + ops.max(0, keys.length - 1), path);
    const copy = ops.create(null);
    ops.setAdd(state.ancestors, value);
    try {
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            const keyPath = propertyPath(path, key);
            if (ops.setHas(FORBIDDEN_KEYS, key)) {
                state.fail(
                    ERROR.PROTOTYPE_POLLUTION_KEY,
                    'a prototype-sensitive property name is forbidden',
                    keyPath,
                    undefined,
                );
            }
            const descriptor = ops.descriptor(value, key);
            if (!descriptor?.enumerable) {
                state.fail(ERROR.NON_ENUMERABLE_PROPERTY, 'object properties must be enumerable', keyPath);
            }
            if (!ops.hasOwn(descriptor, 'value')) {
                state.fail(ERROR.ACCESSOR_PROPERTY, 'object properties must be data properties', keyPath);
            }
            addCanonicalBytes(state, inspectString(key, state, keyPath) + 1, keyPath);
            const element = copyValue(descriptor.value, state, keyPath, depth + 1);
            if (ops.captured) ops.defineData(copy, key, element);
            else copy[key] = element;
        }
    } finally {
        ops.setDelete(state.ancestors, value);
    }
    return state.options.freeze ? ops.freeze(copy) : copy;
}

function copyValue(value, state, path, depth) {
    if (depth > state.options.limits.maxDepth) {
        state.fail(
            ERROR.DEPTH_LIMIT,
            `value depth exceeds ${state.options.limits.maxDepth}`,
            path,
            { actual: depth, maximum: state.options.limits.maxDepth },
        );
    }
    state.nodes += 1;
    if (state.nodes > state.options.limits.maxNodes) {
        state.fail(
            ERROR.NODE_LIMIT,
            `value node count exceeds ${state.options.limits.maxNodes}`,
            path,
            { actual: state.nodes, maximum: state.options.limits.maxNodes },
        );
    }

    if (value === null) {
        addCanonicalBytes(state, 4, path);
        return null;
    }
    const type = typeof value;
    if (type === 'string') {
        addCanonicalBytes(state, inspectString(value, state, path), path);
        return value;
    }
    if (type === 'boolean') {
        addCanonicalBytes(state, value ? 4 : 5, path);
        return value;
    }
    if (type === 'number') {
        if (!state.ops.finite(value)) {
            state.fail(ERROR.NON_FINITE_NUMBER, 'numbers must be finite', path, { value: state.ops.string(value) });
        }
        if (state.ops.is(value, -0)) {
            state.fail(ERROR.NEGATIVE_ZERO, 'negative zero is not canonical contract data', path);
        }
        if (state.ops.integer(value) && !state.ops.safeInteger(value)) {
            state.fail(ERROR.UNSAFE_INTEGER, 'integers must be within the JavaScript safe-integer range', path);
        }
        addCanonicalBytes(state, canonicalTextByteLength(state.ops.jsonStringify(value), state, path), path);
        return value;
    }
    if (type === 'undefined') {
        state.fail(ERROR.UNDEFINED_VALUE, 'undefined is not valid contract data', path);
    }
    if (type === 'function') {
        state.fail(ERROR.FUNCTION_VALUE, 'functions are not valid contract data', path);
    }
    if (type === 'bigint') {
        state.fail(ERROR.BIGINT_VALUE, 'BigInt values are not valid contract data', path);
    }
    if (type === 'symbol') {
        state.fail(ERROR.SYMBOL_VALUE, 'symbols are not valid contract data', path);
    }
    if (type !== 'object') {
        state.fail(ERROR.INVALID_VALUE_TYPE, `unsupported contract value type ${type}`, path, { type });
    }
    if (state.ops.setHas(state.ancestors, value)) {
        state.fail(ERROR.CYCLE, 'cyclic references are not valid contract data', path);
    }
    return state.ops.isArray(value)
        ? copyArray(value, state, path, depth)
        : copyObject(value, state, path, depth);
}

/**
 * Validate a JavaScript value as bounded plain JSON and return a defensive copy.
 * The copy is deeply frozen by default and object keys are emitted in stable
 * lexical order. Shared non-cyclic references are copied as independent values.
 */
export function preflightRealmContractValue(value, options = undefined, operationProfile = undefined) {
    const ops = resolveRealmContractOperations(operationProfile);
    const normalizedOptions = readOptions(options, ops, operationProfile);
    return copyValue(value, createState(normalizedOptions, ops, operationProfile), '$', 0);
}

/** Compatibility name for callers that treat preflight as an assertion. */
export function assertRealmContractValue(value, options = undefined, operationProfile = undefined) {
    return preflightRealmContractValue(value, options, operationProfile);
}

export default preflightRealmContractValue;
