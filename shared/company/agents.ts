/** Initial configuration for the company's agents. Existing agent definitions and versions retain their settings. */
interface CompanyAgent {
  id: string;
  name: string;
  role: string;
  dept: string;
  duty: string;
  managerId?: string;
  parentId?: string;
  site?: string;
  description: string;
  version: string;
  model: string;
  skills: string[];
}

export const COMPANY_AGENTS: CompanyAgent[] = [
  {
    id: "gm", name: "GM", role: "manager", dept: "Executive",
    duty: "General Manager",
    description: "Orchestrates the company: breaks missions into plans, assigns agents and reports outcomes to the Owner.",
    version: "v3.2.0", model: "claude-opus-5-5", skills: ["Planning", "Delegation", "Prioritization", "Reporting"],
  },
  {
    id: "researcher-01", name: "Researcher-01", role: "research", dept: "R&D",
    duty: "Research", managerId: "gm",
    description: "Gathers sources, verifies claims and produces cited research briefs.",
    version: "v2.4.0", model: "claude-opus-5-5", skills: ["Web research", "Citation", "Synthesis", "Fact-check"],
  },
  {
    id: "analyst-01", name: "Analyst-01", role: "analytics", dept: "R&D",
    duty: "Analytics", managerId: "gm",
    description: "Turns raw data into insight: metrics, trends, forecasts and dashboards.",
    version: "v2.4.0", model: "claude-sonnet-5-5", skills: ["SQL", "Forecasting", "Dashboards", "Statistics"],
  },
  {
    id: "coder-01", name: "Coder-01", role: "dev", dept: "Engineering",
    duty: "Software development (Developer)", managerId: "gm",
    description: "Builds and maintains code: components, services and automated tests.",
    version: "v2.4.0", model: "claude-haiku-5-5", skills: ["TypeScript", "React", "Node.js", "Testing"],
  },
  {
    id: "ops-01", name: "Ops-01", role: "ops", dept: "Operations",
    duty: "Operations", managerId: "gm",
    description: "Keeps services healthy: monitoring, runbooks, scheduled jobs and incident response.",
    version: "v2.3.9", model: "local/llama-4-70b", skills: ["Runbooks", "Monitoring", "systemd", "Incidents"],
  },
  {
    id: "security-01", name: "Security-01", role: "security", dept: "Governance",
    duty: "Security", managerId: "gm",
    description: "Guards permissions, secrets and policy; reviews risky actions before they run.",
    version: "v2.4.0", model: "claude-fable-5-2", skills: ["Threat model", "Secrets", "Policy", "Audit"],
  },
  {
    id: "comms-01", name: "Comms-01", role: "comms", dept: "Operations",
    duty: "Communication", managerId: "gm",
    description: "Writes clear messages, summaries and translations for humans and agents.",
    version: "v2.3.8", model: "claude-opus-5-5", skills: ["Copywriting", "Summaries", "Translation", "Tone"],
  },
  {
    id: "planner-01", name: "Planner-01", role: "planning", dept: "Operations",
    duty: "Planning", managerId: "gm",
    description: "Schedules work, maps dependencies and keeps missions on their critical path.",
    version: "v2.4.0", model: "claude-sonnet-5-5", skills: ["Roadmaps", "Scheduling", "Dependencies", "Risk"],
  },
  {
    id: "loader-01", name: "Loader-01", role: "loader", dept: "Operations",
    duty: "Model loading & selection", managerId: "gm",
    description: "Selects and loads the right model for every agent and task, balancing quality, speed and host capacity (CPU, RAM, VRAM).",
    version: "v2.3.9", model: "claude-haiku-5-5", skills: ["Model fit", "Routing", "Load balancing", "Benchmarks"],
  },
  {
    id: "knowledge-01", name: "Knowledge-01", role: "knowledge", dept: "Knowledge",
    duty: "Knowledge curation", managerId: "gm",
    description: "Curates verified lessons, documents and embeddings for reuse.",
    version: "v2.4.0", model: "local/llama-4-70b", skills: ["Indexing", "Embeddings", "Dedup", "Curation"],
  },
  {
    id: "optimizer-01", name: "Optimizer-01", role: "optimize", dept: "R&D",
    duty: "Optimization", managerId: "gm",
    description: "Measures and improves agent prompts, recipes and token/latency trade-offs.",
    version: "v2.4.0", model: "claude-fable-5-2", skills: ["Profiling", "Prompt tuning", "Caching", "A/B"],
  },
  {
    id: "tester-01", name: "Tester-01", role: "qa", dept: "QA",
    duty: "QA / Testing", managerId: "gm",
    description: "Independently verifies outputs with acceptance tests and evidence.",
    version: "v2.3.9", model: "claude-opus-5-5", skills: ["E2E tests", "Acceptance", "Visual diff", "Regression"],
  },
  {
    id: "integrator-01", name: "Integrator-01", role: "integration", dept: "Engineering",
    duty: "Integration", managerId: "gm",
    description: "Connects external tools: GitHub, APIs, webhooks and providers.",
    version: "v2.4.0", model: "claude-sonnet-5-5", skills: ["APIs", "Webhooks", "GitHub", "OAuth"],
  },
  {
    id: "browser-01", name: "Browser-01", role: "browser", dept: "Engineering",
    duty: "Browser operation", managerId: "gm",
    description: "Operates managed Playwright browsers inside granted website origins.",
    version: "v2.4.0", model: "claude-haiku-5-5", skills: ["Playwright", "Locators", "Forms", "Screenshots"],
  },
  {
    id: "designer-01", name: "Designer-01", role: "design", dept: "Engineering",
    duty: "Design", managerId: "gm",
    description: "Designs interfaces, tokens and motion; keeps UI accessible.",
    version: "v2.4.0", model: "local/llama-4-70b", skills: ["UI design", "Accessibility", "Motion", "Design tokens"],
  },
  {
    id: "writer-01", name: "Writer-01", role: "writer", dept: "Operations",
    duty: "Writing", managerId: "gm",
    description: "Drafts documentation, release notes and on-page copy.",
    version: "v2.3.9", model: "claude-fable-5-2", skills: ["Docs", "Release notes", "UX copy", "Editing"],
  },
  {
    id: "mentor-01", name: "Mentor-01", role: "mentor", dept: "QA",
    duty: "Mentoring", managerId: "gm",
    description: "Coaches agents with targeted exercises and before/after evaluation.",
    version: "v2.4.0", model: "claude-opus-5-5", skills: ["Coaching", "Rubrics", "Exercises", "Review"],
  },
  {
    id: "release-01", name: "Release-01", role: "release", dept: "Operations",
    duty: "Release", managerId: "gm",
    description: "Packages versions, runs canaries and owns rollback readiness.",
    version: "v2.4.0", model: "claude-sonnet-5-5", skills: ["Versioning", "Canary", "Rollback", "Changelog"],
  },
  {
    id: "mobile-dev-01", name: "Mobile-Dev-01", role: "dev", dept: "Engineering",
    duty: "Mobile app development (iOS, Android)", managerId: "coder-01", parentId: "coder-01",
    description: "Mobile app development (iOS, Android). Derived from Coder-01: keeps specialised experience, shares general lessons upward.",
    version: "v1.3.0", model: "claude-sonnet-5-5", skills: ["Swift", "Kotlin", "React Native", "Offline sync"],
  },
  {
    id: "web-dev-01", name: "Web-Dev-01", role: "dev", dept: "Engineering",
    duty: "Website development lead", managerId: "coder-01", parentId: "coder-01",
    description: "Website development lead. Derived from Coder-01: keeps specialised experience, shares general lessons upward.",
    version: "v1.1.0", model: "claude-sonnet-5-5", skills: ["Next.js", "CSS", "SEO", "Accessibility"],
  },
  {
    id: "homepage-01", name: "Homepage-01", role: "browser", dept: "Engineering",
    duty: "Homepage control & autopilot", managerId: "browser-01", parentId: "browser-01",
    description: "Homepage control & autopilot. Derived from Browser-01: keeps specialised experience, shares general lessons upward.",
    version: "v1.0.0", model: "claude-haiku-5-5", skills: ["Site flows", "Locators", "Forms", "Rate limits"],
  },
  {
    id: "site-upwork", name: "Site-Upwork", role: "browser", dept: "Engineering",
    duty: "Autopilot for upwork.com", managerId: "homepage-01", parentId: "homepage-01", site: "upwork.com",
    description: "Autopilot for upwork.com. Derived from Homepage-01: keeps specialised experience, shares general lessons upward.",
    version: "v1.1.0", model: "claude-haiku-5-5", skills: ["Site flows", "Locators", "Forms", "Rate limits"],
  },
  {
    id: "site-freelancer", name: "Site-Freelancer", role: "browser", dept: "Engineering",
    duty: "Autopilot for freelancer.com", managerId: "homepage-01", parentId: "homepage-01", site: "freelancer.com",
    description: "Autopilot for freelancer.com. Derived from Homepage-01: keeps specialised experience, shares general lessons upward.",
    version: "v1.0.0", model: "claude-haiku-5-5", skills: ["Site flows", "Locators", "Forms", "Rate limits"],
  },
  {
    id: "site-wanted", name: "Site-Wanted", role: "browser", dept: "Engineering",
    duty: "Autopilot for wanted.co.kr", managerId: "homepage-01", parentId: "homepage-01", site: "wanted.co.kr",
    description: "Autopilot for wanted.co.kr. Derived from Homepage-01: keeps specialised experience, shares general lessons upward.",
    version: "v1.0.0", model: "claude-haiku-5-5", skills: ["Site flows", "Locators", "Forms", "Rate limits"],
  },
];

export const COMPANY_AGENT_BY_ID: Record<string, CompanyAgent> = Object.fromEntries(COMPANY_AGENTS.map(a => [a.id, a]));
