-- Tabelas iniciais para Project-Oficial

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  datas_indisponiveis JSONB DEFAULT '[]'::jsonb,
  usuarios_permitidos_visualizar JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS empreendimentos (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  cliente VARCHAR(255),
  endereco TEXT,
  num_proposta VARCHAR(255),
  status VARCHAR(50) DEFAULT 'ativo',
  foto_url TEXT,
  etapas JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipes (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disciplinas (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  cor VARCHAR(50),
  icone VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atividades (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  etapa VARCHAR(255),
  predecessora VARCHAR(255),
  funcao VARCHAR(255),
  subdisciplina VARCHAR(255),
  tempo NUMERIC(8,2),
  id_atividade VARCHAR(255),
  descricao TEXT,
  status VARCHAR(50) DEFAULT 'pendente',
  inicio_previsto TIMESTAMPTZ,
  fim_previsto TIMESTAMPTZ,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  equipe_id INTEGER REFERENCES equipes(id) ON DELETE SET NULL,
  disciplina_id INTEGER REFERENCES disciplinas(id) ON DELETE SET NULL,
  responsavel_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklists (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(100) NOT NULL,
  cliente VARCHAR(255),
  numero_os VARCHAR(100),
  tecnico_responsavel VARCHAR(255),
  data_entrega DATE,
  periodos JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(50) DEFAULT 'em_andamento',
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_sections (
  id SERIAL PRIMARY KEY,
  checklist_id INTEGER REFERENCES checklists(id) ON DELETE CASCADE,
  titulo VARCHAR(255),
  ordem INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id SERIAL PRIMARY KEY,
  checklist_id INTEGER REFERENCES checklists(id) ON DELETE CASCADE,
  secao VARCHAR(255),
  numero_item VARCHAR(100),
  descricao TEXT,
  contribuicao VARCHAR(255),
  tempo VARCHAR(100),
  observacoes TEXT,
  ordem INTEGER DEFAULT 0,
  status_por_periodo JSONB DEFAULT '{}'::jsonb,
  section_id INTEGER REFERENCES checklist_sections(id) ON DELETE CASCADE,
  titulo VARCHAR(255),
  concluido BOOLEAN DEFAULT FALSE,
  responsavel_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comerciais (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(100),
  data_solicitacao DATE,
  solicitante VARCHAR(255),
  cliente VARCHAR(255),
  empreendimento VARCHAR(255),
  tipo_empreendimento VARCHAR(100),
  tipo_obra VARCHAR(100),
  utilizacao VARCHAR(100),
  parceiros JSONB,
  disciplinas JSONB,
  codisciplinas JSONB,
  pavimentos JSONB,
  escopo TEXT,
  area NUMERIC(12,2),
  estado VARCHAR(10),
  valor_bim NUMERIC(12,2),
  valor_cad NUMERIC(12,2),
  data_aprovacao DATE,
  status VARCHAR(50) DEFAULT 'solicitado',
  email VARCHAR(255),
  telefone VARCHAR(100),
  observacao TEXT,
  -- legacy compatibility
  titulo VARCHAR(255),
  valor_estimate NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Documentos (arquivos e metadados)
CREATE TABLE IF NOT EXISTS documentos (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  numero VARCHAR(100),
  tipo VARCHAR(100),
  arquivo TEXT,
  caminho TEXT,
  descritivo TEXT,
  area VARCHAR(255),
  predecessora_id INTEGER REFERENCES documentos(id) ON DELETE SET NULL,
  pavimento_id INTEGER REFERENCES pavimentos(id) ON DELETE SET NULL,
  disciplina_id INTEGER REFERENCES disciplinas(id) ON DELETE SET NULL,
  disciplinas JSONB,
  subdisciplinas JSONB,
  executor_principal VARCHAR(255),
  multiplos_executores BOOLEAN DEFAULT FALSE,
  inicio_planejado TIMESTAMPTZ,
  termino_planejado TIMESTAMPTZ,
  escala VARCHAR(50),
  fator_dificuldade NUMERIC(8,3),
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  tempo_total NUMERIC(10,2),
  tempo_estudo_preliminar NUMERIC(10,2),
  tempo_ante_projeto NUMERIC(10,2),
  tempo_projeto_basico NUMERIC(10,2),
  tempo_projeto_executivo NUMERIC(10,2),
  tempo_liberado_obra NUMERIC(10,2),
  tempo_concepcao NUMERIC(10,2),
  tempo_planejamento NUMERIC(10,2),
  tempo_execucao_total NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documentos_numero_idx ON documentos(numero);
CREATE INDEX IF NOT EXISTS documentos_predecessora_idx ON documentos(predecessora_id);

-- Planejamento de atividades (atividades agendadas no planejamento)
CREATE TABLE IF NOT EXISTS planejamento_atividades (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  atividade_id INTEGER REFERENCES atividades(id) ON DELETE SET NULL,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  executor_principal VARCHAR(255), -- email ou identificador textual usado no frontend
  executores JSONB, -- lista de executores adicionais
  executor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  inicio_previsto TIMESTAMPTZ,
  fim_previsto TIMESTAMPTZ,
  inicio_planejado TIMESTAMPTZ,
  inicio_real DATE,
  termino_planejado TIMESTAMPTZ,
  termino_real DATE,
  tempo_planejado NUMERIC(10,2),
  tempo_executado NUMERIC(10,2),
  horas_por_dia JSONB,
  horas_executadas_por_dia JSONB,
  status VARCHAR(50) DEFAULT 'planejado',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Relacionamento entre planejamento e documentos
CREATE TABLE IF NOT EXISTS planejamento_documentos (
  id SERIAL PRIMARY KEY,
  planejamento_atividade_id INTEGER REFERENCES planejamento_atividades(id) ON DELETE CASCADE,
  documento_id INTEGER REFERENCES documentos(id) ON DELETE CASCADE,
  etapa VARCHAR(255),
  criado_at TIMESTAMPTZ DEFAULT now(),
  executor_principal VARCHAR(255),
  executores JSONB,
  inicio_planejado TIMESTAMPTZ,
  termino_planejado TIMESTAMPTZ,
  inicio_real DATE,
  termino_real DATE,
  tempo_planejado NUMERIC(10,2),
  tempo_executado NUMERIC(10,2),
  horas_por_dia JSONB,
  horas_executadas_por_dia JSONB,
  status VARCHAR(50) DEFAULT 'nao_iniciado'
);

-- Execuções (registros de trabalho)
CREATE TABLE IF NOT EXISTS execucoes (
  id SERIAL PRIMARY KEY,
  planejamento_atividade_id INTEGER REFERENCES planejamento_atividades(id) ON DELETE CASCADE,
  planejamento_id INTEGER,
  usuario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  usuario TEXT,
  inicio TIMESTAMPTZ,
  termino TIMESTAMPTZ,
  minutos INTEGER DEFAULT 0,
  tempo_total NUMERIC(10,2),
  data_execucao TIMESTAMPTZ DEFAULT now(),
  descritivo TEXT,
  base_descritivo TEXT,
  usuario_ajudado TEXT,
  nota TEXT,
  status VARCHAR(50) DEFAULT 'pendente',
  pausado_automaticamente BOOLEAN DEFAULT FALSE,
  empreendimento_id INTEGER,
  tipo_planejamento VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Analíticos/relatórios customizáveis
CREATE TABLE IF NOT EXISTS analiticos (
  id SERIAL PRIMARY KEY,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  titulo VARCHAR(255),
  dados JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Pavimentos (estrutura por empreendimento)
CREATE TABLE IF NOT EXISTS pavimentos (
  id SERIAL PRIMARY KEY,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  nome VARCHAR(255),
  ordem INTEGER DEFAULT 0,
  area NUMERIC(12,2),
  escala VARCHAR(50)
);

-- Cálculo de consumo de água (hidráulica) - dimensionamento de demanda e reservatório
CREATE TABLE IF NOT EXISTS consumo_agua_calculos (
  id SERIAL PRIMARY KEY,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  nome VARCHAR(255) DEFAULT 'Cálculo de Consumo de Água',
  itens JSONB DEFAULT '[]'::jsonb,
  dias_autonomia NUMERIC(6,2) DEFAULT 1,
  reserva_incendio_litros NUMERIC(14,2) DEFAULT 0,
  percentual_reservatorio_inferior NUMERIC(5,2) DEFAULT 40,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Atas de reunião
CREATE TABLE IF NOT EXISTS atas_reuniao (
  id SERIAL PRIMARY KEY,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  titulo VARCHAR(255),
  assunto VARCHAR(255),
  local VARCHAR(255),
  data DATE,
  horario VARCHAR(100),
  data_reuniao TIMESTAMPTZ,
  conteudo TEXT,
  participantes JSONB DEFAULT '[]'::jsonb,
  providencias JSONB DEFAULT '[]'::jsonb,
  folha VARCHAR(50),
  rev VARCHAR(50),
  controle VARCHAR(100),
  emissao VARCHAR(100),
  status VARCHAR(50) DEFAULT 'rascunho',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_atas_reuniao_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_atas_reuniao_updated_at ON atas_reuniao;
CREATE TRIGGER trigger_update_atas_reuniao_updated_at
  BEFORE UPDATE ON atas_reuniao
  FOR EACH ROW
  EXECUTE FUNCTION update_atas_reuniao_updated_at();

-- Notificações de atividade
CREATE TABLE IF NOT EXISTS notificacoes_atividade (
  id SERIAL PRIMARY KEY,
  planejamento_atividade_id INTEGER REFERENCES planejamento_atividades(id) ON DELETE CASCADE,
  tipo VARCHAR(100),
  lida BOOLEAN DEFAULT FALSE,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Funções de atividade (tipos/roles)
CREATE TABLE IF NOT EXISTS atividade_funcoes (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT
);
ALTER TABLE atividade_funcoes ADD COLUMN IF NOT EXISTS funcao         VARCHAR(255);
ALTER TABLE atividade_funcoes ADD COLUMN IF NOT EXISTS frequencia     VARCHAR(50);
ALTER TABLE atividade_funcoes ADD COLUMN IF NOT EXISTS tempo_estimado NUMERIC(10,2);
ALTER TABLE atividade_funcoes ADD COLUMN IF NOT EXISTS dias_semana    INTEGER[];
ALTER TABLE atividade_funcoes ADD COLUMN IF NOT EXISTS dia_mes        INTEGER;
ALTER TABLE atividade_funcoes ADD COLUMN IF NOT EXISTS created_date   TIMESTAMPTZ DEFAULT now();

-- Cargo (função/papel do usuário) para matching com atividade_funcoes
ALTER TABLE users ADD COLUMN IF NOT EXISTS cargo VARCHAR(255);

-- Campos extras para notificações de atividades ocasionais
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS usuario_email    VARCHAR(255);
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS atividade_funcao_id INTEGER;
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS atividade_nome   VARCHAR(255);
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS tempo_estimado   NUMERIC(10,2);
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS status           VARCHAR(50) DEFAULT 'pendente';
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS data_notificacao DATE DEFAULT CURRENT_DATE;
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS data_agendada    DATE;
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS planejamento_id  INTEGER;
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS token_resposta   VARCHAR(255);
ALTER TABLE notificacoes_atividade ADD COLUMN IF NOT EXISTS email_enviado    BOOLEAN DEFAULT FALSE;

-- Sobras por usuário (ajustes/horas sobrando) - legacy table
CREATE TABLE IF NOT EXISTS sobras_usuario (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  minutos INTEGER DEFAULT 0,
  motivo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sobras table used by the SobraUsuario frontend entity
CREATE TABLE IF NOT EXISTS sobras (
  id SERIAL PRIMARY KEY,
  usuario VARCHAR(255) NOT NULL,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  horas_sobra NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sobras_empreendimento_idx ON sobras(empreendimento_id);
CREATE INDEX IF NOT EXISTS sobras_usuario_idx ON sobras(usuario);

-- Alterações de etapa (histórico)
CREATE TABLE IF NOT EXISTS alteracoes_etapa (
  id SERIAL PRIMARY KEY,
  atividade_id INTEGER REFERENCES atividades(id) ON DELETE CASCADE,
  etapa_anterior VARCHAR(255),
  etapa_nova VARCHAR(255),
  criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Ordens de serviço manuais
CREATE TABLE IF NOT EXISTS os_manual (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(100),
  descricao TEXT,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Propostas e orçamentos simples
CREATE TABLE IF NOT EXISTS propostas (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(100),
  data_solicitacao DATE,
  solicitante VARCHAR(255),
  cliente VARCHAR(255),
  empreendimento VARCHAR(255),
  tipo_empreendimento VARCHAR(100),
  tipo_obra VARCHAR(100),
  utilizacao VARCHAR(100),
  parceiros JSONB,
  disciplinas JSONB,
  codisciplinas JSONB,
  pavimentos JSONB,
  escopo TEXT,
  area NUMERIC(12,2),
  estado VARCHAR(10),
  valor_bim NUMERIC(12,2),
  valor_cad NUMERIC(12,2),
  data_aprovacao DATE,
  email VARCHAR(255),
  telefone VARCHAR(100),
  observacao TEXT,
  titulo VARCHAR(255),
  valor NUMERIC(12,2),
  status VARCHAR(50) DEFAULT 'rascunho',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orcamentos (
  id SERIAL PRIMARY KEY,
  proposta_id INTEGER REFERENCES propostas(id) ON DELETE CASCADE,
  descricao TEXT,
  valor NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Alocação de equipe (planejado / reprogramado / realizado / OS)
CREATE TABLE IF NOT EXISTS alocacao_equipe (
  id SERIAL PRIMARY KEY,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  usuario_email TEXT,
  data DATE,
  tipo VARCHAR(50), -- 'planejado' | 'realizado' | 'reprogramado' | 'os'
  referencia TEXT,  -- id/numero da OS, atividade, documento, etc.
  label TEXT,
  cor VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alocacao_equipe_usuario_email_idx ON alocacao_equipe(usuario_email);
CREATE INDEX IF NOT EXISTS alocacao_equipe_data_idx ON alocacao_equipe(data);

-- Atividades específicas por empreendimento (registradas por documento)
CREATE TABLE IF NOT EXISTS atividades_empreendimento (
  id SERIAL PRIMARY KEY,
  id_atividade VARCHAR(255),
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  documento_id INTEGER REFERENCES documentos(id) ON DELETE CASCADE,
  etapa VARCHAR(255),
  disciplina VARCHAR(255),
  subdisciplina VARCHAR(255),
  atividade TEXT,
  predecessora VARCHAR(255),
  tempo NUMERIC(10,2),
  funcao VARCHAR(255),
  documento_ids JSONB,
  status_planejamento VARCHAR(100),
  documento_id_original INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atividades_empreendimento_documento_idx ON atividades_empreendimento(documento_id);

-- Item PRE: itens registrados na aba PRE
CREATE TABLE IF NOT EXISTS itempre (
  id SERIAL PRIMARY KEY,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  item VARCHAR(100) NOT NULL,
  data DATE NOT NULL,
  de VARCHAR(255),
  descritiva TEXT,
  localizacao TEXT,
  assunto VARCHAR(255),
  comentario TEXT,
  disciplina VARCHAR(255),
  status VARCHAR(50) DEFAULT 'Em andamento',
  resposta TEXT,
  imagens JSONB,
  tempo_atendimento NUMERIC(8,2),
  planejamento_executor VARCHAR(255),
  planejamento_executor_nome VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE itempre ADD COLUMN IF NOT EXISTS tempo_atendimento NUMERIC(8,2);
ALTER TABLE itempre ADD COLUMN IF NOT EXISTS planejamento_executor VARCHAR(255);
ALTER TABLE itempre ADD COLUMN IF NOT EXISTS planejamento_executor_nome VARCHAR(255);
ALTER TABLE itempre ADD COLUMN IF NOT EXISTS documentos_vinculados JSONB DEFAULT '[]';
ALTER TABLE itempre ADD COLUMN IF NOT EXISTS checklist_item_id INTEGER REFERENCES checklist_items(id) ON DELETE SET NULL;
ALTER TABLE itempre ADD COLUMN IF NOT EXISTS checklist_doc_id VARCHAR(255);

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS tempo_pre NUMERIC(8,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS itempre_empreendimento_idx ON itempre(empreendimento_id);
CREATE INDEX IF NOT EXISTS itempre_checklist_item_idx ON itempre(checklist_item_id);

-- Controle OS: colunas explícitas conforme schema do frontend
CREATE TABLE IF NOT EXISTS controle_os (
  id SERIAL PRIMARY KEY,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  os VARCHAR(255),
  gestao VARCHAR(255),
  formalizacao TEXT,
  cronograma VARCHAR(255) DEFAULT 'NA',
  markup VARCHAR(255) DEFAULT 'NA',
  abertura_os_servidor VARCHAR(255) DEFAULT 'NA',
  atividades_planejamento VARCHAR(255) DEFAULT 'NA',
  kickoff_cliente VARCHAR(255) DEFAULT 'NA',
  art_ee_ais VARCHAR(255) DEFAULT 'NA',
  art_hid_in VARCHAR(255) DEFAULT 'NA',
  art_hvac VARCHAR(255) DEFAULT 'NA',
  art_bomb VARCHAR(255) DEFAULT 'NA',
  conc_telefonia VARCHAR(255) DEFAULT 'NA',
  conc_gas VARCHAR(255) DEFAULT 'NA',
  conc_eletrica VARCHAR(255) DEFAULT 'NA',
  conc_hidraulica VARCHAR(255) DEFAULT 'NA',
  conc_agua_pluvial VARCHAR(255) DEFAULT 'NA',
  conc_incendio VARCHAR(255) DEFAULT 'NA',
  atividades_vinculadas JSONB,
  planejamento JSONB,
  monitoramento JSONB,
  avanco JSONB,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS controle_os_empreendimento_idx ON controle_os(empreendimento_id);

-- Performance indexes on the most frequently queried foreign-key columns
CREATE INDEX IF NOT EXISTS documentos_empreendimento_idx ON documentos(empreendimento_id);
CREATE INDEX IF NOT EXISTS atividades_empreendimento_idx ON atividades(empreendimento_id);
CREATE INDEX IF NOT EXISTS planejamento_atividades_empreendimento_idx ON planejamento_atividades(empreendimento_id);
CREATE INDEX IF NOT EXISTS planejamento_atividades_executor_id_idx ON planejamento_atividades(executor_id);
CREATE INDEX IF NOT EXISTS execucoes_empreendimento_idx ON execucoes(empreendimento_id);
CREATE INDEX IF NOT EXISTS execucoes_planejamento_atividade_id_idx ON execucoes(planejamento_atividade_id);
CREATE INDEX IF NOT EXISTS execucoes_usuario_id_idx ON execucoes(usuario_id);
CREATE INDEX IF NOT EXISTS checklists_empreendimento_idx ON checklists(empreendimento_id);
CREATE INDEX IF NOT EXISTS atividades_empreendimento_emp_idx ON atividades_empreendimento(empreendimento_id);
CREATE INDEX IF NOT EXISTS planejamento_documentos_documento_id_idx ON planejamento_documentos(documento_id);
CREATE INDEX IF NOT EXISTS planejamento_documentos_planejamento_id_idx ON planejamento_documentos(planejamento_atividade_id);

-- Data Cadastro: datas por documento/etapa/revisao para a aba Cadastro
CREATE TABLE IF NOT EXISTS data_cadastro (
  id SERIAL PRIMARY KEY,
  empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  documento_id INTEGER REFERENCES documentos(id) ON DELETE CASCADE,
  datas JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_cadastro_empreendimento_idx ON data_cadastro(empreendimento_id);
CREATE INDEX IF NOT EXISTS data_cadastro_documento_idx ON data_cadastro(documento_id);

-- Descrições das colunas para documentação
COMMENT ON COLUMN controle_os.empreendimento_id IS 'ID do empreendimento relacionado';
COMMENT ON COLUMN controle_os.os IS 'Número da OS';
COMMENT ON COLUMN controle_os.gestao IS 'Responsável pela gestão (nome do usuário)';
COMMENT ON COLUMN controle_os.formalizacao IS 'Descrição da formalização';
COMMENT ON COLUMN controle_os.cronograma IS 'Status do Cronograma';
COMMENT ON COLUMN controle_os.markup IS 'Status do Markup';
COMMENT ON COLUMN controle_os.abertura_os_servidor IS 'Status da Abertura de OS - Servidor';
COMMENT ON COLUMN controle_os.atividades_planejamento IS 'Status das Atividades de Planejamento';
COMMENT ON COLUMN controle_os.kickoff_cliente IS 'Status do Kick off com Cliente';
COMMENT ON COLUMN controle_os.art_ee_ais IS 'Status ART - EE/AIS';
COMMENT ON COLUMN controle_os.art_hid_in IS 'Status ART - HID/IN';
COMMENT ON COLUMN controle_os.art_hvac IS 'Status ART - HVAC';
COMMENT ON COLUMN controle_os.art_bomb IS 'Status ART - BOMB';
COMMENT ON COLUMN controle_os.conc_telefonia IS 'Status Concessionária Telefonia';
COMMENT ON COLUMN controle_os.conc_gas IS 'Status Concessionária Gás';
COMMENT ON COLUMN controle_os.conc_eletrica IS 'Status Concessionária Elétrica';
COMMENT ON COLUMN controle_os.conc_hidraulica IS 'Status Concessionária Hidráulica';
COMMENT ON COLUMN controle_os.conc_agua_pluvial IS 'Status Concessionária Água Pluvial';
COMMENT ON COLUMN controle_os.conc_incendio IS 'Status Concessionária Incêndio';
COMMENT ON COLUMN controle_os.atividades_vinculadas IS 'Mapa de atividades vinculadas do empreendimento (chave: nome_atividade, valor: status)';
COMMENT ON COLUMN controle_os.planejamento IS 'Status de cada disciplina no planejamento (hidráulica, elétrica, etc) com sub-etapas';
COMMENT ON COLUMN controle_os.monitoramento IS 'Status de monitoramento com briefing, cronograma, LMD e entregas x etapas';
COMMENT ON COLUMN controle_os.avanco IS 'Lista de itens de avanço do projeto';
COMMENT ON COLUMN controle_os.observacoes IS 'Observações gerais';



-- Idempotent column additions (safe to run multiple times)
ALTER TABLE equipes ADD COLUMN IF NOT EXISTS cor VARCHAR(50) DEFAULT '#3B82F6';
ALTER TABLE equipes ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipe_id INTEGER REFERENCES equipes(id) ON DELETE SET NULL;

-- Atividades rápidas genéricas (por usuário)
CREATE TABLE IF NOT EXISTS atividades_genericas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  usuario_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE atividades_genericas ADD COLUMN IF NOT EXISTS id SERIAL;
ALTER TABLE atividades_genericas ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
