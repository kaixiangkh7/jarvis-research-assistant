

export interface KeyInsight {
  title: string;
  description: string;
  citation_quote: string;
  context_block?: string; // The surrounding paragraph(s)
  page_reference?: string;
  category?: string; // e.g., 'Concept', 'Person', 'Stat', 'Date'
}

export interface AnalysisResult {
  source_file: string;
  doc_title: string; // was company_name
  doc_type: string; // was report_period (e.g. "Research Paper", "Contract")
  summary: string;
  key_insights: KeyInsight[];
  topics?: string[]; // New: List of main topics discussed
}

export interface OrchestratorTask {
  file_name: string;
  specific_question: string;
  rationale: string;
}

export interface OrchestratorStep {
  step_title: string;
  description: string;
  tasks: OrchestratorTask[];
}

export interface OrchestratorPlan {
  plan_type: 'SIMPLE_FACT' | 'DEEP_ANALYSIS';
  thought_process: string;
  strategy_explanation: string;
  steps: OrchestratorStep[];
  revision_commentary?: string; // New: Lead's defense or acceptance of advisor feedback
}

export interface Scorecard {
  goal_alignment: number;
  insight_quality: number;
  accuracy_traceability: number;
  robustness: number;
  simplicity: number;
  feasibility: number;
}

export interface AdvisorReview {
  scorecard: Scorecard;
  key_risks: string[];
  evidence_references: string[];
}

export interface OutputQualityVerdict {
  does_answer_query: boolean;
  has_hallucinations: boolean;
  consultant_opinion: string;
}

export interface LeadArbitration {
  verdict: "APPROVED" | "REJECTED" | "DEBATE" | "NEEDS_CLARIFICATION";
  reasoning: string;
  remediation_plan?: OrchestratorPlan;
  clarification_message?: string; // New: Message to display to the user
}

// New: For the recursive loop
export interface ResearchEvaluation {
  status: "CONTINUE_RESEARCH" | "FINALIZE";
  gap_analysis: string; // What is missing?
  new_plan?: OrchestratorPlan; // Only if status is CONTINUE
}

export interface ExecutionLog {
  tasks: OrchestratorTask[];
}

export interface ExecutionResultLog {
  results: { file: string; question: string; response: string }[];
}

export interface CollaborationStep {
  type: 'ORCHESTRATOR' | 'ADVISOR' | 'BOARD_REVIEW' | 'RESEARCH_EVALUATION' | 'EXECUTION_LOG' | 'EXECUTION_RESULTS' | 'LEAD_ARBITRATION';
  round: number;
  content: OrchestratorPlan | AdvisorReview | OutputQualityVerdict | ResearchEvaluation | ExecutionLog | ExecutionResultLog | LeadArbitration;
  timestamp: number;
}

export interface ClarificationOption {
  id: string;
  text: string;
  isCustomInput?: boolean;
}

export interface ClarificationQuestion {
  id: string;
  text: string;
  multiple_choice: boolean;
  options: ClarificationOption[];
}

export interface ClarificationRequest {
  requires_clarification: boolean;
  questions: ClarificationQuestion[];
}

export interface IntentClassification {
  type: 'DEEP_RESEARCH' | 'QUICK_ANSWER';
  reasoning: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text?: string;
  images?: File[]; // For multimodal input
  plan?: OrchestratorPlan; // If present, this message is a plan proposal
  clarification?: ClarificationRequest; // If present, we are in HITL mode
  thinking?: string; // For the synthesis phase
  collaborationSteps?: CollaborationStep[]; // The history of plan refinement
  isThinking?: boolean;
  intent?: IntentClassification; // New: Store the classification decision
  // New: Persisted state for HITL interactions
  selectedClarificationOptions?: Record<string, string[]>;
  selectedCustomInputs?: Record<string, string>;
}

export interface SourceViewData {
  fileName: string;
  page?: string;
  quote: string;
  contextBlock: string;
  rationale?: string; // For calculated/derived metrics
}
