import { OTEL_GENAI_SPEC, PINNED_SPANS } from './pinned.ts';

/**
 * Improvement cycle 60 (R2-8): where every AXION task and trace field goes in an OpenTelemetry GenAI export, or that it goes nowhere.
 * The table is data: the exporter (export.ts) reads the same entries, the Markdown file web/docs/improve/phase2/otel-mapping.md is
 * generated from it (renderMappingMarkdown, checked byte for byte by the test), and the test checks it against the real table columns
 * and against the pinned attribute list (pinned.ts). Spec status is "Development", so the version and page hashes are part of the file.
 */
export type Target =
  | { kind: 'gen_ai'; key: string }                         // a GenAI attribute of the pinned spec (or error.type, which the spec reuses)
  | { kind: 'axion'; key: string }                          // AXION's own attribute (extension namespace `axion.`), for a field the spec has no attribute for
  | { kind: 'span'; what: 'start_time' | 'end_time' | 'parent' | 'status' | 'name' | 'event' }
  | { kind: 'none' };                                       // no equivalent: not exported
export interface FieldEntry {
  to: Target;
  note: string;
  /** Content fields: by default only `refKey` (a pointer "axion://table/id#field") is exported; `inlineKey` carries the text only with --include-content. */
  content?: { refKey: string; inlineKey: string };
}

const gen = (key: string): Target => ({ kind: 'gen_ai', key });
const ax = (key: string): Target => ({ kind: 'axion', key });
const sp = (what: 'start_time' | 'end_time' | 'parent' | 'status' | 'name' | 'event'): Target => ({ kind: 'span', what });
const none: Target = { kind: 'none' };
const e = (to: Target, note: string, content?: { refKey: string; inlineKey: string }): FieldEntry => ({ to, note, content });
const text = (stem: string) => ({ refKey: `${stem}_ref`, inlineKey: stem });
const internal = 'internal scope or bookkeeping of AXION; an outside viewer has no use for it';

export const MAPPED_TABLES = ['tasks', 'task_attempts', 'task_dependencies', 'agent_instances', 'mission_runs', 'eval_runs', 'eval_results', 'failure_tags', 'failure_attributions'] as const;

/** The fields of one step inside `eval_results.trace.steps[]`. The database only requires `steps` to be an array; the exporter reads these keys and counts steps it cannot read. */
export const TRACE_STEP_FIELDS = ['kind', 'name', 'input', 'output', 'error', 'startMs', 'endMs'] as const;

