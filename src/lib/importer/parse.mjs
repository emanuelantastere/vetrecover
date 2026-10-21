import { unzipSync } from "fflate";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLUMNS = 60;
const MAX_XLSX_ENTRIES = 200;
const MAX_XLSX_EXPANDED_BYTES = 32 * 1024 * 1024;

export const IMPORT_FIELDS = [
  ["client_external_id", "ID externo do cliente"],
  ["client_name", "Nome do cliente/tutor"],
  ["client_email", "E-mail do cliente"],
  ["client_phone", "Telefone do cliente"],
  ["pet_external_id", "ID externo do pet"],
  ["pet_name", "Nome do pet"],
  ["pet_species", "Espécie do pet"],
  ["quote_external_id", "ID do orçamento"],
  ["quote_amount", "Valor do orçamento"],
  ["quote_status", "Status do orçamento"],
  ["quote_issued_at", "Data do orçamento"],
  ["quote_expires_at", "Validade do orçamento"],
  ["quote_description", "Descrição do orçamento"],
  ["appointment_external_id", "ID do atendimento"],
  ["appointment_starts_at", "Data do atendimento"],
  ["appointment_status", "Status do atendimento"],
  ["appointment_service_name", "Serviço do atendimento"],
  ["appointment_amount", "Valor do atendimento"],
];

const fieldKeys = new Set(IMPORT_FIELDS.map(([key]) => key));
const aliases = new Map([
  ["client_external_id", ["id cliente", "id do cliente", "id externo cliente", "id externo do cliente", "codigo cliente", "codigo do cliente", "cliente id", "customer id", "client id"]],
  ["client_name", ["cliente", "nome cliente", "nome do cliente", "tutor", "nome tutor", "nome do tutor", "responsavel", "nome responsavel", "customer", "customer name", "client name", "owner"]],
  ["client_email", ["email", "e mail", "email cliente", "email do cliente", "e mail do cliente", "customer email"]],
  ["client_phone", ["telefone", "celular", "telefone cliente", "telefone do cliente", "celular do cliente", "phone", "mobile"]],
  ["pet_external_id", ["id pet", "id do pet", "codigo pet", "codigo do pet", "animal id"]],
  ["pet_name", ["pet", "nome pet", "nome do pet", "animal", "nome animal", "nome do animal", "paciente", "nome paciente", "nome do paciente", "pet name"]],
  ["pet_species", ["especie", "especie do pet", "especie animal", "species"]],
  ["quote_external_id", ["id orcamento", "id do orcamento", "codigo orcamento", "numero do orcamento", "quote id"]],
  ["quote_amount", ["valor orcamento", "valor do orcamento", "total orcamento", "orcamento valor", "quote amount"]],
  ["quote_status", ["status orcamento", "status do orcamento", "situacao orcamento", "situacao do orcamento", "quote status"]],
  ["quote_issued_at", ["data orcamento", "data do orcamento", "data emissao", "data de emissao", "emissao orcamento", "quote date", "issued at"]],
  ["quote_expires_at", ["validade orcamento", "validade do orcamento", "data validade", "data de validade", "expira em", "quote expiration"]],
  ["quote_description", ["descricao orcamento", "descricao do orcamento", "procedimento orcamento", "quote description"]],
  ["appointment_external_id", ["id atendimento", "id do atendimento", "codigo atendimento", "numero atendimento", "appointment id"]],
  ["appointment_starts_at", ["data atendimento", "data do atendimento", "data consulta", "data da consulta", "inicio atendimento", "appointment date", "starts at"]],
  ["appointment_status", ["status atendimento", "status do atendimento", "situacao atendimento", "situacao do atendimento", "appointment status"]],
  ["appointment_service_name", ["servico", "servico atendimento", "servico do atendimento", "procedimento", "nome servico", "appointment service"]],
  ["appointment_amount", ["valor atendimento", "valor do atendimento", "valor servico", "valor do servico", "appointment amount"]],
]);

function cleanText(value) {
  return String(value ?? "").replace(/\u0000/g, "").trim();
}

