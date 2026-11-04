// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Opt-in operation capture for the existing Realm JSON/encoding algorithms.
 * Capture requires pristine trusted module initialization. Issuance is not
 * policy, storage-head, lifecycle, or provider authority. Native asynchronous
 * fulfillment still requires stable platform then/constructor chains; this
 * module does not isolate arbitrary transient mutation in a shared realm.
 */
const APPLY = Reflect.apply;
const FREEZE = Object.freeze;
const CREATE = Object.create;
const DEFINE = Object.defineProperty;
const DESCRIPTOR = Object.getOwnPropertyDescriptor;
const PROTOTYPE = Object.getPrototypeOf;
const OWN_KEYS = Reflect.ownKeys;
const KEYS = Object.keys;
const NAMES = Object.getOwnPropertyNames;
const SYMBOLS = Object.getOwnPropertySymbols;
const HAS_OWN = Object.hasOwn;
const OBJECT_PROTOTYPE = Object.prototype;
const ARRAY = Array;
const ARRAY_PROTOTYPE = Array.prototype;
const IS_ARRAY = Array.isArray;
const SORT = Array.prototype.sort;
const NUMBER = Number;
const BIGINT = BigInt;
const STRING = String;
const FINITE = Number.isFinite;
const INTEGER = Number.isInteger;
const SAFE_INTEGER = Number.isSafeInteger;
const IS_NAN = Number.isNaN;
const IS = Object.is;
const MAX = Math.max;
const MIN = Math.min;
const PARSE_INT = Number.parseInt;
const NUMBER_STRING = Number.prototype.toString;
const NORMALIZE = String.prototype.normalize;
const CHAR_CODE = String.prototype.charCodeAt;
const CODE_POINT = String.prototype.codePointAt;
const SLICE = String.prototype.slice;
const STARTS_WITH = String.prototype.startsWith;
const INCLUDES = String.prototype.includes;
const PAD_START = String.prototype.padStart;
const REGEXP_EXEC = RegExp.prototype.exec;
const JSON_PARSE = JSON.parse;
const JSON_STRINGIFY = JSON.stringify;
const SET = Set;
const SET_HAS = Set.prototype.has;
const SET_ADD = Set.prototype.add;
const SET_DELETE = Set.prototype.delete;
const SET_SIZE = DESCRIPTOR(Set.prototype, 'size').get;
const MAP = Map;
const MAP_HAS = Map.prototype.has;
const MAP_GET = Map.prototype.get;
const MAP_SET = Map.prototype.set;
const WEAK_MAP_GET = WeakMap.prototype.get;
const WEAK_MAP_SET = WeakMap.prototype.set;
const TYPE_ERROR = TypeError;
const RANGE_ERROR = RangeError;
const ERROR = Error;
const DATE = Date;
const DATE_PARSE = Date.parse;
const DATE_ISO = Date.prototype.toISOString;
const U8 = Uint8Array;
const U8_PROTOTYPE = Uint8Array.prototype;
const TYPED_PROTOTYPE = PROTOTYPE(U8_PROTOTYPE);
const TYPED_BUFFER = DESCRIPTOR(TYPED_PROTOTYPE, 'buffer').get;
const TYPED_OFFSET = DESCRIPTOR(TYPED_PROTOTYPE, 'byteOffset').get;
const TYPED_LENGTH = DESCRIPTOR(TYPED_PROTOTYPE, 'byteLength').get;
const TYPED_TAG = DESCRIPTOR(TYPED_PROTOTYPE, Symbol.toStringTag).get;
const U8_SET = Uint8Array.prototype.set;
const BUFFER_PROTOTYPE = ArrayBuffer.prototype;
const BUFFER_LENGTH = DESCRIPTOR(BUFFER_PROTOTYPE, 'byteLength').get;
const BUFFER_RESIZABLE = DESCRIPTOR(BUFFER_PROTOTYPE, 'resizable')?.get;
const ENCODER = new TextEncoder();
const ENCODE = TextEncoder.prototype.encode;
const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const DECODE = TextDecoder.prototype.decode;
const SUBTLE = globalThis.crypto?.subtle;
const DIGEST = SUBTLE?.digest;
const PROMISE_PROTOTYPE = Promise.prototype;
const PROMISE_THEN = DESCRIPTOR(PROMISE_PROTOTYPE, 'then').value;
const PROMISE_CONSTRUCTOR = DESCRIPTOR(PROMISE_PROTOTYPE, 'constructor').value;
const MAXIMUM_BYTES = 16_777_216;
const profiles = new WeakMap();

function data(target, key, value) {
  const descriptor = CREATE(null);
  descriptor.value = value;
  descriptor.enumerable = true;
  descriptor.writable = true;
  descriptor.configurable = true;
  DEFINE(target, key, descriptor);
  return value;
}

