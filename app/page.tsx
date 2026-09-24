"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Lead, LeadActivity, Stage } from "@/lib/types";
import WhatsAppInbox from "@/app/whatsapp-inbox";

type SessionState = "loading" | "signed_out" | "ready" | "no_access";
type View = "overview" | "leads" | "tasks" | "activities" | "whatsapp";
type ActivityFeedItem = LeadActivity & { lead_id: string; leads: Pick<Lead, "name" | "company_name"> | null };

const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

const toWhatsApp = (value: string | null) => {
  const number = (value || "").replace(/\D/g, "");
  return number ? `https://wa.me/${number.startsWith("55") ? number : `55${number}`}` : "#";
};

const metadataValue = (lead: Lead, key: string) => {
  const value = lead.metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const activityLabel: Record<LeadActivity["activity_type"], string> = {
  note: "Nota",
  call: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  meeting: "Reunião",
  status_change: "Status",
  other: "Atualização",
};

export default function Home() {
  const [state, setState] = useState<SessionState>("loading");
  const [view, setView] = useState<View>("overview");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [recentActivities, setRecentActivities] = useState<ActivityFeedItem[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false);
  const [newLead, setNewLead] = useState({ name: "", company: "", whatsapp: "", stageId: "", nextAction: "" });
  const [leadActionMessage, setLeadActionMessage] = useState("");
  const [isSavingLead, setIsSavingLead] = useState(false);
  const [activityNote, setActivityNote] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadCrm = async () => {
    if (!supabase) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setState("signed_out");
      return;
    }

    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership) {
      setState("no_access");
      return;
    }

    setOrganizationId(membership.organization_id);
    setRole(membership.role);

    const [{ data: stageData }, { data: leadData }, { data: activityData }] = await Promise.all([
      supabase.from("pipeline_stages").select("id,name,position,color,stage_type").eq("organization_id", membership.organization_id).eq("is_active", true).order("position"),
      supabase.from("leads").select("id,name,company_name,whatsapp,source,priority,status,next_action_at,next_action_title,last_contact_at,stage_id,notes,metadata,updated_at,pipeline_stages(name,color)").eq("organization_id", membership.organization_id).neq("status", "archived").order("updated_at", { ascending: false }).limit(100),
      supabase.from("lead_activities").select("id,lead_id,activity_type,title,description,occurred_at,leads(name,company_name)").eq("organization_id", membership.organization_id).order("occurred_at", { ascending: false }).limit(50),
    ]);

    const safeStages = (stageData || []) as Stage[];
    setStages(safeStages);
    setLeads((leadData || []) as unknown as Lead[]);
    setRecentActivities((activityData || []) as unknown as ActivityFeedItem[]);
    setNewLead((current) => ({ ...current, stageId: current.stageId || safeStages.find((stage) => stage.stage_type === "open")?.id || "" }));
    setState("ready");
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setState("signed_out");
      return;
    }
    void loadCrm();
  }, []);

  const stats = useMemo(() => ({
    open: leads.filter((lead) => lead.status === "open").length,
    next: leads.filter((lead) => lead.next_action_at).length,
    urgent: leads.filter((lead) => lead.priority === "urgent" || lead.priority === "high").length,
    won: leads.filter((lead) => lead.status === "won").length,
  }), [leads]);

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter((lead) => [lead.name, lead.company_name, lead.whatsapp, lead.pipeline_stages?.name].filter(Boolean).join(" ").toLowerCase().includes(term));
  }, [leads, search]);

  const taskLeads = useMemo(() => leads
    .filter((lead) => lead.next_action_title || lead.next_action_at)
    .sort((a, b) => new Date(a.next_action_at || "9999-12-31").getTime() - new Date(b.next_action_at || "9999-12-31").getTime()), [leads]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage("Não foi possível entrar. Confira e-mail e senha.");
      return;
    }
    await loadCrm();
  };

  const createLead = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !organizationId || !newLead.name || !newLead.stageId) return;
    setMessage("");
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase.from("leads").insert({
      organization_id: organizationId,
      created_by: userData.user.id,
      stage_id: newLead.stageId,
      name: newLead.name.trim(),
      company_name: newLead.company.trim() || null,
      whatsapp: newLead.whatsapp.replace(/\D/g, "") || null,
      source: "CRM manual",
      next_action_title: newLead.nextAction.trim() || null,
      next_action_at: newLead.nextAction ? new Date().toISOString() : null,
    });
    if (error) {
      setMessage("Não foi possível salvar o lead. Tente novamente.");
      return;
    }
    setIsNewLeadOpen(false);
    setNewLead({ name: "", company: "", whatsapp: "", stageId: stages.find((stage) => stage.stage_type === "open")?.id || "", nextAction: "" });
    setLeadActionMessage("Lead cadastrado com sucesso.");
    await loadCrm();
  };

  const saveLeadProgress = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !selectedLead) return;
    const targetStage = stages.find((stage) => stage.id === selectedLead.stage_id);
    if (!targetStage) return;
    setIsSavingLead(true);
    setLeadActionMessage("");
    const nextStatus = targetStage.stage_type === "won" ? "won" : targetStage.stage_type === "lost" ? "lost" : "open";
    const { error } = await supabase.from("leads").update({
      stage_id: selectedLead.stage_id,
      status: nextStatus,
      next_action_title: selectedLead.next_action_title?.trim() || null,
      next_action_at: selectedLead.next_action_at || null,
      updated_at: new Date().toISOString(),
    }).eq("id", selectedLead.id);
    if (error) {
      setLeadActionMessage("Não foi possível atualizar o lead.");
      setIsSavingLead(false);
      return;
    }
    setLeadActionMessage("Lead atualizado com sucesso.");
    setIsSavingLead(false);
    await loadCrm();
  };

  const addActivity = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !organizationId || !selectedLead || !activityNote.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    setIsSavingLead(true);
    setLeadActionMessage("");
    const { error } = await supabase.from("lead_activities").insert({
      organization_id: organizationId,
      lead_id: selectedLead.id,
      activity_type: "note",
      title: "Nota comercial",
      description: activityNote.trim(),
      occurred_at: new Date().toISOString(),
      created_by: userData.user.id,
    });
    if (error) {
      setLeadActionMessage("Não foi possível registrar a nota.");
      setIsSavingLead(false);
      return;
    }
    setActivityNote("");
    setLeadActionMessage("Nota registrada no histórico.");
    await openLead(selectedLead);
    await loadCrm();
    setIsSavingLead(false);
  };

  const openLead = async (lead: Lead) => {
    setLeadActionMessage("");
    setActivityNote("");
    setSelectedLead(lead);
    setActivities([]);
    setIsLoadingActivities(true);
    if (!supabase) return;
    const { data } = await supabase.from("lead_activities").select("id,activity_type,title,description,occurred_at").eq("lead_id", lead.id).order("occurred_at", { ascending: false }).limit(30);
    setActivities((data || []) as LeadActivity[]);
    setIsLoadingActivities(false);
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setLeads([]);
    setSelectedLead(null);
    setState("signed_out");
  };

  if (!isSupabaseConfigured) {
    return <main className="centered"><section className="setup-card"><span className="mark">W</span><p className="eyebrow">WUNIFLOW CRM</p><h1>Configuração necessária</h1><p>Adicione as duas variáveis públicas do Supabase na Vercel para ativar o CRM.</p><code>NEXT_PUBLIC_SUPABASE_URL<br />NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code></section></main>;
  }

  if (state === "loading") return <main className="centered"><p className="muted">Carregando CRM…</p></main>;

  if (state === "signed_out") {
    return <main className="centered"><section className="login-card"><span className="mark">W</span><p className="eyebrow">WUNIFLOW AUTOMATIONS</p><h1>CRM Comercial</h1><p className="muted">Tecnologia para quem vive a operação.</p><form onSubmit={signIn}><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>{message && <p className="error">{message}</p>}<button type="submit">Entrar no CRM</button></form></section></main>;
  }

  if (state === "no_access") {
    return <main className="centered"><section className="setup-card"><span className="mark">W</span><h1>Acesso ainda não liberado</h1><p>Este usuário ainda não faz parte da organização Wuniflow no CRM.</p><button onClick={signOut}>Sair</button></section></main>;
  }

  const leadRows = filteredLeads.map((lead) => <tr key={lead.id}><td><strong>{lead.name}</strong><small>{lead.company_name || "Empresa não informada"} · {lead.source || "Origem não informada"}</small></td><td><span className="stage"><i style={{ background: lead.pipeline_stages?.color || "#94a3b8" }} />{lead.pipeline_stages?.name || "Sem etapa"}</span></td><td><span className={`priority ${lead.priority}`}>{lead.priority}</span></td><td><strong>{lead.next_action_title || "Revisar contexto e assumir contato"}</strong><small>{formatDate(lead.next_action_at || lead.last_contact_at)}</small></td><td className="actions"><button className="view-button" onClick={() => void openLead(lead)}>Ver contexto</button>{lead.whatsapp && <a className="whatsapp" href={toWhatsApp(lead.whatsapp)} target="_blank" rel="noreferrer">WhatsApp ↗</a>}</td></tr>);

  return <main className="shell"><aside className={mobileMenuOpen ? "open" : ""}><div className="brand"><span className="mark">W</span><div><strong>WUNIFLOW</strong><small>AUTOMATIONS</small></div></div><nav><button className={view === "overview" ? "active" : ""} onClick={() => { setView("overview"); setMobileMenuOpen(false); }}>Visão geral</button><button className={view === "leads" ? "active" : ""} onClick={() => { setView("leads"); setMobileMenuOpen(false); }}>Leads</button><button className={view === "tasks" ? "active" : ""} onClick={() => { setView("tasks"); setMobileMenuOpen(false); }}>Tarefas</button><button className={view === "activities" ? "active" : ""} onClick={() => { setView("activities"); setMobileMenuOpen(false); }}>Atividades</button><button className={view === "whatsapp" ? "active" : ""} onClick={() => { setView("whatsapp"); setMobileMenuOpen(false); }}>WhatsApp</button></nav><div className="side-footer"><span>{role}</span><button className="text-button" onClick={signOut}>Sair</button></div></aside>{mobileMenuOpen && <button className="mobile-menu-backdrop" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} />}<section className="content"><header><button className="mobile-menu-button" aria-label="Abrir menu" onClick={() => setMobileMenuOpen(true)}><span /><span /><span /></button><div><p className="eyebrow">OPERAÇÃO COMERCIAL</p><h1>{view === "overview" ? "Visão geral" : view === "leads" ? "Leads" : view === "tasks" ? "Próximas ações" : view === "activities" ? "Atividades" : "WhatsApp"}</h1><p className="muted">{view === "overview" ? "Acompanhe leads, prioridades e próximos passos." : view === "leads" ? "Diagnósticos e conversas qualificadas em um só lugar." : view === "tasks" ? "Organize os retornos comerciais que precisam de atenção." : view === "activities" ? "Histórico recente da operação comercial." : "Conversas recebidas pelo WhatsApp da Wuniflow."}</p></div><button onClick={() => setIsNewLeadOpen(true)}>+ Novo lead</button></header>{view === "overview" ? <><section className="stats"><article><span>Leads abertos</span><strong>{stats.open}</strong></article><article><span>Próximas ações</span><strong>{stats.next}</strong></article><article><span>Prioridade alta</span><strong>{stats.urgent}</strong></article><article><span>Ganhos</span><strong>{stats.won}</strong></article></section><section className="panel"><div className="panel-title"><div><h2>Leads recentes</h2><p>Diagnósticos recebidos e atendimentos em andamento.</p></div><span>{leads.length} registros</span></div>{leads.length === 0 ? <div className="empty"><h3>Ainda não há leads no CRM</h3><p>O próximo diagnóstico confirmado pela landing aparecerá aqui automaticamente.</p></div> : <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Etapa</th><th>Prioridade</th><th>Próxima ação</th><th></th></tr></thead><tbody>{leadRows}</tbody></table></div>}</section></> : view === "leads" ? <section className="panel"><div className="panel-title lead-list-heading"><div><h2>Todos os leads</h2><p>Use a busca para localizar empresa, contato, etapa ou telefone.</p></div><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead…" /></div>{filteredLeads.length === 0 ? <div className="empty"><h3>Nenhum lead encontrado</h3><p>{leads.length ? "Tente outro termo de busca." : "Os novos diagnósticos serão listados aqui."}</p></div> : <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Etapa</th><th>Prioridade</th><th>Última atualização</th><th></th></tr></thead><tbody>{leadRows}</tbody></table></div>}</section> : view === "tasks" ? <section className="panel"><div className="panel-title"><div><h2>Próximas ações</h2><p>Leads com retorno ou acompanhamento agendado.</p></div><span>{taskLeads.length} pendências</span></div>{taskLeads.length === 0 ? <div className="empty"><h3>Nenhuma ação pendente</h3><p>Defina a próxima ação dentro de um lead para ela aparecer aqui.</p></div> : <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Etapa</th><th>Próxima ação</th><th>Quando</th><th></th></tr></thead><tbody>{taskLeads.map((lead) => <tr key={lead.id}><td><strong>{lead.name}</strong><small>{lead.company_name || "Empresa não informada"}</small></td><td><span className="stage"><i style={{ background: lead.pipeline_stages?.color || "#94a3b8" }} />{lead.pipeline_stages?.name || "Sem etapa"}</span></td><td><strong>{lead.next_action_title || "Revisar contexto e definir próximo passo"}</strong></td><td>{formatDate(lead.next_action_at)}</td><td className="actions"><button className="view-button" onClick={() => void openLead(lead)}>Abrir lead</button></td></tr>)}</tbody></table></div>}</section> : view === "activities" ? <section className="panel"><div className="panel-title"><div><h2>Atividades recentes</h2><p>Notas, handoffs e interações registradas no CRM.</p></div><span>{recentActivities.length} registros</span></div>{recentActivities.length === 0 ? <div className="empty"><h3>Ainda não há atividades</h3><p>As próximas notas e movimentações aparecerão aqui.</p></div> : <div className="activity-feed">{recentActivities.map((activity) => <article key={activity.id}><span>{activityLabel[activity.activity_type]}</span><div><strong>{activity.title}</strong><p>{activity.leads?.name || "Lead não localizado"}{activity.leads?.company_name ? " · " + activity.leads.company_name : ""}</p>{activity.description && <p>{activity.description}</p>}<small>{formatDate(activity.occurred_at)}</small></div><button className="view-button" onClick={() => { const lead = leads.find((item) => item.id === activity.lead_id); if (lead) void openLead(lead); }}>Abrir lead</button></article>)}</div>}</section> : organizationId ? <WhatsAppInbox organizationId={organizationId} /> : null}}</section>{selectedLead && <div className="modal-backdrop" onMouseDown={() => setSelectedLead(null)}><section className="modal lead-detail" onMouseDown={(event) => event.stopPropagation()}><div className="panel-title"><div><p className="eyebrow">CONTEXTO DO LEAD</p><h2>{selectedLead.name}</h2><p>{selectedLead.company_name || "Empresa não informada"} · {selectedLead.pipeline_stages?.name || "Sem etapa"}</p></div><button className="text-button" onClick={() => setSelectedLead(null)}>Fechar</button></div><div className="detail-body"><div className="detail-actions">{selectedLead.whatsapp && <a className="button-link" href={toWhatsApp(selectedLead.whatsapp)} target="_blank" rel="noreferrer">Assumir no WhatsApp ↗</a>}<span className={`priority ${selectedLead.priority}`}>Prioridade {selectedLead.priority}</span></div><section className="context-grid"><div><span>WhatsApp</span><strong>{selectedLead.whatsapp || "Não informado"}</strong></div><div><span>Último contato</span><strong>{formatDate(selectedLead.last_contact_at)}</strong></div><div><span>Cargo</span><strong>{metadataValue(selectedLead, "role") || "Não informado"}</strong></div><div><span>Equipe</span><strong>{metadataValue(selectedLead, "team_size") || "Não informada"}</strong></div></section><section className="context-summary"><h3>Diagnóstico e qualificação</h3><dl><div><dt>Processo atual</dt><dd>{metadataValue(selectedLead, "current_process") || "Ainda não informado"}</dd></div><div><dt>Principal gargalo</dt><dd>{metadataValue(selectedLead, "main_pain") || "Ainda não informado"}</dd></div><div><dt>Necessidade</dt><dd>{metadataValue(selectedLead, "target_process") || "Ainda não informado"}</dd></div><div><dt>Urgência</dt><dd>{metadataValue(selectedLead, "urgency") || "Ainda não informada"}</dd></div></dl>{metadataValue(selectedLead, "summary") && <p className="summary">{metadataValue(selectedLead, "summary")}</p>}{selectedLead.notes && <p className="notes">{selectedLead.notes}</p>}</section><section className="lead-controls"><h3>Conduzir oportunidade</h3><form onSubmit={saveLeadProgress} className="progress-form"><label>Etapa<select value={selectedLead.stage_id} onChange={(event) => { const stage = stages.find((item) => item.id === event.target.value); setSelectedLead({ ...selectedLead, stage_id: event.target.value, pipeline_stages: stage ? { name: stage.name, color: stage.color } : selectedLead.pipeline_stages }); }}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label>Próxima ação<input value={selectedLead.next_action_title || ""} onChange={(event) => setSelectedLead({ ...selectedLead, next_action_title: event.target.value })} placeholder="Ex.: ligar para entender a operação" /></label><label>Quando<input type="datetime-local" value={selectedLead.next_action_at ? selectedLead.next_action_at.slice(0, 16) : ""} onChange={(event) => setSelectedLead({ ...selectedLead, next_action_at: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label><button type="submit" disabled={isSavingLead}>{isSavingLead ? "Salvando…" : "Salvar andamento"}</button></form>{leadActionMessage && <p className="form-feedback">{leadActionMessage}</p>}</section><section className="timeline"><h3>Histórico comercial</h3>{isLoadingActivities ? <p className="muted">Carregando atividades…</p> : activities.length ? activities.map((activity) => <article key={activity.id}><span>{activityLabel[activity.activity_type]}</span><div><strong>{activity.title}</strong>{activity.description && <p>{activity.description}</p>}<small>{formatDate(activity.occurred_at)}</small></div></article>) : <p className="muted">Ainda não há atividades registradas para este lead.</p>}<form className="note-form" onSubmit={addActivity}><label>Registrar nota<input value={activityNote} onChange={(event) => setActivityNote(event.target.value)} placeholder="Ex.: chamou no WhatsApp e pediu retorno amanhã" /></label><button type="submit" disabled={isSavingLead || !activityNote.trim()}>Adicionar</button></form></section></div></section></div>}{isNewLeadOpen && <div className="modal-backdrop"><section className="modal"><div className="panel-title"><div><p className="eyebrow">CADASTRO MANUAL</p><h2>Novo lead</h2></div><button className="text-button" onClick={() => setIsNewLeadOpen(false)}>Fechar</button></div><form onSubmit={createLead} className="lead-form"><label>Nome<input value={newLead.name} onChange={(event) => setNewLead({ ...newLead, name: event.target.value })} required /></label><label>Empresa<input value={newLead.company} onChange={(event) => setNewLead({ ...newLead, company: event.target.value })} /></label><label>WhatsApp<input inputMode="tel" value={newLead.whatsapp} onChange={(event) => setNewLead({ ...newLead, whatsapp: event.target.value })} placeholder="(61) 99999-9999" /></label><label>Etapa<select value={newLead.stageId} onChange={(event) => setNewLead({ ...newLead, stageId: event.target.value })} required>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="full">Próxima ação<input value={newLead.nextAction} onChange={(event) => setNewLead({ ...newLead, nextAction: event.target.value })} placeholder="Ex.: Revisar diagnóstico e entrar em contato" /></label><div className="form-actions"><button className="secondary" type="button" onClick={() => setIsNewLeadOpen(false)}>Cancelar</button><button type="submit">Salvar lead</button></div></form></section></div>}</main>;
}