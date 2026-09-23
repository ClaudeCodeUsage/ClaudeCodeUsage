export type SharingTemplate = 'combinedHeatmap' | 'claudeShareCard' | 'claudeHeatmap';

export interface SharingCommandIntent {
  revision: number;
  template: SharingTemplate;
}

/**
 * Provider-lifetime command history with a separate, acknowledgement-gated
 * live intent. The revision is never browser state: it only prevents a delayed
 * acknowledgement from consuming a newer explicit host command.
 */
export class SharingCommandIntentLedger {
  private revision = 0;
  private liveIntent: SharingCommandIntent | undefined;

  issue(template: SharingTemplate): SharingCommandIntent {
    const intent = { revision: ++this.revision, template };
    this.liveIntent = intent;
    return { ...intent };
  }

  pending(): SharingCommandIntent | undefined {
    return this.liveIntent ? { ...this.liveIntent } : undefined;
  }

  acknowledge(revision: number): boolean {
    if (!Number.isSafeInteger(revision) || this.liveIntent?.revision !== revision) {
      return false;
    }
    this.liveIntent = undefined;
    return true;
  }

  clearPending(): void {
    this.liveIntent = undefined;
  }

  latestRevision(): number {
    return this.revision;
  }
}
