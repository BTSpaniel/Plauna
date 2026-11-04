// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/util/canonical.js — deterministic serialization + self-describing,
// algorithm-tagged hash IDs (CSE Integrity plane, spec §13).
//
// Equivalent data MUST produce byte-identical bytes before hashing or signing
// (spec rule 58). We implement an RFC 8785-style canonical JSON: object keys
// are sorted by UTF-16 code unit, arrays keep order, no insignificant
// whitespace, and non-finite numbers are rejected. Hash IDs are multihash-style
// (`alg:bits:hex`) so the algorithm can migrate later (spec rule 59).
//
// Two tiers, matching the engine's hybrid integrity policy:
//   • hot-path id   — synchronous 32-bit FNV (runtime identity / state roots).
//   • authority id  — async Web Crypto SHA-256 (capabilities, receipts,
//                     checkpoints) where security matters.

import {
  checksumHex32,
  contentHashHex,
  fnv1aStringCodeUnit32,
} from '../../core/math/ChecksumMath.js';
import { resolveRealmContractOperations } from '../../../webgpu-os/apps/the-virtual-realm/contracts/RealmContractCapturedOperations.js';
import { preflightRealmContractValue } from '../../../webgpu-os/apps/the-virtual-realm/contracts/RealmContractValuePreflight.js';
import { REALM_CANONICAL_LIMITS } from '../../../webgpu-os/apps/the-virtual-realm/contracts/CanonicalRealmEncoding.js';

/** Domain separator prefix so hashes of different structures never collide. */
export const DOMAIN_SEPARATOR = 'cse';

function canonicalNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError(`canonical: non-finite number ${value}`);
  // Integers serialize without a decimal point; JSON.stringify gives the
  // shortest round-trippable form, which is deterministic for finite numbers.
  return JSON.stringify(value);
}

/**
 * Produce a deterministic canonical JSON string for any JSON-compatible value.
 * Object keys are sorted; Maps and Sets are normalized; arrays preserve order.
 * @param {*} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number') return canonicalNumber(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (t === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value instanceof Set) {
    // Sets are unordered → sort their canonical members for stable bytes.
    const members = [...value].map(canonicalize).sort();
    return `[${members.join(',')}]`;
  }
  if (value instanceof Map) {
    return canonicalize(Object.fromEntries(value));
  }
  if (t === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',');
    return `{${body}}`;
  }
  throw new TypeError(`canonical: unsupported type ${t}`);
}

/** Domain-separated canonical bytes string used as hash/sign input (spec §13). */
export function canonicalBytes(value, { domain = DOMAIN_SEPARATOR, schemaVersion = '' } = {}) {
  return `${domain}\u0000${schemaVersion}\u0000${canonicalize(value)}`;
}

/**
 * Synchronous hot-path id: 32-bit FNV over canonical bytes. Tagged so it is
 * self-describing and migratable. Fast, NOT collision-resistant — identity for
 * runtime state, never a security claim (spec rule 52).
 * @returns {string} `fnv1a32:32:<hex8>`
 */
export function hashIdFast(value, opts = {}) {
  return `fnv1a32:32:${checksumHex32(fnv1aStringCodeUnit32(canonicalBytes(value, opts)))}`;
}

/**
 * Async authority id: Web Crypto SHA-256 over canonical bytes. Use for
 * capabilities, witness receipts, checkpoints, and signed transactions.
 * Throws if SubtleCrypto is unavailable (callers degrade explicitly).
 * @returns {Promise<string>} `sha256:256:<hex64>`
 */
export async function hashIdSecure(value, opts = {}) {
  const hex = await contentHashHex(canonicalBytes(value, opts), 'SHA-256');
  return `sha256:256:${hex}`;
}

/** Parse a tagged hash id into `{ alg, bits, hex }` or null. */
export function parseHashId(id) {
  if (typeof id !== 'string') return null;
  const m = /^([a-z0-9-]+):(\d+):([0-9a-f]+)$/.exec(id);
  if (!m) return null;
  return { alg: m[1], bits: Number(m[2]), hex: m[3] };
}

/** True when two tagged hash ids are byte-equal (same algorithm + digest). */
export function hashIdEquals(a, b) {
  return typeof a === 'string' && a === b;
}

// The original canonicalize remains a live Array.map callback: its second
// operand is an index in those calls. A separate required-profile entry is
// necessary for bounded captured JSON without changing that complete body.
const CAPTURED_CANONICAL_PREFLIGHT = Object.freeze({
  requireNfc: false,
  limits: Object.freeze({
    maxDepth: REALM_CANONICAL_LIMITS.maximumDepth,
    maxNodes: REALM_CANONICAL_LIMITS.maximumNodes,
    maxProperties: REALM_CANONICAL_LIMITS.maximumObjectKeys,
    maxTotalProperties: REALM_CANONICAL_LIMITS.maximumNodes,
    maxArrayLength: REALM_CANONICAL_LIMITS.maximumArrayItems,
    maxStringUtf8Bytes: REALM_CANONICAL_LIMITS.maximumStringBytes,
    maxCanonicalUtf8Bytes: REALM_CANONICAL_LIMITS.maximumCanonicalBytes,
  }),
});
const CAPTURED_CANONICAL_CONSOLE = globalThis.console;
const CAPTURED_CANONICAL_DEBUG = CAPTURED_CANONICAL_CONSOLE?.debug;
const CAPTURED_CANONICAL_PERFORMANCE = globalThis.performance;
const CAPTURED_CANONICAL_NOW = CAPTURED_CANONICAL_PERFORMANCE?.now;