function normalizeHeader(value) {
  return cleanText(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function countOutsideQuotes(text, delimiter) {
  let quoted = false;
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') i += 1;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

function parseCsv(text) {
  const delimiter = [",", ";", "\t"].sort((a, b) => countOutsideQuotes(text, b) - countOutsideQuotes(text, a))[0];
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') { quoted = false; afterQuote = true; }
      else cell += char;
      continue;
    }
    if (afterQuote && char !== delimiter && char !== "\n" && char !== "\r" && !/\s/.test(char)) throw new Error("O CSV contém texto depois de um campo entre aspas.");
    if (char === '"') {
      if (cell.trim()) throw new Error("O CSV contém aspas em uma posição inválida.");
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
      afterQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => cleanText(value))) rows.push(row);
      row = [];
      cell = "";
      afterQuote = false;
      if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`A planilha excede o limite de ${MAX_IMPORT_ROWS} registros.`);
    } else cell += char;
  }
  if (quoted) throw new Error("O CSV termina com um campo entre aspas sem fechamento.");
  row.push(cell);
  if (row.some((value) => cleanText(value))) rows.push(row);
  return rows;
}

function getZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.byteLength - 65557);
  let endOffset = -1;
  for (let i = bytes.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) throw new Error("O XLSX não contém um diretório ZIP válido.");

  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("Arquivos XLSX com extensão ZIP64 não são aceitos.");
  if (totalEntries < 1 || totalEntries > MAX_XLSX_ENTRIES || centralOffset + centralSize > endOffset) throw new Error("O XLSX excede os limites de estrutura aceitos.");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = [];
  let offset = centralOffset;
  let totalExpanded = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error("O XLSX contém uma entrada ZIP inválida.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > bytes.byteLength) throw new Error("O XLSX contém uma entrada ZIP incompleta.");
    if (flags & 1) throw new Error("Arquivos XLSX protegidos por senha não são aceitos.");
    if (method !== 0 && method !== 8) throw new Error("O XLSX usa um método de compactação não suportado.");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.startsWith("/") || name.split("/").includes("..") || /vbaProject\.bin|externalLinks/i.test(name)) throw new Error("O XLSX contém conteúdo ativo não aceito.");
    totalExpanded += expandedSize;
    if (expandedSize > MAX_XLSX_EXPANDED_BYTES || totalExpanded > MAX_XLSX_EXPANDED_BYTES) throw new Error("O conteúdo descompactado do XLSX excede o limite de 32 MB.");
    entries.push({ name, compressedSize, expandedSize });
    offset = entryEnd;
  }
  if (offset !== centralOffset + centralSize) throw new Error("O diretório de arquivos XLSX está inconsistente.");
  return entries;
}

