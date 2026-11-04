// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { STATE_CHANNEL_MESSAGE, validateStateChannelMessage } from './StateChannelContract.js';
import { encodeStateChannelProof } from './StateChannelFederationProof.js';

const DEFAULT_BASE_URL = '/_api/state-channels/v1';
const LEASE_REFRESH_MARGIN_MS = 5_000;
const LEASE_RECONNECT_MS = 1_500;
const CONTROL_FORMAT = 'particle-state-channel-control/1';
const MAX_PENDING_EVENTS = 64;
export const STATE_CHANNEL_HTTP_LIMITS = Object.freeze({
    publications: 32, publicationBytes: 256 * 1024, snapshotBytes: 1024 * 1024,
    requests: 8, responseBytes: 2 * 1024 * 1024, timeoutMs: 15_000,
});
const ENCODER = new TextEncoder();
const PUBLICATION_BATCH_PREFIX = '{"format":"particle-state-channel-publications/1","messages":[';
const PUBLICATION_BATCH_OVERHEAD = ENCODER.encode(PUBLICATION_BATCH_PREFIX + ']}').byteLength;
const BATCH_HTTP_CODES = Object.freeze({
    401: 'unauthorized', 403: 'forbidden', 409: 'conflict', 413: 'body-too-large',
    429: 'rate-limited', 503: 'unavailable',
});
const BATCH_SERVER_CODES = new Set([
    'relay-authority-fence-conflict', 'relay-authority-fence-stale',
    'relay-owner-lease-still-active', 'relay-authority-startup-quarantine',
    'relay-authority-clock-regressed', 'relay-owner-capacity', 'relay-claim-capacity',
]);
const LIFECYCLE_CANCELLATIONS = new WeakMap();
const REQUEST_LIFECYCLES = new WeakMap();

function lifecycleCancellation(transport, revision, message) {
    const error = new Error(message);
    error.name = 'AbortError';
    // Recognition uses private provenance, never an error name/message supplied
    // by a signer, fetch implementation or peer.
    LIFECYCLE_CANCELLATIONS.set(error, { transport, revision });
    return error;
}