function capturedCanonicalClock(ops) {
  try {
    if (typeof CAPTURED_CANONICAL_NOW !== 'function') return undefined;
    const value = ops.apply(CAPTURED_CANONICAL_NOW, CAPTURED_CANONICAL_PERFORMANCE, []);
    return ops.finite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function capturedCanonicalDiagnostic(phase, nodes, byteLength, started, ops) {
  try {
    if (typeof CAPTURED_CANONICAL_DEBUG !== 'function') return;
    const entry = ops.createRecord();
    ops.defineData(entry, 'operation', 'capturedCanonicalJson');
    ops.defineData(entry, 'phase', phase);
    ops.defineData(entry, 'nodes', nodes);
    ops.defineData(entry, 'byteLength', byteLength);
    const ended = capturedCanonicalClock(ops);
    if (ops.finite(started) && ops.finite(ended) && ended >= started) {
      ops.defineData(entry, 'elapsedMs', ended - started);
    }
    ops.apply(CAPTURED_CANONICAL_DEBUG, CAPTURED_CANONICAL_CONSOLE,
      ['[CapturedCanonicalJson]', ops.freeze(entry)]);
  } catch {
    // Diagnostics cannot alter the original data operation or expose its error.
  }
}

/**
 * Captured UTF-16 canonical JSON over owned bounded plain JSON only.
 * A genuine profile is required; omission does not select the live serializer.
 * Existing preflight rejects unsafe integers/-0/malformed Unicode and non-data
 * operands. Generic strings need not be NFC, and no input is normalized.
 * This data result creates no source, policy, storage or selection authority.
 */
export function canonicalizeCapturedJson(value, operationProfile = undefined) {
  const ops = resolveRealmContractOperations(operationProfile);
  if (!ops.captured) throw ops.typeError('captured canonical JSON requires an original operation profile');
  const started = capturedCanonicalClock(ops);
  const tokens = ops.newArray();
  let nodes = 0;
  let byteLength = 0;
  const maximumBytes = REALM_CANONICAL_LIMITS.maximumCanonicalBytes;

  const reserve = (text) => {
    const count = ops.byteLength(ops.encode(text, maximumBytes));
    if (byteLength + count > maximumBytes) {
      throw ops.rangeError('captured canonical JSON exceeds its UTF-8 byte limit');
    }
    byteLength += count;
  };
  const append = (text) => {
    reserve(text);
    ops.append(tokens, text);
  };
  const visit = (item, depth) => {
    nodes += 1;
    if (nodes > REALM_CANONICAL_LIMITS.maximumNodes || depth > REALM_CANONICAL_LIMITS.maximumDepth) {
      throw ops.rangeError('captured canonical JSON exceeds its structural bounds');
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'number' || typeof item === 'string') {
      append(ops.jsonStringify(item));
      return;
    }
    if (ops.isArray(item)) {
      append('[');
      for (let index = 0; index < item.length; index += 1) {
        if (index !== 0) append(',');
        visit(item[index], depth + 1);
      }
      append(']');
      return;
    }
    // Only immutable owned null-prototype data reaches this visitor. Primitive
    // keys use the saved default UTF-16 sort, never Realm code-point ordering.
    const keys = ops.sort(ops.keys(item));
    append('{');
    for (let index = 0; index < keys.length; index += 1) {
      if (index !== 0) append(',');
      const key = keys[index];
      append(ops.jsonStringify(key));
      append(':');
      visit(item[key], depth + 1);
    }
    append('}');
  };

  try {
    capturedCanonicalDiagnostic('entered', nodes, byteLength, started, ops);
    const owned = preflightRealmContractValue(value, CAPTURED_CANONICAL_PREFLIGHT, operationProfile);
    capturedCanonicalDiagnostic('owned', nodes, byteLength, started, ops);
    visit(owned, 0);
    const text = ops.join(tokens, '');
    if (ops.byteLength(ops.encode(text, maximumBytes)) !== byteLength) {
      throw ops.typeError('captured canonical JSON byte count changed');
    }
    capturedCanonicalDiagnostic('serialized', nodes, byteLength, started, ops);
    capturedCanonicalDiagnostic('exit', nodes, byteLength, started, ops);
    return text;
  } catch (error) {
    capturedCanonicalDiagnostic('refused', nodes, byteLength, started, ops);
    throw error;
  }
}
