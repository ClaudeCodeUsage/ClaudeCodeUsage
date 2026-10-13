import type {UsageProvider} from './providers/providerTypes';

/** Published historical identities, independent of the currently selected
 * reference rates. Append released versions here; never infer arbitrary future
 * books from their string shape or use these labels to authorize new grants. */
const published: Readonly<Record<UsageProvider,readonly string[]>> = Object.freeze({
  claude:Object.freeze(['api-reference-2026-10-anthropic-v1','api-reference-2026-10-aws-bedrock-in-region-v1']),
  codex:Object.freeze(['api-reference-2026-10-openai-v1']),
});
export function isPublishedAchievementReferencePricebook(provider:UsageProvider,value:unknown):value is string {
  return typeof value==='string' && published[provider].includes(value);
}
