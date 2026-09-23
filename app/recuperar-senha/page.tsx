"use client";

import { FormEvent, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export default function RecuperarSenha() {
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) return;
    if (window.location.hash.includes("type=recovery")) setRecovery(true);
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const requestReset = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/recuperar-senha`,
    });
    setMessage(error ? "Não foi possível enviar o e-mail agora. Tente novamente." : "Enviamos um link seguro para seu e-mail. Abra-o neste mesmo navegador.");
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || newPassword.length < 8) {
      setMessage("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setMessage("O link expirou ou não é válido. Solicite um novo link.");
      return;
    }
    window.location.href = "/";
  };

  return <main className="centered"><section className="login-card"><span className="mark">W</span><p className="eyebrow">WUNIFLOW AUTOMATIONS</p><h1>{recovery ? "Definir nova senha" : "Recuperar acesso"}</h1><p className="muted">{recovery ? "Crie uma nova senha para entrar no CRM." : "Informe seu e-mail para receber um link seguro."}</p>{isSupabaseConfigured ? (recovery ? <form onSubmit={updatePassword}><label>Nova senha<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} required autoComplete="new-password" /></label>{message && <p className="error">{message}</p>}<button type="submit">Salvar nova senha</button></form> : <form onSubmit={requestReset}><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>{message && <p className={message.startsWith("Enviamos") ? "muted" : "error"}>{message}</p>}<button type="submit">Enviar link de recuperação</button></form>) : <p className="error">O CRM ainda não está configurado.</p>}<p className="muted"><a href="/">Voltar para entrar</a></p></section></main>;
}
