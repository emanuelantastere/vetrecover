"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardImport } from "@/lib/dashboard-types";

const fields = [
  ["client_external_id", "ID externo do cliente"], ["client_name", "Nome do cliente/tutor"], ["client_email", "E-mail do cliente"], ["client_phone", "Telefone do cliente"],
  ["pet_external_id", "ID externo do pet"], ["pet_name", "Nome do pet"], ["pet_species", "Espécie do pet"],
  ["quote_external_id", "ID do orçamento"], ["quote_amount", "Valor do orçamento"], ["quote_status", "Status do orçamento"], ["quote_issued_at", "Data do orçamento"], ["quote_expires_at", "Validade do orçamento"], ["quote_description", "Descrição do orçamento"],
  ["appointment_external_id", "ID do atendimento"], ["appointment_starts_at", "Data do atendimento"], ["appointment_status", "Status do atendimento"], ["appointment_service_name", "Serviço do atendimento"], ["appointment_amount", "Valor do atendimento"],
] as const;

type PreviewSample = {
  rowNumber: number;
  client: string;
  pet: string;
  type: string;
  value: number | null;
  date: string | null;
  valid: boolean;
  errors: string[];
  warnings: string[];
  possibleDuplicate: boolean;
  duplicateReason: string | null;
};

type ImportPreview = {
  headers: string[];
  mapping: Array<string | null>;
  rowsSeen: number;
  rowsValid: number;
  rowsInvalid: number;
  possibleDuplicates: number;
  samples: PreviewSample[];
};

