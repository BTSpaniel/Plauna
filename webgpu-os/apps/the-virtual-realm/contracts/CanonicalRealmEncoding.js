// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CanonicalRealmEncoding.js
 *
 * Frozen M0 semantic encoding for The Virtual Realm. This module intentionally
 * does not sign, authorize, persist, or transport records. Contract-specific
 * validation runs first; these functions then construct deterministic payload,
 * content-digest, and signature preimage bytes.
 * The optional original-issued operation profile selects captured primitives;
 * omission preserves the live-operation defaults. Captured reflection is not a
 * proof that a caller-provided Proxy is absent.
 */

import { contentHashHex } from '../../../../engine/core/math/ChecksumMath.js';
import { resolveRealmContractOperations } from './RealmContractCapturedOperations.js';

const UTF8 = new TextEncoder();
const UINT32_MAX = 0xffff_ffffn;
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const CONTENT_DIGEST_BYTES = 32;
const EXCLUSION_CLASSES = Object.freeze(['self', 'digest', 'signature', 'transport']);
const SIGNATURE_DOMAIN = 'particle-realms.signature.v1';

export const REALM_CONTENT_ID_PATTERN = /^sha256:256:[0-9a-f]{64}$/;

export const REALM_CANONICAL_LIMITS = Object.freeze({
  maximumDepth: 64,
  maximumNodes: 100_000,
  maximumArrayItems: 100_000,
  maximumObjectKeys: 16_384,
  maximumStringBytes: 1024 * 1024,
  maximumCanonicalBytes: 16 * 1024 * 1024,
});

function plainObject(value, label, ops = resolveRealmContractOperations(undefined)) {
  if (!value || typeof value !== 'object' || ops.isArray(value)) {
    throw ops.typeError(`${label} must be a plain object`);
  }
  const prototype = ops.getPrototypeOf(value);
  if (prototype !== ops.objectPrototype && prototype !== null) {
    throw ops.typeError(`${label} must be a plain object`);
  }
  return value;
}

function capturedDataRecord(value, label, ops) {
  plainObject(value, label, ops);
  if (!ops.captured) return value;
  const result = ops.createRecord();
  const keys = ops.ownKeys(value);
  if (keys.length > REALM_CANONICAL_LIMITS.maximumObjectKeys) {
    throw ops.rangeError(`${label} exceeds the object key limit`);
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = ops.descriptor(value, key);
    if (!descriptor?.enumerable || !ops.hasOwn(descriptor, 'value')) {
      throw ops.typeError(`${label} fields must be enumerable data properties`);
    }
    ops.defineData(result, key, descriptor.value);
  }
  return result;
}

function utf8Bytes(value, ops, maximumBytes = REALM_CANONICAL_LIMITS.maximumCanonicalBytes) {
  return ops.captured ? ops.encode(value, maximumBytes) : UTF8.encode(value);
}

