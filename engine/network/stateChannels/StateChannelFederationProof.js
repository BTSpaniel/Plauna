// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalJson, sha256Hex, verifyRawSignature } from '../crypto/Trust.js';
import { hpkeHexToBytes } from '../crypto/Hpke.js';

const ENCODER = new TextEncoder();

/** Bounded header/query envelope; message bytes remain in the HTTP body. */
export function encodeStateChannelProof(value) {
    const bytes = ENCODER.encode(JSON.stringify(value));
    if (bytes.length > 6144) throw new RangeError('State Channel proof exceeds its transport budget');
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Verify against the relay issuer explicitly pinned by the already verified network manifest. */
export async function verifyStateChannelOwnerGrant(owner, manifest, { routeTag, channelId, holderPublicKeyHex = null } = {}) {
    const pin = manifest?.capabilities?.stateChannelRelayAuthority;
    const signed = owner?.grant;
    const grant = signed?.payload;
    if (manifest?.capabilities?.stateChannelFederationVersion !== 1
        || manifest?.capabilities?.stateChannelOwnerActivationVersion !== 1 || !pin || !grant
        || grant.format !== 'particle-state-channel-owner-lease/1'
        || grant.issuer !== pin.nodeId || signed.keyId !== pin.keyId
        || grant.membershipEpoch !== pin.membershipEpoch
        || grant.networkRootId !== manifest.networkRootId
        || grant.networkRootVersion !== manifest.networkRootVersion
        || grant.networkRootRollbackVersion !== manifest.networkRootRollbackVersion
        || grant.routeTag !== routeTag || grant.channelId !== channelId
        || (holderPublicKeyHex !== null && grant.holderPublicKeyHex !== holderPublicKeyHex)
        || typeof grant.ownerNodeId !== 'string' || !grant.ownerNodeId
        || !/^[0-9a-f]{32}$/.test(grant.ownerInstanceId)
        || !Number.isSafeInteger(grant.transportEpoch) || grant.transportEpoch < 1
        || !Number.isSafeInteger(grant.authorityFencingToken) || grant.authorityFencingToken < 1
        || !Number.isSafeInteger(grant.notBefore) || !Number.isSafeInteger(grant.expiresAt)
        || grant.expiresAt <= Date.now() || grant.notBefore > Date.now()
        || grant.expiresAt - grant.notBefore > 120_000
        || typeof grant.leaseId !== 'string' || !grant.leaseId.startsWith('sha256:256:')) {
        throw new Error('State Channel owner grant is not bound to the verified network and channel');
    }
    if (await sha256Hex(hpkeHexToBytes(owner.signingPublicKeyHex, 65)) !== pin.keyId
        || !(await verifyRawSignature(owner.signingPublicKeyHex, ENCODER.encode(canonicalJson(grant)), signed.signatureHex))) {
        throw new Error('State Channel owner grant signature is invalid');
    }
    encodeStateChannelProof(owner);
    return Object.freeze({ ...grant });
}

/** An existing approved Realm issuer explicitly binds its lease to this opaque route. */
export async function createStateChannelAuthorityProof({ lease, networkRootId, networkRootVersion,
    networkRootRollbackVersion = 0, routeTag, channelId, holderPublicKeyHex }, issuer) {
    const { verifyAuthorityLease } = await import('../realm/authority/AuthorityLease.js');
    const { createKeyControlledRealmId, parseRealmId } = await import('../realm/addressing/RealmIds.js');
    const checked = await verifyAuthorityLease(lease);
    if (!checked.valid || issuer?.secure === false || typeof issuer?.sign !== 'function'
        || issuer.publicKeyHex?.toLowerCase() !== lease.signer.publicKeyHex
        || !lease.actions.includes('state-channel.publish')
        || !/^[0-9a-f]{64}$/.test(routeTag) || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(channelId)
        || typeof networkRootId !== 'string' || !networkRootId
        || !Number.isSafeInteger(networkRootVersion) || networkRootVersion < 1
        || !Number.isSafeInteger(networkRootRollbackVersion) || networkRootRollbackVersion < 0) {
        throw new Error('An active Realm authority lease and its original issuer are required');
    }
    const holder = holderPublicKeyHex.toLowerCase();
    if (await createKeyControlledRealmId(parseRealmId(lease.holderId).type, holder) !== lease.holderId) {
        throw new Error('State Channel holder key does not control the leased Realm identity');
    }
    const payload = { format: 'particle-state-channel-authority-binding/1', networkRootId, networkRootVersion,
        networkRootRollbackVersion, realmId: lease.realmId, routeTag, channelId, leaseId: lease.leaseId,
        holderPublicKeyHex: holder };
    const signature = await issuer.sign(ENCODER.encode(canonicalJson(payload)));
    const signatureHex = typeof signature === 'string' ? signature.toLowerCase()
        : [...new Uint8Array(signature.buffer ?? signature, signature.byteOffset ?? 0, signature.byteLength)]
            .map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (!/^[0-9a-f]{128}$/.test(signatureHex)) throw new Error('Realm issuer returned an invalid signature');
    return Object.freeze({ lease, binding: Object.freeze({ payload, keyId: lease.signer.fingerprint, signatureHex }) });
}
