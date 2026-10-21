import { getImportContext, importErrorResponse, importPreviewResponse, markDatabaseDuplicates, readImportForm } from "@/lib/importer/server";

export async function POST(request: Request) {
  const context = await getImportContext();
  if ("response" in context) return context.response;
  try {
    const { headers, mapping, records } = await readImportForm(request);
    await markDatabaseDuplicates(context.supabase, context.clinicId, records);
    return Response.json(importPreviewResponse(headers, mapping, records), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return importErrorResponse(error);
  }
}