function safeLimit(value, fallback, label, minimum = 1, ops = resolveRealmContractOperations(undefined)) {
  const selected = value === undefined ? fallback : value;
  if (!ops.safeInteger(selected) || selected < minimum) {
    throw ops.rangeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return selected;
}

function canonicalOptions(options = {}, ops) {
  options = capturedDataRecord(options, 'canonical options', ops);
  const allowed = ops.setCreate(ops.keys(REALM_CANONICAL_LIMITS));
  const unknown = ops.filter(ops.ownKeys(options), (key) => typeof key !== 'string' || !ops.setHas(allowed, key));
  if (unknown.length > 0) throw ops.typeError('canonical options contain unknown fields');
  const limits = ops.freeze({
    maximumDepth: safeLimit(options.maximumDepth, REALM_CANONICAL_LIMITS.maximumDepth, 'maximumDepth', 0, ops),
    maximumNodes: safeLimit(options.maximumNodes, REALM_CANONICAL_LIMITS.maximumNodes, 'maximumNodes', 1, ops),
    maximumArrayItems: safeLimit(options.maximumArrayItems, REALM_CANONICAL_LIMITS.maximumArrayItems, 'maximumArrayItems', 1, ops),
    maximumObjectKeys: safeLimit(options.maximumObjectKeys, REALM_CANONICAL_LIMITS.maximumObjectKeys, 'maximumObjectKeys', 1, ops),
    maximumStringBytes: safeLimit(options.maximumStringBytes, REALM_CANONICAL_LIMITS.maximumStringBytes, 'maximumStringBytes', 1, ops),
    maximumCanonicalBytes: safeLimit(options.maximumCanonicalBytes, REALM_CANONICAL_LIMITS.maximumCanonicalBytes, 'maximumCanonicalBytes', 1, ops),
  });
  if (ops.captured) {
    const names = ops.keys(REALM_CANONICAL_LIMITS);
    for (let index = 0; index < names.length; index += 1) {
      if (limits[names[index]] > REALM_CANONICAL_LIMITS[names[index]]) {
        throw ops.rangeError('captured canonical options cannot increase the frozen limits');
      }
    }
  }
  return limits;
}

// Printable ASCII is well-formed and NFC, has no control characters, and takes one UTF-8 byte per character.
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

function assertWellFormedUnicode(value, name, ops) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = ops.charCodeAt(value, index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = ops.charCodeAt(value, index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw ops.typeError(`${name} contains an unpaired high surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw ops.typeError(`${name} contains an unpaired low surrogate`);
    }
  }
}

/** Validate one already-normalized contract string without changing it. */
export function assertCanonicalRealmString(value, name = 'string', options = {}, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (ops.captured && typeof name !== 'string') throw ops.typeError('captured string labels must be primitive strings');
  if (typeof value !== 'string') throw ops.typeError(`${name} must be a string`);
  options = capturedDataRecord(options, `${name} options`, ops);
  const allowed = ops.setCreate(['allowEmpty', 'forbidControls', 'maximumBytes']);
  if (ops.some(ops.ownKeys(options), (key) => typeof key !== 'string' || !ops.setHas(allowed, key))) {
    throw ops.typeError(`${name} options contain unknown fields`);
  }
  const allowEmpty = options.allowEmpty !== false;
  const maximumBytes = safeLimit(
    options.maximumBytes,
    REALM_CANONICAL_LIMITS.maximumStringBytes,
    `${name} maximumBytes`,
    1,
    ops,
  );
  if (ops.captured && maximumBytes > REALM_CANONICAL_LIMITS.maximumStringBytes) {
    throw ops.rangeError('captured string options cannot increase the frozen string limit');
  }
  if (!allowEmpty && value.length === 0) throw ops.typeError(`${name} must not be empty`);
  if (!ops.captured && PRINTABLE_ASCII.test(value)) {
    if (value.length > maximumBytes) throw ops.rangeError(`${name} exceeds ${maximumBytes} UTF-8 bytes`);
    return value;
  }
  if (ops.captured && value.length > maximumBytes) {
    throw ops.rangeError(`${name} exceeds ${maximumBytes} UTF-8 bytes`);
  }
  assertWellFormedUnicode(value, name, ops);
  if (ops.normalize(value, 'NFC') !== value) throw ops.typeError(`${name} must already be normalized to NFC`);
  if (options.forbidControls === true && ops.regexTest(/[\u0000-\u001f\u007f-\u009f]/u, value)) {
    throw ops.typeError(`${name} contains a forbidden control character`);
  }
  if (ops.byteLength(utf8Bytes(value, ops, maximumBytes)) > maximumBytes) {
    throw ops.rangeError(`${name} exceeds ${maximumBytes} UTF-8 bytes`);
  }
  return value;
}

/** Compare normalized strings lexicographically by Unicode scalar value. */
export function compareRealmUnicodeCodePoints(left, right, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  assertCanonicalRealmString(left, 'left comparison key', {}, operationProfile);
  assertCanonicalRealmString(right, 'right comparison key', {}, operationProfile);
  let leftOffset = 0;
  let rightOffset = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    const leftPoint = ops.codePointAt(left, leftOffset);
    const rightPoint = ops.codePointAt(right, rightOffset);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftOffset += leftPoint > 0xffff ? 2 : 1;
    rightOffset += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftOffset === left.length && rightOffset === right.length) return 0;
  return leftOffset === left.length ? -1 : 1;
}

// Order two strings the caller has already validated; every sort below validates each element first.
function compareValidatedCodePoints(left, right, ops) {
  let leftOffset = 0;
  let rightOffset = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    const leftPoint = ops.codePointAt(left, leftOffset);
    const rightPoint = ops.codePointAt(right, rightOffset);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftOffset += leftPoint > 0xffff ? 2 : 1;
    rightOffset += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftOffset === left.length && rightOffset === right.length) return 0;
  return leftOffset === left.length ? -1 : 1;
}

function exactUnsigned(value, maximum, label, ops = resolveRealmContractOperations(undefined)) {
  let integer;
  if (typeof value === 'bigint') {
    integer = value;
  } else if (typeof value === 'number') {
    if (!ops.safeInteger(value)) {
      throw ops.rangeError(`${label} number must be a safe integer; use bigint or canonical decimal text for larger values`);
    }
    integer = ops.bigInt(value);
  } else if (typeof value === 'string') {
    const decimalPattern = ops.captured ? /^(0|[1-9][0-9]*)$(?![\s\S])/ : /^(0|[1-9][0-9]*)$/;
    if ((ops.captured && value.length > 20) || !ops.regexTest(decimalPattern, value)) {
      throw ops.typeError(`${label} string must be canonical unsigned decimal text`);
    }
    integer = ops.bigInt(value);
  } else {
    throw ops.typeError(`${label} must be a safe integer, bigint, or canonical decimal string`);
  }
  if (integer < 0n || integer > maximum) throw ops.rangeError(`${label} is outside its unsigned range`);
  return integer;
}

function encodeUnsignedBE(value, byteLength, maximum, label, ops) {
  let integer = exactUnsigned(value, maximum, label, ops);
  const bytes = ops.newBytes(byteLength);
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[index] = ops.number(integer & 0xffn);
    integer >>= 8n;
  }
  return bytes;
}

export function encodeRealmUint32BE(value, label = 'uint32', operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (ops.captured && typeof label !== 'string') throw ops.typeError('captured uint32 labels must be primitive strings');
  return encodeUnsignedBE(value, 4, UINT32_MAX, label, ops);
}

export function encodeRealmUint64BE(value, label = 'uint64', operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (ops.captured && typeof label !== 'string') throw ops.typeError('captured uint64 labels must be primitive strings');
  return encodeUnsignedBE(value, 8, UINT64_MAX, label, ops);
}

export function encodeRealmLengthPrefixedUtf8(value, label = 'text', operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (ops.captured && typeof label !== 'string') throw ops.typeError('captured UTF-8 labels must be primitive strings');
  const text = assertCanonicalRealmString(value, label, {}, operationProfile);
  const bytes = utf8Bytes(text, ops);
  return concatenateBytes([
    encodeRealmUint64BE(ops.bigInt(ops.byteLength(bytes)), `${label} byte length`, operationProfile), bytes,
  ], ops);
}

function byteView(value, label, ops = resolveRealmContractOperations(undefined)) {
  if (ops.captured) return ops.copyBytes(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(source);
  }
  throw new TypeError(`${label} must be an ArrayBuffer or typed-array view`);
}

function concatenateBytes(parts, ops = resolveRealmContractOperations(undefined)) {
  let byteLength = 0;
  const views = ops.map(parts, (part, index) => {
    const view = byteView(part, `byte part ${index}`, ops);
    byteLength += ops.byteLength(view);
    if (!ops.safeInteger(byteLength)) throw ops.rangeError('combined byte length exceeds the safe integer range');
    return view;
  });
  const result = ops.newBytes(byteLength);
  let offset = 0;
  for (let index = 0; index < views.length; index += 1) {
    const view = views[index];
    ops.setBytes(result, view, offset);
    offset += ops.byteLength(view);
  }
  return result;
}

function fieldList(values, name, options = {}, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  let allowEmpty;
  if (ops.captured) {
    options = capturedDataRecord(options, 'contract field-list options', ops);
    if (ops.some(ops.ownKeys(options), (key) => key !== 'allowEmpty')) {
      throw ops.typeError('contract field-list options contain unknown fields');
    }
    allowEmpty = options.allowEmpty === undefined ? true : options.allowEmpty;
    if (typeof allowEmpty !== 'boolean') {
      throw ops.typeError('captured contract field-list allowEmpty must be a boolean');
    }
  } else {
    ({ allowEmpty = true } = options);
  }
  if (!ops.isArray(values)) {
    throw ops.typeError(`${name} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  const inputLength = ops.captured ? ops.descriptor(values, 'length')?.value : values.length;
  if (!allowEmpty && inputLength === 0) {
    throw ops.typeError(`${name} must be a non-empty array`);
  }
  if (ops.captured) {
    const length = inputLength;
    if (!ops.safeInteger(length) || length > REALM_CANONICAL_LIMITS.maximumObjectKeys) {
      throw ops.rangeError(`${name} exceeds the contract field limit`);
    }
    const keys = ops.ownKeys(values);
    if (keys.length !== length + 1) throw ops.typeError(`${name} must contain only dense array items`);
    const snapshot = ops.newArray(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = ops.descriptor(values, ops.string(index));
      if (!descriptor?.enumerable || !ops.hasOwn(descriptor, 'value')) {
        throw ops.typeError(`${name} items must be enumerable data properties`);
      }
      ops.defineData(snapshot, ops.string(index), descriptor.value);
    }
    values = snapshot;
  }
  const fields = ops.map(values, (value, index) => assertCanonicalRealmString(value, `${name}[${index}]`, {
    allowEmpty: false,
    forbidControls: true,
    maximumBytes: 256,
  }, operationProfile));
  if (ops.setSize(ops.setCreate(fields)) !== fields.length) throw ops.typeError(`${name} contains duplicate fields`);
  const ordered = ops.captured ? fields : [...fields];
  ops.sort(ordered, (left, right) => compareValidatedCodePoints(left, right, ops));
  return ops.freeze(ordered);
}

// Contracts this module normalized with live operations; normalizing one again gives the same contract.
const liveNormalizedContracts = new WeakSet();

/** Define the exact top-level payload and explicit exclusion categories. */
export function defineCanonicalRealmContract(definition, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  definition = capturedDataRecord(definition, 'canonical Realm contract definition', ops);
  const allowedDefinitionFields = ops.setCreate([
    'domain', 'format', 'majorVersion', 'payloadFields', 'requiredPayloadFields', 'excludedFields',
  ]);
  if (ops.some(ops.ownKeys(definition), (key) => typeof key !== 'string' || !ops.setHas(allowedDefinitionFields, key))) {
    throw ops.typeError('canonical Realm contract definition contains unknown fields');
  }
  const domain = assertCanonicalRealmString(definition.domain, 'contract domain', {
    allowEmpty: false,
    forbidControls: true,
    maximumBytes: 512,
  }, operationProfile);
  const format = assertCanonicalRealmString(definition.format, 'contract format', {
    allowEmpty: false,
    forbidControls: true,
    maximumBytes: 512,
  }, operationProfile);
  const majorVersionValue = exactUnsigned(definition.majorVersion, UINT32_MAX, 'contract majorVersion', ops);
  const majorVersion = ops.number(majorVersionValue);
  const payloadFields = fieldList(definition.payloadFields, 'payloadFields', { allowEmpty: false }, operationProfile);
  const requiredPayloadFields = fieldList(
    definition.requiredPayloadFields ?? definition.payloadFields,
    'requiredPayloadFields',
    {},
    operationProfile,
  );
  const payloadSet = ops.setCreate(payloadFields);
  if (ops.some(requiredPayloadFields, (field) => !ops.setHas(payloadSet, field))) {
    throw ops.typeError('requiredPayloadFields must be a subset of payloadFields');
  }
  const excludedInput = capturedDataRecord(definition.excludedFields ?? {}, 'excludedFields', ops);
  if (ops.some(ops.ownKeys(excludedInput), (key) => typeof key !== 'string' || !ops.includesArray(EXCLUSION_CLASSES, key))) {
    throw ops.typeError('excludedFields contains an unknown exclusion class');
  }
  const excludedFields = ops.captured ? ops.createRecord() : {};
  const allExcluded = ops.setCreate();
  for (let classIndex = 0; classIndex < EXCLUSION_CLASSES.length; classIndex += 1) {
    const exclusionClass = EXCLUSION_CLASSES[classIndex];
    const fields = fieldList(excludedInput[exclusionClass] ?? [], `excludedFields.${exclusionClass}`, {}, operationProfile);
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex];
      if (ops.setHas(payloadSet, field) || ops.setHas(allExcluded, field)) {
        throw ops.typeError(`contract field ${field} appears in more than one payload or exclusion class`);
      }
      ops.setAdd(allExcluded, field);
    }
    if (ops.captured) ops.defineData(excludedFields, exclusionClass, fields);
    else excludedFields[exclusionClass] = fields;
  }
  const contract = ops.freeze({
    domain,
    format,
    majorVersion,
    payloadFields,
    requiredPayloadFields,
    excludedFields: ops.freeze(excludedFields),
  });
  if (!ops.captured) liveNormalizedContracts.add(contract);
  return contract;
}

/** Adapt one frozen Realm contract definition to the exact canonical encoder shape. */
export function canonicalRealmContractFromDefinition(definition, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (ops.captured) {
    // Capture only encoder metadata; legitimate definition validators are not JSON.
    plainObject(definition, 'Realm contract definition', ops);
    const fields = ['kind', 'contentDomain', 'format', 'majorVersion', 'rootSchema',
      'canonicalPayloadFields', 'selfIdentityFields', 'selfDigestFields', 'transportEnvelopeFields'];
    const descriptors = ops.newArray(fields.length);
    for (let index = 0; index < fields.length; index += 1) {
      const descriptor = ops.descriptor(definition, fields[index]);
      if (descriptor === undefined && fields[index] === 'rootSchema') continue;
      if (!descriptor?.enumerable || !ops.hasOwn(descriptor, 'value')) {
        throw ops.typeError('Realm contract encoder metadata must be own enumerable data');
      }
      ops.defineData(descriptors, index, descriptor);
    }
    const metadata = ops.createRecord();
    for (let index = 0; index < fields.length; index += 1) {
      ops.defineData(metadata, fields[index], ops.hasOwn(descriptors, index) ? descriptors[index].value : undefined);
    }
    if (metadata.kind !== 'record') throw ops.typeError('canonical record encoding requires a record contract');
    let requiredValues = ops.newArray();
    if (metadata.rootSchema !== undefined && metadata.rootSchema !== null) {
      plainObject(metadata.rootSchema, 'Realm root schema', ops);
      const descriptor = ops.descriptor(metadata.rootSchema, 'required');
      if (descriptor !== undefined) {
        if (!descriptor.enumerable || !ops.hasOwn(descriptor, 'value')) {
          throw ops.typeError('Realm root required fields must be own enumerable data');
        }
        if (descriptor.value !== undefined && descriptor.value !== null) requiredValues = descriptor.value;
      }
    }
    const required = ops.setCreate(fieldList(requiredValues, 'root required fields', {}, operationProfile));
    const payloadFields = ops.newArray();
    ops.append(payloadFields, 'format'); ops.append(payloadFields, 'version');
    const canonicalFields = fieldList(metadata.canonicalPayloadFields, 'canonicalPayloadFields', {}, operationProfile);
    for (let index = 0; index < canonicalFields.length; index += 1) ops.append(payloadFields, canonicalFields[index]);
    const excludedFields = ops.createRecord();
    ops.defineData(excludedFields, 'self', metadata.selfIdentityFields);
    ops.defineData(excludedFields, 'digest', metadata.selfDigestFields);
    ops.defineData(excludedFields, 'signature', ops.newArray());
    ops.defineData(excludedFields, 'transport', metadata.transportEnvelopeFields);
    const selected = ops.createRecord();
    ops.defineData(selected, 'domain', metadata.contentDomain);
    ops.defineData(selected, 'format', metadata.format);
    ops.defineData(selected, 'majorVersion', metadata.majorVersion);
    ops.defineData(selected, 'payloadFields', payloadFields);
    ops.defineData(selected, 'requiredPayloadFields', ops.filter(payloadFields, field => ops.setHas(required, field)));
    ops.defineData(selected, 'excludedFields', excludedFields);
    return defineCanonicalRealmContract(selected, operationProfile);
  }
  plainObject(definition, 'Realm contract definition');
  if (definition.kind !== 'record') throw new TypeError('canonical record encoding requires a record contract');
  const required = new Set(definition.rootSchema?.required ?? []);
  const payloadFields = ['format', 'version', ...definition.canonicalPayloadFields];
  return defineCanonicalRealmContract({
    domain: definition.contentDomain,
    format: definition.format,
    majorVersion: definition.majorVersion,
    payloadFields,
    requiredPayloadFields: payloadFields.filter(field => required.has(field)),
    excludedFields: {
      self: definition.selfIdentityFields,
      digest: definition.selfDigestFields,
      signature: [],
      transport: definition.transportEnvelopeFields,
    },
  });
}

function canonicalNumber(value, ops) {
  if (!ops.finite(value)) throw ops.typeError('canonical Realm JSON number must be finite');
  if (ops.is(value, -0)) throw ops.typeError('canonical Realm JSON rejects negative zero');
  if (ops.integer(value) && !ops.safeInteger(value)) {
    throw ops.rangeError('canonical Realm JSON integer must be a safe integer');
  }
  return ops.jsonStringify(value);
}

/** Encode strict, already-preflighted JSON with code-point-sorted object keys. */
export function canonicalizeRealmJson(value, options = {}, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  const limits = canonicalOptions(options, ops);
  const active = ops.setCreate();
  let nodes = 0;
  let canonicalByteCount = 0;
  const reserveBytes = (count) => {
    if (!ops.captured) return;
    canonicalByteCount += count;
    if (canonicalByteCount > limits.maximumCanonicalBytes) {
      throw ops.rangeError(`canonical Realm JSON exceeds ${limits.maximumCanonicalBytes} bytes`);
    }
  };
  const encodedScalar = (text) => {
    if (ops.captured) reserveBytes(ops.byteLength(utf8Bytes(text, ops, limits.maximumCanonicalBytes)));
    return text;
  };

  const encode = (item, depth, path) => {
    nodes += 1;
    if (nodes > limits.maximumNodes) throw ops.rangeError('canonical Realm JSON exceeds the node limit');
    if (depth > limits.maximumDepth) throw ops.rangeError('canonical Realm JSON exceeds the depth limit');
    if (item === null) return encodedScalar('null');
    if (typeof item === 'boolean') return encodedScalar(item ? 'true' : 'false');
    if (typeof item === 'number') return encodedScalar(canonicalNumber(item, ops));
    if (typeof item === 'string') {
      return encodedScalar(ops.jsonStringify(assertCanonicalRealmString(item, path, { maximumBytes: limits.maximumStringBytes }, operationProfile)));
    }
    if (typeof item !== 'object') {
      throw ops.typeError(`${path} contains a non-JSON value of type ${typeof item}`);
    }
    if (ops.setHas(active, item)) throw ops.typeError(`${path} contains a cycle`);
    ops.setAdd(active, item);
    try {
      if (ops.isArray(item)) {
        const length = ops.captured ? ops.descriptor(item, 'length')?.value : item.length;
        if ((ops.captured && !ops.safeInteger(length)) || length > limits.maximumArrayItems) throw ops.rangeError(`${path} exceeds the array item limit`);
        if (ops.captured && ops.ownKeys(item).length !== length + 1) {
          throw ops.typeError(`${path} must contain only dense array items`);
        }
        reserveBytes(2 + (length > 0 ? length - 1 : 0));
        const values = ops.newArray();
        for (let index = 0; index < length; index += 1) {
          if (!ops.hasOwn(item, index)) throw ops.typeError(`${path} contains an array hole`);
          let value;
          if (ops.captured) {
            const descriptor = ops.descriptor(item, ops.string(index));
            if (!descriptor?.enumerable || !ops.hasOwn(descriptor, 'value')) {
              throw ops.typeError(`${path} items must be enumerable data properties`);
            }
            value = descriptor.value;
          } else value = item[index];
          ops.append(values, encode(value, depth + 1, `${path}[${index}]`));
        }
        return `[${ops.join(values, ',')}]`;
      }
      plainObject(item, path, ops);
      const keys = ops.ownKeys(item);
      if (keys.length > limits.maximumObjectKeys) throw ops.rangeError(`${path} exceeds the object key limit`);
      reserveBytes(2 + (keys.length > 0 ? keys.length - 1 : 0));
      const descriptors = ops.captured ? ops.createRecord() : undefined;
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key !== 'string') throw ops.typeError(`${path} contains a symbol key`);
        assertCanonicalRealmString(key, `${path} key`, { maximumBytes: 256 }, operationProfile);
        const descriptor = ops.descriptor(item, key);
        if (!descriptor?.enumerable || !ops.hasOwn(descriptor, 'value')) {
          throw ops.typeError(`${path}.${key} must be an enumerable data property`);
        }
        if (ops.captured) ops.defineData(descriptors, key, descriptor.value);
      }
      ops.sort(keys, (left, right) => compareValidatedCodePoints(left, right, ops));
      return `{${ops.join(ops.map(keys, (key) => {
        const encodedKey = encodedScalar(ops.jsonStringify(key));
        reserveBytes(1);
        return `${encodedKey}:${encode(ops.captured ? descriptors[key] : item[key], depth + 1, `${path}.${key}`)}`;
      }), ',')}}`;
    } finally {
      ops.setDelete(active, item);
    }
  };

  const canonical = encode(value, 0, '$');
  if (ops.byteLength(utf8Bytes(canonical, ops, limits.maximumCanonicalBytes)) > limits.maximumCanonicalBytes) {
    throw ops.rangeError(`canonical Realm JSON exceeds ${limits.maximumCanonicalBytes} bytes`);
  }
  return canonical;
}

