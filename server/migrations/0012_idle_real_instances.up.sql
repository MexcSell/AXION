-- Stage 6 final review I3: nothing executes yet, so an instance of a real (non-simulated) mission is idle, never "working".
-- Corrects rows written by the Stage 6 staffing and backfill; demo (simulated) instances keep their fixture states.
update agent_instances set state = 'idle', task_label = 'Staffed, waits for execution', progress = 0
 where simulated = false and state = 'working';
