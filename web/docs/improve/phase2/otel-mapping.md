# AXION to OpenTelemetry GenAI mapping (c60, R2-8)

<!-- Generated from server/src/otel/mapping.ts by `npx tsx src/otel/write-mapping-doc.ts`; server/test/otel-mapping.test.ts fails if this file and the table differ. Do not edit by hand. -->

## Pinned specification

The OpenTelemetry GenAI agent conventions are in **Development** status: names and attributes can change without notice. This mapping is therefore written against one exact version:

- Repository: https://github.com/open-telemetry/semantic-conventions-genai (the GenAI conventions moved there from open-telemetry/semantic-conventions; the old `docs/gen-ai` pages at v1.45.0 are "Moved" stubs).
- Tag `v0.1.0`, commit `d0e74ba6c48bcc4ded473b1828a8212f06b23753`, fetched 2026-11-22.
- Page `docs/gen-ai/gen-ai-agent-spans.md`, SHA-256 `0d2db04dd642e52c73eadf7b05b3ae1586d6ab99462c94a9c31e5cebff0e01ff` (verbatim copy in web/docs/improve/phase2/otel-spec-v0.1.0/).
- Page `docs/gen-ai/execute-tool.md`, SHA-256 `7a72f0d602c6d023944d1e43f54caba53b4eeb2987ac46f6c272746d526d15f3` (verbatim copy in web/docs/improve/phase2/otel-spec-v0.1.0/).

Evidence level: the spec is a convention that other tools read, not evidence that traces help. AXION exports to it so that an outside viewer can open the records; B5 (full traces matter for failure attribution) supports recording full traces, not OpenTelemetry in particular. Task states of the A2A page are vocabulary only and are not used.

## What is exported

`npm run export:otlp -- <missionId>` (server, no route) writes one OTLP-JSON file for one mission from stored records. No network, no collector. Spans, all kind INTERNAL, all validated against the pinned attribute lists:

- `axion.mission`: one root span per mission (an AXION extension span with only `axion.*` attributes and the mission-level failure events).
- `{gen_ai.operation.name} {gen_ai.agent.name}` (operation `invoke_agent`): one per agent instance, one per task and one per task attempt; without an agent name the span is just `invoke_agent`.
- `plan {gen_ai.agent.name}` and `execute_tool {gen_ai.tool.name}`: one per stored trace step of kind "plan" or "tool" of the evaluation results linked to the mission.

**Content is off by default.** Text that a person or an agent wrote (task titles and criteria, instance labels, failure notes, step input, output and error text) is replaced by a `_ref` pointer of the form `axion://table/id#field`. `--include-content` writes the text instead, into the Opt-In attributes of the spec where one exists and into `axion.*` attributes otherwise. The default export contains none of the Opt-In attributes (tested against the pinned list and against sentinel text).

Not used on purpose: `gen_ai.provider.name`, `gen_ai.request.*`, `gen_ai.usage.*` and `gen_ai.response.*` (AXION agents do not execute and no model call is recorded, so nothing is claimed), and `gen_ai.agent.id` / `gen_ai.agent.version` (not part of the internal invoke_agent span; the extension attributes `axion.agent.id` and `axion.agent.version_id` carry them).

## Field table