function normalizedContract(definition, operationProfile = undefined) {
  if (operationProfile === undefined && liveNormalizedContracts.has(definition)) return definition;
  return defineCanonicalRealmContract(definition, operationProfile);
}

function recordKeys(record, label, ops) {
  plainObject(record, label, ops);
  const keys = ops.ownKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string') throw ops.typeError(`${label} contains a symbol key`);
    const descriptor = ops.descriptor(record, key);
    if (!descriptor?.enumerable || !ops.hasOwn(descriptor, 'value')) {
      throw ops.typeError(`${label}.${key} must be an enumerable data property`);
    }
    if (descriptor.value === undefined) throw ops.typeError(`${label}.${key} must not be undefined`);
  }
  return keys;
}

/** Select the explicit canonical payload without recursively stripping names. */
export function canonicalRealmPayload(record, definition, options = {}, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  options = capturedDataRecord(options, 'payload options', ops);
  if (ops.some(ops.ownKeys(options), (key) => key !== 'rejectExcludedFields')) {
    throw ops.typeError('payload options contain unknown fields');
  }
  const contract = normalizedContract(definition, operationProfile);
  const payload = ops.captured ? ops.createRecord() : {};
  const payloadSet = ops.setCreate(contract.payloadFields);
  const excludedSet = ops.setCreate(ops.flatMap(EXCLUSION_CLASSES, (kind) => contract.excludedFields[kind]));
  record = capturedDataRecord(record, 'Realm content record', ops);
  const keys = recordKeys(record, 'Realm content record', ops);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (ops.setHas(payloadSet, key)) {
      if (ops.captured) ops.defineData(payload, key, record[key]);
      else payload[key] = record[key];
    } else if (ops.setHas(excludedSet, key)) {
      if (options.rejectExcludedFields === true) throw ops.typeError(`Realm content record field ${key} is transport-side metadata`);
    } else {
      throw ops.typeError(`Realm content record contains unknown field ${key}`);
    }
  }
  for (let index = 0; index < contract.requiredPayloadFields.length; index += 1) {
    const field = contract.requiredPayloadFields[index];
    if (!ops.hasOwn(payload, field)) {
      throw ops.typeError(`Realm content record is missing required payload field ${field}`);
    }
  }
  if (ops.hasOwn(payload, 'format') && payload.format !== contract.format) {
    throw ops.typeError(`Realm content record format must be ${contract.format}`);
  }
  return ops.freeze(payload);
}

