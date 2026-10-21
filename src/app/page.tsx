import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Dashboard } from "@/components/dashboard";
import { SystemState } from "@/components/system-state";
import { createClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { initials, summarizeOpportunityLifecycle } from "@/lib/dashboard-data.mjs";
import type { DashboardActionHistory, DashboardActivity, DashboardOpportunity } from "@/lib/dashboard-types";

const colors = ["lavender", "peach", "mint", "rose"];
type RawActionHistory = {
  id: string;
  opportunity_id: string;
  action_type: string;
  notes: string | null;
  confirmed_revenue: number | string | null;
  evidence_reference?: string | null;
  actor_user_id?: string | null;
  created_at: string;
};

export default async function HomePage() {
  if (!getSupabasePublicConfig()) {
    return <SystemState title="Conecte seu projeto Supabase"><p>O dashboard está protegido e não exibe dados demonstrativos. Configure as variáveis do Supabase em <code>.env.local</code> e aplique a migração SQL para ativar as contas da clínica.</p><p>Os passos detalhados estão no README. Nenhuma credencial é necessária para compilar o projeto.</p></SystemState>;
  }

  // This page renders authenticated, request-specific clinic data. Keep the
  // Supabase auth/session work out of the prerendered shell.
  await connection();

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login?reason=expired");

  const { data: membership, error: membershipError } = await supabase
    .from("clinic_memberships")
    .select("clinic_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return <SystemState title="Banco ainda não preparado"><p>Não foi possível carregar a clínica. Confirme que aplicou a migração <code>202610190001_initial_schema.sql</code> no projeto Supabase conectado.</p></SystemState>;
  }
  if (!membership) {
    return <SystemState title="Nenhuma clínica associada"><p>Esta conta não tem vínculo ativo com uma clínica. Crie uma conta informando o nome da clínica ou peça ao administrador para configurar o vínculo.</p></SystemState>;
  }

  const { data: intelligenceRefresh, error: intelligenceRefreshError } = await supabase.rpc("reconcile_clinic_opportunities", {
    target_clinic_id: membership.clinic_id,
    as_of: new Date().toISOString(),
  });

  const [{ data: clinic, error: clinicError }, { data: opportunityRows, count: opportunityCount, error: opportunitiesError }, { data: intelligenceTotals, error: intelligenceTotalsError }, { data: importRows, error: importsError }] = await Promise.all([
    supabase.from("clinics").select("name").eq("id", membership.clinic_id).maybeSingle(),
    supabase.from("opportunities").select("*, client:clients!opportunities_client_tenant_fkey(name, phone, email), pet:pets!opportunities_pet_tenant_fkey(name), quote:quotes!opportunities_clinic_id_quote_id_fkey(id, amount, status, issued_at, expires_at, import_id), appointment:appointments!opportunities_clinic_id_appointment_id_fkey(id, status, starts_at, service_name, import_id)", { count: "exact" }).eq("clinic_id", membership.clinic_id).order("created_at", { ascending: false }).range(0, 999),
    supabase.rpc("clinic_intelligence_totals", { target_clinic_id: membership.clinic_id }),
    supabase.from("imports").select("id, file_name, status, rows_seen, rows_imported, rows_rejected, rows_duplicates, error_summary, created_at, completed_at").eq("clinic_id", membership.clinic_id).order("created_at", { ascending: false }).limit(20),
  ]);

  const financialRows = intelligenceTotals;
  const financialError = intelligenceTotalsError;

  const allOpportunityRows = [...(opportunityRows ?? [])];
  let opportunityPageError: unknown = null;
  for (let offset = allOpportunityRows.length; offset < (opportunityCount ?? 0); offset += 1000) {
    const { data: page, error } = await supabase.from("opportunities")
      .select("*, client:clients!opportunities_client_tenant_fkey(name, phone, email), pet:pets!opportunities_pet_tenant_fkey(name), quote:quotes!opportunities_clinic_id_quote_id_fkey(id, amount, status, issued_at, expires_at, import_id), appointment:appointments!opportunities_clinic_id_appointment_id_fkey(id, status, starts_at, service_name, import_id)")
      .eq("clinic_id", membership.clinic_id).order("created_at", { ascending: false }).range(offset, offset + 999);
    if (error) { opportunityPageError = error; break; }
    allOpportunityRows.push(...(page ?? []));
    if ((page ?? []).length < 1000) break;
  }

  const opportunityIds = allOpportunityRows.map((row) => row.id as string);
  const detailedHistories: RawActionHistory[] = [];
  let detailedHistoryError: unknown = null;
  for (let offset = 0; opportunityIds.length > 0; offset += 1000) {
    const { data, error } = await supabase
      .from("action_history")
      .select("*")
      .eq("clinic_id", membership.clinic_id)
      .in("opportunity_id", opportunityIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 999);
    if (error) {
      detailedHistoryError = error;
      break;
    }
    detailedHistories.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  if (clinicError || opportunitiesError || opportunityPageError || detailedHistoryError || financialError || !clinic) {
    return <SystemState title="Não foi possível carregar os dados"><p>A clínica está autenticada, mas a consulta ao banco falhou. Verifique o estado da migração e as políticas RLS; nenhum dado de exemplo será mostrado.</p></SystemState>;
  }

  const rows = [...allOpportunityRows].sort((a, b) => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (order[a.priority] ?? 3) - (order[b.priority] ?? 3) || b.created_at.localeCompare(a.created_at);
  });
  const histories = detailedHistories;
  const hasRealData = (opportunityCount ?? 0) > 0 || histories.length > 0 || (importRows ?? []).some((item) => item.rows_imported > 0);
  const totals = Array.isArray(financialRows) ? financialRows[0] : financialRows;
  const sourceImportIds = [...new Set(rows.flatMap((row) => {
    const quote = Array.isArray(row.quote) ? row.quote[0] : row.quote;
    const appointment = Array.isArray(row.appointment) ? row.appointment[0] : row.appointment;
    return [quote?.import_id, appointment?.import_id].filter((id): id is string => Boolean(id));
  }))];
  const { data: sourceImports } = sourceImportIds.length
    ? await supabase.from("imports").select("id, file_name").eq("clinic_id", membership.clinic_id).in("id", sourceImportIds)
    : { data: [] };
  const importNames = new Map((sourceImports ?? []).map((item) => [item.id, item.file_name]));
  const userName = user.user_metadata?.full_name || "Equipe";
  const actionsByOpportunity = new Map<string, DashboardActionHistory[]>();
  for (const action of histories) {
    const current = actionsByOpportunity.get(action.opportunity_id) ?? [];
    current.push({
      id: action.id,
      action_type: action.action_type,
      notes: action.notes,
      confirmed_revenue: action.confirmed_revenue == null ? null : Number(action.confirmed_revenue),
      evidence_reference: action.evidence_reference ?? null,
      actor_user_id: action.actor_user_id ?? null,
      actor_name: action.actor_user_id === user.id ? userName : "Membro da clínica",
      created_at: action.created_at,
    });
    actionsByOpportunity.set(action.opportunity_id, current);
  }
  const opportunities: DashboardOpportunity[] = rows.map((row, index) => {
    const client = Array.isArray(row.client) ? row.client[0] : row.client;
    const pet = Array.isArray(row.pet) ? row.pet[0] : row.pet;
    const quote = Array.isArray(row.quote) ? row.quote[0] : row.quote;
    const appointment = Array.isArray(row.appointment) ? row.appointment[0] : row.appointment;
    const petName = pet?.name ?? client?.name ?? "Paciente";
    const clientName = client?.name ?? "Cliente";
    const sourceImportId = quote?.import_id ?? appointment?.import_id;
    const sourceFile = sourceImportId ? importNames.get(sourceImportId) : null;
    const sourceLabel = row.source_record_type === "quote" ? "Orçamento" : row.source_record_type === "appointment" ? "Atendimento" : row.source_record_type === "client" ? "Cadastro do cliente" : "Registro manual";
    const status = row.status === "won" ? "Convertida" : row.status === "in_contact" ? "Em contato" : row.status === "waiting_reply" ? "Aguardando retorno" : row.status === "dismissed" ? "Perdida" : row.status === "invalid" ? "Inv\u00e1lida" : "Nova";
    const category = row.opportunity_type === "pending_quote" ? "Orçamento pendente" : row.opportunity_type === "overdue_follow_up" ? "Acompanhamento atrasado" : row.opportunity_type === "inactive_client" ? "Cliente inativo" : "Manual";
    const rawValue = row.potential_value;
    return {
      id: row.id,
      pet: petName,
      owner: clientName,
      ownerPhone: client?.phone ?? null,
      ownerEmail: client?.email ?? null,
      reason: row.recommendation_reason,
      source: `${sourceLabel} · ${sourceFile ? `${sourceFile} · ` : ""}${String(row.source_record_id ?? row.id).slice(0, 8)}`,
      date: `Dado de ${new Date(row.source_occurred_at ?? quote?.issued_at ?? appointment?.starts_at ?? row.created_at).toLocaleDateString("pt-BR")}`,
      value: rawValue == null ? null : Number(rawValue),
      quoteId: row.quote_id ?? null,
      status,
      rawStatus: row.status,
      category,
      priority: row.priority ?? "low",
      priorityReason: row.priority_reason ?? "Prioridade ainda não calculada; aplique a migração do motor de inteligência.",
      dataQuality: row.data_quality ?? "complete",
      dataQualityNotes: row.data_quality_notes ?? null,
      valueSource: row.value_source ?? (quote?.amount != null ? "Orçamento importado" : null),
      nextAction: row.recommended_action ?? "Revisar o registro de origem.",
      nextActionAt: row.next_action_at ?? null,
      nextActionNote: row.next_action_note ?? null,
      history: [...(actionsByOpportunity.get(row.id) ?? [])].reverse(),
      initials: initials(petName || clientName),
      color: colors[index % colors.length],
    };
  });
  const activityLabels: Record<string, string> = {
    recommendation_approved: "Recomendação aprovada",
    recommendation_rejected: "Recomendação rejeitada",
    contacted: "Contato registrado",
    contact_attempted: "Tentativa de contato",
    no_response: "Sem resposta",
    follow_up_scheduled: "Retorno agendado",
    sale_confirmed: "Venda confirmada",
    note_added: "Observação registrada",
    status_changed: "Status atualizado",
  };
  const lifecycleTotals = summarizeOpportunityLifecycle(
    rows.map((row) => ({ id: row.id as string, status: row.status as string })),
    histories,
  );
  const activity: DashboardActivity[] = histories.map((row) => ({
    id: row.id,
    title: activityLabels[row.action_type] ?? "Ação registrada",
    text: row.notes || "Ação registrada sem observação.",
    time: new Date(row.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
  }));
  return <Dashboard data={{
    clinicName: clinic.name,
    userName,
    hasRealData,
    opportunities,
    opportunityCount: opportunityCount ?? 0,
    pendingOpportunityCount: Number(totals?.pending_opportunity_count ?? 0),
    workedOpportunityCount: lifecycleTotals.workedOpportunityCount,
    lostByReason: lifecycleTotals.lostByReason,
    pendingPotentialValue: totals?.pending_potential_value == null ? null : Number(totals.pending_potential_value),
    activity,
    potentialValue: !hasRealData || totals?.potential_value == null ? null : Number(totals.potential_value),
    negotiationValue: !hasRealData || totals?.negotiation_value == null ? null : Number(totals.negotiation_value),
    confirmedRevenue: !hasRealData || totals?.confirmed_revenue == null ? null : Number(totals.confirmed_revenue),
    attributedRevenue: !hasRealData || totals?.attributed_revenue == null ? null : Number(totals.attributed_revenue),
    recentImports: importRows ?? [],
    importerReady: !importsError,
    importerError: importsError ? "Não foi possível carregar o histórico de importações. Atualize a página; se o erro continuar, confira a conexão e as permissões no Supabase." : null,
    intelligenceReady: !intelligenceRefreshError,
    intelligenceReviews: intelligenceRefresh?.reviews ?? [],
  }} />;
}