### tasks

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `tasks.id` | `axion.task.id` (AXION extension) |  | The pinned spec has no task identifier; a task is not an agent, a tool or a conversation. |
| `tasks.tenant_id` | **no equivalent** |  | internal scope or bookkeeping of AXION; an outside viewer has no use for it. Exports are per mission and per tenant. |
| `tasks.mission_id` | `gen_ai.conversation.id` (pinned GenAI attribute) |  | Closest equivalent: the spec calls it the identifier of a conversation (session, thread). A mission is a work session, not a chat. Also written as resource attribute axion.mission.id. |
| `tasks.run_id` | `axion.task.run_id` (AXION extension) |  | No equivalent for a mission run. |
| `tasks.title` | `axion.task.title_ref` (AXION extension) | `axion.task.title_ref` (text in `axion.task.title` only with --include-content) | Text a person wrote: content. Pointer by default. |
| `tasks.status` | span status |  | failed becomes span status ERROR with error.type "task_failed"; every other status is only in axion.task.status. The error message is never exported. |
| `tasks.owner_agent` | `axion.task.owner_agent_ref` (AXION extension) | `axion.task.owner_agent_ref` (text in `axion.task.owner_agent` only with --include-content) | A free-text owner label: content. Pointer by default. The span name uses the (sanitised) name of the owner instance's agent definition when there is one. |
| `tasks.created_at` | span start time |  | Start time of the task span. |
| `tasks.owner_instance_id` | span parent |  | The task span is a child of the span of the owning agent instance; without an owner it is a child of the mission span. |
| `tasks.weight` | `axion.task.weight` (AXION extension) |  | No equivalent: the spec has no notion of a weighted task. |
| `tasks.criteria` | `axion.task.criteria_ref` (AXION extension) | `axion.task.criteria_ref` (text in `axion.task.criteria` only with --include-content) | Acceptance criteria a person wrote: content. Pointer by default. |
| `tasks.evidence` | `axion.task.evidence_count` (AXION extension) |  | A count of evidence items; no equivalent. |
| `tasks.col` | **no equivalent** |  | Position on the board; display only. |
| `tasks.row` | **no equivalent** |  | Position on the board; display only. |
| `tasks.simulated` | `axion.simulated` (AXION extension) |  | AXION marks fixture work as simulated; an outside viewer must be able to tell. |

