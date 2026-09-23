# Wuniflow CRM

CRM comercial da Wuniflow Automations para gerir leads, qualificações, atendimento humano, tarefas e próximas ações.

## Stack

- Next.js + TypeScript
- Supabase Auth e PostgreSQL com RLS
- Integração futura com n8n e Evolution API

## Variáveis de ambiente

Configure exclusivamente na Vercel:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Use somente a chave **publishable** do Supabase. Nunca use service role no navegador ou neste repositório.

## Publicação

Importe o repositório na equipe Wuniflow da Vercel. O framework será detectado automaticamente como Next.js.
