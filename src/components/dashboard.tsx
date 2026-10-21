"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import type { FormEvent } from "react";

import type { DashboardData, DashboardOpportunity } from "@/lib/dashboard-types";

import { SignOutButton } from "@/components/sign-out-button";

import { ImportManager } from "@/components/import-manager";

import { opportunityEventLabel } from "@/lib/opportunities/lifecycle.mjs";

import { summarizeFilteredOpportunityMetrics, summarizeOpportunityLifecycle } from "@/lib/dashboard-data.mjs";

type Opportunity = DashboardOpportunity;
const userInitials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("pt-BR")).join("") || "E";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const nav = [{ icon: "\u25a6", label: "Vis\u00e3o geral", short: "In\u00edcio" }, { icon: "\u25c9", label: "Oportunidades", short: "Oport." }, { icon: "\u21e7", label: "Importa\u00e7\u00f5es", short: "Import." }, { icon: "\u25f7", label: "Hist\u00f3rico de a\u00e7\u00f5es", short: "A\u00e7\u00f5es" }, { icon: "\u260e", label: "Contatos", short: "Contato" }, { icon: "\u25a5", label: "Resultados", short: "Dados" }, { icon: "?", label: "Ajuda", short: "Ajuda" }, { icon: "\u2699", label: "Conta", short: "Conta" }];