function decodeXml(value) {
  return value.replace(/&#x([\da-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

function excelColumnIndex(reference) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return -1;
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return value - 1;
}

function xmlTextNodes(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
}

function parseXlsx(bytes) {
  const entries = getZipEntries(bytes);
  const allowed = new Set(entries.map((entry) => entry.name));
  if (!allowed.has("[Content_Types].xml") || !allowed.has("xl/workbook.xml")) throw new Error("O arquivo não tem a estrutura de uma planilha XLSX.");
  const files = unzipSync(bytes);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const read = (name) => files[name] ? decoder.decode(files[name]) : "";
  const workbook = read("xl/workbook.xml");
  const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/);
  if (!firstSheet) throw new Error("O XLSX não contém uma primeira aba legível.");
  const relationships = read("xl/_rels/workbook.xml.rels");
  const relation = [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map((match) => match[1]).find((attrs) => xmlAttribute(attrs, "Id") === firstSheet[1]);
  if (!relation) throw new Error("Não foi possível localizar a primeira aba do XLSX.");
  let sheetPath = xmlAttribute(relation, "Target").replace(/^\//, "");
  if (!sheetPath.startsWith("xl/")) sheetPath = `xl/${sheetPath.replace(/^\.\//, "")}`;
  const worksheet = read(sheetPath);
  if (!worksheet) throw new Error("A primeira aba do XLSX está vazia ou inválida.");

  const sharedXml = read("xl/sharedStrings.xml");
  const sharedStrings = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => xmlTextNodes(match[1]));
  const rows = [];
  for (const rowMatch of worksheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(xmlAttribute(rowMatch[1], "r")) || rows.length + 1;
    if (rowNumber > MAX_IMPORT_ROWS + 1) throw new Error(`A planilha excede o limite de ${MAX_IMPORT_ROWS} registros.`);
    const cells = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const index = excelColumnIndex(xmlAttribute(attrs, "r"));
      if (index < 0 || index >= MAX_IMPORT_COLUMNS) throw new Error(`A planilha excede o limite de ${MAX_IMPORT_COLUMNS} colunas.`);
      const type = xmlAttribute(attrs, "t");
      const value = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "";
      let cellValue = "";
      if (type === "s") cellValue = sharedStrings[Number(value)] ?? "";
      else if (type === "inlineStr") cellValue = xmlTextNodes(body);
      else if (type === "b") cellValue = value === "1" ? "true" : value === "0" ? "false" : "";
      else if (!/<f(?:\s|>)/.test(body)) cellValue = decodeXml(value);
      cells[index] = cellValue;
    }
    rows[rowNumber - 1] = cells;
  }
  return rows.filter((row) => row && row.some((value) => cleanText(value)));
}

function validateHeaders(rows) {
  if (rows.length < 2) throw new Error("A planilha precisa ter um cabeçalho e ao menos uma linha de dados.");
  const headers = rows[0].map((value) => cleanText(value));
  if (!headers.length || headers.length > MAX_IMPORT_COLUMNS || headers.some((value) => !value)) throw new Error("O cabeçalho contém uma coluna vazia ou excede o limite de colunas.");
  const normalized = headers.map(normalizeHeader);
  if (new Set(normalized).size !== normalized.length) throw new Error("O cabeçalho tem nomes de coluna repetidos. Renomeie-os antes de importar.");
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) throw new Error(`A planilha excede o limite de ${MAX_IMPORT_ROWS} registros.`);
  return { headers, dataRows };
}

export function parseImportFile({ fileName, mimeType = "", buffer }) {
  if (!fileName || typeof fileName !== "string" || fileName.length > 255 || /[\\/\u0000-\u001f]/.test(fileName)) throw new Error("Nome de arquivo inválido.");
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!bytes.byteLength) throw new Error("O arquivo está vazio.");
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error("O arquivo ultrapassa o limite de 10 MB.");
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "xlsx") throw new Error("Envie um arquivo CSV ou XLSX.");

  let rows;
  let fileType;
  if (extension === "csv") {
    if (bytes.includes(0)) throw new Error("O conteúdo não parece ser um CSV de texto.");
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
    catch { throw new Error("O CSV precisa estar codificado em UTF-8."); }
    if (/^\s*(?:<!doctype html|<html)/i.test(text)) throw new Error("O conteúdo enviado não é uma planilha CSV.");
    rows = parseCsv(text);
    fileType = "csv";
  } else {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("O conteúdo não parece ser um arquivo XLSX válido.");
    const mimeAllowed = !mimeType || ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", "application/zip"].includes(mimeType.toLowerCase());
    if (!mimeAllowed) throw new Error("O tipo de conteúdo não corresponde a um XLSX.");
    rows = parseXlsx(bytes);
    fileType = "xlsx";
  }
  return { ...validateHeaders(rows), fileType };
}

export function detectColumnMapping(headers) {
  const mapping = Array(headers.length).fill(null);
  const assigned = new Set();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [field, names] of aliases) {
      if (!assigned.has(field) && names.includes(normalized)) {
        mapping[index] = field;
        assigned.add(field);
        break;
      }
    }
  });
  return mapping;
}

