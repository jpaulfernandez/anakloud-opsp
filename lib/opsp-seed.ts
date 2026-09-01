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
 * Initial plan values for the 33 cells (clean defaults).
 */
export const INITIAL_PLAN_VALUES: Record<string, unknown> = {
  "SWT-1": [
    "Direct clinical workflow empathy from deep field observation in Cavite centers",
    "Full-stack agile engineering team able to ship bespoke pediatric interfaces rapidly",
    "Strong network of referring developmental pediatricians and center owners",
  ],
  "SWT-2": [
    "Centers love demos but have inertia around changing their legacy paper & Viber workflows",
    "Part-time founder availability risking momentum after beta launch",
    "High product complexity spreading across multiple apps instead of a single sharp wedge",
  ],
  "SWT-3": [
    "DOH and DepEd push for early developmental screening and SPED integration",
    "Severe nationwide backlog for developmental pediatric assessments (4-6 months wait)",
    "Rising adoption of smartphone messaging and digital progress tracking among parents",
  ],
  CV: [
    {
      Value: "Say the real thing",
      "We do": "State bugs and hard truths plainly in the open",
      "We don't": "Gloss over broken workflows or pretend bad numbers are fine",
    },
    {
      Value: "Go sit in the center",
      "We do": "Observe clinicians in person before writing code",
      "We don't": "Build features based on speculative whiteboard ideas",
    },
    {
      Value: "Parent-grade clarity",
      "We do": "Write every progress update in warm, accessible language",
      "We don't": "Hide behind clinical jargon or dense EMR codes",
    },
  ],
  "PU-1":
    "Children with developmental delay in the Philippines wait months for assessment and travel hours for therapy. Anakloud exists so distance and broken workflows stop being the reason a child misses care.",
  "PU-2":
    "The default operating system for pediatric therapy across Southeast Asia, ensuring every child with developmental delays is identified and supported before age five.",
  "T35-1": "Q4 2029",
  "T35-2": {
    "Paying centers": "300",
    "Active children": "15,000",
    MRR: "₱2,500,000",
    "Team size": "18",
  },
  "T35-3":
    "Private pediatric developmental therapy centers (OT, PT, Speech) and referring developmental pediatricians in Luzon with 30-150 active children.",
  "T35-3b": [
    "No teletherapy delivery ourselves — we empower existing therapy centers",
    "No adult physical rehabilitation market",
    "No proprietary hospital billing or claims engines — integrate via standard APIs",
  ],
  "T35-4": [
    {
      Promise: "Live connected progress record across doctor, center and parent",
      KPI: ">85% weekly parent engagement with progress notes",
    },
    {
      Promise: "Save 2+ hours of administrative overhead per therapist weekly",
      KPI: "<5 minutes daily session logging time per clinician",
    },
  ],
  "T35-5": [
    "PedConnect referral pipeline from pediatricians to therapy centers",
    "Standardized pediatric therapy progress framework and milestone visualizer",
    "Zero-friction center onboarding and offline-resilient tablet scheduling",
  ],
  "T35-6": {
    a: "Active child on platform per month",
    b: "₱200 / child / mo",
  },
  "G1-1": "31 Dec 2027",
  "G1-2": {
    "Paying centers": "35",
    "Active children": "1,800",
    MRR: "₱350,000",
    "Cash / runway": "12 months",
  },
  "G1-3": [
    "Prove repeatable center adoption in 15 paying beta centers with zero churn",
    "Complete end-to-end referral loop from 30 referring developmental pediatricians",
    "Publish peer-reviewed clinical usability study with partner therapy clinic",
  ],
  "G1-4": "15 paying centers with >80% active therapist retention",
  "G1-5": "Zero unaddressed parent privacy incidents and <3% weekly appointment no-shows",
  "A90-1": "31 Dec 2026",
  "A90-2": {
    "Paying centers": "8",
    "Active children": "250",
    MRR: "₱45,000",
    "Cash / runway": "9 months",
  },
  "A90-3": [
    {
      Rock: "Onboard beta centers",
      Owner: "Ana Reyes",
      "Done-definition": "8 centers each logged 20+ real sessions with live patients",
      "Hrs/wk": "20",
    },
    {
      Rock: "Prove referral loop",
      Owner: "Diego Tan",
      "Done-definition": "15 referrals completed doctor -> center -> parent progress view",
      "Hrs/wk": "15",
    },
    {
      Rock: "Data privacy & NPC compliance",
      Owner: "Carla Santos",
      "Done-definition": "NPC registration filed, DPO named, consent flow deployed",
      "Hrs/wk": "10",
    },
  ],
  "A90-4": "8 centers each logging 20+ real therapy sessions",
  "A90-5": "100% consent coverage for all registered child records",
  "TH-1": "31 Dec 2026",
  "TH-2": "8 beta centers actively running weekly sessions",
  "TH-3": "Make the referral loop real",
  "TH-4": "Physical board in workspace tracking center session counts weekly",
  "TH-5": "Team dinner with partner center therapists and advisors",
  "TH-6": "First team retreat in Tagaytay upon 8th center signoff",
  "TH-7": {
    a: ">=8 centers logging sessions weekly with zero dropouts",
    b: "<4 active centers by November 15 or doctors stopping digital referrals",
  },
  "AC-1": [
    { Person: "Ana Reyes", "KPI 1": "Active center session count", "KPI 2": "Product release velocity" },
    { Person: "Benito Cruz", "KPI 1": "Mobile crash rate (<0.1%)", "KPI 2": "Therapist logging speed" },
    { Person: "Carla Santos", "KPI 1": "API uptime & response time", "KPI 2": "Security & privacy audit status" },
    { Person: "Diego Tan", "KPI 1": "Referring doctor meetings / wk", "KPI 2": "Center trial conversion rate" },
    { Person: "Elena Villanueva", "KPI 1": "Parent progress review NPS", "KPI 2": "Onboarding completion time" },
    { Person: "Lia Mendoza", "KPI 1": "Runway months & burn rate", "KPI 2": "Clinical advisor review cadence" },
  ],
  "AC-2": [
    { Person: "Ana Reyes", Priority: "Deliver core center scheduling & therapist logging", Due: "Nov 15" },
    { Person: "Benito Cruz", Priority: "Ship parent mobile progress view & offline sync", Due: "Nov 30" },
    { Person: "Carla Santos", Priority: "NPC compliance registration & encrypted child database", Due: "Oct 31" },
    { Person: "Diego Tan", Priority: "Sign 8 beta center partnership MOUs", Due: "Oct 15" },
    { Person: "Elena Villanueva", Priority: "Complete 10 parent UX validation interviews", Due: "Nov 20" },
    { Person: "Lia Mendoza", Priority: "Finalize Angel syndication terms & clinical advisory", Due: "Dec 15" },
  ],
};