function defineProperty(target, key, input) {
  const isolated = CREATE(null);
  const fields = ['value', 'get', 'set', 'enumerable', 'writable', 'configurable'];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const descriptor = DESCRIPTOR(input, field);
    if (descriptor !== undefined) {
      if (!HAS_OWN(descriptor, 'value')) throw new TYPE_ERROR('captured property descriptors require own data fields');
      isolated[field] = descriptor.value;
    }
  }
  return DEFINE(target, key, isolated);
}

function append(array, value) {
  data(array, array.length, value);
  return array.length;
}

function maximum(value) {
  if (!SAFE_INTEGER(value) || value < 1 || value > MAXIMUM_BYTES) {
    throw new RANGE_ERROR('captured Realm byte limit must be within 1..16777216');
  }
  return value;
}

function fixedBufferLength(value) {
  // Native slots are checked before callback-capable reflection.
  const length = APPLY(BUFFER_LENGTH, value, []);
  if (BUFFER_RESIZABLE && APPLY(BUFFER_RESIZABLE, value, [])) {
    throw new TYPE_ERROR('captured Realm bytes require fixed ArrayBuffer backing');
  }
  if (PROTOTYPE(value) !== BUFFER_PROTOTYPE) {
    throw new TYPE_ERROR('captured Realm bytes require an original same-realm ArrayBuffer');
  }
  return length;
}

function copyBytes(value, cap = MAXIMUM_BYTES) {
  maximum(cap);
  if (APPLY(TYPED_TAG, value, []) !== 'Uint8Array') {
    throw new TYPE_ERROR('captured Realm input must be a genuine Uint8Array');
  }
  const buffer = APPLY(TYPED_BUFFER, value, []);
  const offset = APPLY(TYPED_OFFSET, value, []);
  const length = APPLY(TYPED_LENGTH, value, []);
  const backingLength = fixedBufferLength(buffer);
  if (length > cap || offset + length > backingLength) {
    throw new RANGE_ERROR('captured Realm byte input exceeds its fixed bound');
  }
  const source = new U8(buffer, offset, length);
  const result = new U8(length);
  APPLY(U8_SET, result, [source, 0]);
  return result;
}

function encode(value, cap = MAXIMUM_BYTES) {
  maximum(cap);
  if (typeof value !== 'string') throw new TYPE_ERROR('captured UTF-8 input must be primitive text');
  // UTF-16 length is a lower bound for UTF-8 length. Limit allocation before
  // encoding; the genuine encoder can allocate at most three bytes per unit.
  if (value.length > cap) throw new RANGE_ERROR('captured UTF-8 text exceeds its bound');
  const bytes = APPLY(ENCODE, ENCODER, [value]);
  if (APPLY(TYPED_LENGTH, bytes, []) > cap) throw new RANGE_ERROR('captured UTF-8 text exceeds its bound');
  return bytes;
}

function assertDigestPromise(value) {
  if (!value || typeof value !== 'object' || PROTOTYPE(value) !== PROMISE_PROTOTYPE
      || OWN_KEYS(value).length !== 0) {
    throw new TYPE_ERROR('captured SHA-256 requires the original native promise profile');
  }
  const then = DESCRIPTOR(PROMISE_PROTOTYPE, 'then');
  const constructor = DESCRIPTOR(PROMISE_PROTOTYPE, 'constructor');
  if (!then || !HAS_OWN(then, 'value') || then.value !== PROMISE_THEN
      || !constructor || !HAS_OWN(constructor, 'value')
      || constructor.value !== PROMISE_CONSTRUCTOR) {
    throw new TYPE_ERROR('captured SHA-256 native promise chain changed');
  }
  return value;
}

function digestBytes(value) {
  if (fixedBufferLength(value) !== 32 || OWN_KEYS(value).length !== 0) {
    throw new TYPE_ERROR('captured SHA-256 must return a private 32-byte ArrayBuffer');
  }
  return copyBytes(new U8(value), 32);
}

function capturedArrayMap(values, callback) {
  const result = new ARRAY();
  for (let index = 0; index < values.length; index += 1) {
    if (HAS_OWN(values, index)) data(result, index, callback(values[index], index, values));
  }
  if (result.length < values.length) defineProperty(result, 'length', { value: values.length });
  return result;
}

function capturedArrayFilter(values, callback) {
  const result = new ARRAY();
  for (let index = 0; index < values.length; index += 1) {
    if (HAS_OWN(values, index) && callback(values[index], index, values)) append(result, values[index]);
  }
  return result;
}

function capturedArraySome(values, callback) {
  for (let index = 0; index < values.length; index += 1) {
    if (HAS_OWN(values, index) && callback(values[index], index, values)) return true;
  }
  return false;
}

