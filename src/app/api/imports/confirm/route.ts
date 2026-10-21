import { getImportContext, importErrorResponse, markDatabaseDuplicates, readImportForm } from "@/lib/importer/server";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  const context = await getImportContext();
  if ("response" in context) return context.response;
  let importId: string | null = null;
  let rowsSeen = 0;
  try {
    const prepared = await readImportForm(request);
    if (!prepared.confirmed) return Response.json({ error: "Confirme a importação depois de revisar a prévia." }, { status: 400 });
    const records = await markDatabaseDuplicates(context.supabase, context.clinicId, prepared.records);
    rowsSeen = records.length;
    const rowsValid = records.filter((record) => record.valid).length;
    if (rowsValid === 0) return Response.json({ error: "Não há linhas válidas para importar." }, { status: 400 });

    const columnMapping = Object.fromEntries(prepared.mapping.flatMap((field, index) => field ? [[field, prepared.headers[index]]] : []));
    const { data: importRecord, error: createError } = await context.supabase
      .from("imports")
      .insert({
        clinic_id: context.clinicId,
        created_by_user_id: context.user.id,
        file_name: prepared.fileName,
        storage_path: null,
        file_type: prepared.fileType,
        status: "validated",
        column_mapping: columnMapping,
        rows_seen: rowsSeen,
        rows_imported: 0,
        rows_rejected: 0,
        error_summary: null,
      })
      .select("id")
      .single();
    if (createError || !importRecord) return Response.json({ error: "Não foi possível iniciar a importação. Confira se a migração da etapa 3 foi aplicada." }, { status: 503 });
    importId = importRecord.id;

    const { data: result, error: commitError } = await context.supabase.rpc("commit_clinic_import", {
      p_import_id: importId,
      p_rows: records,
    });
    if (commitError || !result) {
      await context.supabase
        .from("imports")
        .update({
          status: "failed",
          rows_imported: 0,
          rows_rejected: rowsSeen,
          error_summary: "A gravação transacional falhou; nenhum registro desta importação foi persistido.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", importId)
        .eq("clinic_id", context.clinicId)
        .eq("created_by_user_id", context.user.id)
        .eq("status", "validated");
      return Response.json({ error: "A gravação falhou e nenhum registro foi importado. O evento foi registrado como falha." }, { status: 500 });
    }
    revalidatePath("/");
    return Response.json({ ...result, importId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (importId) {
      await context.supabase
        .from("imports")
        .update({
          status: "failed",
          rows_imported: 0,
          rows_rejected: rowsSeen,
          error_summary: "A gravação transacional falhou; nenhum registro desta importação foi persistido.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", importId)
        .eq("clinic_id", context.clinicId)
        .eq("created_by_user_id", context.user.id)
        .eq("status", "validated");
    }
    return importErrorResponse(error);
  }
}
