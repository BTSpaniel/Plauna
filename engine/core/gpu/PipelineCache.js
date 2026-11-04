// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Generation-scoped pipeline cache with collision-free descriptor identity. */

import { GpuDescriptorIdentity } from './GpuDescriptorIdentity.js';
import { assertCheckedShaderModule, createCheckedShaderModule } from './GpuShaderDiagnostics.js';
import { withErrorScope } from './GpuDebug.js';

// device.destroy() is synchronous, but device.lost settles in a later task.
// Firefox may resolve a pending createComputePipelineAsync on the destroyed
// device before that, which would publish an unusable program. Retire every
// cache sharing the device at the destroy() call itself.
const DESTROY_OBSERVERS = new WeakMap();
function observeExplicitDestroy(device, weakCache) {
    if (!device || typeof device.destroy !== 'function') return;
    let caches = DESTROY_OBSERVERS.get(device);
    if (!caches) {
        caches = new Set();
        DESTROY_OBSERVERS.set(device, caches);
        const destroy = device.destroy;
        device.destroy = function (...args) {
            for (const ref of caches) {
                const cache = ref.deref();
                if (!cache || cache._destroyed) continue;
                cache._lost = { reason: 'destroyed' };
                cache._retire('GPU_PIPELINE_CACHE_DEVICE_LOST', 'PipelineCache device was lost');
            }
            caches.clear();
            return destroy.apply(this, args);
        };
    }
    caches.add(weakCache);
}

export class PipelineCache {
    constructor(device, { generation = 0 } = {}) {
        this.device = device;
        this.cache = new Map();
        this.compiling = new Map();
        this._inflight = new Map();
        this.identity = new GpuDescriptorIdentity({ generation });
        this._epoch = 0;
        this._destroyed = false;
        this._lost = null;
        this._programs = new Map();
        this._programInflight = new Map();
        this._programBases = new Map();
        this._programHits = 0;
        this._programCreations = 0;
        // A raw-device consumer can share this cache without owning its device.
        // Do not keep the cache alive solely through the device's loss promise.
        const weak = new WeakRef(this);
        observeExplicitDestroy(device, weak);
        device?.lost?.then(info => {
            const cache = weak.deref();
            if (!cache || cache._destroyed) return;
            cache._lost = info || { reason: 'unknown' };
            cache._retire('GPU_PIPELINE_CACHE_DEVICE_LOST', 'PipelineCache device was lost');
        }).catch(error => {
            const cache = weak.deref();
            if (!cache || cache._destroyed) return;
            cache._lost = error;
            cache._retire('GPU_PIPELINE_CACHE_DEVICE_LOST', 'PipelineCache device loss observation failed');
        });
    }

    async init() {
        return !this._destroyed;
    }

    _pipelineKey(descriptor, kind) {
        return this.identity.key(descriptor, kind);
    }

    async getOrCreateComputePipeline(descriptor, label = '') {
        return this._getOrCreate('compute', descriptor, label);
    }

    async getOrCreateRenderPipeline(descriptor, label = '') {
        return this._getOrCreate('render', descriptor, label);
    }

