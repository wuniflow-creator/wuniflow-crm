"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Conversation = { id:string; contact_name:string|null; contact_phone:string; last_message_at:string|null; last_message_preview:string|null; unread_count:number; status:string };
type Message = { id:string; conversation_id:string; direction:"inbound"|"outbound"; message_type:string; body:string|null; status:string; created_at:string };

const fmt=(v:string|null)=>v?new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",minute:"2-digit"}).format(new Date(v)):"";

export default function WhatsAppInbox({organizationId}:{organizationId:string}) {
 const [conversations,setConversations]=useState<Conversation[]>([]);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [messages,setMessages]=useState<Message[]>([]);
 const [search,setSearch]=useState("");
 const [draft,setDraft]=useState("");
 const [sending,setSending]=useState(false);
 const [sendError,setSendError]=useState<string|null>(null);

 const loadConversations=useCallback(async()=>{
  if(!supabase)return;
  const {data}=await supabase.from("whatsapp_conversations").select("id,contact_name,contact_phone,last_message_at,last_message_preview,unread_count,status").eq("organization_id",organizationId).neq("status","archived").order("last_message_at",{ascending:false,nullsFirst:false});
  const rows=(data||[]) as Conversation[]; setConversations(rows); setSelectedId(v=>v||rows[0]?.id||null);
 },[organizationId]);

 const loadMessages=useCallback(async(id:string)=>{
  if(!supabase)return;
  const {data}=await supabase.from("whatsapp_messages").select("id,conversation_id,direction,message_type,body,status,created_at").eq("organization_id",organizationId).eq("conversation_id",id).order("created_at",{ascending:true}).limit(300);
  setMessages((data||[]) as Message[]);
 },[organizationId]);

 useEffect(()=>{void loadConversations()},[loadConversations]);
 useEffect(()=>{if(selectedId){void loadMessages(selectedId);if(supabase){void supabase.rpc("mark_whatsapp_conversation_read",{p_conversation_id:selectedId}).then(()=>loadConversations())}}else setMessages([])},[selectedId,loadMessages,loadConversations]);
 useEffect(()=>{
  if(!supabase)return;
  const ch=supabase.channel("wa-inbox-"+organizationId)
   .on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_conversations",filter:"organization_id=eq."+organizationId},()=>void loadConversations())
   .on("postgres_changes",{event:"INSERT",schema:"public",table:"whatsapp_messages",filter:"organization_id=eq."+organizationId},(payload)=>{const row=payload.new as Message;void loadConversations();if(row.conversation_id===selectedId&&selectedId)void loadMessages(selectedId)})
   .subscribe();
  return()=>{void supabase?.removeChannel(ch)};
 },[organizationId,selectedId,loadConversations,loadMessages]);

 const sendMessage=async()=>{if(!supabase||!selectedId||!draft.trim()||sending)return;setSending(true);setSendError(null);const text=draft.trim();const {error}=await supabase.functions.invoke("whatsapp-send-message",{body:{conversation_id:selectedId,text}});if(error){setSendError("Não foi possível enviar. A integração de saída ainda precisa da credencial segura da Evolution.");setSending(false);return}setDraft("");await loadMessages(selectedId);await loadConversations();setSending(false)};

 const selected=conversations.find(x=>x.id===selectedId)||null;
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return q?conversations.filter(x=>((x.contact_name||"")+" "+x.contact_phone+" "+(x.last_message_preview||"")).toLowerCase().includes(q)):conversations},[conversations,search]);

 return <section className="wa-shell">
  <div className="wa-list">
   <div className="wa-list-head"><h2>Conversas</h2><small>{conversations.reduce((n,x)=>n+x.unread_count,0)} não lidas</small></div>
   <div className="wa-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar conversa…" /></div>
   <div className="wa-conversations">{filtered.length?filtered.map(x=><button key={x.id} className={"wa-conversation "+(x.id===selectedId?"active":"")} onClick={()=>setSelectedId(x.id)}><span className="wa-avatar">{(x.contact_name||x.contact_phone).slice(0,1).toUpperCase()}</span><span className="wa-copy"><strong>{x.contact_name||x.contact_phone}</strong><small>{x.last_message_preview||"Sem mensagem"}</small></span><span className="wa-meta"><small>{fmt(x.last_message_at)}</small>{x.unread_count>0&&<b>{x.unread_count}</b>}</span></button>):<p className="wa-empty">Nenhuma conversa recebida.</p>}</div>
  </div>
  <div className="wa-chat">{selected?<><div className="wa-chat-head"><span className="wa-avatar">{(selected.contact_name||selected.contact_phone).slice(0,1).toUpperCase()}</span><div><strong>{selected.contact_name||selected.contact_phone}</strong><small>{selected.contact_phone}</small></div></div><div className="wa-messages">{messages.map(m=><article key={m.id} className={"wa-bubble "+m.direction}><p>{m.body||"["+m.message_type+"]"}</p><small>{fmt(m.created_at)} · {m.status}</small></article>)}</div><div className="wa-compose-wrap"><div className="wa-compose"><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void sendMessage()}}} disabled={sending} placeholder="Digite uma mensagem…" /><button onClick={()=>void sendMessage()} disabled={sending||!draft.trim()}>{sending?"Enviando…":"Enviar"}</button></div>{sendError&&<p className="wa-send-error">{sendError}</p>}</div></>:<div className="wa-chat-empty"><strong>WhatsApp Wuniflow</strong><p>Selecione uma conversa.</p></div>}</div>
 </section>;
}
