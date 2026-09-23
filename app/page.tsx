"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Lead, Stage } from "@/lib/types";

type SessionState = "loading" | "signed_out" | "ready" | "no_access";

const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

const toWhatsApp = (value: string | null) => {
  const number = (value || "").replace(/\D/g, "");
  return number ? `https://wa.me/${number.startsWith("55") ? number : `55${number}`}` : "#";
};

export default function Home() {
  const [state, setState] = useState<SessionState>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false);
  const [newLead, setNewLead] = useState({ name: "", company: "", whatsapp: "", stageId: "", nextAction: "" });

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

    const [{ data: stageData }, { data: leadData }] = await Promise.all([
      supabase.from("pipeline_stages").select("id,name,position,color,stage_type").eq("organization_id", membership.organization_id).eq("is_active", true).order("position"),
      supabase.from("leads").select("id,name,company_name,whatsapp,source,priority,status,next_action_at,next_action_title,last_contact_at,stage_id,pipeline_stages(name,color)").eq("organization_id", membership.organization_id).neq("status", "archived").order("updated_at", { ascending: false }).limit(100),
    ]);

    const safeStages = (stageData || []) as Stage[];
    setStages(safeStages);
    setLeads((leadData || []) as unknown as Lead[]);
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
    const { error } = await supabase.from("leads").insert({
      organization_id: organizationId,
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
    await loadCrm();
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setLeads([]);
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

  return <main className="shell"><aside><div className="brand"><span className="mark">W</span><div><strong>WUNIFLOW</strong><small>AUTOMATIONS</small></div></div><nav><a className="active">Visão geral</a><a>Leads</a><a>Atividades</a><a>Tarefas</a></nav><div className="side-footer"><span>{role}</span><button className="text-button" onClick={signOut}>Sair</button></div></aside><section className="content"><header><div><p className="eyebrow">OPERAÇÃO COMERCIAL</p><h1>Visão geral</h1><p className="muted">Acompanhe leads, prioridades e próximos passos.</p></div><button onClick={() => setIsNewLeadOpen(true)}>+ Novo lead</button></header><section className="stats"><article><span>Leads abertos</span><strong>{stats.open}</strong></article><article><span>Próximas ações</span><strong>{stats.next}</strong></article><article><span>Prioridade alta</span><strong>{stats.urgent}</strong></article><article><span>Ganhos</span><strong>{stats.won}</strong></article></section><section className="panel"><div className="panel-title"><div><h2>Leads recentes</h2><p>Os diagnósticos e atendimentos aparecerão aqui.</p></div><span>{leads.length} registros</span></div>{leads.length === 0 ? <div className="empty"><h3>Ainda não há leads no CRM</h3><p>Os próximos diagnósticos enviados pela landing serão integrados ao n8n e aparecerão aqui.</p></div> : <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Etapa</th><th>Prioridade</th><th>Próxima ação</th><th></th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><strong>{lead.name}</strong><small>{lead.company_name || "Empresa não informada"} · {lead.source || "Origem não informada"}</small></td><td><span className="stage"><i style={{ background: lead.pipeline_stages?.color || "#94a3b8" }} />{lead.pipeline_stages?.name || "Sem etapa"}</span></td><td><span className={`priority ${lead.priority}`}>{lead.priority}</span></td><td><strong>{lead.next_action_title || "Sem ação definida"}</strong><small>{formatDate(lead.next_action_at)}</small></td><td>{lead.whatsapp && <a className="whatsapp" href={toWhatsApp(lead.whatsapp)} target="_blank" rel="noreferrer">WhatsApp ↗</a>}</td></tr>)}</tbody></table></div>}</section></section>{isNewLeadOpen && <div className="modal-backdrop"><section className="modal"><div className="panel-title"><div><p className="eyebrow">CADASTRO MANUAL</p><h2>Novo lead</h2></div><button className="text-button" onClick={() => setIsNewLeadOpen(false)}>Fechar</button></div><form onSubmit={createLead} className="lead-form"><label>Nome<input value={newLead.name} onChange={(event) => setNewLead({ ...newLead, name: event.target.value })} required /></label><label>Empresa<input value={newLead.company} onChange={(event) => setNewLead({ ...newLead, company: event.target.value })} /></label><label>WhatsApp<input inputMode="tel" value={newLead.whatsapp} onChange={(event) => setNewLead({ ...newLead, whatsapp: event.target.value })} placeholder="(61) 99999-9999" /></label><label>Etapa<select value={newLead.stageId} onChange={(event) => setNewLead({ ...newLead, stageId: event.target.value })} required>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label className="full">Próxima ação<input value={newLead.nextAction} onChange={(event) => setNewLead({ ...newLead, nextAction: event.target.value })} placeholder="Ex.: Revisar diagnóstico e entrar em contato" /></label><div className="form-actions"><button className="secondary" type="button" onClick={() => setIsNewLeadOpen(false)}>Cancelar</button><button type="submit">Salvar lead</button></div></form></section></div>}</main>;
}
