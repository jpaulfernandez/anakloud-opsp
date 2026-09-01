// Central OPSP Seed & Registry (OPSP Feature §1 & §2)
//
// Single source of truth for static cell definitions, initial plan values,
// team survey answers from the baseline cohort, and facilitator notes.
// All values are plain strings (no coerced/parsed numbers per §1.1).

export type CellKind =
  | "text"      // one paragraph
  | "list"      // ordered short items
  | "metrics"   // labeled numeric/text rows
  | "date"      // single date or free-text period
  | "table"     // typed columns, variable rows
  | "pair";     // exactly two labeled slots

export type Column =
  | "swot"
  | "values"
  | "purpose"
  | "targets"
  | "goals"
  | "actions"
  | "theme"
  | "accountability";

export interface CellDef {
  id: string;                // e.g. 'T35-5'
  column: Column;
  label: string;             // e.g. 'Key Thrusts / Capabilities'
  helper?: string;           // one line shown in edit view only
  kind: CellKind;
  maxRows?: number;          // soft cap guidance (e.g. 3 or 5)
  columns?: string[];        // for kind 'table'
  rowLabels?: string[];      // for kind 'metrics'
  sourceQuestion?: string;   // e.g. 'Q8 — Door-opener ranking & kill list'
}

export interface CellValue {
  cellId: string;
  content: unknown;          // shape depends on kind (see content shapes below)
  updatedAt: string;
  updatedBy: string;
}

export interface SurveyAnswer {
  cellId: string;
  person: string;            // e.g. 'Ana Reyes'
  answer: string;
  confidence?: number;       // 1-5
  meta?: Record<string, string>; // e.g. { target: '300', unit: 'paying centers' }
}

export interface FacilitatorNote {
  cellId: string;
  body: string;
}

export const COLUMN_ORDER: Column[] = [
  "swot",
  "values",
  "purpose",
  "targets",
  "goals",
  "actions",
  "theme",
  "accountability",
];

export const COLUMN_LABELS: Record<Column, { title: string; subtitle: string }> = {
  swot: { title: "SWOT", subtitle: "Strengths, Weaknesses, Trends" },
  values: { title: "Values", subtitle: "Should / Shouldn't" },
  purpose: { title: "Purpose", subtitle: "Why" },
  targets: { title: "Targets", subtitle: "3-5 Yrs / Where" },
  goals: { title: "Goals", subtitle: "1 Yr / What" },
  actions: { title: "Actions", subtitle: "Qtr / How" },
  theme: { title: "Theme", subtitle: "Who" },
  accountability: { title: "Accountability", subtitle: "Who / When" },
};

/**
 * The 33 cell registry, in exact document order (§2). Stable IDs.
 */
export const CELL_REGISTRY: readonly CellDef[] = [
  {
    id: "SWT-1",
    column: "swot",
    label: "Strengths / Core Competencies",
    helper: "Top capabilities that give Anakloud an unfair advantage",
    kind: "list",
    maxRows: 3,
  },
  {
    id: "SWT-2",
    column: "swot",
    label: "Weaknesses / Vulnerabilities",
    helper: "Internal vulnerabilities and mortality risks to watch",
    kind: "list",
    maxRows: 3,
    sourceQuestion: "Q13 — Pre-mortem",
  },
  {
    id: "SWT-3",
    column: "swot",
    label: "Trends",
    helper: "External tailwinds or regulatory shifts in pediatric therapy",
    kind: "list",
    maxRows: 3,
  },
  {
    id: "CV",
    column: "values",
    label: "Core Values",
    helper: "3-5 foundational operating behaviours extracted from stories",
    kind: "table",
    columns: ["Value", "We do", "We don't"],
    maxRows: 5,
    sourceQuestion: "Q15, Q9 — Stories & Guardrails",
  },
  {
    id: "PU-1",
    column: "purpose",
    label: "Purpose (Why)",
    helper: "Why Anakloud exists in 1-2 clear, memorable sentences",
    kind: "text",
    sourceQuestion: "Q1, Q2 — Why we exist & Who misses us",
  },
  {
    id: "PU-2",
    column: "purpose",
    label: "BHAG (10 yr)",
    helper: "10-year Big Hairy Audacious Goal — audacious and inspiring",
    kind: "text",
    sourceQuestion: "Q4 — Ten years, not three",
  },
  {
    id: "T35-1",
    column: "targets",
    label: "Future date",
    helper: "3-5 year target horizon (e.g. Q4 2029)",
    kind: "date",
  },
  {
    id: "T35-2",
    column: "targets",
    label: "3-yr key numbers",
    helper: "Core scale and financial metrics 3 years out",
    kind: "metrics",
    rowLabels: ["Paying centers", "Active children", "MRR", "Team size"],
    sourceQuestion: "Q3 — The number that would prove it worked",
  },
  {
    id: "T35-3",
    column: "targets",
    label: "Sandbox",
    helper: "Target customer, core segment, and geographic market boundary",
    kind: "text",
    sourceQuestion: "Q5, Q6, Q9 — Role grid & Core customer",
  },
  {
    id: "T35-3b",
    column: "targets",
    label: "Guardrails",
    helper: "Explicit refusals — what we deliberately will NOT do",
    kind: "list",
    maxRows: 5,
    sourceQuestion: "Q9 — Guardrails & Refusals",
  },
  {
    id: "T35-4",
    column: "targets",
    label: "Brand promises",
    helper: "Up to 3 customer-facing commitments with measurable KPIs",
    kind: "table",
    columns: ["Promise", "KPI"],
    maxRows: 3,
    sourceQuestion: "Q7 — Brand Promise",
  },
  {
    id: "T35-5",
    column: "targets",
    label: "Key thrusts / capabilities",
    helper: "Primary product and operational capabilities to lead with",
    kind: "list",
    maxRows: 5,
    sourceQuestion: "Q8 — Door-opener ranking & kill list",
  },
  {
    id: "T35-6",
    column: "targets",
    label: "Economic engine (profit per X)",
    helper: "The single economic unit that drives long-term profitability",
    kind: "pair",
    sourceQuestion: "Q10 — How the money works",
  },
  {
    id: "G1-1",
    column: "goals",
    label: "Year ending",
    helper: "1-year milestone date (e.g. 31 Dec 2027)",
    kind: "date",
  },
  {
    id: "G1-2",
    column: "goals",
    label: "1-yr key numbers",
    helper: "Targets for key business metrics at the 1-year mark",
    kind: "metrics",
    rowLabels: ["Paying centers", "Active children", "MRR", "Cash / runway"],
    sourceQuestion: "Q3, Q10 — Targets & First Peso",
  },
  {
    id: "G1-3",
    column: "goals",
    label: "Key initiatives (1 yr)",
    helper: "3-5 major company initiatives for the upcoming year",
    kind: "list",
    maxRows: 5,
    sourceQuestion: "Q11 — What must be done",
  },
  {
    id: "G1-4",
    column: "goals",
    label: "Critical Number #1",
    helper: "The single #1 operational metric that defines 1-year success",
    kind: "text",
    sourceQuestion: "Q3 — The number that would prove it worked",
  },
  {
    id: "G1-5",
    column: "goals",
    label: "Critical Number #2 (counter-balance)",
    helper: "Counter-balancing quality or risk metric preventing gaming",
    kind: "text",
    sourceQuestion: "Q13 — Risk & Pre-mortem",
  },
  {
    id: "A90-1",
    column: "actions",
    label: "Quarter ending",
    helper: "End date for the current 90-day execution cycle",
    kind: "date",
  },
  {
    id: "A90-2",
    column: "actions",
    label: "Quarterly key numbers",
    helper: "Expected metrics at the conclusion of the 90-day cycle",
    kind: "metrics",
    rowLabels: ["Paying centers", "Active children", "MRR", "Cash / runway"],
  },
  {
    id: "A90-3",
    column: "actions",
    label: "Rocks",
    helper: "Priority quarterly milestones with owners, done definitions and time",
    kind: "table",
    columns: ["Rock", "Owner", "Done-definition", "Hrs/wk"],
    maxRows: 5,
    sourceQuestion: "Q11 — What must be done by year-end",
  },
  {
    id: "A90-4",
    column: "actions",
    label: "Quarterly Critical # 1",
    helper: "Primary 90-day focus number that must be hit",
    kind: "text",
  },
  {
    id: "A90-5",
    column: "actions",
    label: "Quarterly Critical # 2",
    helper: "Counter-balance focus for the 90-day cycle",
    kind: "text",
  },
  {
    id: "TH-1",
    column: "theme",
    label: "Deadline",
    helper: "Date target for the quarterly rallying theme",
    kind: "date",
  },
  {
    id: "TH-2",
    column: "theme",
    label: "Measurable target",
    helper: "The single visible target that wins the theme",
    kind: "text",
  },
  {
    id: "TH-3",
    column: "theme",
    label: "Theme name",
    helper: "Memorable 3-5 word phrase people can repeat in huddles",
    kind: "text",
    sourceQuestion: "Q12 — Name the quarter",
  },
  {
    id: "TH-4",
    column: "theme",
    label: "Scoreboard design",
    helper: "How progress is tracked and displayed to the entire team",
    kind: "text",
  },
  {
    id: "TH-5",
    column: "theme",
    label: "Celebration",
    helper: "How the team marks achieving the theme milestone",
    kind: "text",
  },
  {
    id: "TH-6",
    column: "theme",
    label: "Reward",
    helper: "Tangible team reward upon reaching the theme target",
    kind: "text",
  },
  {
    id: "TH-7",
    column: "theme",
    label: "Between the green and the red",
    helper: "Clear boundaries defining healthy vs danger territory",
    kind: "pair",
    sourceQuestion: "Q13 — Pre-mortem & Risk",
  },
  {
    id: "AC-1",
    column: "accountability",
    label: "Individual KPIs (weekly)",
    helper: "Weekly measurable outputs owned by individual team members",
    kind: "table",
    columns: ["Person", "KPI 1", "KPI 2"],
    maxRows: 8,
    sourceQuestion: "Q14 — What you want to own",
  },
  {
    id: "AC-2",
    column: "accountability",
    label: "Individual quarterly priorities",
    helper: "Key deliverables and commitments per person this quarter",
    kind: "table",
    columns: ["Person", "Priority", "Due"],
    sourceQuestion: "Q14 — Ownership & Hours",
  },
];

