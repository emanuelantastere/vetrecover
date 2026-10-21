const DAY = 86_400_000;
const PRIORITIES = ["low", "medium", "high"];

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function basePriority({ ageDays, expired = false, value = null }) {
  if (expired || ageDays >= 7) return "high";
  if (ageDays >= 2 || (Number.isFinite(value) && value >= 1000)) return "medium";
  return "low";
}

function lowerPriority(priority) {
  return PRIORITIES[Math.max(0, PRIORITIES.indexOf(priority) - 1)];
}

function priorityExplanation(priority, { ageDays, expired = false, value = null, ambiguous = false }) {
  const reasons = [];
  if (expired) reasons.push("prazo do orçamento vencido");
  else if (ageDays >= 7) reasons.push("registro sem resposta há 7 dias ou mais");
  else if (ageDays >= 2) reasons.push("registro sem resposta há pelo menos 2 dias");
  if (Number.isFinite(value) && value >= 1000) reasons.push("valor potencial igual ou superior a R$ 1.000");
  if (ambiguous) reasons.push("prioridade reduzida por informação incompleta ou ambígua; revisar antes de agir");
  return `${priority}: ${reasons.length ? reasons.join("; ") : "registro recente e de menor valor"}.`;
}

export function evaluatePendingQuote(quote, { asOf = new Date(), ambiguous = false } = {}) {
  if (quote?.status !== "pending") return { candidate: null, review: null };
  const issued = dateValue(quote.issued_at);
  if (issued === null) return { candidate: null, review: { type: "pending_quote", reason: "Orçamento pendente sem data de emissão; não é possível calcular o atraso." } };
  const now = dateValue(asOf);
  if (now === null) throw new TypeError("asOf precisa ser uma data válida.");
  if (issued > now) return { candidate: null, review: { type: "pending_quote", reason: "Data de emissão no futuro; revisar antes de recomendar contato." } };
  const ageDays = Math.max(0, Math.floor((now - issued) / DAY));
  const expires = dateValue(quote.expires_at);
  const expired = expires !== null && expires < now;
  const missingValue = !Number.isFinite(quote.amount) || quote.amount < 0;
  const needsReview = ambiguous || missingValue;
  const facts = { ageDays, expired, value: quote.amount, ambiguous: needsReview };
  const priority = needsReview ? lowerPriority(basePriority(facts)) : basePriority(facts);
  return {
    candidate: {
      opportunity_type: "pending_quote",
      source_record_type: "quote",
      source_record_id: quote.id,
      quote_id: quote.id,
      potential_value: Number.isFinite(quote.amount) && quote.amount >= 0 ? quote.amount : null,
      value_source: Number.isFinite(quote.amount) && quote.amount >= 0 ? "Orçamento importado" : null,
      source_occurred_at: quote.issued_at,
      priority,
      priority_reason: priorityExplanation(priority, facts),
      data_quality: needsReview ? "review" : "complete",
      data_quality_notes: [ambiguous ? "Possível duplicidade detectada na importação." : null, missingValue ? "Valor do orçamento ausente ou inválido." : null].filter(Boolean).join(" ") || null,
      recommendation_reason: expired ? "Orçamento pendente com prazo vencido." : `Orçamento pendente há ${ageDays} dia(s).`,
      recommended_action: "Confirmar com a equipe se o tutor recebeu o orçamento e registrar o retorno.",
    },
    review: null,
  };
}

export function evaluateCompletedAppointment(appointment, { asOf = new Date(), ambiguous = false, followUpDays = 2, inactiveDays = 180 } = {}) {
  if (appointment?.status !== "completed") return { candidate: null, review: null };
  const occurred = dateValue(appointment.starts_at);
  if (occurred === null) return { candidate: null, review: { type: "overdue_follow_up", reason: "Atendimento concluído sem data válida; requer revisão." } };
  const now = dateValue(asOf);
  if (now === null) throw new TypeError("asOf precisa ser uma data válida.");
  if (occurred > now) return { candidate: null, review: { type: "overdue_follow_up", reason: "Data de atendimento no futuro; revisar o status e a data de origem." } };
  const ageDays = Math.max(0, Math.floor((now - occurred) / DAY));
  if (ageDays < followUpDays || ageDays >= inactiveDays) return { candidate: null, review: null };
  const base = ageDays >= 7 ? "high" : "medium";
  const priority = ambiguous ? lowerPriority(base) : base;
  return {
    candidate: {
      opportunity_type: "overdue_follow_up",
      source_record_type: "appointment",
      source_record_id: appointment.id,
      appointment_id: appointment.id,
      potential_value: null,
      value_source: null,
      source_occurred_at: appointment.starts_at,
      priority,
      priority_reason: `${priority}: atendimento concluído há ${ageDays} dia(s); regra de acompanhamento após ${followUpDays} dias${ambiguous ? "; prioridade reduzida por ambiguidade" : ""}.`,
      data_quality: ambiguous ? "review" : "complete",
      data_quality_notes: ambiguous ? "Possível duplicidade detectada na importação." : null,
      recommendation_reason: `Atendimento concluído há ${ageDays} dia(s), sem oportunidade de acompanhamento para este evento.`,
      recommended_action: "Verificar como o paciente evoluiu e registrar o contato realizado.",
    },
    review: null,
  };
}

