import { RefreshTrigger } from './refreshPolicy';

export interface LoadUsageDiagnostics {
  filesDiscovered: number;
  filesFailed: number;
  bytesRead: number;
  linesParsed: number;
  readParseMs: number;
}

export interface RefreshDiagnostic extends LoadUsageDiagnostics {
  trigger: RefreshTrigger;
  filesChanged: number;
  filesReused: number;
  filesRemoved: number;
  watcherEvents: number;
  coalescedTriggers: number;
  manifestMs: number;
  aggregateRenderMs: number;
  totalMs: number;
}

const ms = (value: number): string => value.toFixed(1);

export function formatRefreshDiagnostic(value: RefreshDiagnostic): string {
  return `refresh: trigger=${value.trigger} ` +
    `files(discovered=${value.filesDiscovered} changed=${value.filesChanged} ` +
    `reused=${value.filesReused} removed=${value.filesRemoved} failed=${value.filesFailed}) ` +
    `io(bytes=${value.bytesRead} lines=${value.linesParsed}) ` +
    `events(watcher=${value.watcherEvents} coalesced=${value.coalescedTriggers}) ` +
    `ms(manifest=${ms(value.manifestMs)} read-parse=${ms(value.readParseMs)} ` +
    `aggregate-render=${ms(value.aggregateRenderMs)} total=${ms(value.totalMs)})`;
}