export const CELL_REGISTRY_MAP: Record<string, CellDef> = Object.fromEntries(
  CELL_REGISTRY.map((c) => [c.id, c]),
);

/**
 * Returns empty default content for a given cell kind.
 */
export function defaultContentForKind(kind: CellKind, def?: CellDef): unknown {
  switch (kind) {
    case "text":
      return "";
    case "list":
      return [];
    case "date":
      return "";
    case "metrics": {
      const rows = def?.rowLabels ?? [];
      const res: Record<string, string> = {};
      for (const r of rows) res[r] = "";
      return res;
    }
    case "table":
      return [];
    case "pair":
      return { a: "", b: "" };
  }
}

/**
 * Initial plan values for the 32 cells (synthesized from the team's official answers).
 */
export const INITIAL_PLAN_VALUES: Record<string, unknown> = {
  "SWT-1": [
    "Multidisciplinary founding team combining pediatric clinical practice (SLP), full-stack software engineering, legal/privacy, and business development",
    "Rapid prototyping and iterative development agility with direct clinical workflow feedback",
    "Established professional trust network with pediatric therapy centers, developmental pediatricians, and parent communities in Luzon",
  ],
  "SWT-2": [
    "Risk that therapists perceive digital session logging as administrative friction rather than clinical value, reverting to paper notebooks",
    "High vulnerability to patient data privacy breaches or regulatory delays under NPC given sensitive pediatric health records",
    "Runway constraints and part-time founder availability risking momentum before reaching self-sustaining center revenue",
  ],
  "SWT-3": [
    "Severe nationwide backlog for developmental pediatric assessments (4-6+ months) affecting 5.1M Filipino children with special needs",
    "Growing national push from DOH and DepEd for early childhood developmental screening and SPED integration",
    "Increasing smartphone adoption and demand from millennial/Gen-Z parents for transparent, real-time therapy milestone tracking",
  ],
  CV: [
    {
      Value: "Child at the center",
      "We do": "Favor the child's progress and parent understanding whenever stakeholder interests conflict",
      "We don't": "Compromise clinical integrity or monetize child data for commercial gain",
    },
    {
      Value: "Respect domain expertise",
      "We do": "Listen deeply and give weight to clinical, technical, and regulatory specialists in decisions",
      "We don't": "Overrule clinicians with speculative tech ideas or ignore operational realities",
    },
    {
      Value: "Step in and adapt fast",
      "We do": "Embrace rapid changes, adopt better solutions immediately, and step in when teammates need support",
      "We don't": "Cling rigidly to outdated assumptions or let essential tasks drop",
    },
    {
      Value: "Test before building",
      "We do": "Validate workflows and pricing directly with practicing therapy centers before writing code",
      "We don't": "Build complex multi-app features based on guesswork",
    },
  ],
  "PU-1":
    "Developmental care in the Philippines is deeply fragmented across pediatricians, therapy centers, therapists, and parents, delaying life-changing interventions for 5.1M children. Anakloud connects the entire developmental care team into one shared journey so no child is left behind by broken communication and distance.",
  "PU-2":
    "The trusted pediatric developmental care and progress platform supporting 10 million children across the Philippines and Southeast Asia.",
  "T35-1": "Q4 2029",
  "T35-2": {
    "Paying centers": "300",
    "Active children": "45,000",
    MRR: "₱2,500,000",
    "Team size": "18",
  },
  "T35-3":
    "Private pediatric developmental therapy centers (OT, PT, Speech) and referring developmental pediatricians in the Philippines serving parents of children aged 0-18 with developmental delays.",
  "T35-3b": [
    "No adult physical rehabilitation or geriatric therapy services",
    "No teletherapy delivery ourselves — empower existing therapy centers and clinicians",
    "No selling child data or patient records to third parties, pharma, or advertisers",
    "No AI-only diagnostic tools or replacement of qualified clinicians",
    "No proprietary hospital billing or claims engines — integrate via standard APIs",
  ],
  "T35-4": [
    {
      Promise: "Connect therapy, progress, and parent communication in one continuous record centered on the child",
      KPI: ">80% weekly parent view rate of session progress notes",
    },
    {
      Promise: "Faster, structured session documentation that saves therapists time over notebooks",
      KPI: "<5 minutes daily session logging per therapist",
    },
    {
      Promise: "Safe, secure, and NPC-compliant data exchange across the care team",
      KPI: "100% consent coverage and zero unaddressed privacy incidents",
    },
  ],
  "T35-5": [
    "PedConnect: Physician referral pipeline and pediatrician progress update portal",
    "ParentUp: Mobile progress tracker, milestone visualizer, and parent communication",
    "TeachDay: Therapy center scheduling, multi-profession session logging, and progress synthesis",
    "Standardized Filipino developmental milestone and therapy progress framework",
  ],
  "T35-6": {
    a: "Active child with coordinated care plan per month",
    b: "₱150 - ₱500 / active child / month (or ₱2,500 - ₱5,000 / center / mo)",
  },
  "G1-1": "31 Dec 2027",
  "G1-2": {
    "Paying centers": "35",
    "Active children": "2,000",
    MRR: "₱350,000",
    "Cash / runway": "12 months",
  },
  "G1-3": [
    "Prove repeatable center adoption in 15 paying beta centers with zero churn",
    "Complete end-to-end referral and progress loop across 30 referring developmental pediatricians",
    "Deploy standardized OT, SLP, and SPED milestone tracking and progress report analytics",
    "Achieve full NPC privacy registration and complete clinical advisory board onboarding",
  ],
  "G1-4": "15 paying therapy centers actively running daily sessions with >80% therapist retention",
  "G1-5": "Zero patient privacy complaints and <5% client drop-off across 8-week therapy cycles",
  "A90-1": "31 Dec 2026",
  "A90-2": {
    "Paying centers": "5",
    "Active children": "150",
    MRR: "₱45,000",
    "Cash / runway": "9 months",
  },
  "A90-3": [
    {
      Rock: "Close & Onboard 5 Beta Centers",
      Owner: "Karen / Ern",
      "Done-definition": "5 centers actively logging 20+ real sessions with 50+ children tracked",
      "Hrs/wk": "20",
    },
    {
      Rock: "Ship MVP & Parent Progress Loop",
      Owner: "Ern / Paul",
      "Done-definition": "Complete functional app with live parent progress view deployed",
      "Hrs/wk": "25",
    },
    {
      Rock: "Data Privacy & NPC Compliance Baseline",
      Owner: "Karen",
      "Done-definition": "DPO named, NPC registration filed, consent flow in production",
      "Hrs/wk": "10",
    },
    {
      Rock: "Clinical & Multi-Profession Alignment",
      Owner: "Weng",
      "Done-definition": "OT & SLP milestone framework reviewed with clinical adviser on retainer",
      "Hrs/wk": "12",
    },
  ],
  "A90-4": "5 beta centers actively logging daily sessions with 50+ active children",
  "A90-5": "100% NPC consent flow coverage for all registered child records",
  "TH-1": "31 Dec 2026",
  "TH-2": "5 beta therapy centers actively logging weekly therapy sessions",
  "TH-3": "Prove It Works — From Project to Company",
  "TH-4": "Weekly dashboard tracking active centers, logged sessions, and parent progress views",
  "TH-5": "Team dinner with partner center clinicians and clinical advisors",
  "TH-6": "First team retreat upon reaching 5th active beta center milestone",
  "TH-7": {
    a: ">=5 centers logging therapy sessions weekly with active therapist engagement",
    b: "<3 active centers by Nov 30 or therapists reverting to paper/notebooks",
  },
  "AC-1": [
    { Person: "Ern", "KPI 1": "Beta center partner meetings / wk", "KPI 2": "Product release velocity" },
    { Person: "Karen", "KPI 1": "Center onboarding conversion rate", "KPI 2": "Data privacy & NPC compliance milestones" },
    { Person: "Paul", "KPI 1": "Backend API uptime & latency", "KPI 2": "Cash runway & burn tracking" },
    { Person: "Weng", "KPI 1": "Clinical framework validity reviews", "KPI 2": "Therapist workflow feedback rating" },
    { Person: "Kristian", "KPI 1": "Marketing lead generation", "KPI 2": "Grant & fundraising applications" },
    { Person: "Hannah", "KPI 1": "Center user onboarding completion", "KPI 2": "User satisfaction rating" },
  ],
  "AC-2": [
    { Person: "Ern", Priority: "Deliver MVP and sign 5 beta therapy center MOUs", Due: "Nov 15" },
    { Person: "Karen", Priority: "File NPC registration, appoint DPO, and deploy consent flow", Due: "Oct 31" },
    { Person: "Paul", Priority: "Deploy secure multi-tenant backend and financial runway ledger", Due: "Nov 30" },
    { Person: "Weng", Priority: "Align SLP & OT clinical milestone documentation with adviser", Due: "Nov 15" },
    { Person: "Kristian", Priority: "Submit 2 pre-seed / grant applications and setup marketing deck", Due: "Dec 15" },
    { Person: "Hannah", Priority: "Run pilot user onboarding interviews and support workflows", Due: "Nov 20" },
  ],
};