export function evaluateInactiveClient(client, events, { asOf = new Date(), inactiveDays = 180, ambiguous = false } = {}) {
  const validEvents = (events ?? []).map((event) => ({ ...event, time: dateValue(event.occurred_at) }));
  if (!client?.id || validEvents.length === 0 || validEvents.some((event) => event.time === null)) {
    return { candidate: null, review: { type: "inactive_client", client_id: client?.id ?? null, reason: validEvents.length ? "Há eventos sem data válida; atividade do cliente requer revisão." : "Não há histórico de atividade suficiente para avaliar inatividade." } };
  }
  const now = dateValue(asOf);
  if (now === null) throw new TypeError("asOf precisa ser uma data válida.");
  if (validEvents.some((event) => event.time > now)) return { candidate: null, review: { type: "inactive_client", client_id: client.id, reason: "Existe evento com data no futuro; revisar as datas antes de avaliar inatividade." } };
  const latest = validEvents.reduce((a, b) => a.time > b.time ? a : b);
  if (latest.event_type !== "completed_appointment") return { candidate: null, review: null };
  const ageDays = Math.max(0, Math.floor((now - latest.time) / DAY));
  if (ageDays < inactiveDays) return { candidate: null, review: null };
  const base = ageDays >= 365 ? "high" : "medium";
  const priority = ambiguous ? lowerPriority(base) : base;
  return {
    candidate: {
      opportunity_type: "inactive_client",
      source_record_type: "appointment",
      source_record_id: latest.id,
      appointment_id: latest.id,
      client_id: client.id,
      potential_value: null,
      value_source: null,
      source_occurred_at: latest.occurred_at,
      priority,
      priority_reason: `${priority}: última atividade em atendimento concluído há ${ageDays} dia(s); regra de inatividade: ${inactiveDays} dias${ambiguous ? "; prioridade reduzida por ambiguidade" : ""}.`,
      data_quality: ambiguous ? "review" : "complete",
      data_quality_notes: ambiguous ? "Possível duplicidade detectada na importação." : null,
      recommendation_reason: `Cliente sem orçamento ou atendimento posterior ao atendimento concluído há ${ageDays} dia(s).`,
      recommended_action: "Revisar o histórico antes de oferecer retorno ou novo agendamento.",
    },
    review: null,
  };
}

export function deduplicateCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) return false;
    const key = `${candidate.clinic_id ?? ""}:${candidate.opportunity_type}:${candidate.source_record_type}:${candidate.source_record_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const terminal = new Set(["won", "dismissed", "invalid"]);

export function validateOpportunityAction(currentStatus, targetStatus, { reason = "", confirmedRevenue = null, evidenceReference = "" } = {}) {
  const allowed = new Set(["in_contact", "won", "dismissed", "invalid"]);
  if (!allowed.has(targetStatus)) return { valid: false, error: "Ação de status inválida." };
  if (terminal.has(currentStatus)) return { valid: false, error: "Oportunidades encerradas não podem ser alteradas." };
  if (targetStatus === "dismissed" || targetStatus === "invalid") {
    if (!reason.trim()) return { valid: false, error: "Informe uma justificativa para encerrar a oportunidade." };
  }
  if (targetStatus === "won") {
    if (!Number.isFinite(confirmedRevenue) || confirmedRevenue < 0) return { valid: false, error: "Informe o valor da venda concluída." };
    if (!evidenceReference.trim()) return { valid: false, error: "Informe uma referência verificável da venda." };
  } else if (confirmedRevenue !== null || evidenceReference.trim()) {
    return { valid: false, error: "Dados de venda só podem ser informados ao concluir com venda." };
  }
  return { valid: true, error: null };
}

export function calculateFinancialTotals(opportunities, actions, clinicId = null) {
  const quoteValues = new Map();
  for (const opportunity of opportunities ?? []) {
    if (clinicId !== null && opportunity.clinic_id !== clinicId) continue;
    if (opportunity.status !== "open" && opportunity.status !== "in_contact") continue;
    if (opportunity.opportunity_type !== "pending_quote" || !opportunity.quote_id) continue;
    const key = `${opportunity.clinic_id ?? ""}:${opportunity.quote_id}`;
    if (Number.isFinite(opportunity.potential_value) && opportunity.potential_value >= 0) {
      quoteValues.set(key, Math.max(quoteValues.get(key) ?? 0, opportunity.potential_value));
    }
  }
  const sales = new Map();
  for (const action of actions ?? []) {
    if (clinicId !== null && action.clinic_id !== clinicId) continue;
    if (action.action_type !== "sale_confirmed" || !action.evidence_reference || !Number.isFinite(action.confirmed_revenue) || action.confirmed_revenue < 0) continue;
    const key = `${action.clinic_id ?? ""}:${action.evidence_reference}`;
    if (!sales.has(key)) sales.set(key, action.confirmed_revenue);
  }
  return {
    pendingPotential: [...quoteValues.values()].reduce((sum, value) => sum + value, 0),
    confirmedRevenue: [...sales.values()].reduce((sum, value) => sum + value, 0),
    attributedRevenue: 0,
  };
}