function capturedJoin(values, separator = ',') {
  let result = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index !== 0) result += separator;
    const value = values[index];
    if (value !== undefined && value !== null) result += STRING(value);
  }
  return result;
}

function sealed(record) {
  const result = CREATE(null);
  const keys = KEYS(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index], descriptor = DESCRIPTOR(record, key);
    if (HAS_OWN(descriptor, 'value')) data(result, key, descriptor.value);
    else defineProperty(result, key, descriptor);
  }
  return FREEZE(result);
}

const CAPTURED = sealed({
  captured: true,
  apply: APPLY, freeze: FREEZE, create: CREATE, createRecord: () => CREATE(null),
  defineProperty, defineData: data, getPrototypeOf: PROTOTYPE,
  objectPrototype: OBJECT_PROTOTYPE, arrayPrototype: ARRAY_PROTOTYPE,
  ownKeys: OWN_KEYS, keys: KEYS, ownNames: NAMES, ownSymbols: SYMBOLS,
  descriptor: DESCRIPTOR, hasOwn: HAS_OWN, isArray: IS_ARRAY,
  newArray: (length = 0) => new ARRAY(length), append,
  sort: (values, compare = undefined) => APPLY(SORT, values, [compare]),
  map: capturedArrayMap, filter: capturedArrayFilter, some: capturedArraySome,
  includesArray(values, value) {
    for (let index = 0; index < values.length; index += 1) if (IS(values[index], value) || values[index] === value) return true;
    return false;
  },
  flatMap(values, callback) {
    const result = new ARRAY();
    for (let index = 0; index < values.length; index += 1) {
      const part = callback(values[index], index, values);
      if (IS_ARRAY(part)) {
        for (let item = 0; item < part.length; item += 1) append(result, part[item]);
      } else append(result, part);
    }
    return result;
  },
  join: capturedJoin,
  safeInteger: SAFE_INTEGER, finite: FINITE, integer: INTEGER, isNaN: IS_NAN,
  is: IS, max: MAX, min: MIN, number: NUMBER, bigInt: BIGINT, string: STRING,
  parseInt: PARSE_INT,
  numberToString: (value, radix) => APPLY(NUMBER_STRING, value, [radix]),
  padStart: (value, length, fill) => APPLY(PAD_START, value, [length, fill]),
  normalize: (value, form) => APPLY(NORMALIZE, value, [form]),
  charCodeAt: (value, offset) => APPLY(CHAR_CODE, value, [offset]),
  codePointAt: (value, offset) => APPLY(CODE_POINT, value, [offset]),
  slice: (value, start, end) => APPLY(SLICE, value, [start, end]),
  startsWith: (value, prefix, offset) => APPLY(STARTS_WITH, value, [prefix, offset]),
  includes: (value, item, offset) => APPLY(INCLUDES, value, [item, offset]),
  regexExec: (pattern, value) => APPLY(REGEXP_EXEC, pattern, [value]),
  regexTest: (pattern, value) => APPLY(REGEXP_EXEC, pattern, [value]) !== null,
  jsonParse: JSON_PARSE, jsonStringify: JSON_STRINGIFY,
  setCreate(values = undefined) {
    const result = new SET();
    if (values !== undefined) for (let index = 0; index < values.length; index += 1) APPLY(SET_ADD, result, [values[index]]);
    return result;
  },
  setHas: (set, value) => APPLY(SET_HAS, set, [value]),
  setAdd: (set, value) => APPLY(SET_ADD, set, [value]),
  setDelete: (set, value) => APPLY(SET_DELETE, set, [value]),
  setSize: (set) => APPLY(SET_SIZE, set, []),
  mapCreate: () => new MAP(),
  mapHas: (map, key) => APPLY(MAP_HAS, map, [key]),
  mapGet: (map, key) => APPLY(MAP_GET, map, [key]),
  mapSet: (map, key, value) => APPLY(MAP_SET, map, [key, value]),
  encode, decode: (bytes, cap = MAXIMUM_BYTES) => APPLY(DECODE, DECODER, [copyBytes(bytes, cap)]),
  newBytes(length) {
    if (!SAFE_INTEGER(length) || length < 0 || length > MAXIMUM_BYTES) throw new RANGE_ERROR('captured Realm allocation exceeds its bound');
    return new U8(length);
  },
  copyBytes, byteLength: (value) => APPLY(TYPED_LENGTH, value, []),
  setBytes: (target, source, offset = 0) => APPLY(U8_SET, target, [source, offset]),
  dateParse: DATE_PARSE, dateIso: (value) => APPLY(DATE_ISO, new DATE(value), []),
  typeError: (message) => new TYPE_ERROR(message), rangeError: (message) => new RANGE_ERROR(message),
  error: (message) => new ERROR(message),
  digestSha256(bytes) {
    if (typeof DIGEST !== 'function') throw new TYPE_ERROR('native SHA-256 is unavailable');
    return APPLY(DIGEST, SUBTLE, ['SHA-256', copyBytes(bytes)]);
  },
  assertDigestPromise, digestBytes,
});