export function canonicalRealmPayloadBytes(record, definition, options = {}, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (ops.captured) options = capturedDataRecord(options, 'canonical payload byte options', ops);
  const payloadOptions = options.payload ?? {};
  const canonicalOptionsValue = options.canonical ?? {};
  plainObject(options, 'canonical payload byte options', ops);
  if (ops.some(ops.ownKeys(options), (key) => key !== 'payload' && key !== 'canonical')) {
    throw ops.typeError('canonical payload byte options contain unknown fields');
  }
  const canonical = canonicalizeRealmJson(
    canonicalRealmPayload(record, definition, payloadOptions, operationProfile),
    canonicalOptionsValue,
    operationProfile,
  );
  return utf8Bytes(canonical, ops);
}

export function buildRealmContentPreimage(record, definition, options = {}, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  const contract = normalizedContract(definition, operationProfile);
  const canonicalPayloadBytes = canonicalRealmPayloadBytes(record, contract, options, operationProfile);
  return concatenateBytes([
    encodeRealmLengthPrefixedUtf8(contract.domain, 'content domain', operationProfile),
    encodeRealmLengthPrefixedUtf8(contract.format, 'content format', operationProfile),
    encodeRealmUint32BE(contract.majorVersion, 'content majorVersion', operationProfile),
    encodeRealmUint64BE(ops.bigInt(ops.byteLength(canonicalPayloadBytes)), 'canonical payload byte length', operationProfile),
    canonicalPayloadBytes,
  ], ops);
}