/**
 * Stacked survey answers from all 6 founders across all source-mapped cells.
 */
export const SURVEY_ANSWERS: readonly SurveyAnswer[] = [
  // SWT-2 / Q13
  {
    cellId: "SWT-2",
    person: "Ana Reyes",
    answer: "Centers loved every demo and never changed how they worked. We mistook enthusiasm for adoption, squandered three months, and ran out of money.",
    meta: { category: "Workflow Inertia", primaryRisk: "Adoption Failure" },
  },
  {
    cellId: "SWT-2",
    person: "Benito Cruz",
    answer: "Two of us took full-time jobs in November and it went quiet by February. Nobody ever said it was over, it just ended.",
    meta: { category: "Commitment Drift", primaryRisk: "Team Disbandment" },
  },
  {
    cellId: "SWT-2",
    person: "Carla Santos",
    answer: "We spread our tooling across four apps and none got good enough for anyone to pay for. Death by a thousand betas.",
    meta: { category: "Focus Dilution", primaryRisk: "Product Sprawl" },
  },
  {
    cellId: "SWT-2",
    person: "Diego Tan",
    answer: "Doctors never referred through us; we built the center product for nobody. The pipeline dried up and the runway ran out.",
    meta: { category: "Distribution Block", primaryRisk: "Physician Buy-in" },
  },
  {
    cellId: "SWT-2",
    person: "Elena Villanueva",
    answer: "We kept building features nobody had asked for and ignored the empty sales pipeline. When we finally looked, there were no customers left to lose.",
    meta: { category: "Sales Avoidance", primaryRisk: "Pipeline Blindness" },
  },
  {
    cellId: "SWT-2",
    person: "Lia Mendoza",
    answer: "We avoided the hard conversation about who officially owns what, kept everything urgent, and drifted apart when the deadlines passed.",
    meta: { category: "Role Ambiguity", primaryRisk: "Governance Vacuum" },
  },

  // CV / Q15, Q9
  {
    cellId: "CV",
    person: "Ana Reyes",
    answer: "When the demo crashed in front of the panel, J didn't explain it away. Said 'that's a real bug, we'll fix it,' and had it fixed that night.",
    meta: { extractedValue: "Say the real thing", guardrail: "No teletherapy" },
  },
  {
    cellId: "CV",
    person: "Benito Cruz",
    answer: "R spent a whole Saturday sitting in a therapy center watching, and came back and told us half our screens were wrong.",
    meta: { extractedValue: "Go sit in the center", guardrail: "No adult rehab" },
  },
  {
    cellId: "CV",
    person: "Carla Santos",
    answer: "When I said our consent copy read like legalese, L rewrote it in one evening in words a parent would say. No fuss, just fixed.",
    meta: { extractedValue: "Plain words for parents", guardrail: "No funds management" },
  },
  {
    cellId: "CV",
    person: "Diego Tan",
    answer: "M walked a skeptical center owner through the product for an hour and left having learned our biggest onboarding blocker, not having sold anything.",
    meta: { extractedValue: "Learn before selling", guardrail: "No self-built billing" },
  },
  {
    cellId: "CV",
    person: "Elena Villanueva",
    answer: "When I flagged a privacy gap late on a Friday, D owned it, drafted the fix and asked for review rather than parking it till Monday.",
    meta: { extractedValue: "Protect the child first", guardrail: "No hospital enterprise sales" },
  },
  {
    cellId: "CV",
    person: "Lia Mendoza",
    answer: "At the review C said plainly that our pricing was a guess, and insisted we go ask real centers before we touch a change request. Best ten minutes of the year.",
    meta: { extractedValue: "Test before building", guardrail: "No proprietary payments" },
  },

  // PU-1 / Q1, Q2
  {
    cellId: "PU-1",
    person: "Ana Reyes",
    answer: "Children with developmental delay in the Philippines wait months for assessment and travel hours for therapy, and most give up. We exist so that waiting stops being the reason a child misses care.",
    meta: { missesUsFirst: "Therapy center admins", angle: "Access & Distance" },
  },
  {
    cellId: "PU-1",
    person: "Benito Cruz",
    answer: "Parents pay months for therapy and never see if it works. We make progress visible so families know what they are buying.",
    meta: { missesUsFirst: "Therapy center admins", angle: "Parent Trust & Visibility" },
  },
  {
    cellId: "PU-1",
    person: "Carla Santos",
    answer: "Therapy centers run on notebooks and Viber groups, so nobody can answer how many active clients they have. We give them the system they would have if software were built for this market.",
    meta: { missesUsFirst: "Therapy center admins", angle: "SaaS & Workflow" },
  },
  {
    cellId: "PU-1",
    person: "Diego Tan",
    answer: "A parent in Cavite waits four to six months for a developmental assessment, then travels two hours each way for weekly sessions. We exist so distance stops deciding who gets care.",
    meta: { missesUsFirst: "Therapy center admins", angle: "Geographic Inequity" },
  },
  {
    cellId: "PU-1",
    person: "Elena Villanueva",
    answer: "Nobody can tell a clinician, a parent or a school the truth about a child's progress because the record lives in six places. We make the progress record one connected thing.",
    meta: { missesUsFirst: "Therapy center admins", angle: "Unified Progress Record" },
  },
  {
    cellId: "PU-1",
    person: "Lia Mendoza",
    answer: "Children with delays are lost because assessment and therapy sit on opposite sides of a commute most families cannot afford. We collapse that distance.",
    meta: { missesUsFirst: "Therapy center admins", angle: "Systemic Friction" },
  },

  // PU-2 / Q4
  {
    cellId: "PU-2",
    person: "Ana Reyes",
    answer: "Every child in the Philippines with a developmental delay is identified before age five.",
    confidence: 2,
    meta: { horizon: "10 Years", flavor: "National Health Outcome" },
  },
  {
    cellId: "PU-2",
    person: "Benito Cruz",
    answer: "The default operating system for pediatric therapy in Southeast Asia.",
    confidence: 2,
    meta: { horizon: "10 Years", flavor: "Regional Market Leader" },
  },
  {
    cellId: "PU-2",
    person: "Carla Santos",
    answer: "The operating system the whole developmental therapy sector runs on before ten years are out.",
    confidence: 2,
    meta: { horizon: "10 Years", flavor: "Sector Infrastructure" },
  },
  {
    cellId: "PU-2",
    person: "Diego Tan",
    answer: "Every child in the country referred for developmental therapy is seen, tracked and supported by us.",
    confidence: 2,
    meta: { horizon: "10 Years", flavor: "Coverage & Referral Reach" },
  },
  {
    cellId: "PU-2",
    person: "Elena Villanueva",
    answer: "The record every pediatric therapist in the Philippines reaches for by default.",
    confidence: 2,
    meta: { horizon: "10 Years", flavor: "Standard of Clinical Care" },
  },
  {
    cellId: "PU-2",
    person: "Lia Mendoza",
    answer: "The default way pediatric developmental care is delivered in the Philippines.",
    confidence: 2,
    meta: { horizon: "10 Years", flavor: "Delivery Paradigm Shift" },
  },

  // T35-2 / Q3
  {
    cellId: "T35-2",
    person: "Ana Reyes",
    answer: "Paying therapy centers — 300. Centers are the distribution; everything real runs on them adopting us.",
    confidence: 3,
    meta: { metric: "Paying therapy centers", target: "300", unit: "centers" },
  },
  {
    cellId: "T35-2",
    person: "Benito Cruz",
    answer: "Paying therapy centers — 350. Adoption in real centers is the number that proves we changed healthcare delivery.",
    confidence: 3,
    meta: { metric: "Paying therapy centers", target: "350", unit: "centers" },
  },
  {
    cellId: "T35-2",
    person: "Carla Santos",
    answer: "Paying therapy centers — 250. It is the count that means we actually reached the families we claim to serve.",
    confidence: 3,
    meta: { metric: "Paying therapy centers", target: "250", unit: "centers" },
  },
  {
    cellId: "T35-2",
    person: "Diego Tan",
    answer: "Paying therapy centers — 400. Engaged centers are the only durable signal that clinicians actually adopted the workflow.",
    confidence: 3,
    meta: { metric: "Paying therapy centers", target: "400", unit: "centers" },
  },
  {
    cellId: "T35-2",
    person: "Elena Villanueva",
    answer: "Paying therapy centers — 275. Centers paying us month after month proves the software earns its keep in their workflow.",
    confidence: 3,
    meta: { metric: "Paying therapy centers", target: "275", unit: "centers" },
  },
  {
    cellId: "T35-2",
    person: "Lia Mendoza",
    answer: "Paying therapy centers — 250. The number of centers actively paying is the honest test of whether we built something clinics keep.",
    confidence: 3,
    meta: { metric: "Paying therapy centers", target: "250", unit: "centers" },
  },

  // T35-3 / Q5, Q6, Q9
  {
    cellId: "T35-3",
    person: "Ana Reyes",
    answer: "Center owners decide and pay. If they churn, there is no data for the parent to look at anyway.",
    meta: { decides: "Center Owner", pays: "Center Owner", primaryCustomer: "Therapy Center" },
  },
  {
    cellId: "T35-3",
    person: "Benito Cruz",
    answer: "Centers gate every therapist in the country; win them and the parents follow.",
    meta: { decides: "Center Owner", pays: "Center Owner", primaryCustomer: "Therapy Center" },
  },
  {
    cellId: "T35-3",
    person: "Carla Santos",
    answer: "The parent picks whoever the center already trusts; we have to earn the center's adoption first.",
    meta: { decides: "Center Owner", pays: "Center Owner", primaryCustomer: "Therapy Center" },
  },
  {
    cellId: "T35-3",
    person: "Diego Tan",
    answer: "Pediatricians decide and parents drive demand. Centers will adopt whatever parents are already asking for.",
    meta: { decides: "Pediatrician", pays: "Parent", primaryCustomer: "Parent" },
  },
  {
    cellId: "T35-3",
    person: "Elena Villanueva",
    answer: "The parent is the human we are actually here for; everything else is infrastructure.",
    meta: { decides: "Pediatrician", pays: "Parent", primaryCustomer: "Parent" },
  },
  {
    cellId: "T35-3",
    person: "Lia Mendoza",
    answer: "We cannot claim to be about the parent and then abandon them the moment money is mentioned.",
    meta: { decides: "Pediatrician", pays: "Parent", primaryCustomer: "Parent" },
  },

  // T35-3b / Q9
  {
    cellId: "T35-3b",
    person: "Ana Reyes",
    answer: "1. No teletherapy delivery. 2. No adult rehab. 3. No hospital enterprise sales cycles.",
  },
  {
    cellId: "T35-3b",
    person: "Diego Tan",
    answer: "1. No teletherapy. 2. No adult rehab. 3. No building billing engines we can integrate.",
  },
  {
    cellId: "T35-3b",
    person: "Elena Villanueva",
    answer: "1. No proprietary payments. 2. No adult rehab. 3. No hospital systems.",
  },

  // T35-4 / Q7
  {
    cellId: "T35-4",
    person: "Ana Reyes",
    answer: "Show the parent, the therapist and the referring doctor the same live progress record.",
    confidence: 4,
    meta: { promiseFocus: "Unified Live Progress" },
  },
  {
    cellId: "T35-4",
    person: "Benito Cruz",
    answer: "Cut two hours of administrative paperwork per therapist per week.",
    confidence: 4,
    meta: { promiseFocus: "Clinician Time Savings" },
  },
  {
    cellId: "T35-4",
    person: "Carla Santos",
    answer: "Connect the referral, the therapy sessions and the milestone report in one thread.",
    confidence: 4,
    meta: { promiseFocus: "End-to-End Threading" },
  },
  {
    cellId: "T35-4",
    person: "Diego Tan",
    answer: "Built specifically for Filipino pediatric developmental therapy, not adapted from US EMRs.",
    confidence: 4,
    meta: { promiseFocus: "Local Clinical Fit" },
  },
  {
    cellId: "T35-4",
    person: "Elena Villanueva",
    answer: "Make the parent, the school and the clinic finally see the exact same progress story.",
    confidence: 4,
    meta: { promiseFocus: "Multidisciplinary Alignment" },
  },
  {
    cellId: "T35-4",
    person: "Lia Mendoza",
    answer: "Give every parent a therapist-backed progress record they actually understand.",
    confidence: 4,
    meta: { promiseFocus: "Parent Comprehension" },
  },

  // T35-5 / Q8
  {
    cellId: "T35-5",
    person: "Ana Reyes",
    answer: "PedConnect (1st) -> TeachDay -> ParentUp. Delete: PedMD. Why: The referral is the scarce resource; a center with no incoming referrals needs no management software.",
    confidence: 5,
    meta: { rank1: "PedConnect", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Benito Cruz",
    answer: "PedConnect (1st) -> TeachDay -> ParentUp. Delete: PedMD. Why: Pediatrician referrals drive the whole funnel.",
    confidence: 4,
    meta: { rank1: "PedConnect", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Carla Santos",
    answer: "PedConnect (1st) -> TeachDay -> ParentUp. Delete: PedMD. Why: Center software is commodity; physician connectivity is defensible.",
    confidence: 5,
    meta: { rank1: "PedConnect", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Diego Tan",
    answer: "TeachDay (1st) -> PedConnect -> ParentUp. Delete: PedMD. Why: Centers have daily operational pain and cash; doctors will not change a 15-year habit for a startup.",
    confidence: 5,
    meta: { rank1: "TeachDay", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Elena Villanueva",
    answer: "TeachDay (1st) -> PedConnect -> ParentUp. Delete: PedMD. Why: Win the therapy center's staff first before asking doctors to install anything.",
    confidence: 4,
    meta: { rank1: "TeachDay", kill: "PedMD" },
  },
  {
    cellId: "T35-5",
    person: "Lia Mendoza",
    answer: "TeachDay (1st) -> PedConnect -> ParentUp. Delete: PedMD. Why: Center operations pay the bills today; doctor networks take years to cultivate.",
    confidence: 5,
    meta: { rank1: "TeachDay", kill: "PedMD" },
  },

  // T35-6 / Q10
  {
    cellId: "T35-6",
    person: "Ana Reyes",
    answer: "Center pays monthly subscription. ₱2,500/month flat per center. First peso: Jan 2027.",
    confidence: 1,
    meta: { payer: "Center", model: "Monthly subscription", amount: "₱2,500", firstPeso: "2027-01" },
  },
  {
    cellId: "T35-6",
    person: "Benito Cruz",
    answer: "Center pays monthly subscription. ₱2,800/month flat per center. First peso: Mar 2027.",
    confidence: 2,
    meta: { payer: "Center", model: "Monthly subscription", amount: "₱2,800", firstPeso: "2027-03" },
  },
  {
    cellId: "T35-6",
    person: "Carla Santos",
    answer: "Center pays monthly subscription. ₱3,000/month flat per center. First peso: Dec 2026.",
    confidence: 1,
    meta: { payer: "Center", model: "Monthly subscription", amount: "₱3,000", firstPeso: "2026-12" },
  },
  {
    cellId: "T35-6",
    person: "Diego Tan",
    answer: "Center pays per active child. ₱200 per active child per month. First peso: Nov 2026.",
    confidence: 2,
    meta: { payer: "Center", model: "Per active child", amount: "₱200", firstPeso: "2026-11" },
  },
  {
    cellId: "T35-6",
    person: "Elena Villanueva",
    answer: "Center pays per active child. ₱250 per active child per month. First peso: Jan 2027.",
    confidence: 1,
    meta: { payer: "Center", model: "Per active child", amount: "₱250", firstPeso: "2027-01" },
  },
  {
    cellId: "T35-6",
    person: "Lia Mendoza",
    answer: "Center pays per active child. ₱150 per active child per month. First peso: Dec 2026.",
    confidence: 2,
    meta: { payer: "Center", model: "Per active child", amount: "₱150", firstPeso: "2026-12" },
  },

  // G1-2 / Q3, Q10
  {
    cellId: "G1-2",
    person: "Diego Tan",
    answer: "First peso in Nov 2026 with ₱200/child pricing model. Target 35 centers by year 1.",
    confidence: 2,
    meta: { timeline: "12 Months", revenueTarget: "₱350k MRR" },
  },
  {
    cellId: "G1-2",
    person: "Ana Reyes",
    answer: "First peso Jan 2027 with ₱2,500/center subscription. Target 30-40 centers by year 1.",
    confidence: 2,
    meta: { timeline: "12 Months", revenueTarget: "₱300k MRR" },
  },

  // G1-3 / Q11
  {
    cellId: "G1-3",
    person: "Ana Reyes",
    answer: "1. Onboard 8 beta centers (20+ real sessions each). 2. Prove referral loop (15 referrals complete). 3. Data privacy baseline (NPC filed).",
    confidence: 4,
    meta: { starred: "Onboard beta centers" },
  },
  {
    cellId: "G1-3",
    person: "Benito Cruz",
    answer: "1. Prove referral loop (15 referrals doctor -> center -> parent). 2. Decide the wedge with written conversion evidence.",
    confidence: 4,
    meta: { starred: "Prove referral loop" },
  },
  {
    cellId: "G1-3",
    person: "Carla Santos",
    answer: "1. Data privacy baseline (NPC registration filed, consent flow shipped). 2. Hire clinical adviser on retainer.",
    confidence: 4,
    meta: { starred: "Data privacy baseline" },
  },
  {
    cellId: "G1-3",
    person: "Diego Tan",
    answer: "1. Prove referral loop. 2. Onboard beta centers. 3. Decide the wedge.",
    confidence: 4,
    meta: { starred: "Decide the wedge" },
  },
  {
    cellId: "G1-3",
    person: "Elena Villanueva",
    answer: "1. Decide the wedge. 2. Onboard beta centers (8 centers, 20+ sessions).",
    confidence: 4,
    meta: { starred: "Onboard beta centers" },
  },
  {
    cellId: "G1-3",
    person: "Lia Mendoza",
    answer: "1. Hire clinical adviser (OT/SLP on retainer). 2. Prove referral loop end to end.",
    confidence: 4,
    meta: { starred: "Hire clinical adviser" },
  },

  // G1-4 / Q3
  {
    cellId: "G1-4",
    person: "Ana Reyes",
    answer: "Paying therapy centers — 15 in year 1. Proves clinics find the software indispensable.",
    confidence: 3,
  },
  {
    cellId: "G1-4",
    person: "Diego Tan",
    answer: "Active children receiving weekly tracked therapy — 500 children. Proves clinical throughput.",
    confidence: 3,
  },

  // G1-5 / Q13
  {
    cellId: "G1-5",
    person: "Carla Santos",
    answer: "NPC compliance audit clearance and zero patient privacy complaints.",
  },
  {
    cellId: "G1-5",
    person: "Elena Villanueva",
    answer: "Parent retention: <5% drop-off across 8-week therapy cycles.",
  },

  // A90-3 / Q11
  {
    cellId: "A90-3",
    person: "Ana Reyes",
    answer: "Onboard beta centers: 8 centers each logged 20+ real sessions with active therapists.",
    confidence: 4,
  },
  {
    cellId: "A90-3",
    person: "Diego Tan",
    answer: "Prove referral loop: 15 pediatric referrals completed from doctor to center to parent progress view.",
    confidence: 4,
  },
  {
    cellId: "A90-3",
    person: "Carla Santos",
    answer: "Data privacy baseline: NPC registration filed, consent flow shipped, DPO officially named.",
    confidence: 4,
  },

  // TH-3 / Q12
  {
    cellId: "TH-3",
    person: "Ana Reyes",
    answer: "Make the referral loop real",
    meta: { tone: "Action-oriented" },
  },
  {
    cellId: "TH-3",
    person: "Benito Cruz",
    answer: "Eight centers, zero drop-offs",
    meta: { tone: "Retention & Adoption" },
  },
  {
    cellId: "TH-3",
    person: "Carla Santos",
    answer: "Prove someone will pay",
    meta: { tone: "Commercial Validation" },
  },
  {
    cellId: "TH-3",
    person: "Diego Tan",
    answer: "From school project to company",
    meta: { tone: "Maturity & Transition" },
  },
  {
    cellId: "TH-3",
    person: "Elena Villanueva",
    answer: "Prove someone will pay",
    meta: { tone: "Commercial Validation" },
  },
  {
    cellId: "TH-3",
    person: "Lia Mendoza",
    answer: "From school project to company",
    meta: { tone: "Maturity & Transition" },
  },

  // TH-7 / Q13
  {
    cellId: "TH-7",
    person: "Diego Tan",
    answer: "Green: Doctors referring digitally weekly. Red: Relying on paper referrals with no app engagement.",
  },
  {
    cellId: "TH-7",
    person: "Ana Reyes",
    answer: "Green: Centers running their daily schedule on Anakloud. Red: Double-booking via Viber groups.",
  },

  // AC-1 & AC-2 / Q14
  {
    cellId: "AC-1",
    person: "Ana Reyes",
    answer: "Wants: Product, Backend, Data Privacy & Security. Hours: 30 hrs/wk.",
    meta: { roleWants: "Product / Backend", hours: "30" },
  },
  {
    cellId: "AC-1",
    person: "Benito Cruz",
    answer: "Wants: Product, Mobile/Web, Design/UX. Hours: 40 hrs/wk.",
    meta: { roleWants: "Mobile / Design", hours: "40" },
  },
  {
    cellId: "AC-1",
    person: "Carla Santos",
    answer: "Wants: Backend, QA, Data Privacy & Security. Hours: 35 hrs/wk.",
    meta: { roleWants: "Backend / QA / Privacy", hours: "35" },
  },
  {
    cellId: "AC-1",
    person: "Diego Tan",
    answer: "Wants: Product, Sales & Partnerships, Doctor Relations. Hours: 40 hrs/wk (evenings/clinics).",
    meta: { roleWants: "Sales / Doctor Relations", hours: "40" },
  },
  {
    cellId: "AC-1",
    person: "Elena Villanueva",
    answer: "Wants: Design/UX, Marketing, Onboarding & Success. Hours: 8 hrs/wk.",
    meta: { roleWants: "Design / Success", hours: "8" },
  },
  {
    cellId: "AC-1",
    person: "Lia Mendoza",
    answer: "Wants: Backend, Finance, Fundraising. Hours: 20 hrs/wk.",
    meta: { roleWants: "Finance / Fundraising", hours: "20" },
  },
  {
    cellId: "AC-2",
    person: "Ana Reyes",
    answer: "Weekly priority: Ship sprint releases & run center onboarding check-ins.",
  },
  {
    cellId: "AC-2",
    person: "Diego Tan",
    answer: "Weekly priority: 5 doctor 1:1 meetings & 2 center partnership follow-ups.",
  },
];

/**
 * Facilitator notes (sensitive strategic commentary).
 * VISIBILITY GATED: only served when audience mode is 'facilitator'.
 */
export const FACILITATOR_NOTES: readonly FacilitatorNote[] = [
  {
    cellId: "SWT-2",
    body: "Critical pre-mortem takeaway: 3 founders fear workflow inertia in centers, while 2 fear co-founder availability post-graduation. Address founder time commitments in 1:1s before locking rocks.",
  },
  {
    cellId: "PU-1",
    body: "Notice the split: Ana/Diego view Anakloud as a healthcare access mission (Cavite commute); Benito/Elena see it as a parent trust/visibility play; Carla sees it as B2B center workflow software. Keep the mission inclusive of access and workflow.",
  },
  {
    cellId: "PU-2",
    body: "Confidence is uniformly low (2/5) as expected pre-beta. Keep the BHAG in pencil for now and revisit in Q2 2027 once real clinical throughput numbers exist.",
  },
  {
    cellId: "T35-2",
    body: "Strong alignment on unit: all 6 respondents chose 'paying therapy centers' with targets between 250 and 400. This is a solid foundation for distribution discussions.",
  },
  {
    cellId: "T35-3",
    body: "Hard split on customer identity: 3 founders (Ana, Benito, Carla) say the center owner is the primary customer; 3 founders (Diego, Elena, Lia) insist the parent or doctor is the primary customer. Must be resolved during group discussion.",
  },
  {
    cellId: "T35-5",
    body: "Clean 3-3 split on lead wedge app: Ana/Benito/Carla picked PedConnect (doctor referral first); Diego/Elena/Lia picked TeachDay (center ops first). All 6 agreed on killing PedMD.",
  },
  {
    cellId: "T35-6",
    body: "Soft split on monetization: subscription per center (₱2,500-₱3,000) vs per active child (₱150-₱250). Low confidence across the board. Resolve by testing both pricing tiers in the upcoming pilot.",
  },
  {
    cellId: "G1-3",
    body: "Starred rock conflict: Ana & Elena starred 'Onboard beta centers'; Benito & Diego starred 'Prove referral loop'; Carla starred 'Data privacy'; Lia starred 'Hire clinical adviser'. Settle on exactly one #1 priority before concluding the workshop.",
  },
  {
    cellId: "TH-3",
    body: "'Make the referral loop real' and 'From school project to company' are the two dominant themes. Let the room vote live at the end of the session.",
  },
  {
    cellId: "AC-1",
    body: "Major hours imbalance: Benito (40h) and Diego (40h) vs Elena (8h) and Lia (20h). Nobody volunteered for Regulatory/Clinical Liaison or Bookkeeping. Treat these as immediate hiring / advisory needs.",
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