// Only opt-in callers use CAPTURED. These delegates intentionally retain the
// existing default helper behavior, including live intrinsic dispatch.
const LIVE = sealed({
  captured: false,
  apply: (fn, receiver, args) => Reflect.apply(fn, receiver, args),
  freeze: (value) => Object.freeze(value), create: (proto) => Object.create(proto),
  createRecord: () => Object.create(null), defineProperty: (target, key, value) => Object.defineProperty(target, key, value),
  defineData: (target, key, value) => { target[key] = value; return value; },
  getPrototypeOf: (value) => Object.getPrototypeOf(value),
  get objectPrototype() { return Object.prototype; }, get arrayPrototype() { return Array.prototype; },
  ownKeys: (value) => Reflect.ownKeys(value), keys: (value) => Object.keys(value),
  ownNames: (value) => Object.getOwnPropertyNames(value), ownSymbols: (value) => Object.getOwnPropertySymbols(value),
  descriptor: (value, key) => Object.getOwnPropertyDescriptor(value, key), hasOwn: (value, key) => Object.hasOwn(value, key),
  isArray: (value) => Array.isArray(value), newArray: (length = 0) => new Array(length),
  append: (values, value) => values.push(value), sort: (values, compare) => values.sort(compare),
  map: (values, callback) => values.map(callback), filter: (values, callback) => values.filter(callback),
  some: (values, callback) => values.some(callback), includesArray: (values, value) => values.includes(value),
  flatMap: (values, callback) => values.flatMap(callback), join: (values, separator) => values.join(separator),
  safeInteger: (value) => Number.isSafeInteger(value), finite: (value) => Number.isFinite(value),
  integer: (value) => Number.isInteger(value), isNaN: (value) => Number.isNaN(value),
  is: (left, right) => Object.is(left, right), max: (...values) => Math.max(...values), min: (...values) => Math.min(...values),
  number: (value) => Number(value), bigInt: (value) => BigInt(value), string: (value) => String(value),
  parseInt: (value, radix) => Number.parseInt(value, radix),
  numberToString: (value, radix) => value.toString(radix), padStart: (value, length, fill) => value.padStart(length, fill),
  normalize: (value, form) => value.normalize(form), charCodeAt: (value, offset) => value.charCodeAt(offset),
  codePointAt: (value, offset) => value.codePointAt(offset), slice: (value, start, end) => value.slice(start, end),
  startsWith: (value, prefix, offset) => value.startsWith(prefix, offset), includes: (value, item, offset) => value.includes(item, offset),
  regexExec: (pattern, value) => pattern.exec(value), regexTest: (pattern, value) => pattern.test(value),
  jsonParse: (value) => JSON.parse(value), jsonStringify: (value) => JSON.stringify(value),
  setCreate: (values) => new Set(values), setHas: (set, value) => set.has(value), setAdd: (set, value) => set.add(value),
  setDelete: (set, value) => set.delete(value), setSize: (set) => set.size,
  mapCreate: () => new Map(), mapHas: (map, key) => map.has(key), mapGet: (map, key) => map.get(key),
  mapSet: (map, key, value) => map.set(key, value),
  encode: (value) => ENCODER.encode(value), decode: (value) => DECODER.decode(value),
  newBytes: (length) => new Uint8Array(length), copyBytes: (value) => new Uint8Array(value),
  byteLength: (value) => value.byteLength, setBytes: (target, source, offset) => target.set(source, offset),
  dateParse: (value) => Date.parse(value), dateIso: (value) => new Date(value).toISOString(),
  typeError: (message) => new TypeError(message), rangeError: (message) => new RangeError(message), error: (message) => new Error(message),
});

/** Issue an immutable version-one profile; no caller operations are accepted. */
export function createRealmContractOperationProfile() {
  if (arguments.length !== 0) throw new TYPE_ERROR('captured Realm profile accepts no arguments');
  if (typeof DIGEST !== 'function') throw new TYPE_ERROR('native SHA-256 is unavailable');
  const profile = CREATE(null);
  data(profile, 'version', 1);
  APPLY(WEAK_MAP_SET, profiles, [profile, CAPTURED]);
  return FREEZE(profile);
}

/** Resolve original issuance before any input reflection; undefined is legacy. */
export function resolveRealmContractOperations(profile = undefined) {
  if (profile === undefined) return LIVE;
  const operations = APPLY(WEAK_MAP_GET, profiles, [profile]);
  if (operations !== CAPTURED) throw new TYPE_ERROR('captured Realm operation profile was not originally issued');
  return operations;
}
