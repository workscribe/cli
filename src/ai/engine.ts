/**
 * Every engine a stored summary can come from. Workscribe 2.0 writes only `skill` summaries (the agent skill's
 * write-back); `provider`, `ollama` and `legacy` rows were written by 1.x AI providers and are still served.
 */
export type StoredEngine = 'template' | 'skill' | 'provider' | 'ollama' | 'legacy'
