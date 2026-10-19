export const RESOURCE_KINDS = ['timer', 'watcher', 'worker', 'network', 'backfill'] as const;

export const RESOURCE_CAPABILITIES = [
  'refresh',
  'quota',
  'codex-index',
  'codex-history',
  'hourly-history',
  'advice-personalization',
] as const;

export const RESOURCE_SCOPES = ['extension', 'claude', 'codex', 'advice'] as const;

export const RESOURCE_CREATORS = [
  'extension',
  'refresh-coordinator',
  'claude-api-client',
  'codex-quota-client',
  'codex-index-client',
  'codex-index-worker',
  'codex-file-pass-pool',
  'advice-runtime',
] as const;

export const RESOURCE_STOP_CONDITIONS = [
  'settled',
  'completed',
  'cancelled',
  'window-blur',
  'feature-disabled',
  'extension-dispose',
  'user-pause',
  'settings-change',
  'profile-change',
] as const;

export const RESOURCE_BOUNDED_EXCEPTIONS = ['none', 'first-codex-history'] as const;

export type ResourceKind = typeof RESOURCE_KINDS[number];
export type ResourceCapability = typeof RESOURCE_CAPABILITIES[number];
export type ResourceScope = typeof RESOURCE_SCOPES[number];
export type ResourceCreator = typeof RESOURCE_CREATORS[number];
export type ResourceStopCondition = typeof RESOURCE_STOP_CONDITIONS[number];
export type ResourceBoundedException = typeof RESOURCE_BOUNDED_EXCEPTIONS[number];

export interface ResourceDescriptor {
  readonly kind: ResourceKind;
  readonly capability: ResourceCapability;
  readonly scope: ResourceScope;
  readonly creator: ResourceCreator;
  readonly stopConditions: readonly ResourceStopCondition[];
  readonly boundedException: ResourceBoundedException;
}

export interface ResourceLease {
  readonly descriptor: ResourceDescriptor;
  readonly active: boolean;

  /** Runs the real close/abort/terminate/settle action. Ownership is released
   * only after that action resolves; a rejected action leaves the lease active. */
  stop(
    condition: ResourceStopCondition,
    actualStopOrSettle: () => void | Promise<void>,
  ): Promise<boolean>;
}

export interface ResourceOwnershipSnapshot {
  readonly activeCount: number;
  readonly byKind: Readonly<Record<ResourceKind, number>>;
  readonly active: readonly ResourceDescriptor[];
}

const DESCRIPTOR_FIELDS = [
  'kind',
  'capability',
  'scope',
  'creator',
  'stopConditions',
  'boundedException',
] as const;

const kindSet = new Set<unknown>(RESOURCE_KINDS);
const capabilitySet = new Set<unknown>(RESOURCE_CAPABILITIES);
const scopeSet = new Set<unknown>(RESOURCE_SCOPES);
const creatorSet = new Set<unknown>(RESOURCE_CREATORS);
const stopConditionSet = new Set<unknown>(RESOURCE_STOP_CONDITIONS);
const boundedExceptionSet = new Set<unknown>(RESOURCE_BOUNDED_EXCEPTIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactDescriptorFields(value: Record<string, unknown>): void {
  const keys = Object.keys(value);
  if (keys.length !== DESCRIPTOR_FIELDS.length ||
      !DESCRIPTOR_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
    throw new TypeError('resource ownership metadata contains an unknown or missing field');
  }
}

function checkedDescriptor(value: ResourceDescriptor): ResourceDescriptor {
  if (!isRecord(value)) throw new TypeError('resource descriptor must be an object');
  assertExactDescriptorFields(value);
  if (!kindSet.has(value.kind)) throw new TypeError('resource kind must be fixed');
  if (!capabilitySet.has(value.capability)) throw new TypeError('resource capability must be fixed');
  if (!scopeSet.has(value.scope)) throw new TypeError('resource scope must be fixed');
  if (!creatorSet.has(value.creator)) throw new TypeError('resource creator must be fixed');
  if (!boundedExceptionSet.has(value.boundedException)) {
    throw new TypeError('resource bounded exception must be fixed');
  }
  if (!Array.isArray(value.stopConditions) || value.stopConditions.length === 0) {
    throw new TypeError('resource stop conditions must be a non-empty fixed list');
  }
  const seen = new Set<ResourceStopCondition>();
  for (const condition of value.stopConditions) {
    if (!stopConditionSet.has(condition)) throw new TypeError('resource stop condition must be fixed');
    if (seen.has(condition)) throw new TypeError('resource stop conditions contain a duplicate');
    seen.add(condition);
  }
  if (value.boundedException === 'first-codex-history' &&
      (value.kind !== 'backfill' || value.capability !== 'codex-history' || value.scope !== 'codex')) {
    throw new TypeError('first Codex history bounded exception is only valid for a Codex history backfill');
  }

  return Object.freeze({
    kind: value.kind,
    capability: value.capability,
    scope: value.scope,
    creator: value.creator,
    stopConditions: Object.freeze([...value.stopConditions]),
    boundedException: value.boundedException,
  });
}

function emptyKindCounts(): Record<ResourceKind, number> {
  return {
    timer: 0,
    watcher: 0,
    worker: 0,
    network: 0,
    backfill: 0,
  };
}

/** Test-observable ownership bookkeeping only. It neither schedules resources
 * nor retains callbacks, paths, request bodies, or other user content. */
export class ResourceOwnershipRegistry {
  private nextLeaseId = 1;
  private readonly activeDescriptors = new Map<number, ResourceDescriptor>();

  register(input: ResourceDescriptor): ResourceLease {
    const descriptor = checkedDescriptor(input);
    const leaseId = this.nextLeaseId;
    this.nextLeaseId += 1;
    this.activeDescriptors.set(leaseId, descriptor);

    let active = true;
    let stopping: Promise<boolean> | undefined;
    const registry = this;
    return {
      descriptor,
      get active(): boolean {
        return active;
      },
      stop(
        condition: ResourceStopCondition,
        actualStopOrSettle: () => void | Promise<void>,
      ): Promise<boolean> {
        if (!stopConditionSet.has(condition) || !descriptor.stopConditions.includes(condition)) {
          return Promise.reject(new TypeError('stop condition is not declared by this resource'));
        }
        if (typeof actualStopOrSettle !== 'function') {
          return Promise.reject(new TypeError('actual stop or settle action must be a function'));
        }
        if (!active) return Promise.resolve(false);
        if (stopping !== undefined) return stopping;

        stopping = Promise.resolve()
          .then(actualStopOrSettle)
          .then(() => {
            if (!active) return false;
            active = false;
            registry.activeDescriptors.delete(leaseId);
            return true;
          })
          .catch((error: unknown) => {
            stopping = undefined;
            throw error;
          });
        return stopping;
      },
    };
  }

  snapshotForTests(): ResourceOwnershipSnapshot {
    const byKind = emptyKindCounts();
    const active = [...this.activeDescriptors.values()];
    for (const descriptor of active) byKind[descriptor.kind] += 1;
    return Object.freeze({
      activeCount: active.length,
      byKind: Object.freeze(byKind),
      active: Object.freeze(active),
    });
  }
}
