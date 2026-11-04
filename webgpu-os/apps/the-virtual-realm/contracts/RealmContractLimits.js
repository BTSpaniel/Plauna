// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    REALM_CONTRACT_ERROR_CODES as ERROR,
    throwRealmContractError,
} from './RealmContractError.js';
import { resolveRealmContractOperations } from './RealmContractCapturedOperations.js';

/** Default resource ceilings applied before schema or semantic validation. */
export const REALM_CONTRACT_LIMITS = Object.freeze({
    maxDepth: 64,
    maxNodes: 100_000,
    maxProperties: 4_096,
    maxTotalProperties: 100_000,
    maxArrayLength: 65_536,
    maxStringUtf8Bytes: 1_048_576,
    maxCanonicalUtf8Bytes: 16_777_216,
});

export const DEFAULT_REALM_CONTRACT_LIMITS = REALM_CONTRACT_LIMITS;

export const REALM_CONTRACT_LIMIT_KEYS = Object.freeze(Object.keys(REALM_CONTRACT_LIMITS));

const LIMIT_ALIASES = Object.freeze({
    maxPropertiesPerObject: 'maxProperties',
    maxArrayItems: 'maxArrayLength',
    maxStringBytes: 'maxStringUtf8Bytes',
    maxCanonicalBytes: 'maxCanonicalUtf8Bytes',
});

function isPlainRecord(value, ops) {
    if (!value || typeof value !== 'object' || ops.isArray(value)) return false;
    const prototype = ops.getPrototypeOf(value);
    return prototype === ops.objectPrototype || prototype === null;
}

function validatedLimit(key, value, ops, operationProfile) {
    const minimum = key === 'maxDepth' ? 0 : 1;
    if (!ops.safeInteger(value) || value < minimum) {
        throwRealmContractError(
            ERROR.INVALID_LIMITS,
            `${key} must be a safe integer greater than or equal to ${minimum}`,
            `$.limits.${key}`,
            { key, value, minimum },
            operationProfile,
        );
    }
    return value;
}

/**
 * Merge explicit per-operation limits with the immutable defaults.
 * Unknown names fail closed so a misspelled security ceiling is never ignored.
 */
export function resolveRealmContractLimits(overrides = undefined, operationProfile = undefined) {
    const ops = resolveRealmContractOperations(operationProfile);
    if (overrides === undefined || overrides === null) return REALM_CONTRACT_LIMITS;
    if (!isPlainRecord(overrides, ops)) {
        throwRealmContractError(
            ERROR.INVALID_LIMITS,
            'limit overrides must be a plain or null-prototype object',
            '$.limits',
            undefined,
            operationProfile,
        );
    }
    if (ops.ownSymbols(overrides).length !== 0) {
        throwRealmContractError(ERROR.INVALID_LIMITS, 'limit overrides cannot contain symbol properties', '$.limits', undefined, operationProfile);
    }
    for (const key in overrides) {
        if (!ops.hasOwn(overrides, key)) {
            throwRealmContractError(
                ERROR.INVALID_LIMITS,
                `inherited limit ${ops.jsonStringify(key)} is not allowed`,
                '$.limits',
                { key },
                operationProfile,
            );
        }
    }

    const normalized = ops.captured ? ops.create(ops.objectPrototype) : { ...REALM_CONTRACT_LIMITS };
    if (ops.captured) {
        for (let index = 0; index < REALM_CONTRACT_LIMIT_KEYS.length; index += 1) {
            const key = REALM_CONTRACT_LIMIT_KEYS[index];
            ops.defineData(normalized, key, REALM_CONTRACT_LIMITS[key]);
        }
    }
    const assigned = ops.mapCreate();
    const keys = ops.ownNames(overrides);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const descriptor = ops.descriptor(overrides, key);
        if (!descriptor?.enumerable || !ops.hasOwn(descriptor, 'value')) {
            throwRealmContractError(
                ERROR.INVALID_LIMITS,
                'limit overrides must contain enumerable data properties only',
                `$.limits[${ops.jsonStringify(key)}]`,
                undefined,
                operationProfile,
            );
        }
        const canonicalKey = ops.hasOwn(REALM_CONTRACT_LIMITS, key)
            ? key
            : (ops.captured && !ops.hasOwn(LIMIT_ALIASES, key) ? undefined : LIMIT_ALIASES[key]);
        if (!canonicalKey) {
            throwRealmContractError(ERROR.UNKNOWN_LIMIT, `unknown contract limit ${ops.jsonStringify(key)}`, '$.limits', { key }, operationProfile);
        }
        const value = validatedLimit(canonicalKey, descriptor.value, ops, operationProfile);
        if (ops.mapHas(assigned, canonicalKey) && ops.mapGet(assigned, canonicalKey) !== value) {
            throwRealmContractError(
                ERROR.INVALID_LIMITS,
                `conflicting values were supplied for ${canonicalKey}`,
                `$.limits.${canonicalKey}`,
                undefined,
                operationProfile,
            );
        }
        ops.mapSet(assigned, canonicalKey, value);
        if (ops.captured) ops.defineData(normalized, canonicalKey, value);
        else normalized[canonicalKey] = value;
    }
    return ops.freeze(normalized);
}

export default REALM_CONTRACT_LIMITS;
