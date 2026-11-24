# Server local para Project-Oficial

Instruções rápidas:

- Instalar dependências:

```bash
cd server
npm install
```

- Configurar conexão (opcional):

Crie um arquivo `.env` em `server/` com `DATABASE_URL` ou `PG_CONNECTION`.

- Rodar migrações iniciais:

```bash
npm run migrate
```

- Iniciar servidor:

```bash
npm start
```

Endpoints iniciais:
- `GET /health` — checa conexão com DB
- `POST /migrate` — aplica schema SQL (igual a `npm run migrate`)

Importar CSV para `comerciais`:

```bash
cd server
npm run import:comerciais -- "C:/caminho/comerciais.csv" "--sep=;"
```

No PowerShell, use `"--sep=;"` (com aspas) para evitar que `;` seja interpretado como separador de comando.

Opcoes do importador:
- `--sep=;` define delimitador (padrao: `,`)
- `--insert-only` desativa update por `numero` e sempre insere
- `--dry-run` valida arquivo sem gravar no banco

Importar CSV para `documentos`:

```bash
cd server
npm run import:documentos -- "C:/caminho/Documento_export.csv" "--sep=;"
```

Importar CSV para `empreendimentos`:

```bash
cd server
npm run import:empreendimentos -- "C:/caminho/Empreendimentos_export.csv" "--sep=;"
```

Importar CSV para `atividades`:

```bash
cd server
npm run import:atividades -- "C:/caminho/Atividades_export.csv" "--sep=;" --empreendimentos-csv="C:/caminho/Empreendimentos_export.csv"
```

Vincular `documentos` com `empreendimentos` usando os CSVs de origem:

```bash
cd server
npm run link:documentos-empreendimentos -- "C:/caminho/Documento_export.csv" "C:/caminho/Empreendimentos_export.csv"
```

Produção:
- Defina `PORT` conforme a plataforma.
- Defina `DATABASE_URL` para o banco de produção.
- Defina `CORS_ALLOWED_ORIGINS` com a URL do frontend publicado (ou múltiplas URLs separadas por vírgula).

## CDE (Ambiente Comum de Dados, ISO 19650)

Cada empreendimento tem a aba **CDE** no sistema web. Ela guarda documentos de qualquer software (PDF, DWG, RVT, IFC, planilhas, memoriais), cada um com:
- código ISO 19650 (`Projeto-Originador-Volume-Nível-Tipo-Disciplina-Número`);
- revisões (P01, P02…; publicado: C01, C02…);
- estados com finalidade: em andamento S0, compartilhado S1–S4, publicado A1/A2/A3/B1, arquivado;
- histórico de arquivos e de mudanças de estado, com cada versão podendo ser baixada;
- emissões com GRD para imprimir ou salvar em PDF.

**Permissões:**
- Todas as rotas exigem login.
- Qualquer usuário cria documentos, envia arquivos e compartilha.
- Só os perfis **admin, direção, liderança, gestão e coordenação** publicam, arquivam, excluem e alteram a codificação.
- Um documento já emitido não é excluído: é arquivado, e o histórico fica.

**Rotas** (`server/routes/cde.js`):
- `GET /api/cde/:empId`
- `PATCH /api/cde/:empId/config`
- `POST /api/cde/:empId/documentos`
- `PATCH|DELETE /api/cde/documentos/:id`
- `GET /api/cde/documentos/:id/eventos`
- `POST /api/cde/documentos/:id/upload` (URL assinada) → `PUT` do arquivo → `POST /api/cde/documentos/:id/arquivo` (confirma)
- `GET /api/cde/documentos/:id/download[?evento=ID]`
- `POST /api/cde/documentos/:id/estado`
- `POST /api/cde/:empId/emissoes`

### Armazenamento dos arquivos (S3)

Com `S3_BUCKET` definido, os arquivos vão para um armazenamento compatível com S3 (Amazon S3, Cloudflare R2, Backblaze B2, MinIO). O navegador envia e baixa **direto do bucket** por URLs assinadas (1 hora), sem passar pela API. Sem S3, os arquivos ficam no disco do servidor (`CDE_LOCAL_DIR`, padrão `server/storage/cde`). Esse modo serve só para desenvolvimento, porque o disco do Render é apagado a cada deploy.

Variáveis:

| Variável | Exemplo |
| --- | --- |
| `S3_BUCKET` | `cde-projetos` |
| `S3_REGION` | `us-east-1` (S3) ou `auto` (R2) |
| `S3_ENDPOINT` | R2: `https://<conta>.r2.cloudflarestorage.com`; B2: `https://s3.<região>.backblazeb2.com` (vazio no S3 da AWS) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | chave com permissão de leitura e escrita no bucket |
| `S3_FORCE_PATH_STYLE` | `true` só para MinIO |

O bucket precisa de **CORS** liberando o sistema web, para o envio direto do navegador:

```json
[
  {
    "AllowedOrigins": ["https://<seu-site>.onrender.com", "http://localhost:5173"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

O bucket deve ficar **privado**: o acesso é só pelas URLs assinadas.

Testes das regras: `npm test`.
