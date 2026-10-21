import test from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import {
  detectColumnMapping,
  markPossibleDuplicates,
  parseImportFile,
  validateImportRows,
} from "../src/lib/importer/parse.mjs";

function csvFile(name, text) {
  return parseImportFile({ fileName: name, buffer: Buffer.from(text, "utf8") });
}

function xlsxFile() {
  const xml = (value) => new TextEncoder().encode(value);
  const workbook = {
    "[Content_Types].xml": xml("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/></Types>"),
    "xl/workbook.xml": xml("<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Dados\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"),
    "xl/_rels/workbook.xml.rels": xml("<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\" Type=\"worksheet\"/></Relationships>"),
    "xl/worksheets/sheet1.xml": xml("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Tutor</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>Pet</t></is></c><c r=\"C1\" t=\"inlineStr\"><is><t>Valor orçamento</t></is></c><c r=\"D1\" t=\"inlineStr\"><is><t>Data do orçamento</t></is></c></row><row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Ana</t></is></c><c r=\"B2\" t=\"inlineStr\"><is><t>Luna</t></is></c><c r=\"C2\"><v>1250.5</v></c><c r=\"D2\"><v>46234</v></c></row></sheetData></worksheet>"),
  };
  return zipSync(workbook);
}

test("CSV parser supports UTF-8 BOM, quoted delimiters and embedded line breaks", () => {
  const parsed = csvFile("clientes.csv", "\uFEFFTutor;Email;Pet;Valor orçamento;Data do orçamento\r\n\"Ana, Maria\";ana@example.com;Luna;R$ 1.250,50;19/10/2026\r\n\"João\nSilva\";joao@example.com;Nina;0;2026-10-19");
  assert.deepEqual(parsed.headers, ["Tutor", "Email", "Pet", "Valor orçamento", "Data do orçamento"]);
  assert.equal(parsed.dataRows.length, 2);
  assert.equal(parsed.dataRows[0][0], "Ana, Maria");
  assert.equal(parsed.dataRows[1][0], "João\nSilva");
});

test("XLSX parser validates the ZIP package and reads the first worksheet", () => {
  const parsed = parseImportFile({ fileName: "dados.xlsx", buffer: xlsxFile() });
  const mapping = detectColumnMapping(parsed.headers);
  const rows = validateImportRows(parsed.headers, parsed.dataRows, mapping);
  assert.equal(parsed.fileType, "xlsx");
  assert.equal(rows[0].valid, true);
  assert.equal(rows[0].quote.amount, 1250.5);
  assert.equal(rows[0].quote.issued_at, "2026-07-31T00:00:00.000Z");
});

test("invalid extensions, fake XLSX contents, malformed CSV and bad headers are rejected", () => {
  assert.throws(() => parseImportFile({ fileName: "planilha.xls", buffer: Buffer.from("a,b\nc,d") }), /CSV ou XLSX/);
  assert.throws(() => parseImportFile({ fileName: "planilha.xlsx", buffer: Buffer.from("not a zip") }), /XLSX válido/);
  assert.throws(() => csvFile("ruim.csv", 'Tutor,Email\n"Ana,ana@example.com'), /aspas/);
  assert.throws(() => csvFile("ruim.csv", "Tutor,Tutor\nAna,Ana"), /repetidos/);
  assert.throws(() => csvFile("ruim.csv", "\u0000\u0000"), /CSV de texto/);
});

test("file size, row count and column count limits are enforced", () => {
  assert.throws(() => parseImportFile({ fileName: "grande.csv", buffer: new Uint8Array(10 * 1024 * 1024 + 1) }), /10 MB/);
  const tooManyColumns = `${Array.from({ length: 61 }, (_, i) => `C${i}`).join(",")}\n${Array(61).fill("x").join(",")}`;
  assert.throws(() => csvFile("colunas.csv", tooManyColumns), /coluna vazia ou excede o limite de colunas/);
});

test("automatic mapping validates rows, statuses, amounts and dates without estimating", () => {
  const parsed = csvFile("dados.csv", "Tutor,Email,Pet,Valor orçamento,Data do orçamento,Status do orçamento\nAna,ana@example.com,Luna,\"1.250,50\",19/10/2026,Pendente\nBia,,Nina,inválido,32/13/2026,desconhecido");
  const mapping = detectColumnMapping(parsed.headers);
  const records = validateImportRows(parsed.headers, parsed.dataRows, mapping);
  assert.equal(records[0].valid, true, JSON.stringify({ headers: parsed.headers, mapping, record: records[0] }));
  assert.equal(records[0].quote.amount, 1250.5);
  assert.equal(records[0].quote.status, "pending");
  assert.equal(records[0].quote.issued_at, "2026-10-19T00:00:00.000Z");
  assert.equal(records[1].valid, false);
  assert.ok(records[1].errors.includes("valor_orcamento_invalido"));
  assert.ok(records[1].errors.includes("data_orcamento_invalida"));
  assert.ok(records[1].errors.includes("status_orcamento_invalido"));
});

test("manual mapping must include client identity and unique destination fields", () => {
  const parsed = csvFile("dados.csv", "Nome,Data\nAna,2026-10-19");
  assert.throws(() => validateImportRows(parsed.headers, parsed.dataRows, [null, "appointment_starts_at"]), /Nome do cliente/);
  assert.throws(() => validateImportRows(parsed.headers, parsed.dataRows, ["client_name", "client_name"]), /no máximo uma coluna/);
});

test("duplicate detection is tenant-keyed, conservative and does not merge unrelated identifiers", () => {
  const parsed = csvFile("dados.csv", "Tutor,Email,ID externo do cliente,ID do orçamento,Valor orçamento,Data do orçamento\nAna,ana@example.com,C-1,Q-1,50,2026-10-19\nAna,ana@example.com,C-1,Q-2,75,2026-10-20");
  const records = validateImportRows(parsed.headers, parsed.dataRows, detectColumnMapping(parsed.headers));
  markPossibleDuplicates(records, { clients: [{ external_id: "C-1" }] });
  assert.equal(records[0].possible_duplicate, true);
  assert.equal(records[1].possible_duplicate, true);
  assert.match(records[1].duplicate_reason, /linha 2/);
  const isolated = validateImportRows(parsed.headers, parsed.dataRows, detectColumnMapping(parsed.headers));
  markPossibleDuplicates(isolated, { clients: [{ phone: "C-1" }] });
  assert.equal(isolated[0].possible_duplicate, false);
});