export function validateImportRows(headers, sourceRows, mapping) {
  if (!Array.isArray(mapping) || mapping.length !== headers.length || mapping.some((field) => field !== null && !fieldKeys.has(field))) throw new Error("O mapeamento de colunas é inválido.");
  const mapped = mapping.filter(Boolean);
  if (new Set(mapped).size !== mapped.length) throw new Error("Cada campo do VetRecover deve corresponder a no máximo uma coluna.");
  const indexByField = new Map(mapping.flatMap((field, index) => field ? [[field, index]] : []));
  if (!indexByField.has("client_name")) throw new Error("Mapeie uma coluna para Nome do cliente/tutor.");

  const field = (row, key) => {
    const index = indexByField.get(key);
    return index === undefined ? "" : cleanText(row[index]);
  };
  const records = sourceRows.map((source, index) => {
    const rowNumber = index + 2;
    const errors = [];
    const warnings = [];
    const clientName = field(source, "client_name");
    if (!clientName) errors.push("nome_cliente_ausente");
    if (clientName.length > 200) errors.push("nome_cliente_longo");

    const email = field(source, "client_email").toLowerCase();
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)) errors.push("email_invalido");
    const phone = field(source, "client_phone");
    if (phone.length > 40) errors.push("telefone_longo");

    const petName = field(source, "pet_name");
    if (petName.length > 120) errors.push("nome_pet_longo");
    const pet = petName ? { external_id: field(source, "pet_external_id") || null, name: petName, species: field(source, "pet_species") || null } : null;

    const quoteTouched = ["quote_external_id", "quote_amount", "quote_status", "quote_issued_at", "quote_expires_at", "quote_description"].some((key) => field(source, key));
    let quote = null;
    if (quoteTouched) {
      const amount = parseAmount(field(source, "quote_amount"));
      const issuedAt = parseDate(field(source, "quote_issued_at"));
      if (amount === null) errors.push("valor_orcamento_invalido");
      if (!issuedAt) errors.push("data_orcamento_invalida");
      const statusValue = field(source, "quote_status");
      const status = statusValue ? normalizeQuoteStatus(statusValue) : "pending";
      if (statusValue && !status) errors.push("status_orcamento_invalido");
      if (!statusValue) warnings.push("status_orcamento_padrao_pendente");
      const expiresAt = field(source, "quote_expires_at") ? parseDate(field(source, "quote_expires_at")) : null;
      if (field(source, "quote_expires_at") && !expiresAt) errors.push("validade_orcamento_invalida");
      quote = { external_id: field(source, "quote_external_id") || null, amount, status, issued_at: issuedAt, expires_at: expiresAt, description: field(source, "quote_description") || null };
    }

    const appointmentTouched = ["appointment_external_id", "appointment_starts_at", "appointment_status", "appointment_service_name", "appointment_amount"].some((key) => field(source, key));
    let appointment = null;
    if (appointmentTouched) {
      const startsAt = parseDate(field(source, "appointment_starts_at"));
      if (!startsAt) errors.push("data_atendimento_invalida");
      const statusValue = field(source, "appointment_status");
      const status = statusValue ? normalizeAppointmentStatus(statusValue) : "scheduled";
      if (statusValue && !status) errors.push("status_atendimento_invalido");
      if (!statusValue) warnings.push("status_atendimento_padrao_agendado");
      const amountValue = field(source, "appointment_amount");
      const amount = amountValue ? parseAmount(amountValue) : null;
      if (amountValue && amount === null) errors.push("valor_atendimento_invalido");
      appointment = { external_id: field(source, "appointment_external_id") || null, starts_at: startsAt, status, service_name: field(source, "appointment_service_name") || null, amount };
    }

    const client = {
      external_id: field(source, "client_external_id") || null,
      name: clientName,
      email: email || null,
      phone: phone || null,
    };
    const valid = errors.length === 0;
    return { row_number: rowNumber, valid, errors, warnings, possible_duplicate: false, duplicate_reason: null, client, pet, quote, appointment };
  });
  return records;
}