type ImportResponse = {
  status: string;
  rows_seen: number;
  rows_imported: number;
  rows_rejected: number;
  rows_duplicates: number;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

function formatMoney(value: number | null) {
  return value === null ? "—" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

function statusLabel(status: DashboardImport["status"]) {
  return ({ pending: "Pendente", validated: "Validada", completed: "Concluída", partial: "Parcial, com rejeições", failed: "Falhou", cancelled: "Cancelada" })[status];
}

export function ImportManager({ recentImports, ready, databaseError }: { recentImports: DashboardImport[]; ready: boolean; databaseError: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  async function requestPreview(selectedFile: File, mapping?: Array<string | null>) {
    setBusy(true);
    setError("");
    setSuccess("");
    setPreview(null);
    setAcknowledged(false);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      if (mapping) form.append("mapping", JSON.stringify(mapping));
      const response = await fetch("/api/imports/preview", { method: "POST", body: form, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível gerar a prévia.");
      setPreview(body as ImportPreview);
      setMappingDirty(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar a prévia.");
    } finally {
      setBusy(false);
    }
  }

  function chooseFile(selectedFile?: File) {
    if (!selectedFile) return;
    setFile(selectedFile);
    setPreview(null);
    setMappingDirty(false);
    void requestPreview(selectedFile);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    chooseFile(event.dataTransfer.files?.[0]);
  }

  function changeMapping(columnIndex: number, value: string) {
    if (!preview) return;
    const next = [...preview.mapping];
    for (let i = 0; i < next.length; i += 1) if (next[i] === value && value) next[i] = null;
    next[columnIndex] = value || null;
    setPreview({ ...preview, mapping: next });
    setMappingDirty(true);
    setAcknowledged(false);
  }

  async function updatePreview() {
    if (file && preview) await requestPreview(file, preview.mapping);
  }

  async function confirmImport() {
    if (!file || !preview || mappingDirty || !acknowledged) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mapping", JSON.stringify(preview.mapping));
      form.append("confirm", "true");
      const response = await fetch("/api/imports/confirm", { method: "POST", body: form, cache: "no-store" });
      const body = await response.json() as ImportResponse;
      if (!response.ok) throw new Error(body.error || "A importação não foi concluída.");
      setSuccess(body.status === "partial"
        ? `Importação parcial registrada: ${body.rows_imported} linhas importadas e ${body.rows_rejected} rejeitadas. Veja o histórico para detalhes.`
        : `Importação concluída: ${body.rows_imported} linhas processadas; ${body.rows_duplicates} com possíveis duplicidades.`);
      setFile(null);
      setPreview(null);
      setMappingDirty(false);
      setAcknowledged(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A importação não foi concluída.");
    } finally {
      setBusy(false);
    }
  }

  function cancelImport() {
    setFile(null);
    setPreview(null);
    setMappingDirty(false);
    setAcknowledged(false);
    setError("");
    setSuccess("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return <section className="panel import-panel" id="import-panel">
    <div className="panel-heading"><div><div className="heading-title">Importe dados da clínica</div><p>CSV e XLSX · até 10 MB e 5.000 registros por arquivo.</p></div><span className="step-label">ETAPA 1 DE 3</span></div>
    {!ready && <div className="import-not-ready" role={databaseError ? "alert" : "status"}><b>{databaseError ? "Falha ao consultar o banco." : "Importação ainda não habilitada no banco."}</b><span>{databaseError ?? <>Aplique a migração <code>supabase/migrations/202610190002_import_pipeline.sql</code> no SQL Editor do Supabase e atualize a página.</>}</span></div>}
    <label className={`upload-zone ${!ready || busy ? "upload-disabled" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <input ref={inputRef} type="file" accept=".csv,.xlsx" disabled={!ready || busy} onChange={onFileChange}/>
      <span className="upload-icon">↑</span>
      <span><b>{busy ? "Validando arquivo…" : file ? file.name : <>Arraste seu arquivo até aqui ou <u>escolha no computador</u></>}</b><small>CSV UTF-8 ou XLSX · dados só são gravados após confirmação</small></span>
    </label>
    {error && <p className="import-message import-error" role="alert">{error}</p>}
    {success && <p className="import-message import-success" role="status">{success}</p>}

    {preview && <div className="preview-wrap">
      <div className="preview-title"><div><b>Revise o mapeamento e a prévia</b><small>{preview.rowsSeen} linhas analisadas. Mapeamento automático pode ser ajustado.</small></div><button className="text-button" onClick={cancelImport} disabled={busy}>Cancelar</button></div>
      <div className="import-counts">
        <div><b>{preview.rowsValid}</b><span>linhas válidas</span></div>
        <div className={preview.rowsInvalid ? "count-warning" : ""}><b>{preview.rowsInvalid}</b><span>inválidas</span></div>
        <div className={preview.possibleDuplicates ? "count-warning" : ""}><b>{preview.possibleDuplicates}</b><span>possíveis duplicidades</span></div>
      </div>
      <div className="mapping-list"><b>Colunas da planilha</b>{preview.headers.map((header, index) => <label key={`${header}-${index}`}><span>{header}</span><select value={preview.mapping[index] ?? ""} onChange={(event) => changeMapping(index, event.target.value)} disabled={busy}><option value="">Não importar</option>{fields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}</div>
      {mappingDirty && <div className="mapping-update"><span>O mapeamento mudou; atualize a prévia para recalcular validações e duplicidades.</span><button className="secondary-button" onClick={updatePreview} disabled={busy}>Atualizar prévia</button></div>}
      {preview.samples.length > 0 && <div className="table-scroll import-samples"><table><thead><tr><th>Linha</th><th>Cliente</th><th>Pet</th><th>Registros</th><th>Valor</th><th>Data</th><th>Validação</th></tr></thead><tbody>{preview.samples.map((sample) => <tr key={sample.rowNumber}><td>{sample.rowNumber}</td><td>{sample.client}</td><td>{sample.pet}</td><td>{sample.type}</td><td>{formatMoney(sample.value)}</td><td>{formatDate(sample.date)}</td><td>{!sample.valid ? `Rejeitada · ${sample.errors.join(", ")}` : sample.possibleDuplicate ? `Possível duplicidade · ${sample.duplicateReason}` : sample.warnings.join(", ") || "Válida"}</td></tr>)}</tbody></table></div>}
      {preview.rowsValid > 0 && !mappingDirty && <div className="import-confirm-row">
        <label className="import-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}/><span>Revisei a prévia. As linhas inválidas serão rejeitadas e as possíveis duplicidades serão sinalizadas no histórico.</span></label>
        <div className="import-actions"><button className="secondary-button" onClick={cancelImport} disabled={busy}>Cancelar</button><button className="primary-button" onClick={confirmImport} disabled={!acknowledged || busy}> {busy ? "Importando…" : `Confirmar ${preview.rowsValid} linhas válidas`}</button></div>
      </div>}
      <p className="import-disclaimer">Orçamentos não contabilizam receita confirmada. Receita depende de venda concluída registrada explicitamente.</p>
    </div>}

    <div className="import-history"><div className="import-history-heading"><b>Importações recentes</b><span>{recentImports.length} registros</span></div>{recentImports.length ? <div className="table-scroll"><table><thead><tr><th>Arquivo</th><th>Status</th><th>Linhas</th><th>Importadas</th><th>Rejeitadas</th><th>Possíveis duplicidades</th><th>Criada em</th></tr></thead><tbody>{recentImports.map((item) => <tr key={item.id}><td>{item.file_name}{item.error_summary && <small className="import-row-error">{item.error_summary}</small>}</td><td><span className={`import-status import-${item.status}`}>{statusLabel(item.status)}</span></td><td>{item.rows_seen}</td><td>{item.rows_imported}</td><td>{item.rows_rejected}</td><td>{item.rows_duplicates}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table></div> : <p className="import-empty">Nenhuma importação registrada para esta clínica.</p>}</div>
  </section>;
}
