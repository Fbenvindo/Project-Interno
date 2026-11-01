# Project-Oficial

Guia rápido para preparar e publicar o sistema (frontend + API + banco).

## 1) Pré-requisitos

- Node.js 20+
- Banco PostgreSQL acessível
- Variáveis de ambiente configuradas

## 2) Frontend (Vite)

Instalação e build:

```bash
npm install
npm run build
```

Artefato gerado:
- `dist/`

Variáveis importantes do frontend:
- `VITE_API_BASE_URL` (URL pública da API, ex: `https://api.seudominio.com`)
- `VITE_BASE44_APP_ID` (opcional, se usar Base44 remoto)
- `VITE_BASE44_BACKEND_URL` (opcional, se usar Base44 remoto)

Se `VITE_API_BASE_URL` não for definido em produção, o app usa chamadas relativas (`/api`).

## 3) Backend (Express)

No diretório `server/`:

```bash
npm install
npm run migrate
npm start
```

Variáveis importantes do backend:
- `DATABASE_URL` (recomendado)
- `PORT`
- `CORS_ALLOWED_ORIGINS` (origens permitidas, separadas por vírgula)

Exemplo:

```env
PORT=4000
DATABASE_URL=postgresql://usuario:senha@host:5432/project_oficial
CORS_ALLOWED_ORIGINS=https://app.seudominio.com,https://staging.seudominio.com
```

## 4) Estratégias de publicação

Opção A (recomendada):
- Frontend em serviço estático/CDN (Vercel, Netlify, S3+CloudFront).
- Backend em serviço Node (Render, Railway, Fly, VPS).
- Banco PostgreSQL gerenciado (Neon, Supabase, RDS, etc.).

Opção B:
- Publicar frontend e backend no mesmo domínio com proxy reverso para `/api`.

## 4.1) Deploy rápido com Render (já configurado)

Este repositório já inclui `render.yaml` com dois serviços:
- API Node (`server/`)
- Frontend estático (raiz com `dist/`)

Passos:

1. Suba este projeto para um repositório Git remoto.
2. No Render, use a opção de Blueprint e selecione o arquivo `render.yaml`.
3. Preencha as variáveis obrigatórias:
	- API: `DATABASE_URL`, `CORS_ALLOWED_ORIGINS`
	- Frontend: `VITE_API_BASE_URL`
4. Execute o deploy.
5. Rode a migração no serviço da API (Shell/Job): `npm run migrate`.

Templates de variáveis:
- Frontend: `.env.production.example`
- Backend: `server/.env.production.example`

## 5) Checklist de release

- Build do frontend concluído sem erro.
- API sobe e responde em `/health`.
- Migrações aplicadas no banco de produção.
- URL da API configurada no frontend.
- CORS configurado no backend para o domínio publicado.
- Segredos fora do Git (`.env` não versionado).

## 6) Pós-publicação

- Testar login e fluxos críticos (cadastros, planejamento, documentos, relatórios).
- Monitorar logs da API e erros de navegador nas primeiras horas.
- Validar backup e plano de rollback do banco.

## Outros aplicativos neste repositório

- [`apps/mep-bim`](apps/mep-bim/README.md): aplicativo desktop (Electron) para projetos MEP em BIM/IFC. É independente deste sistema de gestão, com dependências e build próprios.
