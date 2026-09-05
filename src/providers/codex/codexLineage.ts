export const CODEX_LINEAGE_FINGERPRINT_BYTES = 16;
export const CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK = 1_024;

export interface CodexLineageTrace {
  /** Packed 128-bit event fingerprints; Base64 keeps the persisted index compact. */
  fingerprintBlocks: string[];
  /** Hex fingerprints not yet promoted into a full packed block. */
  pendingFingerprints: string[];
  tokenEvents: number;
  desiredPrefixEvents: number;
  appliedPrefixEvents: number;
}
