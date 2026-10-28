# Gestão do Lar

Aplicativo independente para organizar as tarefas diárias da casa, os prestadores,
o estoque de produtos e as receitas, com conferência da execução por foto usando
visão computacional (OpenCV).

> Projeto separado dos demais apps deste repositório: não compartilha código, banco
> nem dependências com eles.

## Funcionalidades

| Módulo | O que faz |
| --- | --- |
| **Prestadores** | Cadastro de quem executa as tarefas (função, telefone, valor/hora, ativo). |
| **Atividades** | Tipo (limpeza, refeição, organização, lavanderia...), período (manhã/tarde/noite), frequência (única, diária, semanal, quinzenal, mensal), dias da semana, duração, instruções e a composição de recursos: **humanos** (prestadores, em rodízio) e **materiais** (quantidade por execução). |
| **Receitas** | São atividades do tipo *Refeição*: os ingredientes são os materiais e o modo de preparo fica nas instruções. Cada preparo baixa os ingredientes do estoque. |
| **Estoque** | Recursos materiais com unidade, saldo, estoque mínimo e custo. Entradas, ajustes de contagem e histórico de movimentos. Lista de compras automática: consumo previsto das tarefas dos próximos dias + mínimo − saldo. |
| **Cronograma** | Lançado automaticamente a partir da frequência de cada atividade (30 dias à frente, e sob demanda ao navegar). Editar uma atividade refaz as tarefas pendentes futuras. |
| **Execução** | Mostra instruções e materiais (com alerta de falta no estoque), botão para tirar foto pelo celular, análise da foto, conclusão com baixa automática do estoque. |
| **Login** | Acessos de **dono** (gerencia tudo) e **prestador** (vê e executa só as próprias tarefas). |

## Login e permissões

No primeiro uso, o app abre a tela **Bem-vindo!** para criar o acesso do dono da casa.
Faça isso logo após instalar: enquanto não existir nenhum usuário, qualquer pessoa
que abrir o app pode criar esse primeiro acesso.

Depois, na aba **Usuários**, o dono cria os acessos dos prestadores (cada acesso fica
vinculado a um cadastro de prestador) e pode criar outros donos.

| | Dono | Prestador |
| --- | :---: | :---: |
| Ver painel e cronograma | todas as tarefas | só as próprias |
| Iniciar, fotografar e concluir tarefa | ✓ | só as próprias |
| Cancelar tarefa, trocar prestador, definir foto de referência | ✓ | — |
| Atividades, receitas, estoque, prestadores e usuários | ✓ | — |
| Ver fotos | todas | só das próprias tarefas |

Detalhes de segurança:
- Senhas guardadas com PBKDF2-SHA256 (390 mil iterações, sal aleatório).
- Sessão em cookie `HttpOnly` / `SameSite=Lax` válido por 30 dias (marcado `Secure` sob HTTPS).
  No banco fica só o hash do token.
- Trocar a senha desconecta os outros aparelhos. Desativar um usuário, ou o prestador
  vinculado a ele, encerra o acesso na hora. Excluir um prestador exclui também o acesso dele.
- O sistema não deixa remover ou desativar o último dono ativo.

## Conferência por foto (OpenCV)

Cada atividade pode ter uma **foto de referência** ("como o ambiente deve ficar").
O jeito mais simples de criá-la: na primeira execução bem feita, toque em
*Usar foto como referência*.

Ao enviar a foto da execução, `app/visao.py` calcula:

1. **Qualidade da foto**: nitidez (variância do Laplaciano), brilho e contraste.
   Foto tremida, escura ou estourada → `foto_inadequada` (pede nova foto).
2. **Semelhança estrutural (SSIM)** com a referência, após normalizar a iluminação (CLAHE).
3. **Semelhança de cores** (correlação de histogramas HSV).
4. **Enquadramento**: pontos ORB + homografia (RANSAC) confirmam se é o mesmo local/ângulo.
5. **Índice de desordem**: densidade de bordas (Canny) comparada à referência.
   Objetos fora do lugar e sujeira aumentam a quantidade de bordas.

O resultado é uma nota de 0 a 100 e uma avaliação: `aprovada`, `revisar`,
`reprovada`, `foto_inadequada` ou `sem_referencia`. Os limiares ficam no topo
de `app/visao.py` e devem ser calibrados com fotos reais da casa.

Para manter a comparação confiável, oriente que a foto seja tirada sempre do mesmo
ponto e com o mesmo enquadramento da referência.

## Como rodar

Requer Python 3.11+.

```bash
cd gestao-lar
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python -m app.seed               # opcional: dados de exemplo (já cria os acessos abaixo)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Aplicativo: http://localhost:8000 (no celular, use o IP do computador na mesma rede)
- Documentação da API: http://localhost:8000/docs

Acessos criados pelo `app.seed` (só para demonstração; troque as senhas):

| Login | Senha | Papel |
| --- | --- | --- |
| `dono` | `dono123` | Dono |
| `maria`, `joao`, `carlos` | `123456` | Prestadores |

Banco SQLite e fotos ficam em `gestao-lar/data/` (configurável com `LAR_DATA_DIR`
ou `LAR_DATABASE_URL`).

> Para usar a câmera do celular direto no navegador em produção, sirva o app por HTTPS.

## Testes

```bash
pip install -r requirements-dev.txt
pytest
```

## Estrutura

```
gestao-lar/
├── app/
│   ├── main.py          # FastAPI, rotas, fotos protegidas e arquivos estáticos
│   ├── auth.py          # Senhas, sessões e permissões (dono x prestador)
│   ├── models.py        # Prestador, Recurso, Atividade, Tarefa, MovimentoEstoque, Usuario, Sessao
│   ├── cronograma.py    # Regras de frequência e lançamento automático
│   ├── estoque.py       # Movimentos e lista de compras
│   ├── visao.py         # Análise das fotos com OpenCV
│   ├── routers/         # Endpoints REST
│   ├── static/          # Interface web (HTML/CSS/JS, mobile-first)
│   └── seed.py          # Dados de exemplo
└── tests/
```

## Próximos passos sugeridos

- Limite de tentativas de login (hoje não há bloqueio por tentativas erradas).
- Notificações (WhatsApp/push) de tarefas do dia e de estoque baixo.
- Custos por tarefa (horas do prestador + materiais) e relatórios mensais.
- Modelo treinado (ex.: classificação "limpo/sujo" ou detecção de objetos com YOLO)
  quando houver um volume de fotos avaliadas para treinar.