    /** Borrow immutable checked shader/layout/pipelines on this exact device.
     * All inputs are copied plain values; buffers, binding groups, runtime
     * authoring and numerical state cannot enter this cache. Instance disposal
     * releases its references only. Cache clear/destroy/loss retires publication.
     */
    getOrCreateComputeProgram(descriptor, label = '') {
        let snapshot, key;
        const epoch = this._epoch;
        try {
            this._assertProgramCurrent(epoch);
            snapshot = snapshotComputeProgram(descriptor);
            if (typeof label !== 'string') throw new TypeError('Compute program label must be a string');
            this._assertProgramCurrent(epoch);
            key = this.identity.key(snapshot, 'compute-program');
        } catch (error) { return Promise.reject(error); }
        if (this._programs.has(key)) {
            this._programHits++;
            return Promise.resolve(this._programs.get(key));
        }
        if (this._programInflight.has(key)) {
            this._programHits++;
            return this._programInflight.get(key).promise;
        }
        const record = { key, epoch: this._epoch, controller: new AbortController(),
            settled: false, cancelled: false, resolve: null, reject: null, promise: null };
        record.promise = new Promise((resolve, reject) => { record.resolve = resolve; record.reject = reject; });
        record.promise.catch(() => {});
        this._programInflight.set(key, record);
        this._programCreations++;
        let base = null;
        const operation = (async () => {
            base = this._computeProgramBase(snapshot, label, record);
            const resources = await base.promise;
            this._assertProgramCurrent(record.epoch, record);
            // The existing canonical pipeline path owns compiler deduplication
            // and revocation. Independent entry points start concurrently.
            const pipelines = await Promise.all(snapshot.entryPoints.map(entryPoint =>
                this.getOrCreateComputePipeline({ layout: resources.layout,
                    compute: { module: resources.module, entryPoint, constants: snapshot.constants } },
                `${label || 'Compute program'} ${entryPoint}`)));
            this._assertProgramCurrent(record.epoch, record);
            const byEntryPoint = Object.create(null);
            snapshot.entryPoints.forEach((entryPoint, index) => { byEntryPoint[entryPoint] = pipelines[index]; });
            const bundle = Object.freeze({ module: resources.module, layout: resources.layout,
                bindGroupLayouts: resources.bindGroupLayouts,
                pipelines: Object.freeze(byEntryPoint), descriptor: snapshot,
                device: resources.device, generation: this.identity.generation, cacheEpoch: record.epoch });
            this._assertProgramCurrent(record.epoch, record);
            this._programs.set(key, bundle);
            return bundle;
        })();
        operation.then(bundle => this._settleProgram(record, null, bundle), error => {
            // A failed program never leaves its module for a retry to inherit.
            if (base && this._programBases.get(base.key) === base) this._programBases.delete(base.key);
            this._settleProgram(record, error);
        });
        return record.promise;
    }

    // Programs that differ only in their entry-point subset share one checked
    // module and layout, so the canonical pipeline path deduplicates each entry
    // point across subsets (a configuration compiles only what it dispatches).
    _computeProgramBase(snapshot, label, record) {
        const key = this.identity.key({ code: snapshot.code,
            bindGroupLayoutDescriptors: snapshot.bindGroupLayoutDescriptors }, 'compute-program-base');
        const cached = this._programBases.get(key);
        if (cached && cached.epoch === record.epoch) return cached;
        const device = this.device;
        const base = { key, epoch: record.epoch, controller: new AbortController(), promise: null };
        base.promise = (async () => {
            const resources = await withErrorScope(device, () => {
                this._assertProgramCurrent(base.epoch);
                const module = createCheckedShaderModule(device, { code: snapshot.code, label }, {
                    generation: this.identity.generation, signal: base.controller.signal,
                });
                this._assertProgramCurrent(base.epoch);
                const bindGroupLayouts = Object.freeze(snapshot.bindGroupLayoutDescriptors.map(value => {
                    this._assertProgramCurrent(base.epoch);
                    const result = device.createBindGroupLayout(value);
                    this._assertProgramCurrent(base.epoch);
                    return result;
                }));
                const layout = device.createPipelineLayout({ bindGroupLayouts });
                this._assertProgramCurrent(base.epoch);
                return { module, bindGroupLayouts, layout, device };
            }, { logErrors: false });
            this._assertProgramCurrent(base.epoch);
            await assertCheckedShaderModule(resources.module, { label, signal: base.controller.signal });
            this._assertProgramCurrent(base.epoch);
            return resources;
        })();
        base.promise.catch(() => { if (this._programBases.get(key) === base) this._programBases.delete(key); });
        this._programBases.set(key, base);
        return base;
    }

    _assertProgramCurrent(epoch, record = null) {
        if (this._destroyed || !this.device || epoch !== this._epoch || record?.cancelled) {
            const error = new Error(this._lost ? 'PipelineCache device was lost'
                : this._destroyed ? 'PipelineCache is destroyed' : 'Compute program generation was cleared');
            error.code = this._lost ? 'GPU_PIPELINE_CACHE_DEVICE_LOST'
                : this._destroyed ? 'GPU_PIPELINE_CACHE_DESTROYED' : 'GPU_PIPELINE_CACHE_CLEARED';
            throw error;
        }
    }

