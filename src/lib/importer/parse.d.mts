export const MAX_IMPORT_BYTES: number;
export const MAX_IMPORT_ROWS: number;
export const MAX_IMPORT_COLUMNS: number;

export type ImportField =
  | "client_external_id" | "client_name" | "client_email" | "client_phone"
  | "pet_external_id" | "pet_name" | "pet_species"
  | "quote_external_id" | "quote_amount" | "quote_status" | "quote_issued_at" | "quote_expires_at" | "quote_description"
  | "appointment_external_id" | "appointment_starts_at" | "appointment_status" | "appointment_service_name" | "appointment_amount";

export type ImportClient = { external_id: string | null; name: string; email: string | null; phone: string | null };
export type ImportPet = { external_id: string | null; name: string; species: string | null };
export type ImportQuote = { external_id: string | null; amount: number | null; status: string; issued_at: string | null; expires_at: string | null; description: string | null };
export type ImportAppointment = { external_id: string | null; starts_at: string | null; status: string; service_name: string | null; amount: number | null };
export type ImportRecord = {
  row_number: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  possible_duplicate: boolean;
  duplicate_reason: string | null;
  client: ImportClient;
  pet: ImportPet | null;
  quote: ImportQuote | null;
  appointment: ImportAppointment | null;
};
export type ExistingImportKeys = {
  clients?: Array<Partial<ImportClient>>;
  pets?: Array<{ external_id?: string | null }>;
  quotes?: Array<{ external_id?: string | null }>;
  appointments?: Array<{ external_id?: string | null }>;
};

export function parseImportFile(input: { fileName: string; mimeType?: string; buffer: Uint8Array | ArrayBuffer }): { headers: string[]; dataRows: string[][]; fileType: "csv" | "xlsx" };
export function detectColumnMapping(headers: string[]): Array<ImportField | null>;
export function validateImportRows(headers: string[], sourceRows: string[][], mapping: Array<ImportField | null>): ImportRecord[];
export function markPossibleDuplicates(records: ImportRecord[], existing?: ExistingImportKeys | Array<Partial<ImportClient>>): ImportRecord[];
export function parseAmount(value: string): number | null;
