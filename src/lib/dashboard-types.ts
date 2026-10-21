export type OpportunityStatus = "Nova" | "Em contato" | "Aguardando retorno" | "Convertida" | "Perdida" | "Inválida";

export type DashboardActionHistory = {
  id: string;
  action_type: string;
  notes: string | null;
  confirmed_revenue: number | null;
  evidence_reference: string | null;
  actor_user_id: string | null;
  actor_name: string;
  created_at: string;
};

export type DashboardOpportunity = {
  id: string;
  pet: string;
  owner: string;
  ownerPhone: string | null;
  ownerEmail: string | null;
  reason: string;
  source: string;
  date: string;
  value: number | null;
  quoteId: string | null;
  status: OpportunityStatus;
  rawStatus: "open" | "in_contact" | "waiting_reply" | "won" | "dismissed" | "invalid";
  category: string;
  priority: "low" | "medium" | "high";
  priorityReason: string;
  dataQuality: "complete" | "review";
  dataQualityNotes: string | null;
  valueSource: string | null;
  nextAction: string;
  nextActionAt: string | null;
  nextActionNote: string | null;
  history: DashboardActionHistory[];
  initials: string;
  color: string;
};

export type DashboardActivity = {
  id: string;
  title: string;
  text: string;
  time: string;
};

export type DashboardReview = { source_record_type: string; source_record_id: string; reason: string };

export type DashboardImport = {
  id: string;
  file_name: string;
  status: "pending" | "validated" | "completed" | "partial" | "failed" | "cancelled";
  rows_seen: number;
  rows_imported: number;
  rows_rejected: number;
  rows_duplicates: number;
  error_summary: string | null;
  created_at: string;
  completed_at: string | null;
};

export type DashboardData = {
  clinicName: string;
  userName: string;
  hasRealData: boolean;
  opportunities: DashboardOpportunity[];
  opportunityCount: number;
  pendingOpportunityCount: number;
  workedOpportunityCount: number;
  lostByReason: Array<{ reason: string; count: number }>;
  pendingPotentialValue: number | null;
  activity: DashboardActivity[];
  potentialValue: number | null;
  negotiationValue: number | null;
  confirmedRevenue: number | null;
  attributedRevenue: number | null;
  recentImports: DashboardImport[];
  importerReady: boolean;
  importerError: string | null;
  intelligenceReady: boolean;
  intelligenceReviews: DashboardReview[];
};