export const FIELD_MAP: Record<string, FieldEntry> = {
  // ---- tasks: one `invoke_agent` span per task, child of the span of the agent instance that owns it (or of the mission span)
  'tasks.id': e(ax('axion.task.id'), 'The pinned spec has no task identifier; a task is not an agent, a tool or a conversation.'),
  'tasks.tenant_id': e(none, `${internal}. Exports are per mission and per tenant.`),
  'tasks.mission_id': e(gen('gen_ai.conversation.id'), 'Closest equivalent: the spec calls it the identifier of a conversation (session, thread). A mission is a work session, not a chat. Also written as resource attribute axion.mission.id.'),
  'tasks.run_id': e(ax('axion.task.run_id'), 'No equivalent for a mission run.'),
  'tasks.title': e(ax('axion.task.title_ref'), 'Text a person wrote: content. Pointer by default.', text('axion.task.title')),
  'tasks.status': e(sp('status'), 'failed becomes span status ERROR with error.type "task_failed"; every other status is only in axion.task.status. The error message is never exported.'),
  'tasks.owner_agent': e(ax('axion.task.owner_agent'), 'A free-text owner label. The span name uses the name of the owner instance\'s agent definition when there is one.'),
  'tasks.created_at': e(sp('start_time'), 'Start time of the task span.'),
  'tasks.owner_instance_id': e(sp('parent'), 'The task span is a child of the span of the owning agent instance; without an owner it is a child of the mission span.'),
  'tasks.weight': e(ax('axion.task.weight'), 'No equivalent: the spec has no notion of a weighted task.'),
  'tasks.criteria': e(ax('axion.task.criteria_ref'), 'Acceptance criteria a person wrote: content. Pointer by default.', text('axion.task.criteria')),
  'tasks.evidence': e(ax('axion.task.evidence_count'), 'A count of evidence items; no equivalent.'),
  'tasks.col': e(none, 'Position on the board; display only.'),
  'tasks.row': e(none, 'Position on the board; display only.'),
  'tasks.simulated': e(ax('axion.simulated'), 'AXION marks fixture work as simulated; an outside viewer must be able to tell.'),
  'task_dependencies.task_id': e(none, 'Span links are not part of the pinned GenAI pages; the dependency graph is not exported.'),
  'task_dependencies.depends_on': e(none, 'Span links are not part of the pinned GenAI pages; the dependency graph is not exported.'),

  // ---- task attempts: one `invoke_agent` span per attempt, child of its task span
  'task_attempts.id': e(ax('axion.attempt.id'), 'No equivalent for an attempt number space.'),
  'task_attempts.task_id': e(sp('parent'), 'The attempt span is a child of its task span.'),
  'task_attempts.attempt_no': e(ax('axion.attempt.no'), 'No equivalent.'),
  'task_attempts.started_at': e(sp('start_time'), 'Start time of the attempt span (the task\'s start when the attempt has none yet).'),
  'task_attempts.finished_at': e(sp('end_time'), 'End time of the attempt span.'),
  'task_attempts.result': e(sp('status'), 'failed becomes span status ERROR with error.type "attempt_failed"; the value is also in axion.attempt.result.'),
  'task_attempts.evidence_ref': e(ax('axion.attempt.evidence_ref'), 'Already a pointer in AXION, so it is exported as is (a pointer, not content).'),

  // ---- agent instances: one `invoke_agent` span per instance, child of the mission span
  'agent_instances.seq': e(none, internal),
  'agent_instances.id': e(ax('axion.instance.id'), 'The spec advises against in-memory instance ids on gen_ai.agent.id, and the internal invoke_agent span has no agent id attribute at all.'),
  'agent_instances.tenant_id': e(none, internal),
  'agent_instances.mission_id': e(gen('gen_ai.conversation.id'), 'See tasks.mission_id.'),
  'agent_instances.run_id': e(ax('axion.instance.run_id'), 'No equivalent for a mission run.'),
  'agent_instances.agent_id': e(ax('axion.agent.id'), 'The pinned gen_ai.agent.id belongs to the create-agent and client invoke-agent spans, not to the internal invoke_agent span AXION emits, so the extension attribute is used. The agent\'s name is exported as gen_ai.agent.name.'),
  'agent_instances.agent_version_id': e(ax('axion.agent.version_id'), 'Same reason: gen_ai.agent.version is not on the internal invoke_agent span.'),
  'agent_instances.manager_instance_id': e(sp('parent'), 'The span of a managed instance could be a child of its manager\'s; AXION keeps all instances under the mission span and records the manager in axion.instance.manager_id.'),
  'agent_instances.state': e(ax('axion.instance.state'), 'No equivalent.'),
  'agent_instances.task_label': e(ax('axion.instance.task_label_ref'), 'Text shown on the instance card: content. Pointer by default.', text('axion.instance.task_label')),
  'agent_instances.progress': e(none, 'A display percentage, not a measurement.'),
  'agent_instances.task_count': e(none, 'A display count (a fixture value on demo missions).'),
  'agent_instances.pending': e(none, 'A display count.'),
  'agent_instances.simulated': e(ax('axion.simulated'), 'See tasks.simulated.'),
  'agent_instances.created_at': e(sp('start_time'), 'Start time of the instance span.'),
  'agent_instances.ended_at': e(sp('end_time'), 'End time of the instance span (the latest end of its children when it is still open).'),

  // ---- mission runs: no span of their own
  'mission_runs.id': e(ax('axion.task.run_id'), 'A run has no span; its id is carried on the tasks and instances of the run.'),
  'mission_runs.mission_id': e(gen('gen_ai.conversation.id'), 'See tasks.mission_id.'),
  'mission_runs.revision': e(none, 'The mission text revision a run started from; no equivalent.'),
  'mission_runs.status': e(none, 'A run has no span, so its status has nowhere to go.'),
  'mission_runs.execution': e(none, 'AXION\'s execution mode (disabled, simulated); no equivalent, and the export never claims that anything executed.'),
  'mission_runs.started_at': e(none, 'A run has no span.'),
  'mission_runs.ended_at': e(none, 'A run has no span.'),

  // ---- evaluation runs and results (traces): one `invoke_agent` span per result, children per trace step
  'eval_runs.id': e(ax('axion.eval.run_id'), 'No equivalent for an evaluation run.'),
  'eval_runs.tenant_id': e(none, internal),
  'eval_runs.dataset_id': e(ax('axion.eval.dataset_id'), 'No equivalent for an evaluation dataset.'),
  'eval_runs.subject_version_id': e(ax('axion.agent.version_id'), 'The agent version under evaluation. It also decides which evaluation results belong to a mission: those whose subject version is pinned by one of the mission\'s agent instances.'),
  'eval_runs.subject_proposal_id': e(ax('axion.eval.subject_proposal_id'), 'A run evaluates either a version or a version proposal (exactly one). Results of proposal runs have no pinned version, so they are not linked to a mission and are not exported.'),
  'eval_runs.judge_model_family': e(ax('axion.eval.judge_model_family'), 'A family label of the judge, not a model name; gen_ai.request.model is not used because no model call is recorded.'),
  'eval_runs.evaluator_id': e(none, 'A person\'s or agent\'s identity is not exported.'),
  'eval_runs.k': e(ax('axion.eval.k'), 'No equivalent.'),
  'eval_runs.started_at': e(none, 'A run has no span of its own; the span of a result starts at the result\'s recorded time.'),
  'eval_runs.finished_at': e(none, 'A run has no span of its own.'),
  'eval_results.run_id': e(ax('axion.eval.run_id'), 'See eval_runs.id.'),
  'eval_results.case_id': e(ax('axion.eval.case_id'), 'No equivalent.'),
  'eval_results.attempt': e(ax('axion.eval.attempt'), 'No equivalent.'),
  'eval_results.score': e(ax('axion.eval.score'), 'The spec has no score for an agent result.'),
  'eval_results.cost_units': e(ax('axion.eval.cost_units'), 'AXION cost units are not tokens; gen_ai.usage.* attributes are not used so that nothing implies a token count.'),
  'eval_results.trace': e(sp('event'), 'Each step of trace.steps[] becomes a child span; see the step rows below. Steps with an unknown kind are counted in axion.export.unmapped_steps on the result span, never dropped silently.'),
  'eval_results.recorded_at': e(sp('start_time'), 'Start time of the result span when a step has no time of its own.'),
  'eval_results.trace.steps[].kind': e(sp('name'), '"tool" becomes an execute_tool span, "plan" a plan span; any other value is not mapped.'),
  'eval_results.trace.steps[].name': e(gen('gen_ai.tool.name'), 'The tool name of an execute_tool span (Required by the spec; a tool step without a name is counted as unmapped). Not used for a plan step.'),
  'eval_results.trace.steps[].input': e(ax('axion.step.input_ref'), 'Content. Opt-In in the spec, and the spec has no _ref form for tool arguments, so the pointer uses AXION\'s axion.step.input_ref and the text uses gen_ai.tool.call.arguments (tool steps) or axion.step.input (plan steps) only with --include-content.', { refKey: 'axion.step.input_ref', inlineKey: 'gen_ai.tool.call.arguments' }),
  'eval_results.trace.steps[].output': e(ax('axion.step.output_ref'), 'Content. Opt-In in the spec; same pointer rule as input (gen_ai.tool.call.result with --include-content for tool steps, axion.step.output for plan steps).', { refKey: 'axion.step.output_ref', inlineKey: 'gen_ai.tool.call.result' }),
  'eval_results.trace.steps[].error': e(gen('error.type'), 'A short error class (letters, digits and . _ : -, at most 64 characters) becomes error.type; anything else becomes "_OTHER". The message text is content: axion.step.error_ref by default.', { refKey: 'axion.step.error_ref', inlineKey: 'axion.step.error' }),
  'eval_results.trace.steps[].startMs': e(sp('start_time'), 'Milliseconds since the epoch; optional.'),
  'eval_results.trace.steps[].endMs': e(sp('end_time'), 'Milliseconds since the epoch; optional.'),

  // ---- failure tags and attributions: span events on the span of the tagged subject
  'failure_tags.id': e(ax('axion.failure.tag_id'), 'No equivalent: the spec has no failure taxonomy. Exported as an event "axion.failure_tag" on the span of the tagged task or attempt (on the mission span for a mission or message).'),
  'failure_tags.tenant_id': e(none, internal),
  'failure_tags.mission_id': e(gen('gen_ai.conversation.id'), 'See tasks.mission_id.'),
  'failure_tags.subject_kind': e(ax('axion.failure.subject_kind'), 'No equivalent.'),
  'failure_tags.subject_id': e(sp('parent'), 'Decides which span carries the event.'),
  'failure_tags.taxonomy_version': e(ax('axion.failure.taxonomy_version'), 'No equivalent (MAST, arXiv 2503.13657v3).'),
  'failure_tags.mode_id': e(ax('axion.failure.mode_id'), 'No equivalent.'),
  'failure_tags.note': e(ax('axion.failure.note_ref'), 'Text a person wrote: content. Pointer by default.', text('axion.failure.note')),
  'failure_tags.tagged_by': e(none, 'A person\'s or instance\'s identity is not exported; only the kind is.'),
  'failure_tags.tagged_by_kind': e(ax('axion.failure.tagged_by_kind'), 'No equivalent.'),
  'failure_tags.status': e(ax('axion.failure.status'), 'proposed, confirmed or rejected; no equivalent.'),
  'failure_tags.created_at': e(sp('event'), 'The event time.'),
  'failure_tags.decided_by': e(none, 'A person\'s identity is not exported.'),
  'failure_tags.decided_at': e(none, 'Not exported; the status carries the outcome.'),
  'failure_tags.self_confirmed': e(ax('axion.failure.self_confirmed'), 'No equivalent.'),
  'failure_attributions.id': e(ax('axion.failure.attribution_id'), 'No equivalent. Exported as an event "axion.failure_attribution" next to the tag event.'),
  'failure_attributions.tenant_id': e(none, internal),
  'failure_attributions.tag_id': e(ax('axion.failure.tag_id'), 'Links the attribution event to its tag event.'),
  'failure_attributions.mission_id': e(gen('gen_ai.conversation.id'), 'See tasks.mission_id.'),
  'failure_attributions.agent_id': e(ax('axion.failure.attributed_agent_id'), 'A claim about which agent the failure came from. Not gen_ai.agent.id: that names the agent of the span, and this is somebody\'s claim.'),
  'failure_attributions.step_ref': e(ax('axion.failure.attributed_step_ref'), 'A claim about which step. A free-text reference, not checked against stored traces.'),
  'failure_attributions.full_trace_available': e(ax('axion.failure.full_trace_available'), 'The attributor\'s claim that the whole trace exists for checking.'),
  'failure_attributions.attributed_by': e(none, 'A person\'s identity is not exported; only the kind is.'),
  'failure_attributions.attributed_by_kind': e(ax('axion.failure.attributed_by_kind'), 'No equivalent.'),
  'failure_attributions.created_at': e(sp('event'), 'The event time.'),
};

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const targetText = (t: Target): string =>
  t.kind === 'gen_ai' ? `\`${t.key}\` (pinned GenAI attribute)` :
  t.kind === 'axion' ? `\`${t.key}\` (AXION extension)` :
  t.kind === 'span' ? `span ${t.what.replace('_', ' ')}` : '**no equivalent**';

