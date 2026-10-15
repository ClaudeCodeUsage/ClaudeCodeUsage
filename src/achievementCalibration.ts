/** Runtime-only command orchestration. No storage, credentials, network,
 * scheduler, retries, or award decisions belong at this boundary. */
export type AchievementCalibrationResult = 'recalibrated' | 'partial' | 'disabled' | 'cancelled' | 'failed';
export type AchievementCalibrationCommitResult = 'partial' | boolean | void;

export interface AchievementCalibrationOperation {
  enabled(): boolean;
  cancelled(): boolean;
  /** Includes source/configuration and OFF -> ON transitions. */
  generation(): unknown;
  /** One local incremental pass (or the already-running production pass).
   * Reject on actual failure; a stale last-good snapshot is not success. */
  refreshLocal(current: () => boolean): Promise<void>;
  /** The Webview checks this live guard after awaits and at its durable write
   * fence. True confirms completed calibration (possibly with no new writes);
   * partial confirms some work was saved but calibration did not fully finish.
   * Neither outcome can be undone by late cancellation. False/legacy void
   * still require a current post-await guard. */
  recalibrate(current: () => boolean): Promise<AchievementCalibrationCommitResult>;
}

export class AchievementCalibrationSingleFlight {
  private pending: Promise<AchievementCalibrationResult> | undefined;

  run(operation: AchievementCalibrationOperation): Promise<AchievementCalibrationResult> {
    if (this.pending) return this.pending;
    const generation = operation.generation();
    const retired = (): AchievementCalibrationResult | undefined =>
      !operation.enabled() ? 'disabled' :
      operation.cancelled() || operation.generation() !== generation ? 'cancelled' : undefined;
    const current = () => retired() === undefined;
    const pending = Promise.resolve().then(async (): Promise<AchievementCalibrationResult> => {
      const before = retired();
      if (before) return before;
      try {
        await operation.refreshLocal(current);
        const after = retired();
        if (after) return after;
        const committed = await operation.recalibrate(current);
        // Report actual completion/partial saves, even when cancellation or
        // source retirement arrived afterward. Never claim saved work vanished.
        if (committed === 'partial') return 'partial';
        return committed === true ? 'recalibrated' : retired() ?? 'recalibrated';
      } catch {
        return retired() ?? 'failed';
      }
    }).finally(() => {
      if (this.pending === pending) this.pending = undefined;
    });
    this.pending = pending;
    return pending;
  }
}

/** Called by the real Claude refresh before even looking up quota credentials.
 * Local-only requests must never be merged with ordinary quota-bearing work. */
export function shouldFetchQuotaForRefresh(request: { localOnly?: boolean }): boolean {
  return request.localOnly !== true;
}
