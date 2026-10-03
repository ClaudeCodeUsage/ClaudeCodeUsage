/** JSONL-derived keys can be named __proto__, constructor or toString. Read
 * only own entries and define writes without invoking an inherited setter;
 * keep ordinary enumerable objects for existing snapshots and consumers. */
export function ownRecordValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export function setRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}