    _settleProgram(record, error = null, bundle = null) {
        if (this._programInflight.get(record.key) === record) this._programInflight.delete(record.key);
        if (record.settled) return false;
        record.settled = true;
        if (error) { record.controller.abort(error); record.reject(error); }
        else record.resolve(bundle);
        return true;
    }

    _revokePrograms(code, message) {
        for (const record of this._programInflight.values()) {
            if (record.settled) continue;
            record.cancelled = true;
            const error = new Error(message); error.code = code;
            this._settleProgram(record, error);
            record.controller.abort(error);
        }
        this._programInflight.clear();
        this._programs.clear();
        for (const base of this._programBases.values()) {
            const error = new Error(message); error.code = code;
            base.controller.abort(error);
        }
        this._programBases.clear();
    }

    _getOrCreate(kind, descriptor, label) {
        if (this._destroyed || !this.device) {
            const error = new Error('PipelineCache is destroyed');
            error.code = this._lost ? 'GPU_PIPELINE_CACHE_DEVICE_LOST' : 'GPU_PIPELINE_CACHE_DESTROYED';
            return Promise.reject(error);
        }
        const key = this._pipelineKey(descriptor, kind);
        if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
        if (this.compiling.has(key)) return this.compiling.get(key);

        const epoch = this._epoch;
        const token = this.identity.token(key);
        const device = this.device;
        const record = {
            key,
            epoch,
            settled: false,
            cancelled: false,
            resolve: null,
            reject: null,
            promise: null,
        };
        record.promise = new Promise((resolve, reject) => {
            record.resolve = resolve;
            record.reject = reject;
        });
        // Cancellation can happen during owner teardown even when the caller
        // intentionally does not retain the promise. Keep that rejection from
        // becoming a global unhandled-rejection while preserving await/then.
        record.promise.catch(() => {});

        const compilationOperation = (async () => {
            const startTime = performance.now();
            const modules = [
                descriptor.compute?.module,
                descriptor.vertex?.module,
                descriptor.fragment?.module,
            ].filter(Boolean);
            await Promise.all(modules.map(module => assertCheckedShaderModule(module, { label })));
            if (record.cancelled || this._destroyed || epoch !== this._epoch) {
                const error = new Error('Pipeline compilation was revoked before pipeline creation');
                error.code = this._destroyed
                    ? 'GPU_PIPELINE_CACHE_DESTROYED'
                    : 'GPU_PIPELINE_CACHE_CLEARED';
                throw error;
            }
            const method = kind === 'compute' ? 'createComputePipelineAsync' : 'createRenderPipelineAsync';
            const prefix = kind === 'compute' ? 'ComputePipeline' : 'RenderPipeline';
            const pipeline = await device[method]({
                ...descriptor,
                label: label || `${prefix}_${token}`,
            });
            const compileTime = performance.now() - startTime;
            if (compileTime > 10) {
                console.log(`[PipelineCache] Compiled ${label}: ${compileTime.toFixed(1)}ms`);
            }
            if (this._destroyed || epoch !== this._epoch) {
                const error = new Error('Pipeline compilation completed for a stale device generation');
                error.code = 'GPU_PIPELINE_GENERATION_STALE';
                throw error;
            }
            this.cache.set(key, pipeline);
            return pipeline;
        });
        compilationOperation().then(
            pipeline => this._settleCompilation(record, null, pipeline),
            error => this._settleCompilation(record, error),
        );
        this._inflight.set(key, record);
        this.compiling.set(key, record.promise);
        return record.promise;
    }

    _settleCompilation(record, error = null, pipeline = null) {
        if (this._inflight.get(record.key) === record) this._inflight.delete(record.key);
        if (this.compiling.get(record.key) === record.promise) this.compiling.delete(record.key);
        if (record.settled) return false;
        record.settled = true;
        if (error) record.reject(error);
        else record.resolve(pipeline);
        return true;
    }

    _revokeInflight(code, message) {
        for (const record of this._inflight.values()) {
            if (record.settled) continue;
            record.cancelled = true;
            record.settled = true;
            const error = new Error(message);
            error.code = code;
            record.reject(error);
        }
        this._inflight.clear();
        this.compiling.clear();
    }