/** Default standard transport: SSE projections/receipts down, HTTP intents up. */
export class SseStateChannelTransport {
    constructor({
        channelId,
        authority = null,
        clientId,
        baseUrl = DEFAULT_BASE_URL,
        EventSourceImpl = globalThis.EventSource,
        fetchImpl = globalThis.fetch,
        leaseProvider = null,
        logger = console,
    } = {}) {
        if (!EventSourceImpl || !fetchImpl) throw new Error('SSE transport requires EventSource and fetch');
        this.channelId = String(channelId);
        this.authority = authority;
        this.clientId = String(clientId ?? `sse-${Math.random().toString(36).slice(2)}`);
        this.baseUrl = String(baseUrl).replace(/\/$/, '');
        this.EventSourceImpl = EventSourceImpl;
        this.fetchImpl = (...args) => fetchImpl.call(globalThis, ...args);
        this.leaseProvider = typeof leaseProvider === 'function' ? leaseProvider : null;
        this.logger = logger;
        this.listeners = new Set();
        this.source = null;
        this.lastEventId = 0;
        this.releaseAuthority = null;
        this.status = 'idle';
        this.lease = null;
        this.leaseRequest = null;
        this.leaseRefreshTimer = null;
        this.reconnectTimer = null;
        this.startPromise = null;
        this.stopped = true;
        this.generation = null;
        this.resynchronizing = false;
        this.needsAuthoritySnapshot = true;
        this.lifecycleRevision = 0;
        this.publishQueue = Promise.resolve();
        this.publicationBacklog = [];
        this.publicationDrain = null;
        this.publicationWake = null;
        this.publicationTouch = null;
        this.receiveQueue = Promise.resolve();
        this.pendingEvents = 0;
        this.pendingPublications = 0;
        this.pendingPublicationBytes = 0;
        this.pendingSnapshotBytes = 0;
        this.requestControllers = new Set();
        this.publicationRecoveryRequired = false;
        this.publicationRecoveryRevision = 0;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async start() {
        if (this.source) return;
        if (this.startPromise) return this.startPromise;
        this.stopped = false;
        this.startPromise = this.#performStart();
        try { await this.startPromise; }
        catch (error) {
            if (this.leaseProvider && !this.stopped) this.#scheduleReconnect();
            throw error;
        }
        finally { this.startPromise = null; }
    }

    stop() {
        this.stopped = true;
        this.lifecycleRevision += 1;
        this.publicationWake?.();
        for (const pending of this.publicationBacklog.splice(0)) {
            this.#settlePublication(pending, lifecycleCancellation(this, pending.revision, 'State Channel transport stopped before publication'));
        }
        for (const controller of this.requestControllers) {
            controller.abort(lifecycleCancellation(this, REQUEST_LIFECYCLES.get(controller), 'State Channel transport stopped'));
        }
        if (this.leaseRefreshTimer) clearTimeout(this.leaseRefreshTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.leaseRefreshTimer = null;
        this.reconnectTimer = null;
        this.source?.close();
        this.source = null;
        this.releaseAuthority?.();
        this.releaseAuthority = null;
        this.lease = null;
        this.leaseRequest = null;
        this.generation = null;
        this.lastEventId = 0;
        this.resynchronizing = false;
        this.needsAuthoritySnapshot = true;
        this.publicationRecoveryRequired = false;
        this.status = 'idle';
        this.logger.debug?.(`[SseStateChannelTransport][stop][exit] channel=${this.channelId} client=${this.clientId}`);
    }

    async sendIntent(intent) {
        if (this.authority) return this.authority.submit(intent);
        return this.#post('intents', intent);
    }

    async publish(message) {
        if (!this.authority) throw new Error('Only an authority SSE transport may publish projections or receipts');
        if (![STATE_CHANNEL_MESSAGE.PROJECTION, STATE_CHANNEL_MESSAGE.RECEIPT].includes(message.kind)) {
            throw new TypeError(`SSE authority cannot publish ${message.kind}`);
        }
        const projection = message.kind === STATE_CHANNEL_MESSAGE.PROJECTION;
        const snapshot = projection && message.projectionKind === 'snapshot';
        if (this.pendingPublications >= STATE_CHANNEL_HTTP_LIMITS.publications) {
            if (projection) this.#requirePublicationRecovery();
            throw new Error('State Channel publication capacity reached');
        }
        const wire = JSON.stringify(message), bytes = ENCODER.encode(wire).byteLength;
        if (snapshot ? this.pendingSnapshotBytes + bytes > STATE_CHANNEL_HTTP_LIMITS.snapshotBytes
            : this.pendingPublicationBytes + bytes > STATE_CHANNEL_HTTP_LIMITS.publicationBytes) {
            if (projection) this.#requirePublicationRecovery();
            throw new Error('State Channel publication capacity reached');
        }
        if (projection && !snapshot && this.publicationRecoveryRequired) {
            this.#requirePublicationRecovery();
            throw new Error('State Channel projection requires a recovery snapshot');
        }
        this.pendingPublications += 1;
        if (snapshot) this.pendingSnapshotBytes += bytes;
        else this.pendingPublicationBytes += bytes;
        const result = new Promise((resolve, reject) => {
            this.publicationBacklog.push({ wire, bytes, version: message.version, projection, snapshot,
                revision: this.lifecycleRevision, recoveryRevision: this.publicationRecoveryRevision,
                resolve, reject, settled: false });
        });
        this.#schedulePublicationDrain();
        return result;
    }

    #settlePublication(entry, error = null, result = null) {
        if (entry.settled) return;
        entry.settled = true;
        if (error && entry.projection && entry.revision === this.lifecycleRevision) this.#requirePublicationRecovery();
        if (!error && entry.snapshot && entry.revision === this.lifecycleRevision
            && entry.recoveryRevision === this.publicationRecoveryRevision) {
            this.publicationRecoveryRequired = false;
            this.needsAuthoritySnapshot = false;
        }
        this.pendingPublications -= 1;
        if (entry.snapshot) this.pendingSnapshotBytes -= entry.bytes;
        else this.pendingPublicationBytes -= entry.bytes;
        if (error) entry.reject(error);
        else entry.resolve(result);
    }

    #publicationReady(entry) {
        if (entry.settled || this.stopped || entry.revision !== this.lifecycleRevision) {
            throw lifecycleCancellation(this, entry.revision, 'State Channel transport stopped before publication');
        }
        if (entry.projection && !entry.snapshot && this.publicationRecoveryRequired) {
            throw new Error('State Channel projection requires a recovery snapshot');
        }
    }

