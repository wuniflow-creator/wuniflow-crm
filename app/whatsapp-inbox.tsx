"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Conversation = { id:string; contact_name:string|null; contact_phone:string; last_message_at:string|null; last_message_preview:string|null; unread_count:number; status:string };
type Message = { id:string; conversation_id:string; direction:"inbound"|"outbound"; message_type:string; body:string|null; media_url:string|null; media_mime_type:string|null; media_filename:string|null; status:string; created_at:string; delivered_at:string|null; read_at:string|null };

const fmt=(v:string|null)=>v?new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",minute:"2-digit"}).format(new Date(v)):"";
const messageState=(m:Message)=>{
 if(m.direction==="inbound") return "";
 if(m.status==="read"||m.read_at) return "✓✓ Lida";
 if(m.status==="delivered"||m.delivered_at) return "✓✓ Entregue";
 if(m.status==="failed") return "Falha";
 return "✓ Enviada";
};

export default function WhatsAppInbox({organizationId}:{organizationId:string}) {
 const [conversations,setConversations]=useState<Conversation[]>([]);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [messages,setMessages]=useState<Message[]>([]);
 const [search,setSearch]=useState("");
 const [draft,setDraft]=useState("");
 const [sending,setSending]=useState(false);
 const [sendError,setSendError]=useState<string|null>(null);
 const [mediaUrls,setMediaUrls]=useState<Record<string,string>>({});
 const [attachment,setAttachment]=useState<File|null>(null);
 const [recording,setRecording]=useState(false);
 const [recordSeconds,setRecordSeconds]=useState(0);
 const [recordingError,setRecordingError]=useState<string|null>(null);
 const fileInputRef=useRef<HTMLInputElement|null>(null);
 const messagesEndRef=useRef<HTMLDivElement|null>(null);
 const mediaRecorderRef=useRef<MediaRecorder|null>(null);
 const mediaStreamRef=useRef<MediaStream|null>(null);
 const recordingChunksRef=useRef<Blob[]>([]);
 const recordingTimerRef=useRef<ReturnType<typeof setInterval>|null>(null);

 const loadConversations=useCallback(async()=>{
  if(!supabase)return;
  const {data}=await supabase.from("whatsapp_conversations").select("id,contact_name,contact_phone,last_message_at,last_message_preview,unread_count,status").eq("organization_id",organizationId).neq("status","archived").order("last_message_at",{ascending:false,nullsFirst:false});
  const rows=(data||[]) as Conversation[]; setConversations(rows); setSelectedId(v=>v||rows[0]?.id||null);
 },[organizationId]);

 const loadMessages=useCallback(async(id:string)=>{
  if(!supabase)return;
  const {data}=await supabase.from("whatsapp_messages").select("id,conversation_id,direction,message_type,body,media_url,media_mime_type,media_filename,status,created_at,delivered_at,read_at").eq("organization_id",organizationId).eq("conversation_id",id).order("created_at",{ascending:true}).limit(300);
  const rows=(data||[]) as Message[]; setMessages(rows);
  const paths=rows.filter(m=>m.media_url).map(m=>m.media_url!) ;
  if(paths.length){const {data:signed}=await supabase.storage.from("whatsapp-media").createSignedUrls(paths,3600);const next:Record<string,string>={};signed?.forEach((x,i)=>{if(x.signedUrl)next[paths[i]]=x.signedUrl});setMediaUrls(next)}else setMediaUrls({});
 },[organizationId]);

 useEffect(()=>{void loadConversations()},[loadConversations]);
 useEffect(()=>()=>{if(recordingTimerRef.current)clearInterval(recordingTimerRef.current);mediaStreamRef.current?.getTracks().forEach(track=>track.stop())},[]);
 useEffect(()=>{messagesEndRef.current?.scrollIntoView({behavior:"smooth",block:"end"})},[messages,selectedId]);
 useEffect(()=>{if(selectedId){void loadMessages(selectedId);if(supabase){void supabase.rpc("mark_whatsapp_conversation_read",{p_conversation_id:selectedId}).then(()=>loadConversations())}}else setMessages([])},[selectedId,loadMessages,loadConversations]);
 useEffect(()=>{
  if(!supabase)return;
  const ch=supabase.channel("wa-inbox-"+organizationId)
   .on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_conversations",filter:"organization_id=eq."+organizationId},()=>void loadConversations())
   .on("postgres_changes",{event:"*",schema:"public",table:"whatsapp_messages",filter:"organization_id=eq."+organizationId},(payload)=>{const row=payload.new as Message;void loadConversations();if(row?.conversation_id===selectedId&&selectedId)void loadMessages(selectedId)})
   .subscribe();
  return()=>{void supabase?.removeChannel(ch)};
 },[organizationId,selectedId,loadConversations,loadMessages]);

 const finishRecordingResources=()=>{
  if(recordingTimerRef.current){clearInterval(recordingTimerRef.current);recordingTimerRef.current=null}
  mediaStreamRef.current?.getTracks().forEach(track=>track.stop());
  mediaStreamRef.current=null;
 };

 const startRecording=async()=>{
  if(recording||sending)return;
  setRecordingError(null); setSendError(null);
  if(typeof MediaRecorder==="undefined"||!navigator.mediaDevices?.getUserMedia){
   setRecordingError("Este navegador não oferece gravação de áudio.");
   return;
  }
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   mediaStreamRef.current=stream;
   const preferred=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4"];
   const mimeType=preferred.find(type=>MediaRecorder.isTypeSupported(type))||"";
   const recorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
   mediaRecorderRef.current=recorder;
   recordingChunksRef.current=[];
   recorder.ondataavailable=event=>{if(event.data.size>0)recordingChunksRef.current.push(event.data)};
   recorder.onerror=()=>{setRecordingError("Não foi possível gravar o áudio.");setRecording(false);finishRecordingResources()};
   recorder.onstop=()=>{
    const normalized=(recorder.mimeType||mimeType||"audio/webm").toLowerCase().split(";")[0].trim();
    const extension=normalized==="audio/ogg"?"ogg":normalized==="audio/mp4"?"m4a":normalized==="audio/mpeg"?"mp3":"webm";
    const blob=new Blob(recordingChunksRef.current,{type:normalized});
    recordingChunksRef.current=[];
    finishRecordingResources();
    setRecording(false);
    if(!blob.size){setRecordingError("A gravação ficou vazia. Tente novamente.");return}
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");
    setAttachment(new File([blob],"audio-"+stamp+"."+extension,{type:normalized}));
   };
   recorder.start(250);
   setRecordSeconds(0);
   setRecording(true);
   recordingTimerRef.current=setInterval(()=>setRecordSeconds(value=>value+1),1000);
  }catch(err){
   finishRecordingResources();
   setRecording(false);
   setRecordingError(err instanceof DOMException&&err.name==="NotAllowedError"?"Permita o acesso ao microfone para gravar áudio.":"Não foi possível acessar o microfone.");
  }
 };

 const stopRecording=()=>{
  const recorder=mediaRecorderRef.current;
  if(recorder&&recorder.state!=="inactive")recorder.stop();
 };

 const recordLabel=Math.floor(recordSeconds/60).toString().padStart(2,"0")+":"+(recordSeconds%60).toString().padStart(2,"0");

 const sendMessage=async()=>{
  if(!supabase||!selectedId||(!draft.trim()&&!attachment)||sending||recording)return;
  setSending(true); setSendError(null);
  const messageText=draft.trim();
  try{
   const sessionResult=await supabase.auth.getSession();
   const token=sessionResult.data.session?.access_token;
   if(!token){setSendError("Sua sessão expirou. Entre novamente no CRM.");return}
   let mediaPayload:null|{type:string;path:string;mime_type:string;filename:string}=null;
   if(attachment){
    if(attachment.size>25*1024*1024){setSendError("O anexo deve ter no máximo 25 MB.");return}
    const mime=(attachment.type||"application/octet-stream").toLowerCase().split(";")[0].trim();
    const type=mime.startsWith("image/")?"image":mime.startsWith("video/")?"video":mime.startsWith("audio/")?"audio":"document";
    const allowedMime:Record<string,string[]>={
     image:["image/jpeg","image/png","image/webp"],
     video:["video/mp4"],
     audio:["audio/ogg","audio/mpeg","audio/mp4","audio/webm"],
     document:["application/pdf","application/octet-stream","text/plain","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
    };
    if(!allowedMime[type]?.includes(mime)){setSendError("Formato de anexo não suportado.");return}
    const safeName=attachment.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120)||"arquivo";
    const path=organizationId+"/"+selectedId+"/outbound/"+crypto.randomUUID()+"-"+safeName;
    const upload=await supabase.storage.from("whatsapp-media").upload(path,attachment,{contentType:mime,upsert:false});
    if(upload.error){setSendError("Falha ao preparar anexo: "+upload.error.message);return}
    mediaPayload={type,path,mime_type:mime,filename:safeName};
   }
   const {data,error}=await supabase.functions.invoke("whatsapp-send-message",{
    body:{conversation_id:selectedId,text:messageText,media:mediaPayload},
    headers:{Authorization:"Bearer "+token}
   });
   if(error||!data?.ok){
    const code=data?.error||error?.message||"send_failed";
    setSendError("Falha no envio: "+code);
    return;
   }
   setDraft(""); setAttachment(null); if(fileInputRef.current)fileInputRef.current.value="";
   await loadMessages(selectedId);
   await loadConversations();
  }catch(err){
   setSendError("Falha no envio: "+(err instanceof Error?err.message:"erro inesperado"));
  }finally{setSending(false)}
 };

 const selected=conversations.find(x=>x.id===selectedId)||null;
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return q?conversations.filter(x=>((x.contact_name||"")+" "+x.contact_phone+" "+(x.last_message_preview||"")).toLowerCase().includes(q)):conversations},[conversations,search]);

 return <section className="wa-shell">
  <div className="wa-list">
   <div className="wa-list-head"><h2>Conversas</h2><small>{conversations.reduce((n,x)=>n+x.unread_count,0)} não lidas</small></div>
   <div className="wa-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar conversa…" /></div>
   <div className="wa-conversations">{filtered.length?filtered.map(x=><button key={x.id} className={"wa-conversation "+(x.id===selectedId?"active":"")} onClick={()=>setSelectedId(x.id)}><span className="wa-avatar">{(x.contact_name||x.contact_phone).slice(0,1).toUpperCase()}</span><span className="wa-copy"><strong>{x.contact_name||x.contact_phone}</strong><small>{x.last_message_preview||"Sem mensagem"}</small></span><span className="wa-meta"><small>{fmt(x.last_message_at)}</small>{x.unread_count>0&&<b>{x.unread_count}</b>}</span></button>):<p className="wa-empty">Nenhuma conversa recebida.</p>}</div>
  </div>
  <div className="wa-chat">{selected?<><div className="wa-chat-head"><span className="wa-avatar">{(selected.contact_name||selected.contact_phone).slice(0,1).toUpperCase()}</span><div><strong>{selected.contact_name||selected.contact_phone}</strong><small>{selected.contact_phone}</small></div></div><div className="wa-messages">{messages.map(m=><article key={m.id} className={"wa-bubble "+m.direction}><p>{m.body||m.media_filename||({"image":"📷 Imagem","audio":"🎵 Áudio","video":"🎥 Vídeo","document":"📄 Documento","sticker":"🏷️ Figurinha","location":"📍 Localização","contact":"👤 Contato"}[m.message_type]||"["+m.message_type+"]")}</p>{m.media_url&&mediaUrls[m.media_url]&&m.message_type==="image"&&<img className="wa-media-image" src={mediaUrls[m.media_url]} alt={m.body||"Imagem recebida"} />}{m.media_url&&mediaUrls[m.media_url]&&m.message_type==="audio"&&<audio className="wa-media-audio" controls src={mediaUrls[m.media_url]} />}{m.media_url&&mediaUrls[m.media_url]&&m.message_type==="video"&&<video className="wa-media-video" controls src={mediaUrls[m.media_url]} />}{m.media_url&&mediaUrls[m.media_url]&&m.message_type==="document"&&<a className="wa-media-link" href={mediaUrls[m.media_url]} target="_blank" rel="noreferrer">{m.media_filename||"Abrir documento"}</a>}<small>{fmt(m.created_at)}{m.direction==="outbound"&&<> · <span className={"wa-message-status "+m.status}>{messageState(m)}</span></>}</small></article>)}<div ref={messagesEndRef} /></div><div className="wa-compose-wrap"><div className="wa-compose"><input ref={fileInputRef} className="wa-file-input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,audio/ogg,audio/mpeg,audio/mp4,audio/webm,application/pdf,text/plain,.doc,.docx,.xls,.xlsx" onChange={e=>{setAttachment(e.target.files?.[0]||null);setRecordingError(null)}} /><button type="button" className="wa-attach" onClick={()=>fileInputRef.current?.click()} disabled={sending||recording} title="Anexar arquivo">📎</button><button type="button" className={"wa-mic "+(recording?"recording":"")} onClick={()=>recording?stopRecording():void startRecording()} disabled={sending} title={recording?"Parar gravação":"Gravar áudio"}>{recording?"■":"🎙️"}</button><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void sendMessage()}}} disabled={sending||recording} placeholder={recording?"Gravando áudio…":"Digite uma mensagem…"} /><button onClick={()=>void sendMessage()} disabled={sending||recording||(!draft.trim()&&!attachment)}>{sending?"Enviando…":"Enviar"}</button></div>{recording&&<div className="wa-recording-status"><span>● Gravando</span><strong>{recordLabel}</strong><small>Toque no botão ■ para finalizar.</small></div>}{attachment&&<div className="wa-attachment"><span>{attachment.type.startsWith("audio/")?"🎙️":"📎"} {attachment.name}</span><button type="button" onClick={()=>{setAttachment(null);setRecordingError(null);if(fileInputRef.current)fileInputRef.current.value=""}}>Remover</button></div>}{recordingError&&<p className="wa-send-error">{recordingError}</p>}{sendError&&<p className="wa-send-error">{sendError}</p>}</div></>:<div className="wa-chat-empty"><strong>WhatsApp Wuniflow</strong><p>Selecione uma conversa.</p></div>}</div>
 </section>;
}