/** AXION attributes the exporter writes that belong to no table column: they describe the export itself or a relation between spans. */
export const STRUCTURAL_AXION_ATTRIBUTES = [
  'axion.mission.id', 'axion.task.status', 'axion.attempt.result', 'axion.instance.manager_id', 'axion.export.unmapped_steps',
  'axion.export.include_content', 'axion.export.semconv_repository', 'axion.export.semconv_tag', 'axion.export.semconv_commit', 'axion.export.semconv_status',
  'axion.step.input', 'axion.step.output', // the inline text of a plan step (a tool step uses the spec's gen_ai.tool.call.* attributes), only with --include-content
] as const;

/** The text of web/docs/improve/phase2/otel-mapping.md. Run `npx tsx src/otel/write-mapping-doc.ts` after editing the table. */
export function renderMappingMarkdown(): string {
  const spec = OTEL_GENAI_SPEC;
  const L: string[] = [];
  L.push('# AXION to OpenTelemetry GenAI mapping (c60, R2-8)', '');
  L.push('<!-- Generated from server/src/otel/mapping.ts by `npx tsx src/otel/write-mapping-doc.ts`; server/test/otel-mapping.test.ts fails if this file and the table differ. Do not edit by hand. -->', '');
  L.push('## Pinned specification', '');
  L.push(`The OpenTelemetry GenAI agent conventions are in **${spec.status}** status: names and attributes can change without notice. This mapping is therefore written against one exact version:`, '');
  L.push(`- Repository: ${spec.repository} (the GenAI conventions moved there from open-telemetry/semantic-conventions; the old \`docs/gen-ai\` pages at v1.45.0 are "Moved" stubs).`);
  L.push(`- Tag \`${spec.tag}\`, commit \`${spec.commit}\`, fetched ${spec.fetchedOn}.`);
  for (const [path, p] of Object.entries(spec.pages)) L.push(`- Page \`${path}\`, SHA-256 \`${p.sha256}\` (verbatim copy in web/docs/improve/phase2/otel-spec-v0.1.0/).`);
  L.push('', 'Evidence level: the spec is a convention that other tools read, not evidence that traces help. AXION exports to it so that an outside viewer can open the records; B5 (full traces matter for failure attribution) supports recording full traces, not OpenTelemetry in particular. Task states of the A2A page are vocabulary only and are not used.', '');
  L.push('## What is exported', '');
  L.push('`npm run export:otlp -- <missionId>` (server, no route) writes one OTLP-JSON file for one mission from stored records. No network, no collector. Spans, all kind INTERNAL, all validated against the pinned attribute lists:', '');
  L.push(`- \`axion.mission\`: one root span per mission (an AXION extension span with only \`axion.*\` attributes and the mission-level failure events).`);
  L.push(`- \`${PINNED_SPANS.invoke_agent.nameFormat}\` (operation \`invoke_agent\`): one per agent instance, one per task and one per task attempt; without an agent name the span is just \`invoke_agent\`.`);
  L.push(`- \`${PINNED_SPANS.plan.nameFormat}\` and \`${PINNED_SPANS.execute_tool.nameFormat}\`: one per stored trace step of kind "plan" or "tool" of the evaluation results linked to the mission.`);
  L.push('', '**Content is off by default.** Text that a person or an agent wrote (task titles and criteria, instance labels, failure notes, step input, output and error text) is replaced by a `_ref` pointer of the form `axion://table/id#field`. `--include-content` writes the text instead, into the Opt-In attributes of the spec where one exists and into `axion.*` attributes otherwise. The default export contains none of the Opt-In attributes (tested against the pinned list and against sentinel text).', '');
  L.push('Not used on purpose: `gen_ai.provider.name`, `gen_ai.request.*`, `gen_ai.usage.*` and `gen_ai.response.*` (AXION agents do not execute and no model call is recorded, so nothing is claimed), and `gen_ai.agent.id` / `gen_ai.agent.version` (not part of the internal invoke_agent span; the extension attributes `axion.agent.id` and `axion.agent.version_id` carry them).', '');
  L.push('## Field table', '');
  const groups = [...MAPPED_TABLES.map((t) => [t, Object.keys(FIELD_MAP).filter((k) => k.startsWith(`${t}.`) && !k.includes('.trace.steps[]'))] as const), ['eval_results.trace.steps[]', Object.keys(FIELD_MAP).filter((k) => k.includes('.trace.steps[]'))] as const];
  for (const [g, keys] of groups) {
    L.push(`### ${g}`, '', '| AXION field | OpenTelemetry target | Default export of content | Note |', '|---|---|---|---|');
    for (const k of keys) {
      const f = FIELD_MAP[k];
      const content = f.content ? `\`${f.content.refKey}\` (text in \`${f.content.inlineKey}\` only with --include-content)` : '';
      L.push(`| \`${k}\` | ${targetText(f.to)} | ${cell(content)} | ${cell(f.note)} |`);
    }
    L.push('');
  }
  const n = Object.keys(FIELD_MAP).length, none_ = Object.values(FIELD_MAP).filter((f) => f.to.kind === 'none').length, g_ = Object.values(FIELD_MAP).filter((f) => f.to.kind === 'gen_ai').length;
  L.push('## Attributes that belong to no column', '', 'These describe the export itself (resource attributes, with the pinned version) a relation between spans, or the inline text of a plan step (with --include-content): ' + STRUCTURAL_AXION_ATTRIBUTES.map((a) => `\`${a}\``).join(', ') + '.', '');
  L.push('## Counts', '', `${n} AXION fields listed; ${g_} map to a pinned GenAI attribute; ${none_} have no equivalent and are not exported; the rest map to a span property or an \`axion.*\` extension attribute.`, '');
  return L.join('\n');
}