    #schedulePublicationDrain() {
        if (this.publicationDrain) {
            this.publicationTouch?.();
            return;
        }
        // Only an idle negotiated lane coalesces arrivals: 1 ms of quiet, at
        // most 8 ms from its first publication, or immediately when full. The
        // acknowledged backlog still drains immediately, in its original FIFO
        // order. Legacy leases retain their immediate microtask schedule.
        const revision = this.lifecycleRevision;
        const ready = this.lease?.publicationBatchVersion === 1 ? new Promise(resolve => {
            const firstAt = performance.now();
            let quietTimer = null, maximumTimer = null, lastAt = firstAt, settled = false;
            const wake = () => {
                if (settled) return;
                settled = true;
                clearTimeout(quietTimer);
                clearTimeout(maximumTimer);
                if (this.publicationWake === wake) this.publicationWake = null;
                if (this.publicationTouch === touch) this.publicationTouch = null;
                resolve();
            };
            const quiet = () => {
                const remaining = lastAt + 1 - performance.now();
                if (remaining > 0) quietTimer = setTimeout(quiet, remaining);
                else wake();
            };
            const maximum = () => {
                const remaining = firstAt + 8 - performance.now();
                if (remaining > 0) maximumTimer = setTimeout(maximum, remaining);
                else wake();
            };
            const touch = () => {
                if (settled) return;
                lastAt = performance.now();
                let count = 0, bytes = PUBLICATION_BATCH_OVERHEAD;
                for (const entry of this.publicationBacklog) {
                    const added = entry.bytes + Number(count > 0);
                    if (++count >= this.lease.publicationBatchMaxMessages
                        || bytes + added >= this.lease.publicationBatchMaxBytes) {
                        wake();
                        return;
                    }
                    bytes += added;
                }
                if (lastAt >= firstAt + 8) { wake(); return; }
                clearTimeout(quietTimer);
                quietTimer = setTimeout(quiet, 1);
            };
            this.publicationWake = wake;
            this.publicationTouch = touch;
            maximumTimer = setTimeout(maximum, 8);
            touch();
        }) : Promise.resolve();
        const drain = ready.then(() => {
            if (revision === this.lifecycleRevision) return this.#drainPublications();
        });
        this.publicationDrain = drain;
        this.publishQueue = drain.catch(() => {});
        const finished = () => {
            if (this.publicationDrain === drain) this.publicationDrain = null;
            if (this.publicationBacklog.length) this.#schedulePublicationDrain();
        };
        void drain.then(finished, error => {
            for (const entry of this.publicationBacklog.splice(0)) this.#settlePublication(entry, error);
            finished();
        });
    }

    async #drainPublications() {
        while (this.publicationBacklog.length) {
            const first = this.publicationBacklog[0];
            let entries = [first];
            try {
                this.#publicationReady(first);
                await this.#ensureLease();
                this.#publicationReady(first);
                const lease = this.lease;
                if (lease?.publicationBatchVersion === 1) {
                    entries = [];
                    let bytes = PUBLICATION_BATCH_OVERHEAD;
                    for (const entry of this.publicationBacklog) {
                        if (entries.length >= lease.publicationBatchMaxMessages) break;
                        try { this.#publicationReady(entry); } catch { break; }
                        const added = entry.bytes + Number(entries.length > 0);
                        if (bytes + added > lease.publicationBatchMaxBytes) break;
                        entries.push(entry); bytes += added;
                    }
                    // A large single publication, including a recovery snapshot,
                    // keeps its existing single-message limit and ordered lane.
                    if (!entries.length) entries = [first];
                }
                this.publicationBacklog.splice(0, entries.length);
                if (entries.length > 1) {
                    const result = await this.#postPublicationBatch(entries, lease);
                    entries.forEach((entry, index) => this.#settlePublication(entry, null, {
                        ok: true, accepted: true, brokerSequence: result.firstSequence + index,
                        leaseRole: 'authority', messageVersion: entry.version,
                    }));
                } else {
                    const result = await this.#post('messages', { version: first.version }, first.wire);
                    this.#settlePublication(first, null, result);
                }
            } catch (error) {
                for (const entry of entries) {
                    if (this.publicationBacklog[0] === entry) this.publicationBacklog.shift();
                    this.#settlePublication(entry, error);
                }
            }
        }
    }

    async #postPublicationBatch(entries, lease) {
        for (const entry of entries) {
            if (Array.isArray(lease.messageVersions) && !lease.messageVersions.includes(entry.version)) {
                throw new Error(`State channel server does not accept message version ${entry.version}`);
            }
        }
        const wire = PUBLICATION_BATCH_PREFIX + entries.map(entry => entry.wire).join(',') + ']}';
        if (ENCODER.encode(wire).byteLength > lease.publicationBatchMaxBytes) throw new Error('State Channel batch exceeds byte limit');
        const { response, payload } = await this.#fetchWithLease(
            `${lease.baseUrl}/${encodeURIComponent(this.channelId)}/messages/batch`, {
                method: 'POST', body: wire,
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Particle-State-Client': this.clientId },
            }, false, lease);
        // An uncertain response never falls back to individual POSTs: the whole
        // atomic batch may already have committed, including its receipts.
        if (response.status !== 202) {
            const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
                ? response.status : 0;
            const reportedCode = typeof payload?.detail === 'string' ? payload.detail : payload?.error;
            const code = BATCH_SERVER_CODES.has(reportedCode) ? reportedCode
                : BATCH_HTTP_CODES[status] ?? 'unexpected-status';
            // Do not include arbitrary error bodies, tokens, URLs or server text.
            const error = new Error(`State Channel batch POST failed: HTTP ${status} (${code})`);
            error.httpStatus = status;
            error.code = code;
            throw error;
        }
        if (payload?.ok !== true || payload.accepted !== entries.length
            || !Number.isSafeInteger(payload.firstSequence) || payload.firstSequence < 1
            || !Number.isSafeInteger(payload.lastSequence)
            || payload.lastSequence !== payload.firstSequence + entries.length - 1) {
            throw new Error('State Channel batch acknowledgement is invalid');
        }
        return payload;
    }

    #requirePublicationRecovery() {
        this.publicationRecoveryRequired = true;
        this.publicationRecoveryRevision += 1;
        this.needsAuthoritySnapshot = true;
        this.publicationWake?.();
        if (!this.stopped) this.#scheduleReconnect();
    }

    #logTransportFailure(operation, error) {
        const cancellation = LIFECYCLE_CANCELLATIONS.get(error);
        const expected = cancellation?.transport === this
            && (this.stopped || cancellation.revision !== this.lifecycleRevision);
        if (expected) this.logger.debug?.(`[SseStateChannelTransport][${operation}][cancelled]`);
        else this.logger.error?.(`[SseStateChannelTransport][${operation}]`, error);
        return expected;
    }

    async requestSnapshot() {
        const revision = this.lifecycleRevision;
        const source = this.source;
        if (this.authority) {
            const snapshot = this.authority.snapshot();
            for (const listener of [...this.listeners]) listener(snapshot);
            return snapshot;
        }
        await this.#ensureLease();
        const { response, payload } = await this.#fetchWithLease(`${this.#channelUrl()}/snapshot`, {
            headers: { Accept: 'application/json' },
        });
        if (response.status === 404 || response.status === 204) return null;
        if (!response.ok) throw new Error(`State channel snapshot failed: HTTP ${response.status}`);
        if (this.stopped || revision !== this.lifecycleRevision || source !== this.source) return null;
        if (payload?.message && validateStateChannelMessage(payload.message, this.channelId)) {
            if (payload.message.kind === STATE_CHANNEL_MESSAGE.PROJECTION && payload.message.projectionKind === 'snapshot') {
                this.resynchronizing = false;
            }
            this.#emit(payload.message);
        }
        return payload?.message ?? null;
    }

    async #post(resource, message, publicationWire = null) {
        const revision = this.lifecycleRevision;
        await this.#ensureLease();
        if (this.stopped || revision !== this.lifecycleRevision) throw lifecycleCancellation(this, revision, 'State Channel transport changed before request');
        const advertisedVersions = this.lease?.messageVersions;
        if (Array.isArray(advertisedVersions) && !advertisedVersions.includes(message?.version)) {
            throw new Error(`State channel server does not accept message version ${message?.version}`);
        }
        const startedAt = globalThis.performance?.now?.() ?? Date.now();
        const wire = publicationWire ?? JSON.stringify(message);
        if (publicationWire === null && ENCODER.encode(wire).byteLength > STATE_CHANNEL_HTTP_LIMITS.publicationBytes) {
            throw new Error('State Channel request exceeds byte limit');
        }
        const { response, payload } = await this.#fetchWithLease(`${this.#channelUrl()}/${resource}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-Particle-State-Client': this.clientId,
            },
            body: wire,
        });
        if (!response.ok) throw new Error(payload.error ?? `State channel POST failed: HTTP ${response.status}`);
        const durationMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
        this.logger.debug?.(`[SseStateChannelTransport][post][exit] channel=${this.channelId} resource=${resource} status=${response.status} durationMs=${durationMs.toFixed(3)}`);
        return payload;
    }

    async #performStart() {
        this.logger.debug?.(`[SseStateChannelTransport][start][entry] channel=${this.channelId} client=${this.clientId}`);
        await this.#ensureLease();
        if (this.stopped) return;
        this.#openEventSource();
        if (this.authority && !this.releaseAuthority) {
            this.releaseAuthority = this.authority.subscribe((message) => {
                this.#emit(message);
                this.publish(message).catch((error) => this.#logTransportFailure('publish', error));
            }, { replay: false });
        }
        if (this.authority && this.lease?.resumeVersion !== 1 && this.needsAuthoritySnapshot) {
            await this.publish(this.authority.snapshot());
            this.needsAuthoritySnapshot = this.publicationRecoveryRequired;
        }
        this.logger.debug?.(`[SseStateChannelTransport][start][exit] channel=${this.channelId} role=${this.authority ? 'authority' : 'client'}`);
    }

    #openEventSource() {
        this.source?.close();
        const params = new URLSearchParams({
            clientId: this.clientId,
            after: String(this.lastEventId),
        });
        if (this.lease?.resumeVersion === 1) {
            params.set('resumeVersion', '1');
            if (this.generation) params.set('generation', this.generation);
        }
        if (this.lease?.token) params.set('token', this.lease.token);
        if (this.lease?.ownerGrant) params.set('ownerGrant', encodeStateChannelProof(this.lease.ownerGrant));
        const source = new this.EventSourceImpl(`${this.#channelUrl()}/events?${params}`);
        this.source = source;
        source.onopen = () => { if (this.source === source) this.status = 'connected'; };
        source.onerror = () => {
            if (this.source !== source || this.stopped) return;
            this.status = 'reconnecting';
            if (this.leaseProvider) this.#scheduleReconnect();
        };
        const receive = (event, control = false) => {
            if (this.source !== source || this.stopped) return;
            if (this.pendingEvents >= MAX_PENDING_EVENTS) {
                this.#scheduleReconnect();
                return;
            }
            this.pendingEvents += 1;
            this.receiveQueue = this.receiveQueue.then(async () => {
                if (this.source !== source || this.stopped) return;
                if (control) await this.#receiveControl(event, source);
                else await this.#receiveEvent(event, source);
            }).catch((error) => {
                this.#logTransportFailure('receive', error);
                if (this.source === source && !this.stopped) this.#scheduleReconnect();
            }).finally(() => { this.pendingEvents -= 1; });
        };
        source.onmessage = (event) => receive(event);
        for (const kind of Object.values(STATE_CHANNEL_MESSAGE)) {
            source.addEventListener?.(kind, (event) => receive(event));
        }
        source.addEventListener?.('state-channel-control', (event) => receive(event, true));
    }

    #scheduleReconnect(delayMs = LEASE_RECONNECT_MS) {
        if (this.reconnectTimer || this.stopped) return;
        this.source?.close();
        this.source = null;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.#ensureLease(true).then(() => {
                // Initial acquisition may have failed during issuer startup.
                // Complete authority subscription/snapshot setup on recovery.
                if (!this.stopped) return this.#performStart();
            }).catch((error) => {
                if (this.#logTransportFailure('lease-refresh', error)) return;
                this.#scheduleReconnect(Math.min(30_000, Math.max(LEASE_RECONNECT_MS, delayMs * 2)));
            });
        }, delayMs);
    }

    async #ensureLease(force = false) {
        if (!this.leaseProvider) return null;
        const revision = this.lifecycleRevision;
        const now = Math.floor(Date.now() / 1000);
        if (!force && this.lease?.expiresAt > now + 5) return this.lease;
        let request = this.leaseRequest;
        if (!request || request.revision !== revision) {
            request = { revision, waiters: 0, promise: null };
            this.leaseRequest = request;
            request.promise = Promise.resolve().then(() => this.#acquireLease(revision)).finally(() => {
                if (this.leaseRequest === request) this.leaseRequest = null;
            });
        }
        if (request.waiters >= STATE_CHANNEL_HTTP_LIMITS.requests) throw new Error('State Channel HTTP capacity reached');
        request.waiters += 1;
        try { return await request.promise; }
        finally { request.waiters -= 1; }
    }

    async #acquireLease(revision) {
        if (revision !== this.lifecycleRevision) throw lifecycleCancellation(this, revision, 'State Channel transport changed before acquiring its lease');
        const role = this.authority ? 'authority' : 'client';
        const lease = await this.#withRequestDeadline(async signal => {
            signal.throwIfAborted();
            const result = await this.leaseProvider({ channelId: this.channelId, clientId: this.clientId, role });
            signal.throwIfAborted();
            return result;
        });
        if (revision !== this.lifecycleRevision) throw lifecycleCancellation(this, revision, 'State Channel transport changed while acquiring its lease');
        let leaseBaseUrl;
        try { leaseBaseUrl = new URL(lease?.baseUrl, globalThis.location?.href).href.replace(/\/$/, ''); }
        catch (_) { throw new Error('State Channel lease base URL is invalid'); }
        if (
            typeof lease?.token !== 'string' || !lease.token
            || lease.channelId !== this.channelId
            || lease.role !== role
            || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= Math.floor(Date.now() / 1000)
            || (lease.resumeVersion !== undefined && lease.resumeVersion !== 1)
            || (lease.federationVersion !== undefined && (lease.federationVersion !== 1 || !lease.ownerGrant
                || (this.authority && typeof lease.signPublication !== 'function')))
        ) throw new Error('State Channel lease is not bound to this transport');
        const batchFields = ['publicationBatchVersion', 'publicationBatchMaxMessages', 'publicationBatchMaxBytes'];
        if (batchFields.some(field => lease[field] !== undefined) && (
            !this.authority || lease.federationVersion !== 1 || lease.publicationBatchVersion !== 1
            || !Number.isSafeInteger(lease.publicationBatchMaxMessages) || lease.publicationBatchMaxMessages < 1
            || lease.publicationBatchMaxMessages > 32 || !Number.isSafeInteger(lease.publicationBatchMaxBytes)
            || lease.publicationBatchMaxBytes < 1 || lease.publicationBatchMaxBytes > 32768
        )) throw new Error('State Channel publication batch lease is invalid');
        const priorOwner = this.lease?.ownerGrant?.grant?.payload;
        const nextOwner = lease.ownerGrant?.grant?.payload;
        if (this.lease && (this.lease.baseUrl !== leaseBaseUrl
            || priorOwner?.transportEpoch !== nextOwner?.transportEpoch
            || priorOwner?.ownerInstanceId !== nextOwner?.ownerInstanceId)) {
            this.generation = null;
            this.lastEventId = 0;
            this.needsAuthoritySnapshot = true;
        }
        this.baseUrl = leaseBaseUrl;
        this.lease = Object.freeze({ ...lease, baseUrl: leaseBaseUrl });
        if (this.leaseRefreshTimer) clearTimeout(this.leaseRefreshTimer);
        const refreshDelay = Math.max(1_000, (lease.expiresAt * 1000) - Date.now() - LEASE_REFRESH_MARGIN_MS);
        this.leaseRefreshTimer = setTimeout(() => {
            this.leaseRefreshTimer = null;
            this.#scheduleReconnect(0);
        }, refreshDelay);
        return this.lease;
    }

    async #withRequestDeadline(run) {
        if (this.stopped) throw lifecycleCancellation(this, this.lifecycleRevision, 'State Channel transport stopped before request');
        if (this.requestControllers.size >= STATE_CHANNEL_HTTP_LIMITS.requests) throw new Error('State Channel HTTP capacity reached');
        const controller = new AbortController();
        REQUEST_LIFECYCLES.set(controller, this.lifecycleRevision);
        this.requestControllers.add(controller);
        const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
        const timer = setTimeout(() => controller.abort(new Error('State Channel HTTP deadline exceeded')), STATE_CHANNEL_HTTP_LIMITS.timeoutMs);
        try {
            return await Promise.race([aborted, run(controller.signal)]);
        } finally {
            clearTimeout(timer);
            this.requestControllers.delete(controller);
        }
    }

    async #fetchWithLease(url, init, retry = true, requestLease = this.lease) {
        const revision = this.lifecycleRevision;
        // Signing is part of the bounded, cancellable request. A late signer
        // must never send an abandoned batch after stop or a deadline expires.
        const { response, payload } = await this.#withRequestDeadline(async signal => {
            const headers = { ...init.headers };
            if (requestLease?.token) headers.Authorization = `Bearer ${requestLease.token}`;
            if (requestLease?.ownerGrant) {
                headers['X-Particle-State-Owner'] = encodeStateChannelProof(requestLease.ownerGrant);
                if (this.authority && init.method === 'POST') {
                    headers['X-Particle-State-Publication'] = encodeStateChannelProof(await requestLease.signPublication(init.body));
                }
            }
            signal.throwIfAborted();
            if (this.stopped || revision !== this.lifecycleRevision) throw lifecycleCancellation(this, revision, 'State Channel transport changed before request');
            const response = await this.fetchImpl(url, { ...init, headers, signal });
            if (signal.aborted) {
                void response.body?.cancel().catch(() => {});
                signal.throwIfAborted();
            }
            const payload = await this.#readResponse(response, signal);
            return { response, payload };
        });
        if (this.stopped || revision !== this.lifecycleRevision) throw lifecycleCancellation(this, revision, 'State Channel transport changed during request');
        if (retry && this.leaseProvider && [401, 403].includes(response.status)) {
            await this.#ensureLease(true);
            if (this.stopped || revision !== this.lifecycleRevision) throw lifecycleCancellation(this, revision, 'State Channel transport changed during lease refresh');
            return this.#fetchWithLease(url.replace(/^.*?(\/_api\/state-channels\/v1)/, `${this.baseUrl}`), init, false);
        }
        return { response, payload };
    }

    async #readResponse(response, signal) {
        if (!response.body) return {};
        const length = Number(response.headers?.get('Content-Length'));
        if (Number.isFinite(length) && length > STATE_CHANNEL_HTTP_LIMITS.responseBytes) {
            await response.body.cancel();
            throw new Error('State Channel response exceeds byte limit');
        }
        const reader = response.body.getReader(), chunks = [];
        let bytes = 0, complete = false;
        const abort = () => { void reader.cancel().catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
            while (true) {
                signal.throwIfAborted();
                const part = await reader.read();
                signal.throwIfAborted();
                if (part.done) { complete = true; break; }
                bytes += part.value.byteLength;
                if (bytes > STATE_CHANNEL_HTTP_LIMITS.responseBytes) throw new Error('State Channel response exceeds byte limit');
                chunks.push(part.value);
            }
            const raw = new Uint8Array(bytes);
            let offset = 0;
            for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
            if (!bytes) return {};
            try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
            catch (error) { if (response.ok) throw error; return {}; }
        } finally {
            signal.removeEventListener('abort', abort);
            if (!complete) void reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    }

    async #receiveControl(event, source) {
        let control;
        try { control = JSON.parse(event.data); }
        catch { throw new Error('Invalid State Channel resume control'); }
        if (this.lease?.resumeVersion !== 1 || control?.format !== CONTROL_FORMAT
            || !['ready', 'reset'].includes(control.kind)
            || !/^[0-9a-f]{32}$/.test(control.generation)
            || !['initial', 'generation-changed', 'cursor-ahead', 'replay-gap'].includes(control.reason)) {
            throw new Error('Invalid State Channel resume control');
        }
        const changed = this.generation !== control.generation || control.kind === 'reset';
        if (changed) {
            this.generation = control.generation;
            this.lastEventId = 0;
            this.resynchronizing = !this.authority;
            this.needsAuthoritySnapshot = true;
        }
        if (this.authority && this.needsAuthoritySnapshot) {
            await this.publish(this.authority.snapshot());
            if (this.source === source && !this.stopped) this.needsAuthoritySnapshot = this.publicationRecoveryRequired;
        } else if (!this.authority && changed) {
            await this.requestSnapshot();
        }
    }

    async #receiveEvent(event, source) {
        let message;
        try { message = JSON.parse(event.data); }
        catch { return; }
        if (!validateStateChannelMessage(message, this.channelId)) return;
        if (message.kind === STATE_CHANNEL_MESSAGE.INTENT && this.authority) {
            await this.authority.submit(message);
        } else if (message.kind !== STATE_CHANNEL_MESSAGE.INTENT) {
            if (message.kind === STATE_CHANNEL_MESSAGE.PROJECTION) {
                if (this.resynchronizing && message.projectionKind !== 'snapshot') return;
                if (message.projectionKind === 'snapshot') this.resynchronizing = false;
            }
            this.#emit(message);
        }
        if (this.source !== source || this.stopped) return;
        const cursor = Number(event.lastEventId);
        if (event.lastEventId && Number.isSafeInteger(cursor) && cursor >= 0) {
            this.lastEventId = Math.max(this.lastEventId, cursor);
        }
    }

    #emit(message) {
        for (const listener of [...this.listeners]) listener(message);
    }

    #channelUrl() {
        return `${this.baseUrl}/${encodeURIComponent(this.channelId)}`;
    }
}

export function createDefaultStateChannelTransport(options) {
    return new SseStateChannelTransport(options);
}