/**
 * Stacked survey answers from all 6 founders across all source-mapped cells.
 */
export const SURVEY_ANSWERS: readonly SurveyAnswer[] = [
  // SWT-2 / Q13 — Pre-mortem
  {
    cellId: "SWT-2",
    person: "Ern",
    answer: "Anakloud holds highly confidential information about children and their families. A major data leak would trigger a loss of trust from our users that may ultimately lead to its demise. Another possible cause may be a competitor got there first.",
    meta: { category: "Data Privacy & Security", primaryRisk: "Data Leak / Trust Loss" },
  },
  {
    cellId: "SWT-2",
    person: "Hannah",
    answer: "We could not sustain the technology requirement to convert therapy centers from current system to Anakloud. This caused a lot of complaints and escalations which pushed therapy center owners to unsubscribe.",
    meta: { category: "Center Conversion", primaryRisk: "Migration Friction" },
  },
  {
    cellId: "SWT-2",
    person: "Karen",
    answer: "We built something that therapy centers saw value in, pero hindi siya naging part ng actual day-to-day workflow ng therapists because it still felt like additional work. If they don’t consistently use Anakloud, centers won’t see enough reason to keep paying.",
    meta: { category: "Workflow Adoption", primaryRisk: "Therapist Inactivity" },
  },
  {
    cellId: "SWT-2",
    person: "Kristian",
    answer: "We might have missed having sustainable business model and ran out of runway.",
    meta: { category: "Business Model", primaryRisk: "Monetization Failure" },
  },
  {
    cellId: "SWT-2",
    person: "Paul",
    answer: "We avoided the hard conversation about who officially owns what, kept everything urgent, and drifted apart when the deadlines passed.",
    meta: { category: "Role Governance", primaryRisk: "Commitment Drift" },
  },
  {
    cellId: "SWT-2",
    person: "Weng",
    answer: "Spreading efforts too thinly thus not being efficient in managing resources.",
    meta: { category: "Resource Allocation", primaryRisk: "Focus Dilution" },
  },

  // CV / Q15, Q9 — Stories & Guardrails
  {
    cellId: "CV",
    person: "Ern",
    answer: "I designed all the apps but there were times that I thought of something better and informed Isaias about the change. Without any qualms, Isaias simply accept the changes and many times suggests a better way. We adapt to changes fast.",
    meta: { extractedValue: "Step in and adapt fast", guardrail: "No geriatrics/adult rehab" },
  },
  {
    cellId: "CV",
    person: "Hannah",
    answer: "Not anyone in particular but I liked how each one steps in if one person is unavailable.",
    meta: { extractedValue: "Support each other", guardrail: "No selling child data" },
  },
  {
    cellId: "CV",
    person: "Karen",
    answer: "There were times na we had different opinions, but I appreciated how we learned to recognize kung sino talaga ang may domain expertise on a particular issue and give weight to that. Even when we had difficult conversations, we were able to talk through them maturely.",
    meta: { extractedValue: "Respect domain expertise", guardrail: "No AI-only diagnosis" },
  },
  {
    cellId: "CV",
    person: "Kristian",
    answer: "Timeline-driven execution and multi-stakeholder communication.",
    meta: { extractedValue: "Timeline-driven delivery", guardrail: "No hospital enterprise lock-in" },
  },
  {
    cellId: "CV",
    person: "Paul",
    answer: "At the review C said plainly that our pricing was a guess, and insisted we go ask real centers before we touch a change request. Best ten minutes of the year.",
    meta: { extractedValue: "Test before building", guardrail: "No own billing engines" },
  },
  {
    cellId: "CV",
    person: "Weng",
    answer: "A member realized his limitations but also knew his strength, finding people who would see his vision and believe the project can make a difference... We operate like pieces of a big puzzle finding how one fits with another.",
    meta: { extractedValue: "Fit strengths together", guardrail: "No unregulated professions" },
  },

  // PU-1 / Q1, Q2 — Purpose
  {
    cellId: "PU-1",
    person: "Ern",
    answer: "There are different professionals working on every child's development journey (therapists, pediatricians, therapy providers, teachers). The problem is each have their own system. Anakloud connects them so fragmentation stops causing delays in progress, missed diagnosis, and wasted time.",
    meta: { missesUsFirst: "Parents", angle: "Care Team Coordination" },
  },
  {
    cellId: "PU-1",
    person: "Hannah",
    answer: "In PH, there are 5.1M children with developmental needs. While the developmental care team exists, there is no system to connect them, process is highly fragmented which delays child's best outcome.",
    meta: { missesUsFirst: "Parents", angle: "Systemic Scale & Access" },
  },
  {
    cellId: "PU-1",
    person: "Karen",
    answer: "Fragmented ang journey ng isang child in therapy. Anakloud brings everything together so progress is properly documented, parents can actually see how their child is doing, and everyone involved can make better, more coordinated decisions for the child.",
    meta: { missesUsFirst: "Therapy center owners, therapists, parents", angle: "Parent Visibility & Documentation" },
  },
  {
    cellId: "PU-1",
    person: "Kristian",
    answer: "The child development space is fragmented. The stakeholders have communication gaps that contribute to potential delays in early intervention.",
    meta: { missesUsFirst: "Parents/guardians", angle: "Stakeholder Communication" },
  },
  {
    cellId: "PU-1",
    person: "Paul",
    answer: "Children with delays are lost because assessment and therapy sit on opposite sides of a commute most families cannot afford. We collapse that distance.",
    meta: { missesUsFirst: "Therapy center admins", angle: "Geographic Inequity & Distance" },
  },
  {
    cellId: "PU-1",
    person: "Weng",
    answer: "As a practicing therapist, Anakloud will help me focus on planning and implementing therapeutic sessions since documentation will be faster. As a Program Director, it helps in providing informed decisions with access to needed data.",
    meta: { missesUsFirst: "Parents", angle: "Clinician Efficiency & Decisions" },
  },

  // PU-2 / Q4 — BHAG (10 yr)
  {
    cellId: "PU-2",
    person: "Ern",
    answer: "Anakloud will be a multi-billion dollar company approximately US$5B in valuation with operations in Asia, Europe and in the US.",
    confidence: 5,
    meta: { horizon: "10 Years", flavor: "Global Valuation Leader" },
  },
  {
    cellId: "PU-2",
    person: "Hannah",
    answer: "We have Anakloud children not just in PH but even in Southeast Asia and probably starting with the rest of the world.",
    confidence: 4,
    meta: { horizon: "10 Years", flavor: "Regional & Global Expansion" },
  },
  {
    cellId: "PU-2",
    person: "Karen",
    answer: "Anakloud becomes the trusted care and development platform supporting 10 million children across the Philippines and Southeast Asia.",
    confidence: 5,
    meta: { horizon: "10 Years", flavor: "Regional Scale & Trust" },
  },
  {
    cellId: "PU-2",
    person: "Kristian",
    answer: "1,000,000 active users across the developmental care ecosystem.",
    confidence: 4,
    meta: { horizon: "10 Years", flavor: "Ecosystem User Reach" },
  },
  {
    cellId: "PU-2",
    person: "Paul",
    answer: "The default way pediatric developmental care is delivered in the Philippines.",
    confidence: 2,
    meta: { horizon: "10 Years", flavor: "National Health Infrastructure" },
  },
  {
    cellId: "PU-2",
    person: "Weng",
    answer: "Anakloud will be adopted by the Phil govt to provide an objective measurement of how our children are developing to provide needed support.",
    confidence: 4,
    meta: { horizon: "10 Years", flavor: "Public Health Adoption" },
  },

  // T35-2 / Q3 — 3-yr targets
  {
    cellId: "T35-2",
    person: "Ern",
    answer: "parents subscribed — 100,000 families. The families are the main target users of Anakloud. The more parents using it, the more we have empowered them.",
    confidence: 5,
    meta: { metric: "parents subscribed", target: "100000", unit: "families" },
  },
  {
    cellId: "T35-2",
    person: "Hannah",
    answer: "children with coordinated care plan using Anakloud — 45,000 children. The child is at the center; they all use Anakloud to perform their parts and converge per child.",
    confidence: 4,
    meta: { metric: "children with coordinated care plan", target: "45000", unit: "children" },
  },
  {
    cellId: "T35-2",
    person: "Karen",
    answer: "active therapy centers using Anakloud — 300 therapy centers (30% penetration of 1000 market universe). Proves we are solving a real problem and centers keep using the platform.",
    confidence: 5,
    meta: { metric: "active therapy centers", target: "300", unit: "therapy centers" },
  },
  {
    cellId: "T35-2",
    person: "Kristian",
    answer: "Number of active users — 100,000 accounts. Multi-stakeholder accounting across centers, therapists and families.",
    confidence: 5,
    meta: { metric: "Number of active users", target: "100000", unit: "accounts" },
  },
  {
    cellId: "T35-2",
    person: "Paul",
    answer: "paying therapy centers — 250 paying centers. The number of centers actively paying is the honest test of whether we built something clinics keep.",
    confidence: 3,
    meta: { metric: "paying therapy centers", target: "250", unit: "centers" },
  },
  {
    cellId: "T35-2",
    person: "Weng",
    answer: "Number of parents/ children in the App — 500 Families. Aligning to pediatric psychometric test validity where hundreds of subjects are needed.",
    confidence: 4,
    meta: { metric: "parents/children in App", target: "500", unit: "Families" },
  },

  // T35-3 / Q5, Q6, Q9 — Sandbox & Core Customer
  {
    cellId: "T35-3",
    person: "Ern",
    answer: "Core customer: Parent. If it is not good for the child, it is not good for Anakloud. Pays: pediatrician, center_owner, parent.",
    meta: { decides: "All Stakeholders", pays: "Center / Parent", primaryCustomer: "Parent" },
  },
  {
    cellId: "T35-3",
    person: "Hannah",
    answer: "Core customer: Parent. The parent represents the child and the child is at the center of what we do. Pays: center_owner, pediatrician, LGU/DOH, HMO.",
    meta: { decides: "All Stakeholders", pays: "Center / LGU", primaryCustomer: "Parent" },
  },
  {
    cellId: "T35-3",
    person: "Karen",
    answer: "Core customer: Parent. Because while the center is our customer, Anakloud ultimately exists for the child, and when interests conflict, we should favor the parent’s ability to understand and participate in care.",
    meta: { decides: "Center Owner / Clinicians", pays: "Center / Parent", primaryCustomer: "Parent" },
  },
  {
    cellId: "T35-3",
    person: "Kristian",
    answer: "Core customer: Parent. Parents are the main customers here. They are the most concerned about the progress of their child.",
    meta: { decides: "All Stakeholders", pays: "All Stakeholders", primaryCustomer: "Parent" },
  },
  {
    cellId: "T35-3",
    person: "Paul",
    answer: "Core customer: Parent. We cannot claim to be about the parent and then abandon them the moment money is mentioned.",
    meta: { decides: "Pediatrician", pays: "Center Owner", primaryCustomer: "Parent" },
  },
  {
    cellId: "T35-3",
    person: "Weng",
    answer: "Core customer: Parent. Since the App involves children, parents have the last decision.",
    meta: { decides: "Pediatrician / Center", pays: "Center / Parent", primaryCustomer: "Parent" },
  },

  // T35-3b / Q9 — Guardrails
  {
    cellId: "T35-3b",
    person: "Ern",
    answer: "1. No geriatrics/adult rehab. 2. No building school registration systems (integrate via API). 3. No building therapist material creation modules (partner with boom cards).",
  },
  {
    cellId: "T35-3b",
    person: "Hannah",
    answer: "1. Will not sell child info to big pharma or other orgs. 2. No expansion outside PH before stabilizing PH. 3. No AI-only diagnostic screening.",
  },
  {
    cellId: "T35-3b",
    person: "Karen",
    answer: "1. No AI therapist / AI diagnosis tool. 2. No expansion to all general healthcare. 3. No building full hospital EMR systems.",
  },
  {
    cellId: "T35-3b",
    person: "Kristian",
    answer: "1. No major app revamp. 2. No business model that excludes stakeholders. 3. No hospital enterprise sales.",
  },
  {
    cellId: "T35-3b",
    person: "Paul",
    answer: "1. No teletherapy delivery. 2. No adult rehab market. 3. No building our own payment engines.",
  },
  {
    cellId: "T35-3b",
    person: "Weng",
    answer: "1. No expanding to unregulated health professions. 2. No expanding to general educational institutions. 3. No cases beyond 18 years of age.",
  },

  // T35-4 / Q7 — Brand Promises
  {
    cellId: "T35-4",
    person: "Ern",
    answer: "processes the data and synthesizes to make it more informative so progress can be known on demand.",
    confidence: 5,
    meta: { promiseFocus: "Progress Synthesis On Demand" },
  },
  {
    cellId: "T35-4",
    person: "Hannah",
    answer: "can make their work more efficient and effective more than a notebook can",
    confidence: 5,
    meta: { promiseFocus: "Notebook Replacement Efficiency" },
  },
  {
    cellId: "T35-4",
    person: "Karen",
    answer: "connect therapy, progress, and parent communication in one continuous record centered on the child.",
    confidence: 5,
    meta: { promiseFocus: "Continuous Connected Record" },
  },
  {
    cellId: "T35-4",
    person: "Kristian",
    answer: "can provide a digital platform where all of their day-to-day materials can be accessed.",
    confidence: 4,
    meta: { promiseFocus: "Digital Platform Access" },
  },
  {
    cellId: "T35-4",
    person: "Paul",
    answer: "give every parent a therapist-backed progress record they actually understand.",
    confidence: 4,
    meta: { promiseFocus: "Parent Comprehension" },
  },
  {
    cellId: "T35-4",
    person: "Weng",
    answer: "Ensures that data exchanged between and among professionals and families are safe, secure, and valid.",
    confidence: 5,
    meta: { promiseFocus: "Safe & Valid Data Exchange" },
  },

  // T35-5 / Q8 — Door-opener & Kill list
  {
    cellId: "T35-5",
    person: "Ern",
    answer: "PedConnect (1st) -> ParentUp -> TeachDay -> PedMD. Delete: PedMD. Why: Integration of PedMD is better appreciated in the latter part of journey.",
    confidence: 5,
    meta: { rank1: "PedConnect", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Hannah",
    answer: "PedConnect (1st) -> TeachDay -> ParentUp -> PedMD. Delete: PedMD. Why: Least user in ecosystem, can survive in own system.",
    confidence: 4,
    meta: { rank1: "PedConnect", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Karen",
    answer: "PedConnect (1st) -> ParentUp -> TeachDay -> PedMD. Delete: PedMD. Why: TeachDay, ParentUp, PedConnect complete the core loop; PedMD can come later.",
    confidence: 5,
    meta: { rank1: "PedConnect", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Kristian",
    answer: "ParentUp (1st) -> PedMD -> PedConnect -> TeachDay. Delete: TeachDay. Why: Can be coursed through therapy centers.",
    confidence: 5,
    meta: { rank1: "ParentUp", kill: "TeachDay" },
  },
  {
    cellId: "T35-5",
    person: "Paul",
    answer: "TeachDay (1st) -> PedConnect -> ParentUp -> PedMD. Delete: PedMD. Why: Centers have money and daily pain; doctors will not change habit for startup.",
    confidence: 5,
    meta: { rank1: "TeachDay", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Weng",
    answer: "PedConnect (1st) -> TeachDay -> ParentUp -> PedMD. Delete: PedMD. Why: Based on potential number of users.",
    confidence: 4,
    meta: { rank1: "PedConnect", kill: "PedMD" },
  },

  // T35-6 / Q10 — Economic Engine
  {
    cellId: "T35-6",
    person: "Ern",
    answer: "Payer: Center, Parent. Model: Freemium with parent upgrade. ₱500 / upgrade. First peso: Oct 2026.",
    confidence: 2,
    meta: { payer: "Center, Parent", model: "Freemium with parent upgrade", amount: "₱500", firstPeso: "2026-10" },
  },
  {
    cellId: "T35-6",
    person: "Hannah",
    answer: "Payer: Center, LGU/DOH, HMO, School, Doctor, Parent. Model: Monthly subscription per center. ₱5,000/center/mo. First peso: Nov 2026.",
    confidence: 2,
    meta: { payer: "Center, LGU, HMO", model: "Monthly subscription per center", amount: "₱5,000", firstPeso: "2026-11" },
  },
  {
    cellId: "T35-6",
    person: "Karen",
    answer: "Payer: Center. Model: Grant / Institutional funding. ₱3,000. First peso: Sep 2026.",
    confidence: 2,
    meta: { payer: "Center", model: "Grant / Institutional funding", amount: "₱3,000", firstPeso: "2026-09" },
  },
  {
    cellId: "T35-6",
    person: "Kristian",
    answer: "Payer: LGU/DOH, Center, Parent, HMO. Model: Grant funding. ₱1,200,000. First peso: Dec 2026.",
    confidence: 1,
    meta: { payer: "LGU, Center, Parent", model: "Grant funding", amount: "₱1,200,000", firstPeso: "2026-12" },
  },
  {
    cellId: "T35-6",
    person: "Paul",
    answer: "Payer: Center. Model: Per active child. ₱150 / active child / month. First peso: Dec 2026.",
    confidence: 2,
    meta: { payer: "Center", model: "Per active child", amount: "₱150", firstPeso: "2026-12" },
  },
  {
    cellId: "T35-6",
    person: "Weng",
    answer: "Payer: Center, Parent, LGU/DOH. Model: Per active child per month. ₱500 / child / mo. First peso: Dec 2026.",
    confidence: 2,
    meta: { payer: "Center, Parent, LGU", model: "Per active child per month", amount: "₱500", firstPeso: "2026-12" },
  },

  // G1-2 / Q3, Q10 — 1-Year Key Numbers
  {
    cellId: "G1-2",
    person: "Karen",
    answer: "First peso in Sep 2026 with ₱3,000-₱5,000 pilot center tier. Target 15-35 active therapy centers in year 1.",
    confidence: 3,
    meta: { timeline: "12 Months", revenueTarget: "₱350k MRR" },
  },
  {
    cellId: "G1-2",
    person: "Ern",
    answer: "First peso Oct 2026 via freemium parent upgrades (₱500). Target 10,000+ active families in year 1.",
    confidence: 3,
    meta: { timeline: "12 Months", revenueTarget: "₱250k MRR" },
  },
  {
    cellId: "G1-2",
    person: "Paul",
    answer: "First peso Dec 2026 with ₱150-₱200/child pricing model. Target 35 centers by year 1.",
    confidence: 3,
    meta: { timeline: "12 Months", revenueTarget: "₱350k MRR" },
  },
  {
    cellId: "G1-2",
    person: "Hannah",
    answer: "First peso Nov 2026 with ₱5,000 center subscription. Target 45,000 coordinated care children.",
    confidence: 3,
    meta: { timeline: "12 Months", revenueTarget: "₱300k MRR" },
  },
  {
    cellId: "G1-2",
    person: "Weng",
    answer: "First peso Dec 2026 with ₱500/child model. Target 500+ active validated therapy cases.",
    confidence: 3,
    meta: { timeline: "12 Months", revenueTarget: "₱250k MRR" },
  },
  {
    cellId: "G1-2",
    person: "Kristian",
    answer: "First peso Dec 2026 via grant/institutional funding (₱1.2M). Target 100,000 multi-stakeholder accounts.",
    confidence: 2,
    meta: { timeline: "12 Months", revenueTarget: "₱1.2M Grant" },
  },

  // G1-3 / Q11 — Key initiatives
  {
    cellId: "G1-3",
    person: "Ern",
    answer: "1. Deliver MVP (evaluation/session workspace). 2. Secure Beta Centers (sign up 5 centers, 5 clinicians each). 3. Generate Pre-Seed Fund ($200k).",
    confidence: 5,
    meta: { starred: "Deliver the MVP" },
  },
  {
    cellId: "G1-3",
    person: "Hannah",
    answer: "1. Acquire 10 centers (signed contract). 2. Integrate 2 systems. 3. Establish baseline for child milestones (2 disabilities).",
    confidence: 4,
    meta: { starred: "Acquire 10 centers" },
  },
  {
    cellId: "G1-3",
    person: "Karen",
    answer: "1. Close and onboard 5 pilot therapy centers (50+ active children tracked). 2. Data privacy baseline (DPO appointed, NPC filed). 3. Validate parent engagement loop (>70% view within 48h).",
    confidence: 5,
    meta: { starred: "Close and onboard 5 pilot centers" },
  },
  {
    cellId: "G1-3",
    person: "Kristian",
    answer: "1. Initial funding. 2. Installations across center partners. 3. Data integration and multi-stakeholder communication.",
    confidence: 4,
    meta: { starred: "Initial funding" },
  },
  {
    cellId: "G1-3",
    person: "Paul",
    answer: "1. Hire a clinical adviser (OT/SLP on retainer). 2. Prove the referral loop (15 referrals complete end to end).",
    confidence: 4,
    meta: { starred: "Hire clinical adviser" },
  },
  {
    cellId: "G1-3",
    person: "Weng",
    answer: "1. Content and Tech seamless alignment (SLP and OT). 2. Add SPED individualized sessions. 3. Progress reports and analytics for 3 professions.",
    confidence: 3,
    meta: { starred: "Content and Tech alignment" },
  },

  // G1-4 / Q3 — Critical Number #1
  {
    cellId: "G1-4",
    person: "Karen",
    answer: "Active therapy centers using Anakloud — 300 (or 15-35 in Year 1). Proves clinics find the software indispensable.",
    confidence: 5,
  },
  {
    cellId: "G1-4",
    person: "Paul",
    answer: "Paying therapy centers — 250 (15 in Year 1). Proves sustainable adoption.",
    confidence: 3,
  },
  {
    cellId: "G1-4",
    person: "Hannah",
    answer: "Children with coordinated care plans — 45,000 children across centers.",
    confidence: 4,
  },
  {
    cellId: "G1-4",
    person: "Ern",
    answer: "Parents subscribed — 100,000 families empowered with progress visibility.",
    confidence: 5,
  },
  {
    cellId: "G1-4",
    person: "Kristian",
    answer: "Active users — 100,000 accounts across the care ecosystem.",
    confidence: 5,
  },
  {
    cellId: "G1-4",
    person: "Weng",
    answer: "Parents/children in App — 500 validated active therapy cases.",
    confidence: 4,
  },

  // G1-5 / Q13 — Critical Number #2 (counter-balance)
  {
    cellId: "G1-5",
    person: "Ern",
    answer: "NPC compliance audit clearance and zero patient privacy complaints or data leaks.",
  },
  {
    cellId: "G1-5",
    person: "Karen",
    answer: "Therapist workflow retention: >80% weekly session logging adherence and <5% center churn.",
  },
  {
    cellId: "G1-5",
    person: "Hannah",
    answer: "Zero unresolved technical escalations during center conversion.",
  },
  {
    cellId: "G1-5",
    person: "Paul",
    answer: "Zero unaddressed role governance gaps and continuous weekly leadership rhythm.",
  },
  {
    cellId: "G1-5",
    person: "Weng",
    answer: "100% clinical validity verification for developmental milestone progress analytics.",
  },
  {
    cellId: "G1-5",
    person: "Kristian",
    answer: "Positive cash flow and minimum 12 months forward runway reserve.",
  },

  // A90-3 / Q11 — Rocks
  {
    cellId: "A90-3",
    person: "Karen",
    answer: "Close and onboard 5 pilot therapy centers: 5 centers actively logging 20+ real sessions with 50+ children tracked.",
    confidence: 5,
  },
  {
    cellId: "A90-3",
    person: "Ern",
    answer: "Deliver the MVP: Evaluation and session logging workspace functional for beta center therapists.",
    confidence: 5,
  },
  {
    cellId: "A90-3",
    person: "Paul",
    answer: "Hire clinical adviser: OT or SLP on retainer reviewing the milestone progress framework.",
    confidence: 4,
  },
  {
    cellId: "A90-3",
    person: "Weng",
    answer: "Content and Tech alignment: Seamless documentation alignment for SLP and OT disciplines.",
    confidence: 3,
  },
  {
    cellId: "A90-3",
    person: "Hannah",
    answer: "Establish milestone baseline: Standardized milestone metrics for 2 pediatric disability conditions.",
    confidence: 4,
  },
  {
    cellId: "A90-3",
    person: "Kristian",
    answer: "Initial funding & partner installations: Secure pre-seed / grant funding baseline.",
    confidence: 4,
  },

  // TH-3 / Q12 — Theme
  {
    cellId: "TH-3",
    person: "Karen",
    answer: "Prove It Works",
    meta: { tone: "Validation & Evidence" },
  },
  {
    cellId: "TH-3",
    person: "Ern",
    answer: "The Traction Quarter",
    meta: { tone: "Growth & Momentum" },
  },
  {
    cellId: "TH-3",
    person: "Paul",
    answer: "From school project to company",
    meta: { tone: "Maturity & Transition" },
  },
  {
    cellId: "TH-3",
    person: "Weng",
    answer: "Focus on the essentials",
    meta: { tone: "Execution Discipline" },
  },
  {
    cellId: "TH-3",
    person: "Hannah",
    answer: "user acquisition and deployment period",
    meta: { tone: "Deployment Focus" },
  },
  {
    cellId: "TH-3",
    person: "Kristian",
    answer: "Capacity Building",
    meta: { tone: "Operational Readiness" },
  },

  // TH-7 / Q13 — Between green and red
  {
    cellId: "TH-7",
    person: "Karen",
    answer: "Green: Therapists logging daily sessions naturally. Red: Centers subscribing but therapists reverting to notebooks.",
  },
  {
    cellId: "TH-7",
    person: "Ern",
    answer: "Green: Clean security audit & zero leaks. Red: Any unauthorized data access or privacy complaint.",
  },
  {
    cellId: "TH-7",
    person: "Paul",
    answer: "Green: Clear ownership of weekly deliverables across all 6 founders. Red: Silent missed deadlines.",
  },
  {
    cellId: "TH-7",
    person: "Weng",
    answer: "Green: Clear clinical validity buy-in from center directors. Red: Clinicians finding data exchange confusing.",
  },
  {
    cellId: "TH-7",
    person: "Hannah",
    answer: "Green: Onboarding completed within 48 hours per center. Red: Centers stuck in setup friction.",
  },
  {
    cellId: "TH-7",
    person: "Kristian",
    answer: "Green: Positive revenue or secured grant runway. Red: Burn rate exceeding monthly budget.",
  },

  // AC-1 & AC-2 / Q14 — Accountability & Ownership
  {
    cellId: "AC-1",
    person: "Ern",
    answer: "Wants: Sales & Partnerships, Product, Fundraising. Hours: 52 hrs/wk.",
    meta: { roleWants: "Sales / Product / Fundraising", hours: "52" },
  },
  {
    cellId: "AC-1",
    person: "Karen",
    answer: "Wants: Sales & Partnerships, Data Privacy & Security, Legal & IP. Hours: 16 hrs/wk.",
    meta: { roleWants: "Sales / Privacy / Legal", hours: "16" },
  },
  {
    cellId: "AC-1",
    person: "Paul",
    answer: "Wants: Backend, Finance, Fundraising. Hours: 20 hrs/wk.",
    meta: { roleWants: "Backend / Finance / Fundraising", hours: "20" },
  },
  {
    cellId: "AC-1",
    person: "Weng",
    answer: "Wants: Clinical & Regulatory Liaison, Onboarding & Success, Marketing. Hours: 16 hrs/wk.",
    meta: { roleWants: "Clinical / Onboarding / Marketing", hours: "16" },
  },
  {
    cellId: "AC-1",
    person: "Kristian",
    answer: "Wants: Marketing, Fundraising, Support. Hours: 8 hrs/wk.",
    meta: { roleWants: "Marketing / Fundraising / Support", hours: "8" },
  },
  {
    cellId: "AC-1",
    person: "Hannah",
    answer: "Wants: Onboarding & Success, Product, Marketing. Hours: 5 hrs/wk.",
    meta: { roleWants: "Onboarding / Product", hours: "5" },
  },
  {
    cellId: "AC-2",
    person: "Ern",
    answer: "Weekly priority: Deliver MVP release & close 5 beta therapy center MOUs.",
  },
  {
    cellId: "AC-2",
    person: "Karen",
    answer: "Weekly priority: NPC registration filing, DPO appointment, and center pilot terms.",
  },
  {
    cellId: "AC-2",
    person: "Paul",
    answer: "Weekly priority: Multi-tenant backend deployment, security controls & runway management.",
  },
  {
    cellId: "AC-2",
    person: "Weng",
    answer: "Weekly priority: SLP/OT clinical documentation alignment & clinical adviser cadence.",
  },
  {
    cellId: "AC-2",
    person: "Kristian",
    answer: "Weekly priority: Pre-seed grant applications and ecosystem marketing narrative.",
  },
  {
    cellId: "AC-2",
    person: "Hannah",
    answer: "Weekly priority: Center onboarding interviews and parent experience validation.",
  },
];

/**
 * Facilitator notes (sensitive strategic commentary).
 * VISIBILITY GATED: only served when audience mode is 'facilitator'.
 */
export const FACILITATOR_NOTES: readonly FacilitatorNote[] = [
  {
    cellId: "SWT-2",
    body: "Critical pre-mortem takeaway: 3 founders fear workflow inertia in therapy centers, while Ern flags child data privacy breaches as an existential risk. Prioritize frictionless therapist logging and full NPC data compliance in beta.",
  },
  {
    cellId: "PU-1",
    body: "High alignment across the team: all 6 founders point to systemic fragmentation across developmental pediatricians, therapy centers, therapists, and parents across 5.1M Filipino children.",
  },
  {
    cellId: "PU-2",
    body: "10-year BHAG balances Philippine national standard of care (Paul, Weng) and Southeast Asian regional expansion (Karen, Hannah, Ern). Keep in pencil for now and calibrate once pilot retention data is established.",
  },
  {
    cellId: "T35-2",
    body: "Unit metrics discussion: Karen and Paul focus on paying therapy centers (250-300 centers), while Ern, Hannah, Kristian, and Weng focus on children/families (500 to 100,000). Use center count as primary distribution driver and active children as clinical impact metric.",
  },
  {
    cellId: "T35-3",
    body: "Unanimous alignment on Q6 tiebreak: all 6 founders chose 'Parent' as the core customer when interests conflict, while agreeing that therapy centers are the paying gatekeeper.",
  },
  {
    cellId: "T35-5",
    body: "Strong 4-of-6 consensus on lead wedge app: PedConnect (doctor referral first) led the rankings, followed closely by ParentUp and TeachDay. Unanimous agreement on killing/deprioritizing PedMD.",
  },
  {
    cellId: "T35-6",
    body: "Monetization model split: monthly center subscription (₱2,500-₱5,000) vs per-active-child pricing (₱150-₱500) vs grant funding. Test hybrid pricing models during beta center pilots.",
  },
  {
    cellId: "G1-3",
    body: "Starred rock consensus: onboarding 5 beta centers and proving repeatable session logging with active children emerged as the top shared objective across co-founders.",
  },
  {
    cellId: "TH-3",
    body: "'Prove It Works', 'The Traction Quarter', and 'From school project to company' are the dominant theme candidates. Rally the team behind 'Prove It Works'.",
  },
  {
    cellId: "AC-1",
    body: "Capacity and hours spread: Ern (52h), Paul (20h), Karen (16h), Weng (16h) vs Kristian (8h) and Hannah (5h). Ensure quarterly rock ownership aligns with actual founder time commitments.",
  },
];

/**
 * Filter facilitator notes based on audience mode.
 * In 'room' mode, returns an empty array to prevent data leakage in network payloads.
 */
export function getFacilitatorNotesForMode(
  cellId: string,
  mode: "facilitator" | "room",
): FacilitatorNote[] {
  if (mode !== "facilitator") return [];
  return FACILITATOR_NOTES.filter((n) => n.cellId === cellId);
}

/**
 * Get all survey answers for a specific cell.
 */
export function getSurveyAnswersForCell(cellId: string): SurveyAnswer[] {
  return SURVEY_ANSWERS.filter((a) => a.cellId === cellId);
}
