const eventLabels = {
  contact_attempted: "Registrar tentativa de contato",
  contacted: "Registrar contato realizado",
  no_response: "Registrar ausência de resposta",
  follow_up_scheduled: "Agendar retorno",
  note_added: "Adicionar observação",
  won: "Registrar venda concluída",
  dismissed: "Encerrar sem interesse",
  invalid: "Marcar registro inválido",
};

const rpcErrorMessages = {
  authentication_required: "Sua sessão expirou. Entre novamente e tente de novo.",
  clinic_membership_required: "Sua conta não tem acesso a esta clínica.",
  opportunity_already_closed: "Esta oportunidade já foi encerrada e não aceita novas ações.",
  invalid_event_type: "Esta ação não é válida para o ciclo comercial.",
  request_id_conflict: "A ação foi repetida com um identificador diferente de oportunidade. Atualize a página.",
  reason_required: "Informe o motivo antes de encerrar a oportunidade.",
  note_required: "Escreva uma observação antes de salvar.",
  future_follow_up_required: "Escolha uma data futura para o retorno.",
  sale_amount_and_evidence_required: "Informe o valor e uma referência verificável da venda.",
  sale_evidence_only_for_won: "Valor e evidência só podem ser registrados ao confirmar uma venda.",
  action_text_too_long: "O texto ultrapassa o limite permitido. Reduza o conteúdo e tente de novo.",
};

/** @param {string} eventType */
export function opportunityEventLabel(eventType) {
  return eventLabels[eventType] ?? "Registrar ação comercial";
}

/** @param {string | undefined} databaseMessage */
export function opportunityActionErrorMessage(databaseMessage) {
  if (databaseMessage && Object.hasOwn(rpcErrorMessages, databaseMessage)) {
    return rpcErrorMessages[databaseMessage];
  }
  return "Não foi possível salvar a ação no banco. Atualize a página; se o erro continuar, confira a sessão e as migrations do Supabase.";
}