function normalizeIdentity(value) {
  return cleanText(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function identityKeys(client) {
  return [
    client.external_id && `external:${normalizeIdentity(client.external_id)}`,
    client.email && `email:${normalizeIdentity(client.email)}`,
    client.phone && `phone:${normalizeIdentity(client.phone)}`,
  ].filter(Boolean);
}

export function markPossibleDuplicates(records, existing = {}) {
  if (Array.isArray(existing)) existing = { clients: existing };
  const seen = new Map();
  const existingIndex = new Map();
  for (const client of existing.clients ?? []) for (const key of identityKeys(client)) existingIndex.set(key, true);
  for (const pet of existing.pets ?? []) if (pet.external_id) existingIndex.set(`pet:${normalizeIdentity(pet.external_id)}`, true);
  for (const quote of existing.quotes ?? []) if (quote.external_id) existingIndex.set(`quote:${normalizeIdentity(quote.external_id)}`, true);
  for (const appointment of existing.appointments ?? []) if (appointment.external_id) existingIndex.set(`appointment:${normalizeIdentity(appointment.external_id)}`, true);
  for (const record of records) {
    if (!record.valid) continue;
    const keys = [
      ...identityKeys(record.client),
      record.pet?.external_id && `pet:${normalizeIdentity(record.pet.external_id)}`,
      record.quote?.external_id && `quote:${normalizeIdentity(record.quote.external_id)}`,
      record.appointment?.external_id && `appointment:${normalizeIdentity(record.appointment.external_id)}`,
    ].filter(Boolean);
    const fileMatch = keys.find((key) => seen.has(key));
    const dbMatch = keys.some((key) => existingIndex.has(key));
    if (fileMatch || dbMatch) {
      record.possible_duplicate = true;
      record.duplicate_reason = fileMatch ? `Possível repetição da linha ${seen.get(fileMatch)} nesta planilha` : "Cliente com identificador já existente nesta clínica";
    }
    for (const key of keys) if (!seen.has(key)) seen.set(key, record.row_number);
  }
  return records;
}

export function parseAmount(value) {
  const text = cleanText(value).replace(/[R$\s\u00a0]/g, "");
  if (!text) return null;
  let normalized = text;
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function parseDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  let date;
  const brazil = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (brazil) {
    const parts = [Number(brazil[3]), Number(brazil[2]) - 1, Number(brazil[1]), Number(brazil[4] || 0), Number(brazil[5] || 0), Number(brazil[6] || 0)];
    date = new Date(Date.UTC(...parts));
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] || date.getUTCDate() !== parts[2] || date.getUTCHours() !== parts[3] || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) return null;
  }
  else if (/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(text)) {
    const parts = text.slice(0, 10).split("-").map(Number);
    const check = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (check.getUTCFullYear() !== parts[0] || check.getUTCMonth() !== parts[1] - 1 || check.getUTCDate() !== parts[2]) return null;
    date = text.length === 10 ? new Date(`${text}T00:00:00.000Z`) : new Date(text);
  }
  else if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial < 1 || serial > 100000) return null;
    date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  } else return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedStatus(value) {
  return normalizeHeader(value);
}

function normalizeQuoteStatus(value) {
  const key = normalizedStatus(value);
  return ({ pending: "pending", pendente: "pending", aberto: "pending", aberta: "pending", "em aberto": "pending", accepted: "accepted", aceito: "accepted", aceita: "accepted", aprovado: "accepted", aprovada: "accepted", declined: "declined", recusado: "declined", recusada: "declined", rejeitado: "declined", rejeitada: "declined", expired: "expired", expirado: "expired", expirada: "expired", vencido: "expired", vencida: "expired", cancelled: "cancelled", canceled: "cancelled", cancelado: "cancelled", cancelada: "cancelled" })[key] ?? null;
}

function normalizeAppointmentStatus(value) {
  const key = normalizedStatus(value);
  return ({ scheduled: "scheduled", agendado: "scheduled", agendada: "scheduled", completed: "completed", realizado: "completed", realizada: "completed", concluido: "completed", concluida: "completed", cancelled: "cancelled", canceled: "cancelled", cancelado: "cancelled", cancelada: "cancelled", no_show: "no_show", "no show": "no_show", "nao compareceu": "no_show", falta: "no_show", faltou: "no_show" })[key] ?? null;
}