export function Dashboard({ data }: { data: DashboardData }) {

  const router = useRouter();

  const [active, setActive] = useState("Visão geral");

  const opportunities = data.opportunities;

  const [selected, setSelected] = useState<Opportunity | null>(null);

  const [query, setQuery] = useState("");

  const [notice, setNotice] = useState("");

  const [filter, setFilter] = useState("Todas");

  const [priorityFilter, setPriorityFilter] = useState("Todas");

  const [sortOrder, setSortOrder] = useState("priority");

  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const [actionReason, setActionReason] = useState("");

  const [saleAmount, setSaleAmount] = useState("");

  const [saleEvidence, setSaleEvidence] = useState("");

  const [nextActionAt, setNextActionAt] = useState("");

  const [nextActionNote, setNextActionNote] = useState("");

  const [reminderAction, setReminderAction] = useState<"keep" | "clear" | "schedule">("keep");

  const [actionRequestId, setActionRequestId] = useState("");

  const [savingAction, setSavingAction] = useState(false);

  const visible = useMemo(() => opportunities.filter((o) => `${o.pet} ${o.owner} ${o.reason} ${o.source} ${o.category} ${o.status}`.toLowerCase().includes(query.toLowerCase()) && (filter === "Todas" || o.status === filter) && (priorityFilter === "Todas" || o.priority === priorityFilter)).sort((a,b) => sortOrder === "date" ? b.date.localeCompare(a.date) : sortOrder === "value" ? (b.value ?? -1)-(a.value ?? -1) : ({high:0,medium:1,low:2}[a.priority] ?? 3)-({high:0,medium:1,low:2}[b.priority] ?? 3)), [opportunities, query, filter, priorityFilter, sortOrder]);

  const filteredMetrics = useMemo(() => summarizeFilteredOpportunityMetrics(visible), [visible]);

  const filteredLifecycle = summarizeOpportunityLifecycle(visible.map((item) => ({ id: item.id, status: item.rawStatus })), visible.flatMap((item) => item.history.map((action) => ({ ...action, opportunity_id: item.id }))));

  const hasListFilters = Boolean(query.trim()) || filter !== "Todas" || priorityFilter !== "Todas";

  const contactEvents = useMemo(() => opportunities.flatMap((opportunity) => opportunity.history

    .filter((action) => ["contact_attempted", "contacted", "no_response", "follow_up_scheduled"].includes(action.action_type))

    .map((action) => ({ opportunity, action })))

    .sort((a, b) => b.action.created_at.localeCompare(a.action.created_at)), [opportunities]);

  const scheduledContacts = useMemo(() => opportunities

    .filter((opportunity) => opportunity.nextActionAt && ["open", "in_contact", "waiting_reply"].includes(opportunity.rawStatus))

    .sort((a, b) => (a.nextActionAt ?? "").localeCompare(b.nextActionAt ?? "")), [opportunities]);

  async function submitOpportunityAction(event: FormEvent<HTMLFormElement>) {

    event.preventDefault();

    if (!selected || !actionStatus) return;

    setSavingAction(true);

    setNotice("");

    try {

      const response = await fetch(`/api/opportunities/${selected.id}/action`, {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ eventType: actionStatus, requestId: actionRequestId, reason: actionReason, reminderAction, nextActionAt: actionStatus === "follow_up_scheduled" || reminderAction === "schedule" ? (nextActionAt ? new Date(nextActionAt).toISOString() : null) : null, nextActionNote: actionStatus === "follow_up_scheduled" || reminderAction === "schedule" ? nextActionNote : null, confirmedRevenue: actionStatus === "won" ? saleAmount : null, evidenceReference: actionStatus === "won" ? saleEvidence : null }),

      });

      const result = await response.json();

      if (!response.ok) throw new Error(result.error || "Não foi possível registrar esta ação.");

      setActionStatus(null);

      setActionReason("");

      setSaleAmount("");

      setSaleEvidence("");

      setNextActionAt("");

      setNextActionNote("");

      setReminderAction("keep");

      setActionRequestId("");

      setSelected(null);

      router.refresh();

    } catch (error) {

      setNotice(error instanceof Error ? error.message : "Não foi possível registrar esta ação.");

    } finally {

      setSavingAction(false);

    }

  }

  function beginAction(status: string) {

    setActionStatus(status);

    setActionReason("");

    setSaleAmount("");

    setSaleEvidence("");

    setNextActionAt("");

    setNextActionNote("");

    setReminderAction("keep");

    setActionRequestId(crypto.randomUUID());

  }

  return <main className="app-shell">

    <aside className="sidebar">

      <a className="brand" href="#inicio" aria-label="VetRecover, início"><span className="brand-mark">v</span><span>vet<span className="brand-light">recover</span></span></a>

      <div className="clinic-switch"><div className="clinic-avatar">{data.clinicName.slice(0, 1).toLocaleUpperCase("pt-BR")}</div><div className="clinic-copy"><b>{data.clinicName}</b><span>Espaço de trabalho</span></div><span className="chevron">⌄</span></div>

      <span className="nav-caption">MENU PRINCIPAL</span>

      <nav className="main-nav" aria-label="Navegação principal">{nav.map((item) => <button key={item.label} title={item.label} aria-label={item.label} className={`nav-item ${active === item.label ? "active" : ""}`} onClick={() => { setActive(item.label); }}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-full-label">{item.label}</span><span className="nav-short-label" aria-hidden="true">{item.short}</span>{item.label === "Contatos" && contactEvents.length > 0 && <span className="nav-count" aria-label={`${contactEvents.length} ações de contato`}>{contactEvents.length}</span>}</button>)}</nav>

      <div className="sidebar-bottom"><div className="profile"><div className="profile-avatar">{data.userName.slice(0, 2).toLocaleUpperCase("pt-BR")}</div><div className="clinic-copy"><b>{data.userName}</b><span>Equipe da clínica</span></div><SignOutButton /></div><div className="privacy"><span>●</span> Seus dados protegidos</div></div>

    </aside>

    <section className="workspace">

      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <b>{active}</b></div><div className="top-actions"><SignOutButton /><div className="top-avatar" aria-label={`Conta ${data.userName}`}>{userInitials(data.userName)}</div></div></header>

      <div className="content">

        <div className="welcome-row"><div><div className="eyebrow"><span className="live-dot" /> VISÃO GERAL DA CLÍNICA</div><h1>{active === nav[0].label ? <>Olá, {data.userName} <span className="wave">✳</span></> : active}</h1><p className="subtitle">{active === nav[0].label ? "Veja o que está acontecendo na sua clínica hoje." : "Consulte e gerencie os dados persistidos da clínica."}</p></div><div className="header-controls">{active === nav[0].label && <span className="period-label">Indicadores | {hasListFilters ? "filtros atuais" : "historico completo"}</span>}<button className="primary-button" onClick={() => { setActive(nav[2].label); }}><span>＋</span> Nova importação</button></div></div>

        <div className="demo-banner"><span className="demo-icon">i</span><span><b>{data.hasRealData ? "Dados da clínica." : "Sem dados reais ainda."}</b> {data.hasRealData ? "Indicadores e recomendações usam registros desta clínica." : "Os indicadores aparecem depois que os registros reais forem adicionados ao banco."}</span></div>

        {!data.intelligenceReady && <div className="intelligence-not-ready" role="status">A atualização da inteligência comercial falhou. Confirme que aplicou as migrações do motor no Supabase; dados importados continuam preservados.</div>}

        {data.intelligenceReviews.length > 0 && <div className="intelligence-review" role="status"><b>{data.intelligenceReviews.length} registro(s) precisam de revisão</b><ul>{data.intelligenceReviews.slice(0, 5).map((item) => <li key={`${item.source_record_type}:${item.source_record_id}`}>{item.source_record_type} {item.source_record_id.slice(0, 8)} · {item.reason}</li>)}</ul></div>}

        {(active === nav[0].label || active === nav[5].label) && (<section className="metrics" aria-label="Indicadores financeiros"><Metric title="Oportunidades abertas" value={data.hasRealData ? String(filteredMetrics.openOpportunityCount) : "—"} change={data.hasRealData ? (hasListFilters ? "Filtros atuais" : "Dados persistidos") : "Sem registros"} tone="green" icon="◉" description="Oportunidades novas que ainda aguardam ação da equipe."/><Metric title="Trabalhadas" value={data.hasRealData ? String(filteredMetrics.workedOpportunityCount) : "—"} change={data.hasRealData ? "Ação registrada" : "Sem registros"} tone="neutral" icon="✓" description="Oportunidades com tentativas, contatos, retorno agendado, observação ou venda registrados."/><Metric title="Valor potencial" value={!data.hasRealData ? "\u2014" : brl(filteredMetrics.potentialValue)} change={!data.hasRealData ? "Sem registros" : hasListFilters ? "Filtros atuais" : "Dados importados"} tone="green" icon="↗" description="Total de valores das oportunidades ativas apos deduplicacao; nao e receita."/><Metric title="Em negociação" value={!data.hasRealData ? "\u2014" : brl(filteredMetrics.negotiationValue)} change={!data.hasRealData ? "Sem registros" : hasListFilters ? "Filtros atuais" : "Oportunidades abertas"} tone="green" icon="◷" description="Valor das oportunidades ativas em contato ou aguardando retorno."/><Metric title="Receita confirmada" value={!data.hasRealData ? "\u2014" : brl(filteredMetrics.confirmedRevenue)} change={!data.hasRealData ? "Sem vendas registradas" : hasListFilters ? "Filtros atuais" : "Vendas registradas"} tone="neutral" icon="✓" description="Vendas registradas como concluídas pela equipe."/><Metric title="Receita atribuída" value={data.attributedRevenue === null ? "—" : brl(data.attributedRevenue)} change={data.attributedRevenue === null ? "Sem atribuição" : "Método documentado"} tone="purple" icon="⌁" description="Receita associada a uma ação pelo método documentado. Associação temporal não comprova causalidade."/></section>)}

        {(active === nav[0].label || active === nav[1].label) && (<div className={`dashboard-grid ${active === nav[1].label ? "opportunities-full" : ""}`}><section className="panel opportunity-panel" id="opportunity-panel"><div className="panel-heading"><div><div className="heading-title">Oportunidades prioritárias <span className="count-pill">{data.opportunityCount}</span></div><p>Sinais para revisão da equipe; não garantem recuperação de receita.</p></div><button className="text-button" onClick={() => { setActive("Oportunidades"); document.getElementById("opportunity-panel")?.scrollIntoView({ behavior: "smooth" }); }}>Ver todas <span>→</span></button></div>

          <div className="table-tools"><label className="search"><span>⌕</span><input aria-label="Buscar oportunidades" placeholder="Buscar por pet ou tutor..." value={query} onChange={(e) => setQuery(e.target.value)}/><kbd>⌘ K</kbd></label><select aria-label="Filtrar status" value={filter} onChange={(e) => setFilter(e.target.value)}><option>Todas</option><option>Nova</option><option>Em contato</option><option>Aguardando retorno</option><option>Convertida</option><option>Perdida</option><option>Inválida</option></select><select aria-label="Filtrar prioridade" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}><option value="Todas">Todas prioridades</option><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select><select aria-label="Ordenar oportunidades" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}><option value="priority">Prioridade</option><option value="date">Data recente</option><option value="value">Maior valor</option></select><button className="filter-button" aria-label="Mais filtros">☷</button></div>

          <div className="opportunity-list">{visible.length ? visible.map((o) => <button className="opportunity-row" key={o.id} onClick={() => { setSelected(o); setActionStatus(null); }}><span className={`pet-avatar ${o.color}`}>{o.initials}</span><span className="pet-details"><b>{o.pet}<small>{o.owner}</small></b></span><span className="opportunity-reason"><b>{o.reason}</b><small>{o.category} · {o.priority === "high" ? "Prioridade alta" : o.priority === "medium" ? "Prioridade média" : "Prioridade baixa"} · {o.source}</small></span><span className="opportunity-value"><b>{o.value === null ? "—" : brl(o.value)}</b><small>{o.date}</small></span><span className={`status status-${o.rawStatus === "open" ? "pending" : o.rawStatus === "won" ? "done" : o.rawStatus === "in_contact" ? "contact" : "closed"}`}><i />{o.status}</span><span className="row-arrow">›</span></button>) : <div className="empty-state">Nenhuma oportunidade encontrada para este filtro.</div>}</div>

          <button className="panel-footer" onClick={() => { setActive("Oportunidades"); document.getElementById("opportunity-panel")?.scrollIntoView({ behavior: "smooth" }); }}>Ver todas as {data.opportunityCount} oportunidades <span>→</span></button></section>

          {active === nav[0].label && (<section className="panel insight-panel"><div className="panel-heading"><div><div className="heading-title">Resumo inteligente <span className="sparkle">✳</span></div><p>Leitura dos dados registrados nesta clínica.</p></div><button className="more-button" aria-label="Mais opções">···</button></div><div className="insight-content">{filteredMetrics.openOpportunityCount ? <><div className="insight-highlight"><span className="bulb">✳</span><p><b>{filteredMetrics.openOpportunityCount} oportunidades aguardam revisão.</b> Revise a origem e o motivo antes de decidir o próximo contato.</p></div><div className="insight-stat"><span className="stat-icon gold">⌁</span><div><b>{brl(filteredMetrics.potentialValue)}</b><small>valor potencial ativo apos os filtros atuais</small></div></div><div className="insight-note"><span>ⓘ</span> Valor calculado dos registros da clínica; nenhuma probabilidade de conversão foi aplicada.</div><button className="insight-link" onClick={() => { setFilter("Nova"); setActive("Oportunidades"); }}>Revisar oportunidades <span>→</span></button></> : <div className="empty-state">Nenhuma oportunidade pendente. Quando os dados forem adicionados, as recomendações aparecerão aqui.</div>}</div></section>)}</div>)}

        {(active === nav[0].label || active === nav[3].label) && (<section className="panel activity-panel"><div className="panel-heading"><div><div className="heading-title">Atividade recente</div><p>Ações registradas pela equipe.</p></div><button className="text-button" onClick={() => setActive("Histórico de ações")}>Ver histórico <span>→</span></button></div><div className="activity-list">{data.activity.length ? (active === nav[3].label ? data.activity : data.activity.slice(0, 5)).map((item) => <Activity key={item.id} icon="•" color="green" title={item.title} text={item.text} time={item.time}/>) : <div className="empty-state">Nenhuma ação foi registrada para esta clínica.</div>}</div></section>)}

        {(active === nav[0].label || active === nav[2].label) && <ImportManager recentImports={data.recentImports} ready={data.importerReady} databaseError={data.importerError}/>}{active === nav[4].label && <section className="panel contact-center" aria-label="Central de contatos"><div className="panel-heading"><div><div className="heading-title">Central de contatos <span className="count-pill">{contactEvents.length}</span></div><p>Acompanhe as a&ccedil;&otilde;es registradas e os pr&oacute;ximos retornos da equipe.</p></div></div><div className="contact-scheduled"><b>Retornos agendados <span className="count-pill">{scheduledContacts.length}</span></b>{scheduledContacts.length ? scheduledContacts.map((opportunity) => <button className="contact-event" key={`next-${opportunity.id}`} onClick={() => { setSelected(opportunity); setActionStatus(null); }}><span className="activity-icon green">&bull;</span><span className="activity-copy"><b>{opportunity.nextActionNote || opportunity.nextAction}</b><span>{opportunity.pet} / {opportunity.owner} / {opportunity.status}</span></span><time>{opportunity.nextActionAt ? new Date(opportunity.nextActionAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""}</time><span className="row-arrow">&gt;</span></button>) : <p className="empty-state">Nenhum retorno agendado.</p>}</div><div className="contact-history"><b>A&ccedil;&otilde;es de contato registradas</b>{contactEvents.length ? contactEvents.map(({ opportunity, action }) => <button className="contact-event" key={action.id} onClick={() => { setSelected(opportunity); setActionStatus(null); }}><span className="activity-icon green">{{contact_attempted: "T", contacted: "C", no_response: "!", follow_up_scheduled: "R"}[action.action_type]}</span><span className="activity-copy"><b>{{contact_attempted: "Tentativa de contato", contacted: "Contato realizado", no_response: "Sem resposta", follow_up_scheduled: "Retorno agendado"}[action.action_type]}</b><span>{opportunity.pet} / {opportunity.owner} / {opportunity.status} / {action.actor_name} / {action.notes || "A??o registrada"}</span></span><time>{new Date(action.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time><span className="row-arrow">&gt;</span></button>) : <p className="empty-state">Ainda n?o h? contatos registrados. Abra uma oportunidade e selecione Tentar contato para come?ar.</p>}</div></section>}{active === nav[5].label && <section className="panel" aria-label="Resultados"><div className="panel-heading"><div><div className="heading-title">Resultados registrados</div><p>Indicadores calculados de dados persistidos; valor potencial não é receita.</p></div></div><div className="activity-list">{[{key:"open",label:"Nova"},{key:"in_contact",label:"Em contato"},{key:"waiting_reply",label:"Aguardando retorno"},{key:"won",label:"Convertida"},{key:"dismissed",label:"Perdida"},{key:"invalid",label:"Inválida"}].map(({key,label}) => <Activity key={key} icon="•" color="green" title={label} text={`${visible.filter((item) => item.rawStatus === key).length} oportunidade(s)`} time="Agora" />)}<Activity icon="•" color="green" title="Trabalhadas" text={`${filteredMetrics.workedOpportunityCount} oportunidade(s) com ação da equipe registrada`} time="Histórico persistido" /></div><div className="detail-source"><b>Perdidas por motivo</b>{filteredLifecycle.lostByReason.length ? filteredLifecycle.lostByReason.map((item) => <p key={item.reason}>{item.reason} · {item.count} oportunidade(s)</p>) : <p>Nenhuma oportunidade perdida registrada.</p>}</div><div className="detail-source"><b>Valores financeiros</b><p>Valor potencial ativo: {!data.hasRealData ? "\u2014" : brl(filteredMetrics.potentialValue)}. Em negociação: {!data.hasRealData ? "\u2014" : brl(filteredMetrics.negotiationValue)}. Receita confirmada: {!data.hasRealData ? "\u2014" : brl(filteredMetrics.confirmedRevenue)}. Receita atribuída permanece sem valor até haver vínculo documentado.</p></div></section>} {active === "Conta" && <section className="panel" aria-label="Conta"><div className="panel-heading"><div><div className="heading-title">Conta e cl?nica</div><p>Informa&ccedil;&otilde;es da sess&atilde;o autenticada e do espa&ccedil;o de trabalho.</p></div></div><div className="detail-source"><b>Cl&iacute;nica</b><p>{data.clinicName}</p></div><div className="detail-source"><b>Conta autenticada</b><p>{data.userName}</p><small>O acesso aos dados &eacute; limitado pela associa&ccedil;&atilde;o desta conta &agrave; cl&iacute;nica.</small></div><div className="detail-source"><b>Dados</b><p>O dashboard exibe registros persistidos no banco da cl&iacute;nica. Nenhuma prefer&ecirc;ncia edit&aacute;vel &eacute; apresentada aqui.</p></div></section>}{active === "Ajuda" && <section className="panel" aria-label="Ajuda"><div className="panel-heading"><div><div className="heading-title">Como usar o VetRecover</div><p>Orienta&ccedil;&otilde;es r&aacute;pidas para as tarefas da equipe.</p></div></div><div className="detail-source"><b>Oportunidades</b><p>Abra uma oportunidade para conferir a origem, o motivo e os dados do tutor. Use os filtros para localizar e priorizar registros.</p></div><div className="detail-source"><b>Registrar contato</b><p>As a&ccedil;&otilde;es ficam vis&iacute;veis para a cl&iacute;nica no hist&oacute;rico e na Central de contatos. Registrar uma tentativa n&atilde;o inicia liga&ccedil;&atilde;o, e-mail nem mensagem.</p></div><div className="detail-source"><b>Importar dados</b><p>Envie um CSV ou XLSX, revise o mapeamento e confirme a importa&ccedil;&atilde;o. Identificadores externos consistentes ajudam a evitar duplicidades.</p></div><div className="detail-source"><b>Indicadores</b><p>Valor potencial &eacute; uma estimativa baseada nos or&ccedil;amentos. Receita confirmada s&oacute; aparece ap&oacute;s registrar a venda e uma evid&ecirc;ncia verific&aacute;vel.</p></div></section>}<footer className="page-foot"><span>© 2025 VetRecover</span><span><i/> Todos os sistemas operacionais</span><span>Feito para cuidar do futuro da sua clínica <b>✳</b></span></footer>

      </div>

    </section>

    {notice && <div role="status" className="toast">ⓘ &nbsp;{notice}<button onClick={() => setNotice("")}>×</button></div>}

    {selected && <div className="modal-backdrop" onClick={() => { setSelected(null); setActionStatus(null); }}><section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => { setSelected(null); setActionStatus(null); }} aria-label="Fechar">×</button><span className={`pet-avatar large ${selected.color}`}>{selected.initials}</span><span className="eyebrow">{selected.category.toLocaleUpperCase("pt-BR")} · PRIORIDADE {selected.priority.toLocaleUpperCase("pt-BR")}</span><h2 id="detail-title">{selected.pet} · {selected.owner}</h2><p className="subtitle">Status: {selected.status}{selected.dataQuality === "review" ? " · dado ambíguo, requer revisão" : ""}</p>{selected.dataQualityNotes && <div className="detail-source"><b>Informações ausentes ou ambíguas</b><p>{selected.dataQualityNotes}</p></div>}<div className="detail-source"><b>Contato do tutor</b><p>Telefone: {selected.ownerPhone?.trim() || "Não informado"}</p><p>E-mail: {selected.ownerEmail?.trim() || "Não informado"}</p></div><div className="detail-value"><small>{selected.valueSource ?? "Valor potencial associado"}</small><b>{selected.value === null ? "—" : brl(selected.value)}</b></div><div className="detail-source"><b>Motivo da identificação</b><p>{selected.reason}</p><small>Origem: {selected.source} · {selected.date}</small></div><div className="detail-source"><b>Regra de prioridade</b><p>{selected.priorityReason}</p></div><div className="detail-source"><b>Próxima ação</b><p>{selected.nextActionNote || selected.nextAction}</p>{selected.nextActionAt && <small>Agendada para {new Date(selected.nextActionAt).toLocaleString("pt-BR")}</small>}</div><div className="detail-source"><b>Histórico da equipe</b>{selected.history.length ? selected.history.map((action) => <p key={action.id}>{new Date(action.created_at).toLocaleString("pt-BR")} · {action.action_type} · {action.actor_name} · {action.notes || ""}{action.confirmed_revenue !== null ? ` · venda ${brl(action.confirmed_revenue)}` : ""}{action.evidence_reference ? ` · evidência ${action.evidence_reference}` : ""}</p>) : <p>Nenhuma ação registrada para esta oportunidade.</p>}</div>{selected.rawStatus === "open" || selected.rawStatus === "in_contact" || selected.rawStatus === "waiting_reply" ? <><p className="attribution-note">Registrar contato salva a ação para a equipe. Isso não inicia uma ligação, e-mail ou mensagem.</p><div className="modal-actions"><button className="secondary-button" onClick={() => beginAction("contact_attempted")}>Tentar contato</button><button className="secondary-button" onClick={() => beginAction("contacted")}>Contato realizado</button><button className="secondary-button" onClick={() => beginAction("no_response")}>Sem resposta</button><button className="secondary-button" onClick={() => beginAction("follow_up_scheduled")}>Agendar retorno</button><button className="secondary-button" onClick={() => beginAction("note_added")}>Adicionar observação</button><button className="primary-button" onClick={() => beginAction("won")}>Concluir com venda</button><button className="secondary-button" onClick={() => beginAction("dismissed")}>Sem interesse</button><button className="secondary-button" onClick={() => beginAction("invalid")}>Marcar inválida</button></div>{actionStatus && <form className="opportunity-action-form" onSubmit={submitOpportunityAction}><b>{opportunityEventLabel(actionStatus)}</b>{(["dismissed", "invalid", "note_added"].includes(actionStatus)) && <label>Justificativa<textarea required maxLength={1000} value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label>}{["contact_attempted", "contacted", "no_response"].includes(actionStatus) && <><label>Observa&ccedil;&atilde;o (opcional)<textarea maxLength={1000} value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label><label>Retorno agendado<select value={reminderAction} onChange={(event) => setReminderAction(event.target.value as "keep" | "clear" | "schedule")}><option value="keep">Manter data atual (padr&atilde;o)</option><option value="clear">Marcar retorno anterior como conclu&iacute;do</option><option value="schedule">Agendar nova data</option></select></label>{reminderAction === "keep" && selected.nextActionAt && <small>Data atual: {new Date(selected.nextActionAt).toLocaleString("pt-BR")}. Quando Sem resposta, a data ser&aacute; mantida.</small>}{reminderAction === "schedule" && <><label>Nova data e hora<input required type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} /></label><label>O que fazer no retorno<textarea maxLength={500} value={nextActionNote} onChange={(event) => setNextActionNote(event.target.value)} /></label></>}</>}{actionStatus === "follow_up_scheduled" && <><label>Data e hora do retorno<input required type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} /></label><label>O que fazer no retorno<textarea maxLength={500} value={nextActionNote} onChange={(event) => setNextActionNote(event.target.value)} /></label></>}{actionStatus === "won" && <><label>Valor da venda concluída<input required type="number" min="0" step="0.01" value={saleAmount} onChange={(event) => setSaleAmount(event.target.value)} /></label><label>Referência verificável (ex.: número do recibo/nota)<input required maxLength={200} value={saleEvidence} onChange={(event) => setSaleEvidence(event.target.value)} /></label><small>Este valor só será confirmado como receita com a evidência informada. Não será atribuído à oportunidade automaticamente.</small></>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setActionStatus(null)} disabled={savingAction}>Voltar</button><button type="submit" className="primary-button" disabled={savingAction}>{savingAction ? "Salvando…" : "Registrar ação"}</button></div></form>}</> : <small className="attribution-note">Oportunidade encerrada. Consulte o histórico para ver a justificativa e o registro da ação.</small>}<small className="attribution-note">Receita atribuída permanece zero sem vínculo documentado entre a ação e uma venda.</small></section></div>}

  </main>;

}

function Metric({ title, value, change, tone, icon, description }: { title: string; value: string; change: string; tone: string; icon: string; description: string }) { return <article className="metric-card"><div className="metric-top"><span>{title}<span className="tooltip" title={description} aria-label={description}>ⓘ</span></span><span className={`metric-icon ${tone}`}>{icon}</span></div><strong>{value}</strong><div className="metric-bottom"><span className={`metric-change ${tone}`}>{change}</span><span className="metric-context">Fonte: banco da clínica</span></div><div className="metric-description">{description}</div></article> }

function Activity({ icon, color, title, text, time }: { icon: string; color: string; title: string; text: string; time: string }) { return <div className="activity-row"><span className={`activity-icon ${color}`}>{icon}</span><div className="activity-copy"><b>{title}</b><span>{text}</span></div><time>{time}</time></div> }