### task_attempts

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `task_attempts.id` | `axion.attempt.id` (AXION extension) |  | No equivalent for an attempt number space. |
| `task_attempts.task_id` | span parent |  | The attempt span is a child of its task span. |
| `task_attempts.attempt_no` | `axion.attempt.no` (AXION extension) |  | No equivalent. |
| `task_attempts.started_at` | span start time |  | Start time of the attempt span (the task's start when the attempt has none yet). |
| `task_attempts.finished_at` | span end time |  | End time of the attempt span. |
| `task_attempts.result` | span status |  | failed becomes span status ERROR with error.type "attempt_failed"; the value is also in axion.attempt.result. |
| `task_attempts.evidence_ref` | `axion.attempt.evidence_ref_ref` (AXION extension) | `axion.attempt.evidence_ref_ref` (text in `axion.attempt.evidence_ref` only with --include-content) | Caller-supplied text (AXION does not check that it is a pointer): content. Pointer to the field by default. |

### task_dependencies

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `task_dependencies.task_id` | **no equivalent** |  | Span links are not part of the pinned GenAI pages; the dependency graph is not exported. |
| `task_dependencies.depends_on` | **no equivalent** |  | Span links are not part of the pinned GenAI pages; the dependency graph is not exported. |

### agent_instances

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `agent_instances.seq` | **no equivalent** |  | internal scope or bookkeeping of AXION; an outside viewer has no use for it |
| `agent_instances.id` | `axion.instance.id` (AXION extension) |  | The spec advises against in-memory instance ids on gen_ai.agent.id, and the internal invoke_agent span has no agent id attribute at all. |
| `agent_instances.tenant_id` | **no equivalent** |  | internal scope or bookkeeping of AXION; an outside viewer has no use for it |
| `agent_instances.mission_id` | `gen_ai.conversation.id` (pinned GenAI attribute) |  | See tasks.mission_id. |
| `agent_instances.run_id` | `axion.instance.run_id` (AXION extension) |  | No equivalent for a mission run. |
| `agent_instances.agent_id` | `axion.agent.id` (AXION extension) |  | The pinned gen_ai.agent.id belongs to the create-agent and client invoke-agent spans, not to the internal invoke_agent span AXION emits, so the extension attribute is used. The agent's name is exported as gen_ai.agent.name, sanitised: only letters, digits, spaces and . _ : - (at most 64 characters, not shaped like a key) pass, otherwise "_OTHER"; the raw name is axion.agent.name_raw only with --include-content. |
| `agent_instances.agent_version_id` | `axion.agent.version_id` (AXION extension) |  | Same reason: gen_ai.agent.version is not on the internal invoke_agent span. |
| `agent_instances.manager_instance_id` | span parent |  | The span of a managed instance could be a child of its manager's; AXION keeps all instances under the mission span and records the manager in axion.instance.manager_id. |
| `agent_instances.state` | `axion.instance.state` (AXION extension) |  | No equivalent. |
| `agent_instances.task_label` | `axion.instance.task_label_ref` (AXION extension) | `axion.instance.task_label_ref` (text in `axion.instance.task_label` only with --include-content) | Text shown on the instance card: content. Pointer by default. |
| `agent_instances.progress` | **no equivalent** |  | A display percentage, not a measurement. |
| `agent_instances.task_count` | **no equivalent** |  | A display count (a fixture value on demo missions). |
| `agent_instances.pending` | **no equivalent** |  | A display count. |
| `agent_instances.simulated` | `axion.simulated` (AXION extension) |  | See tasks.simulated. |
| `agent_instances.created_at` | span start time |  | Start time of the instance span. |
| `agent_instances.ended_at` | span end time |  | End time of the instance span (the latest end of its children when it is still open). |

### mission_runs

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `mission_runs.id` | `axion.task.run_id` (AXION extension) |  | A run has no span; its id is carried on the tasks and instances of the run. |
| `mission_runs.mission_id` | `gen_ai.conversation.id` (pinned GenAI attribute) |  | See tasks.mission_id. |
| `mission_runs.revision` | **no equivalent** |  | The mission text revision a run started from; no equivalent. |
| `mission_runs.status` | **no equivalent** |  | A run has no span, so its status has nowhere to go. |
| `mission_runs.execution` | **no equivalent** |  | AXION's execution mode (disabled, simulated); no equivalent, and the export never claims that anything executed. |
| `mission_runs.started_at` | **no equivalent** |  | A run has no span. |
| `mission_runs.ended_at` | **no equivalent** |  | A run has no span. |

### eval_runs

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `eval_runs.id` | `axion.eval.run_id` (AXION extension) |  | No equivalent for an evaluation run. |
| `eval_runs.tenant_id` | **no equivalent** |  | internal scope or bookkeeping of AXION; an outside viewer has no use for it |
| `eval_runs.dataset_id` | `axion.eval.dataset_id` (AXION extension) |  | No equivalent for an evaluation dataset. Only a plain identifier is exported (otherwise "_OTHER"). |
| `eval_runs.subject_version_id` | `axion.agent.version_id` (AXION extension) |  | The agent version under evaluation. It also decides which evaluation results belong to a mission: those whose subject version is pinned by one of the mission's agent instances. |
| `eval_runs.subject_proposal_id` | `axion.eval.subject_proposal_id` (AXION extension) |  | A run evaluates either a version or a version proposal (exactly one). Results of proposal runs have no pinned version, so they are not linked to a mission and are not exported. |
| `eval_runs.judge_model_family` | `axion.eval.judge_model_family` (AXION extension) |  | A family label of the judge (plain identifier only, otherwise "_OTHER"), not a model name; gen_ai.request.model is not used because no model call is recorded. |
| `eval_runs.evaluator_id` | **no equivalent** |  | A person's or agent's identity is not exported. |
| `eval_runs.k` | `axion.eval.k` (AXION extension) |  | No equivalent. |
| `eval_runs.grader_name` | **no equivalent** |  | Who graded a run (c61, an instrument record). The spec has no attribute for a grader and it is not part of the agent's behaviour, so it is not exported. |
| `eval_runs.grader_version` | **no equivalent** |  | The version of the grader that graded a run (c61); not exported, see eval_runs.grader_name. |
| `eval_runs.holdout_key` | **no equivalent** |  | An internal uniqueness key (c53) that makes a holdout count once. It names no behaviour of the agent and is not exported. |
| `eval_runs.started_at` | **no equivalent** |  | A run has no span of its own; the span of a result starts at the result's recorded time. |
| `eval_runs.finished_at` | **no equivalent** |  | A run has no span of its own. |

### eval_results

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `eval_results.run_id` | `axion.eval.run_id` (AXION extension) |  | See eval_runs.id. |
| `eval_results.case_id` | `axion.eval.case_id` (AXION extension) |  | No equivalent. Written by a dataset author, so only a plain identifier is exported (otherwise "_OTHER"). |
| `eval_results.attempt` | `axion.eval.attempt` (AXION extension) |  | No equivalent. |
| `eval_results.score` | `axion.eval.score` (AXION extension) |  | The spec has no score for an agent result. |
| `eval_results.ungraded_reason` | **no equivalent** |  | Why a result has no score (c61: grader timeout, error, unparseable output and so on). An instrument record, not an agent attribute, so it is not exported. |
| `eval_results.cost_units` | `axion.eval.cost_units` (AXION extension) |  | AXION cost units are not tokens; gen_ai.usage.* attributes are not used so that nothing implies a token count. |
| `eval_results.trace` | span event |  | Each step of trace.steps[] becomes a child span; see the step rows below. Steps with an unknown kind are counted in axion.export.unmapped_steps on the result span, never dropped silently. |
| `eval_results.recorded_at` | span start time |  | Start time of the result span when a step has no time of its own. |

### failure_tags

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `failure_tags.id` | `axion.failure.tag_id` (AXION extension) |  | No equivalent: the spec has no failure taxonomy. Exported as an event "axion.failure_tag" on the span of the tagged task or attempt (on the mission span for a mission or message). |
| `failure_tags.tenant_id` | **no equivalent** |  | internal scope or bookkeeping of AXION; an outside viewer has no use for it |
| `failure_tags.mission_id` | `gen_ai.conversation.id` (pinned GenAI attribute) |  | See tasks.mission_id. |
| `failure_tags.subject_kind` | `axion.failure.subject_kind` (AXION extension) |  | No equivalent. |
| `failure_tags.subject_id` | span parent |  | Decides which span carries the event. |
| `failure_tags.taxonomy_version` | `axion.failure.taxonomy_version` (AXION extension) |  | No equivalent (MAST, arXiv 2503.13657v3). |
| `failure_tags.mode_id` | `axion.failure.mode_id` (AXION extension) |  | No equivalent. |
| `failure_tags.note` | `axion.failure.note_ref` (AXION extension) | `axion.failure.note_ref` (text in `axion.failure.note` only with --include-content) | Text a person wrote: content. Pointer by default. |
| `failure_tags.tagged_by` | **no equivalent** |  | A person's or instance's identity is not exported; only the kind is. |
| `failure_tags.tagged_by_kind` | `axion.failure.tagged_by_kind` (AXION extension) |  | No equivalent. |
| `failure_tags.status` | `axion.failure.status` (AXION extension) |  | proposed, confirmed or rejected; no equivalent. |
| `failure_tags.created_at` | span event |  | The event time. |
| `failure_tags.decided_by` | **no equivalent** |  | A person's identity is not exported. |
| `failure_tags.decided_at` | **no equivalent** |  | Not exported; the status carries the outcome. |
| `failure_tags.self_confirmed` | `axion.failure.self_confirmed` (AXION extension) |  | No equivalent. |
| `failure_tags.detection_channel` | `axion.failure.detection_channel` (AXION extension) |  | No equivalent. A fixed list of five values (c63), so it is not free text. Only present when the tagger gave one. |
| `failure_tags.detected_after_seconds` | `axion.failure.detected_after_seconds` (AXION extension) |  | No equivalent. Database now() minus the stored failure time at tag time (c63); only present when computed. |
| `failure_tags.mechanism` | `axion.failure.mechanism` (AXION extension) |  | No equivalent. A fixed list (c63), not free text. |
| `failure_tags.control_expected` | `axion.failure.control_expected` (AXION extension) |  | No equivalent. A fixed list (c63), not free text. |
| `failure_tags.control_caught` | `axion.failure.control_caught` (AXION extension) |  | No equivalent. A fixed list (c63), not free text. |
| `failure_tags.detection_note` | `axion.failure.detection_note_ref` (AXION extension) | `axion.failure.detection_note_ref` (text in `axion.failure.detection_note` only with --include-content) | Text a person wrote: content. Pointer by default. |

### failure_attributions

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `failure_attributions.id` | `axion.failure.attribution_id` (AXION extension) |  | No equivalent. Exported as an event "axion.failure_attribution" next to the tag event. |
| `failure_attributions.tenant_id` | **no equivalent** |  | internal scope or bookkeeping of AXION; an outside viewer has no use for it |
| `failure_attributions.tag_id` | `axion.failure.tag_id` (AXION extension) |  | Links the attribution event to its tag event. |
| `failure_attributions.mission_id` | `gen_ai.conversation.id` (pinned GenAI attribute) |  | See tasks.mission_id. |
| `failure_attributions.agent_id` | `axion.failure.attributed_agent_id_ref` (AXION extension) | `axion.failure.attributed_agent_id_ref` (text in `axion.failure.attributed_agent_id` only with --include-content) | A claim about which agent the failure came from, free text written by the attributor: content. Pointer by default. Not gen_ai.agent.id: that names the agent of the span, and this is somebody's claim. |
| `failure_attributions.step_ref` | `axion.failure.attributed_step_ref_ref` (AXION extension) | `axion.failure.attributed_step_ref_ref` (text in `axion.failure.attributed_step_ref` only with --include-content) | A claim about which step. A free-text reference, not checked against stored traces: content. Pointer by default. |
| `failure_attributions.full_trace_available` | `axion.failure.full_trace_available` (AXION extension) |  | The attributor's claim that the whole trace exists for checking. |
| `failure_attributions.attributed_by` | **no equivalent** |  | A person's identity is not exported; only the kind is. |
| `failure_attributions.attributed_by_kind` | `axion.failure.attributed_by_kind` (AXION extension) |  | No equivalent. |
| `failure_attributions.created_at` | span event |  | The event time. |

### eval_results.trace.steps[]

| AXION field | OpenTelemetry target | Default export of content | Note |
|---|---|---|---|
| `eval_results.trace.steps[].kind` | span name |  | "tool" becomes an execute_tool span, "plan" a plan span; any other value is not mapped. |
| `eval_results.trace.steps[].name` | `gen_ai.tool.name` (pinned GenAI attribute) | `axion.step.tool_name_ref` (text in `axion.step.tool_name` only with --include-content) | The tool name of an execute_tool span (Required by the spec; a tool step without a name is counted as unmapped). Not used for a plan step. The name is untrusted text: only a plain identifier (a letter, then letters, digits, "_" or ".", at most 48 characters, and not shaped like a key or token) is exported, in the span name and in gen_ai.tool.name; anything else becomes "_OTHER". The raw name is axion.step.tool_name only with --include-content (pointer axion.step.tool_name_ref by default). |
| `eval_results.trace.steps[].input` | `axion.step.input_ref` (AXION extension) | `axion.step.input_ref` (text in `gen_ai.tool.call.arguments` only with --include-content) | Content. Opt-In in the spec, and the spec has no _ref form for tool arguments, so the pointer uses AXION's axion.step.input_ref and the text uses gen_ai.tool.call.arguments (tool steps) or axion.step.input (plan steps) only with --include-content. |
| `eval_results.trace.steps[].output` | `axion.step.output_ref` (AXION extension) | `axion.step.output_ref` (text in `gen_ai.tool.call.result` only with --include-content) | Content. Opt-In in the spec; same pointer rule as input (gen_ai.tool.call.result with --include-content for tool steps, axion.step.output for plan steps). |
| `eval_results.trace.steps[].error` | `error.type` (pinned GenAI attribute) | `axion.step.error_ref` (text in `axion.step.error` only with --include-content) | error.type comes from a fixed vocabulary only (timeout, rate_limit, not_found, permission_denied, invalid_input, unavailable, cancelled, internal_error); any other value becomes "_OTHER", the OpenTelemetry convention for an unknown value. The message text is content: axion.step.error_ref by default. |
| `eval_results.trace.steps[].startMs` | span start time |  | Milliseconds since the epoch; optional. |
| `eval_results.trace.steps[].endMs` | span end time |  | Milliseconds since the epoch; optional. |

## Attributes that belong to no column

These describe the export itself (resource attributes, with the pinned version) a relation between spans, or the inline text of a plan step or the raw agent name (with --include-content): `axion.mission.id`, `axion.task.status`, `axion.attempt.result`, `axion.instance.manager_id`, `axion.export.unmapped_steps`, `axion.export.linked_by`, `axion.export.include_content`, `axion.export.semconv_repository`, `axion.export.semconv_tag`, `axion.export.semconv_commit`, `axion.export.semconv_status`, `axion.agent.name_raw`, `axion.step.input`, `axion.step.output`.

## Counts

106 AXION fields listed; 7 map to a pinned GenAI attribute; 29 have no equivalent and are not exported; the rest map to a span property or an `axion.*` extension attribute.
