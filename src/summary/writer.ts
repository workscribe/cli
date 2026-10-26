import { TemplateProvider } from '../ai/engines/template/provider'
import type { AIProvider } from '../ai/types'
import type { WorkscribeConfig } from '../config'

/** What writes summaries since 2.0: the offline template engine, honouring summary.includeCategories. */
export function createSummaryWriter(config: WorkscribeConfig): AIProvider {
  return new TemplateProvider(config.summary?.includeCategories ?? [])
}
