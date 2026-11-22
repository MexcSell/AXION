/**
 * The pinned OpenTelemetry GenAI semantic conventions (improvement cycle 60, R2-8). The status of every page is "Development": names and
 * attributes may change without notice, so the export is checked against THIS list and nothing else. The two pages used are stored verbatim
 * in web/docs/improve/phase2/otel-spec-v0.1.0/ and server/test/otel-mapping.test.ts re-hashes them and re-parses their attribute tables.
 * Moving to a newer version means: fetch the pages, update this file and the stored copies together, re-run the tests (the mapping
 * table in web/docs/improve/phase2/otel-mapping.md is generated from src/otel/mapping.ts and checked against this list).
 */
export const OTEL_GENAI_SPEC = {
  repository: 'https://github.com/open-telemetry/semantic-conventions-genai',
  tag: 'v0.1.0',
  commit: 'd0e74ba6c48bcc4ded473b1828a8212f06b23753',
  status: 'Development',
  fetchedOn: '2026-11-22',
  pages: {
    'docs/gen-ai/gen-ai-agent-spans.md': { sha256: '0d2db04dd642e52c73eadf7b05b3ae1586d6ab99462c94a9c31e5cebff0e01ff' },
    'docs/gen-ai/execute-tool.md': { sha256: '7a72f0d602c6d023944d1e43f54caba53b4eeb2987ac46f6c272746d526d15f3' },
  },
} as const;

export type RequirementLevel = 'Required' | 'Conditionally Required' | 'Recommended' | 'Opt-In';
export interface PinnedSpan { operation: string; kind: 'INTERNAL'; nameFormat: string; attributes: Record<string, RequirementLevel> }

/** Attribute tables of the three span types AXION exports, copied from the pinned pages (the test compares them with the stored pages). */
export const PINNED_SPANS: { invoke_agent: PinnedSpan; plan: PinnedSpan; execute_tool: PinnedSpan } = {
  // "Invoke agent internal span" (an in-process agent entrypoint); its name is `{gen_ai.operation.name} {gen_ai.agent.name}`, or just the operation name without an agent name
  invoke_agent: { operation: 'invoke_agent', kind: 'INTERNAL', nameFormat: '{gen_ai.operation.name} {gen_ai.agent.name}', attributes: {
      'gen_ai.operation.name': 'Required',
      'error.type': 'Conditionally Required',
      'gen_ai.agent.description': 'Conditionally Required',
      'gen_ai.agent.name': 'Conditionally Required',
      'gen_ai.conversation.id': 'Conditionally Required',
      'gen_ai.data_source.id': 'Conditionally Required',
      'gen_ai.output.type': 'Conditionally Required',
      'gen_ai.request.choice.count': 'Conditionally Required',
      'gen_ai.request.seed': 'Conditionally Required',
      'gen_ai.request.frequency_penalty': 'Recommended',
      'gen_ai.request.max_tokens': 'Recommended',
      'gen_ai.request.model': 'Recommended',
      'gen_ai.request.presence_penalty': 'Recommended',
      'gen_ai.request.stop_sequences': 'Recommended',
      'gen_ai.request.temperature': 'Recommended',
      'gen_ai.request.top_p': 'Recommended',
      'gen_ai.response.finish_reasons': 'Recommended',
      'gen_ai.usage.input_tokens': 'Recommended',
      'gen_ai.usage.output_tokens': 'Recommended',
      'gen_ai.input.messages': 'Opt-In',
      'gen_ai.input.messages_ref': 'Opt-In',
      'gen_ai.output.messages': 'Opt-In',
      'gen_ai.output.messages_ref': 'Opt-In',
      'gen_ai.system_instructions': 'Opt-In',
      'gen_ai.system_instructions_ref': 'Opt-In',
      'gen_ai.tool.definitions': 'Opt-In',
      'gen_ai.tool.definitions_ref': 'Opt-In',
    } },
  plan: { operation: 'plan', kind: 'INTERNAL', nameFormat: 'plan {gen_ai.agent.name}', attributes: {
      'gen_ai.operation.name': 'Required',
      'error.type': 'Conditionally Required',
      'gen_ai.agent.name': 'Conditionally Required',
    } },
  execute_tool: { operation: 'execute_tool', kind: 'INTERNAL', nameFormat: 'execute_tool {gen_ai.tool.name}', attributes: {
      'gen_ai.operation.name': 'Required',
      'gen_ai.tool.name': 'Required',
      'error.type': 'Conditionally Required',
      'gen_ai.agent.name': 'Conditionally Required',
      'gen_ai.conversation.id': 'Conditionally Required',
      'gen_ai.tool.call.id': 'Conditionally Required',
      'gen_ai.tool.description': 'Recommended',
      'gen_ai.tool.type': 'Recommended',
      'gen_ai.tool.call.arguments': 'Opt-In',
      'gen_ai.tool.call.result': 'Opt-In',
    } },
};

export const ALL_PINNED_ATTRIBUTES: ReadonlySet<string> = new Set(Object.values(PINNED_SPANS).flatMap((s) => Object.keys(s.attributes)));

/**
 * Attributes that carry content (text a person or a model wrote, tool arguments and results). The Opt-In attributes of the pinned spans, plus
 * AXION's own inline-text attributes. The default export contains none of them: a `_ref` pointer replaces each (see mapping.ts).
 */
export const CONTENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...Object.values(PINNED_SPANS).flatMap((s) => Object.entries(s.attributes).filter(([, l]) => l === 'Opt-In').map(([k]) => k)),
  'axion.task.title', 'axion.task.criteria', 'axion.instance.task_label', 'axion.failure.note', 'axion.failure.detection_note', 'axion.step.input', 'axion.step.output', 'axion.step.error',
  // c60 fix round: every other free-text or caller-supplied field, and the raw (unsanitised) names
  'axion.task.owner_agent', 'axion.attempt.evidence_ref', 'axion.failure.attributed_agent_id', 'axion.failure.attributed_step_ref', 'axion.step.tool_name', 'axion.agent.name_raw',
]);
