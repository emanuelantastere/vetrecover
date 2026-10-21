import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  detectColumnMapping,
  markPossibleDuplicates,
  MAX_IMPORT_BYTES,
  parseImportFile,
  validateImportRows,
} from "@/lib/importer/parse.mjs";
import type { ImportField } from "@/lib/importer/parse.mjs";

const MAX_REQUEST_BYTES = MAX_IMPORT_BYTES + 512 * 1024;

export async function getImportContext() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 }) };

  const { data: membership, error: membershipError } = await supabase
    .from("clinic_memberships")
    .select("clinic_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError) return { response: NextResponse.json({ error: "Não foi possível verificar o vínculo com a clínica." }, { status: 503 }) };
  if (!membership) return { response: NextResponse.json({ error: "Esta conta não tem vínculo ativo com uma clínica." }, { status: 403 }) };
  return { supabase, user, clinicId: membership.clinic_id };
}

export async function readImportForm(request: Request) {
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REQUEST_BYTES) throw new ImportRequestError("O arquivo ultrapassa o limite de 10 MB.", 413);

  let form: FormData;
  try { form = await request.formData(); }
  catch { throw new ImportRequestError("Não foi possível ler o formulário enviado.", 400); }

  const entry = form.get("file");
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") throw new ImportRequestError("Selecione um arquivo CSV ou XLSX.", 400);
  if (entry.size > MAX_IMPORT_BYTES) throw new ImportRequestError("O arquivo ultrapassa o limite de 10 MB.", 413);

  const fileName = entry.name.split(/[\\/]/).pop() ?? "";
  const buffer = new Uint8Array(await entry.arrayBuffer());
  let parsed;
  try { parsed = parseImportFile({ fileName, mimeType: entry.type, buffer }); }
  catch (error) { throw new ImportRequestError(error instanceof Error ? error.message : "Arquivo inválido.", 400); }

  const mappingEntry = form.get("mapping");
  let mapping: Array<ImportField | null>;
  if (mappingEntry === null) mapping = detectColumnMapping(parsed.headers);
  else {
    if (typeof mappingEntry !== "string" || mappingEntry.length > 8000) throw new ImportRequestError("O mapeamento enviado é inválido.", 400);
    try { mapping = JSON.parse(mappingEntry) as Array<ImportField | null>; }
    catch { throw new ImportRequestError("O mapeamento enviado não é um JSON válido.", 400); }
  }

  let records;
  try { records = validateImportRows(parsed.headers, parsed.dataRows, mapping); }
  catch (error) { throw new ImportRequestError(error instanceof Error ? error.message : "Não foi possível validar as linhas.", 400); }
  return { fileName, fileType: parsed.fileType, headers: parsed.headers, mapping, records, confirmed: form.get("confirm") === "true" };
}

async function selectExistingKeys(supabase: Awaited<ReturnType<typeof createClient>>, clinicId: string, table: string, column: string, values: string[], select: string) {
  const found: Record<string, unknown>[] = [];
  const uniqueValues = [...new Set(values.filter(Boolean))];
  for (let index = 0; index < uniqueValues.length; index += 100) {
    const { data, error } = await supabase.from(table).select(select).eq("clinic_id", clinicId).in(column, uniqueValues.slice(index, index + 100));
    if (error) throw new ImportRequestError("Não foi possível verificar possíveis duplicidades. Tente novamente.", 503);
    found.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
  }
  return found;
}

export async function markDatabaseDuplicates(supabase: Awaited<ReturnType<typeof createClient>>, clinicId: string, records: ReturnType<typeof validateImportRows>) {
  const valid = records.filter((record) => record.valid);
  const [clientsExternal, clientsEmail, clientsPhone, pets, quotes, appointments] = await Promise.all([
    selectExistingKeys(supabase, clinicId, "clients", "external_id", valid.map((r) => r.client.external_id ?? ""), "external_id"),
    selectExistingKeys(supabase, clinicId, "clients", "email", valid.map((r) => r.client.email ?? ""), "email"),
    selectExistingKeys(supabase, clinicId, "clients", "phone", valid.map((r) => r.client.phone ?? ""), "phone"),
    selectExistingKeys(supabase, clinicId, "pets", "external_id", valid.map((r) => r.pet?.external_id ?? ""), "external_id"),
    selectExistingKeys(supabase, clinicId, "quotes", "external_id", valid.map((r) => r.quote?.external_id ?? ""), "external_id"),
    selectExistingKeys(supabase, clinicId, "appointments", "external_id", valid.map((r) => r.appointment?.external_id ?? ""), "external_id"),
  ]);
  return markPossibleDuplicates(records, {
    clients: [...clientsExternal, ...clientsEmail, ...clientsPhone],
    pets,
    quotes,
    appointments,
  });
}

export function importPreviewResponse(headers: string[], mapping: Array<ImportField | null>, records: ReturnType<typeof validateImportRows>) {
  const validRows = records.filter((record) => record.valid);
  const invalidRows = records.filter((record) => !record.valid);
  const duplicateRows = validRows.filter((record) => record.possible_duplicate);
  const samples = records.slice(0, 8).map((record) => ({
    rowNumber: record.row_number,
    client: record.client.name || "—",
    pet: record.pet?.name ?? "—",
    type: [record.quote && "Orçamento", record.appointment && "Atendimento"].filter(Boolean).join(" + ") || "Cliente",
    value: record.quote?.amount ?? record.appointment?.amount ?? null,
    date: record.quote?.issued_at ?? record.appointment?.starts_at ?? null,
    valid: record.valid,
    errors: record.errors,
    warnings: record.warnings,
    possibleDuplicate: record.possible_duplicate,
    duplicateReason: record.duplicate_reason,
  }));
  return {
    headers,
    mapping,
    rowsSeen: records.length,
    rowsValid: validRows.length,
    rowsInvalid: invalidRows.length,
    possibleDuplicates: duplicateRows.length,
    samples,
  };
}

export class ImportRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function importErrorResponse(error: unknown) {
  if (error instanceof ImportRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "A importação falhou. Nenhum dado foi apresentado como concluído." }, { status: 500 });
}
