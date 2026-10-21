import { revalidatePath } from "next/cache";
import { getImportContext } from "@/lib/importer/server";
import { opportunityActionErrorMessage } from "@/lib/opportunities/lifecycle.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getImportContext();
  if ("response" in session) return session.response;
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return Response.json({ error: "Oportunidade inválida." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Ação inválida." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Ação inválida." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const eventType = typeof input.eventType === "string" ? input.eventType : "";
  const reason = typeof input.reason === "string" ? input.reason.slice(0, 1000) : "";
  const evidenceReference = typeof input.evidenceReference === "string" ? input.evidenceReference.slice(0, 200) : "";
  const confirmedRevenue = input.confirmedRevenue === null || input.confirmedRevenue === undefined || input.confirmedRevenue === ""
    ? null
    : Number(input.confirmedRevenue);

  if (confirmedRevenue !== null && (!Number.isFinite(confirmedRevenue) || confirmedRevenue < 0 || confirmedRevenue > 999_999_999_999)) {
    return Response.json({ error: "Informe um valor de venda válido." }, { status: 400 });
  }
  const allowed = new Set(["contact_attempted", "contacted", "no_response", "follow_up_scheduled", "note_added", "won", "dismissed", "invalid"]);
  if (!allowed.has(eventType)) return Response.json({ error: "Tipo de ação inválido." }, { status: 400 });
  const requestId = typeof input.requestId === "string" && uuidPattern.test(input.requestId) ? input.requestId : "";
  if (!requestId) return Response.json({ error: "Identificador da ação inválido." }, { status: 400 });
  const nextActionAt = typeof input.nextActionAt === "string" ? input.nextActionAt : null;
  const nextActionNote = typeof input.nextActionNote === "string" ? input.nextActionNote.slice(0, 500) : null;
  const reminderAction = typeof input.reminderAction === "string" ? input.reminderAction : "keep";
  if (!["keep", "clear", "schedule"].includes(reminderAction)) return Response.json({ error: "Escolha como tratar o retorno agendado." }, { status: 400 });
  if (reminderAction !== "keep" && !["contact_attempted", "contacted", "no_response"].includes(eventType)) {
    return Response.json({ error: "Esta ação não pode alterar o retorno agendado." }, { status: 400 });
  }
  if (reminderAction === "schedule" && (!nextActionAt || !Number.isFinite(Date.parse(nextActionAt)) || Date.parse(nextActionAt) <= Date.now())) {
    return Response.json({ error: "Escolha uma data futura para o novo retorno." }, { status: 400 });
  }
  if (reminderAction !== "schedule" && (nextActionAt || nextActionNote?.trim())) {
    return Response.json({ error: "Informe data e observação somente ao reagendar o retorno." }, { status: 400 });
  }
  if (["dismissed", "invalid"].includes(eventType) && !reason.trim()) return Response.json({ error: "Informe uma justificativa." }, { status: 400 });
  if (eventType === "note_added" && !reason.trim()) return Response.json({ error: "Escreva uma observação." }, { status: 400 });
  if (eventType === "follow_up_scheduled" && (!nextActionAt || !Number.isFinite(Date.parse(nextActionAt)) || Date.parse(nextActionAt) <= Date.now())) return Response.json({ error: "Escolha uma data futura para o retorno." }, { status: 400 });
  if (eventType === "won" && (confirmedRevenue === null || !evidenceReference.trim())) return Response.json({ error: "Informe o valor e a evidência da venda." }, { status: 400 });
  if (eventType !== "won" && (confirmedRevenue !== null || evidenceReference.trim())) return Response.json({ error: "Dados de venda só podem ser enviados ao confirmar uma venda." }, { status: 400 });

  const withReminder = reminderAction !== "keep";
  const { data, error } = withReminder
    ? await session.supabase.rpc("record_clinic_opportunity_event_with_reminder", {
        p_opportunity_id: id,
        p_event_type: eventType,
        p_notes: reason || null,
        p_next_action_at: nextActionAt,
        p_next_action_note: nextActionNote,
        p_request_id: requestId,
        p_reminder_action: reminderAction,
      })
    : await session.supabase.rpc("record_clinic_opportunity_event", {
        p_opportunity_id: id,
        p_event_type: eventType,
        p_notes: reason || null,
        p_next_action_at: nextActionAt,
        p_next_action_note: nextActionNote,
        p_confirmed_revenue: confirmedRevenue,
        p_evidence_reference: evidenceReference || null,
        p_request_id: requestId,
      });
  if (error?.code === "PGRST202" && withReminder) {
    return Response.json({ error: "A decisão de concluir ou reagendar o lembrete exige aplicar a migration 007 no Supabase." }, { status: 503 });
  }
  if (error || !data) return Response.json({ error: opportunityActionErrorMessage(error?.message) }, { status: error ? 409 : 503 });

  revalidatePath("/");
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