    prewarmPipelines(descriptors) {
        const promises = [];
        for (const { type, descriptor, label } of descriptors) {
            if (type === 'compute') {
                promises.push(this.getOrCreateComputePipeline(descriptor, label));
            } else if (type === 'render') {
                promises.push(this.getOrCreateRenderPipeline(descriptor, label));
            }
        }
        return Promise.all(promises);
    }

    clear() {
        this._epoch += 1;
        this._revokeInflight(
            'GPU_PIPELINE_CACHE_CLEARED',
            'Pipeline compilation was revoked because the cache was cleared',
        );
        this._revokePrograms('GPU_PIPELINE_CACHE_CLEARED', 'Compute program was revoked because the cache was cleared');
        this.cache.clear();
        this.identity.clear();
    }

    getStats() {
        return {
            cached: this.cache.size,
            compiling: this.compiling.size,
            programs: this._programs.size,
            programCompiling: this._programInflight.size,
            programHits: this._programHits,
            programCreations: this._programCreations,
        };
    }

    destroy() {
        this._retire('GPU_PIPELINE_CACHE_DESTROYED', 'Pipeline compilation was revoked because the cache was destroyed');
    }

    _retire(code, message) {
        if (this._destroyed) return;
        this._destroyed = true;
        this._epoch += 1;
        this._revokeInflight(code, message);
        this._revokePrograms(code, message);
        this.cache.clear();
        this.identity.clear();
        this.device = null;
    }
}

function snapshotComputeProgram(descriptor) {
    const value = immutableProgramValue(descriptor, new Set());
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new TypeError('Compute program requires a plain descriptor');
    const allowed = new Set(['code', 'entryPoints', 'bindGroupLayoutDescriptors', 'constants']);
    if (Object.keys(value).some(key => !allowed.has(key))) throw new TypeError('Compute program contains an unsupported field');
    if (typeof value.code !== 'string' || !value.code) throw new TypeError('Compute program requires complete WGSL code');
    if (!Array.isArray(value.entryPoints) || !value.entryPoints.length
        || value.entryPoints.some(entry => typeof entry !== 'string' || !entry)
        || new Set(value.entryPoints).size !== value.entryPoints.length)
        throw new TypeError('Compute program requires unique explicit entry points');
    if (!Array.isArray(value.bindGroupLayoutDescriptors)) throw new TypeError('Compute program requires explicit binding layout descriptors');
    for (const layout of value.bindGroupLayoutDescriptors) {
        if (!layout || Array.isArray(layout) || typeof layout !== 'object'
            || !Array.isArray(layout.entries)) throw new TypeError('Each compute program binding layout requires entries');
    }
    const constants = value.constants === undefined ? Object.freeze({}) : value.constants;
    if (!constants || Array.isArray(constants) || typeof constants !== 'object'
        || Object.values(constants).some(number => typeof number !== 'number' || !Number.isFinite(number)))
        throw new TypeError('Compute program constants must be finite numeric values');
    return Object.freeze({ code: value.code, entryPoints: value.entryPoints,
        bindGroupLayoutDescriptors: value.bindGroupLayoutDescriptors, constants });
}

function immutableProgramValue(value, stack) {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Compute program values must be finite');
        return value;
    }
    if (!value || typeof value !== 'object' || stack.has(value)) throw new TypeError('Compute program requires acyclic plain values');
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
        throw new TypeError('Compute program cannot retain GPU resources or class instances');
    stack.add(value);
    const array = Array.isArray(value), result = array ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string' || array && !/^(0|[1-9][0-9]*)$/.test(key))
            throw new TypeError('Compute program cannot retain symbol or custom array fields');
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (!property || !('value' in property)) throw new TypeError('Compute program cannot retain accessors');
        if (property.value !== undefined) result[key] = immutableProgramValue(property.value, stack);
    }
    if (array && (result.length !== value.length || Object.keys(result).length !== value.length))
        throw new TypeError('Compute program arrays must be dense');
    stack.delete(value);
    return Object.freeze(result);
}
