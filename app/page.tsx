"use client";

import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Lead, LeadActivity, Stage } from "@/lib/types";
import WhatsAppInbox from "@/app/whatsapp-inbox";

type SessionState = "loading" | "signed_out" | "ready" | "no_access";
type View = "overview" | "leads" | "kanban" | "tasks" | "activities" | "whatsapp";
type ActivityFeedItem = LeadActivity & { lead_id: string; leads: Pick<Lead, "name" | "company_name"> | null };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

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
  const [newLeadConversationId, setNewLeadConversationId] = useState<string | null>(null);
  const [newLead, setNewLead] = useState({ name: "", company: "", whatsapp: "", stageId: "", nextAction: "" });
  const [leadActionMessage, setLeadActionMessage] = useState("");
  const [isSavingLead, setIsSavingLead] = useState(false);
  const [activityNote, setActivityNote] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [initialWhatsAppConversationId, setInitialWhatsAppConversationId] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [pwaEnvironment, setPwaEnvironment] = useState<"android" | "ios" | "embedded" | "desktop">("desktop");
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);

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

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }

    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
      navigatorWithStandalone.standalone === true,
    );

    const ua = navigator.userAgent || "";
    const isEmbedded =
      /; wv\)/i.test(ua) ||
      /Instagram|FBAN|FBAV|Line\/|Twitter/i.test(ua);
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);

    setPwaEnvironment(
      isEmbedded ? "embedded" : isIos ? "ios" : isAndroid ? "android" : "desktop",
    );

    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "whatsapp") setView("whatsapp");
    const conversationId = params.get("conversation");
    if (conversationId) setInitialWhatsAppConversationId(conversationId);

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; conversationId?: string } | null;
      if (!data?.type) return;
      if (data.type === "OPEN_WHATSAPP" || data.type === "OPEN_WHATSAPP_CONVERSATION") {
        setView("whatsapp");
        setMobileMenuOpen(false);
      }
      if (data.type === "OPEN_WHATSAPP_CONVERSATION" && data.conversationId) {
        setInitialWhatsAppConversationId(data.conversationId);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
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

  const kanbanColumns = useMemo(
    () => stages.map((stage) => ({
      stage,
      leads: filteredLeads.filter((lead) => lead.stage_id === stage.id),
    })),
    [stages, filteredLeads],
  );

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
    const { data: createdLead, error } = await supabase.from("leads").insert({
      organization_id: organizationId,
      created_by: userData.user.id,
      stage_id: newLead.stageId,
      name: newLead.name.trim(),
      company_name: newLead.company.trim() || null,
      whatsapp: newLead.whatsapp.replace(/\D/g, "") || null,
      source: newLeadConversationId ? "WhatsApp Inbox" : "CRM manual",
      next_action_title: newLead.nextAction.trim() || null,
      next_action_at: newLead.nextAction ? new Date().toISOString() : null,
    }).select("id").single();
    if (error || !createdLead) {
      setMessage("Não foi possível salvar o lead. Tente novamente.");
      return;
    }

    if (newLeadConversationId) {
      await supabase
        .from("whatsapp_conversations")
        .update({ lead_id: createdLead.id, updated_at: new Date().toISOString() })
        .eq("id", newLeadConversationId)
        .eq("organization_id", organizationId);

      await supabase.from("lead_activities").insert({
        organization_id: organizationId,
        lead_id: createdLead.id,
        activity_type: "whatsapp",
        title: "Lead criado pelo WhatsApp Inbox",
        description: "Conversa vinculada ao lead no Wuniflow CRM.",
        occurred_at: new Date().toISOString(),
        created_by: userData.user.id,
      });
    }

    setIsNewLeadOpen(false);
    setNewLeadConversationId(null);
    setNewLead({ name: "", company: "", whatsapp: "", stageId: stages.find((stage) => stage.stage_type === "open")?.id || "", nextAction: "" });
    setLeadActionMessage(newLeadConversationId ? "Lead criado e vinculado à conversa." : "Lead cadastrado com sucesso.");
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

  const moveLeadStage = async (leadId: string, targetStageId: string) => {
    if (!supabase || !organizationId || movingLeadId) return;

    const lead = leads.find((item) => item.id === leadId);
    const targetStage = stages.find((stage) => stage.id === targetStageId);
    if (!lead || !targetStage || lead.stage_id === targetStageId) {
      setDraggedLeadId(null);
      return;
    }

    const previousStage = stages.find((stage) => stage.id === lead.stage_id);
    const nextStatus: Lead["status"] =
      targetStage.stage_type === "won" ? "won" :
      targetStage.stage_type === "lost" ? "lost" : "open";
    const movedAt = new Date().toISOString();

    setMovingLeadId(leadId);
    setLeadActionMessage("");
    setLeads((current) =>
      current.map((item) =>
        item.id === leadId
          ? {
              ...item,
              stage_id: targetStage.id,
              status: nextStatus,
              updated_at: movedAt,
              pipeline_stages: { name: targetStage.name, color: targetStage.color },
            }
          : item,
      ),
    );
    setSelectedLead((current) =>
      current?.id === leadId
        ? {
            ...current,
            stage_id: targetStage.id,
            status: nextStatus,
            updated_at: movedAt,
            pipeline_stages: { name: targetStage.name, color: targetStage.color },
          }
        : current,
    );

    const { error } = await supabase
      .from("leads")
      .update({
        stage_id: targetStage.id,
        status: nextStatus,
        updated_at: movedAt,
      })
      .eq("id", leadId)
      .eq("organization_id", organizationId);

    if (error) {
      setLeadActionMessage("Não foi possível mover o lead. A posição anterior foi restaurada.");
      await loadCrm();
      setMovingLeadId(null);
      setDraggedLeadId(null);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      await supabase.from("lead_activities").insert({
        organization_id: organizationId,
        lead_id: leadId,
        activity_type: "status_change",
        title: "Etapa do funil alterada",
        description: (previousStage?.name || "Sem etapa") + " → " + targetStage.name,
        occurred_at: movedAt,
        created_by: userData.user.id,
      });
    }

    setLeadActionMessage("Lead movido para " + targetStage.name + ".");
    setMovingLeadId(null);
    setDraggedLeadId(null);
    await loadCrm();
  };

  const handleKanbanDragStart = (event: DragEvent<HTMLElement>, leadId: string) => {
    setDraggedLeadId(leadId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", leadId);
  };

  const handleKanbanDrop = (event: DragEvent<HTMLElement>, stageId: string) => {
    event.preventDefault();
    const leadId = event.dataTransfer.getData("text/plain") || draggedLeadId;
    if (leadId) void moveLeadStage(leadId, stageId);
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

  const installPwa = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstallPrompt(null);
        return;
      }
    }

    setInstallHelpOpen(true);
  };

  const signOut = async () => {
    if (supabase && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager?.getSubscription();
        if (subscription) {
          await supabase.from("web_push_subscriptions").delete().eq("endpoint", subscription.endpoint);
          await subscription.unsubscribe();
        }
      } catch {
        // Logout must continue even if push cleanup is unavailable.
      }
    }

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

  return <main className={"shell "+(view==="whatsapp"?"whatsapp-mode":"")}><aside className={mobileMenuOpen ? "open" : ""}><div className="brand"><span className="mark">W</span><div><strong>WUNIFLOW</strong><small>AUTOMATIONS</small></div></div><nav><button className={view === "overview" ? "active" : ""} onClick={() => { setView("overview"); setMobileMenuOpen(false); }}>Visão geral</button><button className={view === "leads" ? "active" : ""} onClick={() => { setView("leads"); setMobileMenuOpen(false); }}>Leads</button><button className={view === "kanban" ? "active" : ""} onClick={() => { setView("kanban"); setMobileMenuOpen(false); }}>Funil</button><button className={view === "tasks" ? "active" : ""} onClick={() => { setView("tasks"); setMobileMenuOpen(false); }}>Tarefas</button><button className={view === "activities" ? "active" : ""} onClick={() => { setView("activities"); setMobileMenuOpen(false); }}>Atividades</button><button className={view === "whatsapp" ? "active" : ""} onClick={() => { setView("whatsapp"); setMobileMenuOpen(false); }}>WhatsApp</button></nav><div className="side-footer"><span>{role}</span>{!isStandalone && <button className="text-button install-pwa" onClick={() => void installPwa()}>Instalar CRM</button>}<button className="text-button" onClick={signOut}>Sair</button></div></aside>{mobileMenuOpen && <button className="mobile-menu-backdrop" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} />}<section className={"content "+(view === "whatsapp" ? "whatsapp-page" : "")}><header className={view === "whatsapp" ? "whatsapp-outer-header" : ""}><button className="mobile-menu-button" aria-label="Abrir menu" onClick={() => setMobileMenuOpen(true)}><span /><span /><span /></button><div><p className="eyebrow">OPERAÇÃO COMERCIAL</p><h1>{view === "overview" ? "Visão geral" : view === "leads" ? "Leads" : view === "kanban" ? "Funil comercial" : view === "tasks" ? "Próximas ações" : view === "activities" ? "Atividades" : "WhatsApp"}</h1><p className="muted">{view === "overview" ? "Acompanhe leads, prioridades e próximos passos." : view === "leads" ? "Diagnósticos e conversas qualificadas em um só lugar." : view === "kanban" ? "Movimente oportunidades pelas etapas do processo comercial." : view === "tasks" ? "Organize os retornos comerciais que precisam de atenção." : view === "activities" ? "Histórico recente da operação comercial." : "Conversas recebidas pelo WhatsApp da Wuniflow."}</p></div><button onClick={() => { setNewLeadConversationId(null); setIsNewLeadOpen(true); }}>+ Novo lead</button></header>{view === "overview" ? <><section className="stats"><article><span>Leads abertos</span><strong>{stats.open}</strong></article><article><span>Próximas ações</span><strong>{stats.next}</strong></article><article><span>Prioridade alta</span><strong>{stats.urgent}</strong></article><article><span>Ganhos</span><strong>{stats.won}</strong></article></section><section className="panel"><div className="panel-title"><div><h2>Leads recentes</h2><p>Diagnósticos recebidos e atendimentos em andamento.</p></div><span>{leads.length} registros</span></div>{leads.length === 0 ? <div className="empty"><h3>Ainda não há leads no CRM</h3><p>O próximo diagnóstico confirmado pela landing aparecerá aqui automaticamente.</p></div> : <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Etapa</th><th>Prioridade</th><th>Próxima ação</th><th></th></tr></thead><tbody>{leadRows}</tbody></table></div>}</section></> : view === "leads" ? <section className="panel"><div className="panel-title lead-list-heading"><div><h2>Todos os leads</h2><p>Use a busca para localizar empresa, contato, etapa ou telefone.</p></div><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead…" /></div>{filteredLeads.length === 0 ? <div className="empty"><h3>Nenhum lead encontrado</h3><p>{leads.length ? "Tente outro termo de busca." : "Os novos diagnósticos serão listados aqui."}</p></div> : <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Etapa</th><th>Prioridade</th><th>Última atualização</th><th></th></tr></thead><tbody>{leadRows}</tbody></table></div>}</section> : view === "kanban" ? <section className="kanban-section"><div className="kanban-toolbar"><div><h2>Pipeline comercial</h2><p>Arraste os cards entre as etapas. No celular, use o seletor do card.</p></div><div className="kanban-toolbar-actions"><span>{filteredLeads.length} oportunidades</span><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no funil…" /></div></div>{leadActionMessage && <p className="kanban-feedback">{leadActionMessage}</p>}<div className="kanban-board">{kanbanColumns.map(({ stage, leads: stageLeads }) => <section key={stage.id} className={"kanban-column "+(stage.stage_type !== "open" ? "terminal" : "")} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => handleKanbanDrop(event, stage.id)}><header><div><i style={{ background: stage.color || "#94a3b8" }} /><strong>{stage.name}</strong></div><b>{stageLeads.length}</b></header><div className="kanban-cards">{stageLeads.length ? stageLeads.map((lead) => <article key={lead.id} className={"kanban-card "+(draggedLeadId === lead.id ? "dragging" : "")+(movingLeadId === lead.id ? " moving" : "")} draggable={movingLeadId !== lead.id} onDragStart={(event) => handleKanbanDragStart(event, lead.id)} onDragEnd={() => setDraggedLeadId(null)}><button type="button" className="kanban-card-main" onClick={() => void openLead(lead)}><span className="kanban-card-top"><strong>{lead.name}</strong><em className={"priority "+lead.priority}>{lead.priority}</em></span><small>{lead.company_name || lead.source || "Sem empresa informada"}</small><span className="kanban-next"><b>{lead.next_action_title || "Definir próxima ação"}</b><small>{formatDate(lead.next_action_at || lead.last_contact_at)}</small></span></button><div className="kanban-card-foot"><span>{lead.whatsapp || "Sem WhatsApp"}</span><label><span>Mover</span><select value={lead.stage_id} disabled={movingLeadId === lead.id} onChange={(event) => void moveLeadStage(lead.id, event.target.value)}>{stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label></div></article>) : <div className="kanban-empty">Solte um lead aqui</div>}</div></section>)}</div></section> : view === "tasks" ? <section className="panel"><div className="panel-title"><div><h2>Próximas ações</h2><p>Leads com retorno ou acompanhamento agendado.</p></div><span>{taskLeads.length} pendências</span></div>{taskLeads.length === 0 ? <div className="empty"><h3>Nenhuma ação pendente</h3><p>Defina a próxima ação dentro de um lead para ela aparecer aqui.</p></div> : <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Etapa</th><th>Próxima ação</th><th>Quando</th><th></th></tr></thead><tbody>{taskLeads.map((lead) => <tr key={lead.id}><td><strong>{lead.name}</strong><small>{lead.company_name || "Empresa não informada"}</small></td><td><span className="stage"><i style={{ background: lead.pipeline_stages?.color || "#94a3b8" }} />{lead.pipeline_stages?.name || "Sem etapa"}</span></td><td><strong>{lead.next_action_title || "Revisar contexto e definir próximo passo"}</strong></td><td>{formatDate(lead.next_action_at)}</td><td className="actions"><button className="view-button" onClick={() => void openLead(lead)}>Abrir lead</button></td></tr>)}</tbody></table></div>}</section> : view === "activities" ? <section className="panel"><div className="panel-title"><div><h2>Atividades recentes</h2><p>Notas, handoffs e interações registradas no CRM.</p></div><span>{recentActivities.length} registros</span></div>{recentActivities.length === 0 ? <div className="empty"><h3>Ainda não há atividades</h3><p>As próximas notas e movimentações aparecerão aqui.</p></div> : <div className="activity-feed">{recentActivities.map((activity) => <article key={activity.id}><span>{activityLabel[activity.activity_type]}</span><div><strong>{activity.title}</strong><p>{activity.leads?.name || "Lead não localizado"}{activity.leads?.company_name ? " · " + activity.leads.company_name : ""}</p>{activity.description && <p>{activity.description}</p>}<small>{formatDate(activity.occurred_at)}</small></div><button className="view-button" onClick={() => { const lead = leads.find((item) => item.id === activity.lead_id); if (lead) void openLead(lead); }}>Abrir lead</button></article>)}</div>}</section> : organizationId ? <WhatsAppInbox
  organizationId={organizationId}
  initialConversationId={initialWhatsAppConversationId}
  onConversationDeepLinkHandled={()=>setInitialWhatsAppConversationId(null)}
  pwaInstalled={isStandalone}
  onInstallPwa={()=>void installPwa()}
  onOpenMenu={()=>setMobileMenuOpen(true)}
  onOpenLead={(leadId)=>{const lead=leads.find((item)=>item.id===leadId);if(lead)void openLead(lead)}}
  onCreateLead={({name,phone,conversationId})=>{
    setNewLeadConversationId(conversationId);
    setNewLead({
      name,
      company:"",
      whatsapp:phone,
      stageId:stages.find((stage)=>stage.stage_type==="open")?.id || stages[0]?.id || "",
      nextAction:"Responder e qualificar pelo WhatsApp",
    });
    setIsNewLeadOpen(true);
  }}
/> : null}</section>{installHelpOpen && <div className="modal-backdrop" onMouseDown={() => setInstallHelpOpen(false)}><section className="modal pwa-install-modal" onMouseDown={(event) => event.stopPropagation()}><div className="panel-title"><div><p className="eyebrow">WUNIFLOW CRM</p><h2>Instalar no dispositivo</h2><p>Use o CRM como aplicativo e habilite notificações mesmo com ele fechado.</p></div><button className="text-button" onClick={() => setInstallHelpOpen(false)}>Fechar</button></div><div className="pwa-install-body">{pwaEnvironment === "embedded" ? <><strong>Abra este endereço no Google Chrome.</strong><p>O navegador interno do aplicativo não oferece instalação PWA nem Web Push completo. Use o menu do navegador atual e escolha <b>Abrir no Chrome</b>. Depois acesse novamente <b>crm.wuniflow.site</b>.</p></> : pwaEnvironment === "android" ? <><strong>No Android</strong><p>No Chrome, toque no menu <b>⋮</b> e escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>. Depois abra o ícone Wuniflow CRM criado na tela inicial.</p></> : pwaEnvironment === "ios" ? <><strong>No iPhone/iPad</strong><p>Abra no Safari, toque em <b>Compartilhar</b> e escolha <b>Adicionar à Tela de Início</b>. O Web Push no iOS funciona pelo app adicionado à Tela de Início.</p></> : <><strong>No computador</strong><p>No Chrome ou Edge, use o ícone de instalação na barra de endereço ou o menu do navegador e escolha <b>Instalar Wuniflow CRM</b>.</p></>}<code>https://crm.wuniflow.site</code></div></section></div>}{selectedLead && <div className="modal-backdrop" onMouseDown={() => setSelectedLead(null)}><section className="modal lead-detail" onMouseDown={(event) => event.stopPropagation()}><div className="panel-title"><div><p className="eyebrow">CONTEXTO DO LEAD</p><h2>{selectedLead.name}</h2><p>{selectedLead.company_name || "Empresa não informada"} · {selectedLead.pipeline_stages?.name || "Sem etapa"}</p></div><button className="text-button" onClick={() => setSelectedLead(null)}>Fechar</button></div><div className="detail-body"><div className="detail-actions">{selectedLead.whatsapp && <a className="button-link" href={toWhatsApp(selectedLead.whatsapp)} target="_blank" rel="noreferrer">Assumir no WhatsApp ↗</a>}<span className={`priority ${selectedLead.priority}`}>Prioridade {selectedLead.priority}</span></div><section className="context-grid"><div><span>WhatsApp</span><strong>{selectedLead.whatsapp || "Não informado"}</strong></div><div><span>Último contato</span><strong>{formatDate(selectedLead.last_contact_at)}</strong></div><div><span>Cargo</span><strong>{metadataValue(selectedLead, "role") || "Não informado"}</strong></div><div><span>Equipe</span><strong>{metadataValue(selectedLead, "team_size") || "Não informada"}</strong></div></section><section className="context-summary"><h3>Diagnóstico e qualificação</h3><dl><div><dt>Processo atual</dt><dd>{metadataValue(selectedLead, "current_process") || "Ainda não informado"}</dd></div><div><dt>Principal gargalo</dt><dd>{metadataValue(selectedLead, "main_pain") || "Ainda não informado"}</dd></div><div><dt>Necessidade</dt><dd>{metadataValue(selectedLead, "target_process") || "Ainda não informado"}</dd></div><div><dt>Urgência</dt><dd>{metadataValue(selectedLead, "urgency") || "Ainda não informada"}</dd></div></dl>{metadataValue(selectedLead, "summary") && <p className="summary">{metadataValue(selectedLead, "summary")}</p>}{selectedLead.notes && <p className="notes">{selectedLead.notes}</p>}</section><section className="lead-controls"><h3>Conduzir oportunidade</h3><form onSubmit={saveLeadProgress} className="progress-form"><label>Etapa<select value={selectedLead.stage_id} onChange={(event) => { const stage = stages.find((item) => item.id === event.target.value); setSelectedLead({ ...selectedLead, stage_id: event.target.value, pipeline_stages: stage ? { name: stage.name, color: stage.color } : selectedLead.pipeline_stages }); }}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label>Próxima ação<input value={selectedLead.next_action_title || ""} onChange={(event) => setSelectedLead({ ...selectedLead, next_action_title: event.target.value })} placeholder="Ex.: ligar para entender a operação" /></label><label>Quando<input type="datetime-local" value={selectedLead.next_action_at ? selectedLead.next_action_at.slice(0, 16) : ""} onChange={(event) => setSelectedLead({ ...selectedLead, next_action_at: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label><button type="submit" disabled={isSavingLead}>{isSavingLead ? "Salvando…" : "Salvar andamento"}</button></form>{leadActionMessage && <p className="form-feedback">{leadActionMessage}</p>}</section><section className="timeline"><h3>Histórico comercial</h3>{isLoadingActivities ? <p className="muted">Carregando atividades…</p> : activities.length ? activities.map((activity) => <article key={activity.id}><span>{activityLabel[activity.activity_type]}</span><div><strong>{activity.title}</strong>{activity.description && <p>{activity.description}</p>}<small>{formatDate(activity.occurred_at)}</small></div></article>) : <p className="muted">Ainda não há atividades registradas para este lead.</p>}<form className="note-form" onSubmit={addActivity}><label>Registrar nota<input value={activityNote} onChange={(event) => setActivityNote(event.target.value)} placeholder="Ex.: chamou no WhatsApp e pediu retorno amanhã" /></label><button type="submit" disabled={isSavingLead || !activityNote.trim()}>Adicionar</button></form></section></div></section></div>}{isNewLeadOpen && <div className="modal-backdrop"><section className="modal"><div className="panel-title"><div><p className="eyebrow">CADASTRO MANUAL</p><h2>Novo lead</h2></div><button className="text-button" onClick={() => { setIsNewLeadOpen(false); setNewLeadConversationId(null); }}>Fechar</button></div><form onSubmit={createLead} className="lead-form"><label>Nome<input value={newLead.name} onChange={(event) => setNewLead({ ...newLead, name: event.target.value })} required /></label><label>Empresa<input value={newLead.company} onChange={(event) => setNewLead({ ...newLead, company: event.target.value })} /></label><label>WhatsApp<input inputMode="tel" value={newLead.whatsapp} onChange={(event) => setNewLead({ ...newLead, whatsapp: event.target.value })} placeholder="(61) 99999-9999" /></label><label>Etapa<select value={newLead.stageId} onChange={(event) => setNewLead({ ...newLead, stageId: event.target.value })} required>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="full">Próxima ação<input value={newLead.nextAction} onChange={(event) => setNewLead({ ...newLead, nextAction: event.target.value })} placeholder="Ex.: Revisar diagnóstico e entrar em contato" /></label><div className="form-actions"><button className="secondary" type="button" onClick={() => { setIsNewLeadOpen(false); setNewLeadConversationId(null); }}>Cancelar</button><button type="submit">Salvar lead</button></div></form></section></div>}</main>;
}