function bytesFromHex(hex, label, ops = resolveRealmContractOperations(undefined)) {
  const hexadecimalPattern = ops.captured ? /^[0-9a-f]+$(?![\s\S])/ : /^[0-9a-f]+$/;
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !ops.regexTest(hexadecimalPattern, hex)) {
    throw ops.typeError(`${label} must be lowercase even-length hexadecimal text`);
  }
  const bytes = ops.newBytes(hex.length / 2);
  const length = ops.captured ? ops.byteLength(bytes) : bytes.length;
  for (let index = 0; index < length; index += 1) {
    bytes[index] = ops.parseInt(ops.slice(hex, index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function computeRealmContentDigest(record, definition, options = {}, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  const hex = await contentHashHex(buildRealmContentPreimage(record, definition, options, operationProfile), 'SHA-256', operationProfile);
  return bytesFromHex(hex, 'SHA-256 digest', ops);
}

export async function computeRealmContentId(record, definition, options = {}, operationProfile = undefined) {
  resolveRealmContractOperations(operationProfile);
  const hex = await contentHashHex(buildRealmContentPreimage(record, definition, options, operationProfile), 'SHA-256', operationProfile);
  return `sha256:256:${hex}`;
}

export function realmContentDigestBytes(value, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (typeof value === 'string') {
    if (!(ops.captured ? ops.regexTest(REALM_CONTENT_ID_PATTERN, value) : REALM_CONTENT_ID_PATTERN.test(value))) {
      throw ops.typeError('content digest must be sha256:256:<64 lowercase hex>');
    }
    return bytesFromHex(ops.captured ? ops.slice(value, 'sha256:256:'.length) : value.slice('sha256:256:'.length), 'content digest', ops);
  }
  const bytes = byteView(value, 'content digest', ops);
  if ((ops.captured ? ops.byteLength(bytes) : bytes.byteLength) !== CONTENT_DIGEST_BYTES) {
    throw ops.rangeError('content digest must contain exactly 32 bytes');
  }
  return bytes;
}

/** Construct the exact context-bound signature preimage; no signing occurs. */
export function buildRealmSignaturePreimage(input, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (ops.captured) input = capturedDataRecord(input, 'signature preimage input', ops);
  else plainObject(input, 'signature preimage input');
  const allowed = ops.setCreate([
    'format', 'majorVersion', 'publisherIdentity', 'audienceClass', 'policyRevision',
    'issuedAt', 'expiresAt', 'operationNonce', 'contentDigest',
  ]);
  const keys = ops.ownKeys(input);
  if (ops.some(keys, (key) => typeof key !== 'string' || !ops.setHas(allowed, key))) {
    throw ops.typeError('signature preimage input contains unknown fields');
  }
  if (ops.captured) {
    const requiredFields = ['format', 'majorVersion', 'publisherIdentity', 'audienceClass', 'issuedAt', 'expiresAt', 'contentDigest'];
    for (let index = 0; index < requiredFields.length; index += 1) {
      const required = requiredFields[index];
      if (!ops.hasOwn(input, required) || input[required] === undefined) {
        throw ops.typeError(`signature preimage input is missing ${required}`);
      }
    }
  } else {
    for (const required of ['format', 'majorVersion', 'publisherIdentity', 'audienceClass', 'issuedAt', 'expiresAt', 'contentDigest']) {
      if (!Object.prototype.hasOwnProperty.call(input, required) || input[required] === undefined) {
        throw new TypeError(`signature preimage input is missing ${required}`);
      }
    }
  }
  const format = assertCanonicalRealmString(input.format, 'signature content format', {
    allowEmpty: false,
    forbidControls: true,
    maximumBytes: 512,
  }, operationProfile);
  const publisherIdentity = assertCanonicalRealmString(input.publisherIdentity, 'publisherIdentity', {
    allowEmpty: false,
    forbidControls: true,
    maximumBytes: 1024,
  }, operationProfile);
  const audienceClass = assertCanonicalRealmString(input.audienceClass, 'audienceClass', {
    allowEmpty: false,
    forbidControls: true,
    maximumBytes: 256,
  }, operationProfile);
  const policyRevision = (ops.captured ? ops.hasOwn(input, 'policyRevision') : Object.prototype.hasOwnProperty.call(input, 'policyRevision'))
    ? assertCanonicalRealmString(input.policyRevision, 'policyRevision', {
      allowEmpty: false,
      forbidControls: true,
      maximumBytes: 512,
    }, operationProfile)
    : '';
  const operationNonce = (ops.captured ? ops.hasOwn(input, 'operationNonce') : Object.prototype.hasOwnProperty.call(input, 'operationNonce'))
    ? assertCanonicalRealmString(input.operationNonce, 'operationNonce', {
      allowEmpty: false,
      forbidControls: true,
      maximumBytes: 512,
    }, operationProfile)
    : '';
  const issuedAt = exactUnsigned(input.issuedAt, UINT64_MAX, 'issuedAt', ops);
  const expiresAt = exactUnsigned(input.expiresAt, UINT64_MAX, 'expiresAt', ops);
  if (expiresAt !== 0n && expiresAt <= issuedAt) {
    throw ops.rangeError('expiresAt must be zero or greater than issuedAt');
  }
  return concatenateBytes([
    encodeRealmLengthPrefixedUtf8(SIGNATURE_DOMAIN, 'signature domain', operationProfile),
    encodeRealmLengthPrefixedUtf8(format, 'signature content format', operationProfile),
    encodeRealmUint32BE(input.majorVersion, 'signature majorVersion', operationProfile),
    encodeRealmLengthPrefixedUtf8(publisherIdentity, 'publisherIdentity', operationProfile),
    encodeRealmLengthPrefixedUtf8(audienceClass, 'audienceClass', operationProfile),
    encodeRealmLengthPrefixedUtf8(policyRevision, 'policyRevisionOrEmpty', operationProfile),
    encodeRealmUint64BE(issuedAt, 'issuedAt', operationProfile),
    encodeRealmUint64BE(expiresAt, 'expiresAt', operationProfile),
    encodeRealmLengthPrefixedUtf8(operationNonce, 'operationNonceOrEmpty', operationProfile),
    realmContentDigestBytes(input.contentDigest, operationProfile),
  ], ops);
}
