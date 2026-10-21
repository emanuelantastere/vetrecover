import test from "node:test";
import assert from "node:assert/strict";
import { opportunityActionErrorMessage, opportunityEventLabel } from "../src/lib/opportunities/lifecycle.mjs";

test("each commercial action displays a matching form title", () => {
  assert.equal(opportunityEventLabel("contact_attempted"), "Registrar tentativa de contato");
  assert.equal(opportunityEventLabel("contacted"), "Registrar contato realizado");
  assert.equal(opportunityEventLabel("no_response"), "Registrar ausência de resposta");
  assert.equal(opportunityEventLabel("follow_up_scheduled"), "Agendar retorno");
  assert.equal(opportunityEventLabel("note_added"), "Adicionar observação");
  assert.equal(opportunityEventLabel("won"), "Registrar venda concluída");
  assert.equal(opportunityEventLabel("dismissed"), "Encerrar sem interesse");
  assert.equal(opportunityEventLabel("invalid"), "Marcar registro inválido");
});

test("known lifecycle RPC rejections are explained without exposing raw database errors", () => {
  assert.match(opportunityActionErrorMessage("opportunity_already_closed"), /já foi encerrada/);
  assert.match(opportunityActionErrorMessage("sale_amount_and_evidence_required"), /valor e uma referência/);
  assert.match(opportunityActionErrorMessage("future_follow_up_required"), /data futura/);
  assert.doesNotMatch(opportunityActionErrorMessage("permission denied for table action_history"), /permission denied/);
  assert.match(opportunityActionErrorMessage("unknown_database_error"), /confira a sessão/);
});
