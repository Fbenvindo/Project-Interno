# SmartEasyBIM CDE (servidor local)

CDE (Ambiente Comum de Dados, ISO 19650) que roda num computador do escritório e atende a rede local.

- Documentos de qualquer software (PDF, DWG, RVT, IFC, planilhas) com código ISO 19650
  (`Projeto-Originador-Volume-Nível-Tipo-Disciplina-Número`), revisões (P01, P02…; C01 ao
  publicar), estados com finalidade (S0, S1–S4, A1/A2/A3/B1, AR), histórico e GRDs.
- Banco SQLite e arquivos numa pasta do computador. Não precisa de internet nem de serviço em nuvem.
- A equipe acessa pelo navegador, e o SmartEasyBIM se conecta ao mesmo endereço (painel
  *Gestão da informação → CDE do servidor*).

## Instalação (computador servidor)

1. Rode o instalador `SmartEasyBIM-CDE-Setup-x.y.z.exe`, gerado pelo workflow
   *SmartEasyBIM CDE - instalador Windows* na aba Actions.
2. Abra o **SmartEasyBIM CDE**. O painel mostra os endereços do servidor (por exemplo,
   `http://NOME-DO-PC:4000`). Na primeira vez, permita o acesso à rede quando o Firewall do Windows
   perguntar.
3. Clique em **Abrir o CDE no navegador** e crie o administrador. A primeira configuração só
   funciona no próprio servidor.
4. Em **Usuários**, cadastre a equipe. Perfis:
   - **Coordenação e administrador:** publicam, arquivam e criam empreendimentos.
   - **Colaboradores:** criam documentos, enviam arquivos e compartilham.
5. Marque **Iniciar o CDE junto com o Windows**. O computador precisa ficar ligado para a equipe
   usar o CDE.

## Interferências (clash)

Na página do empreendimento, a aba **Interferências** cruza os modelos IFC do CDE.

1. **Nova análise:** marque os modelos do lado A e do lado B e escolha as regras.
   - **Versão dos modelos:** a última emitida (compartilhada ou publicada) ou a atual.
   - **Colisão física:** elementos que se atravessam ou um embutido no outro. Sobreposições
     até a **tolerância** são ignoradas.
   - **Folga mínima:** elementos que não colidem, mas ficam mais próximos que a distância.
   - **Ignorar tipos IFC:** lista de tipos que ficam fora da análise.
2. **Processamento:** roda no servidor, uma análise de cada vez e numa thread separada; a lista
   mostra o andamento. A geometria de cada arquivo IFC é processada uma vez e guardada em
   `cache\geometria`.
3. **Resultado:**
   - Interferências agrupadas: o mesmo elemento em várias interferências vira um grupo.
   - Filtros por estado, tipo, pavimento e responsável.
   - Visualizador 3D: elemento A em vermelho, B em azul, demais modelos transparentes.
   - Para cada interferência: estado (nova, ativa, resolvida, aprovada), responsável e
     comentário. Também dá para editar várias de uma vez. Só a coordenação aprova.
4. **Relatório PDF:** as interferências filtradas, com imagem de cada uma (até 300).
5. **Reexecutar:** roda de novo com as mesmas regras e a versão mais recente dos modelos.

### Acompanhamento entre revisões, BCF e SmartEasyBIM

- **Comparação:** cada análise é comparada com a anterior de mesmas regras.
  - **Novas:** interferências que não estavam na análise anterior.
  - **Continuam:** mantêm estado, responsável e comentários.
  - **Reabertas:** estavam marcadas como resolvidas, mas a interferência ainda aparece.
  - **Resolvidas pela revisão:** sumiram. A pendência antiga fica registrada como resolvida.
- **Reexecução automática** (opção marcada por padrão): quando um modelo usado na análise recebe
  revisão nova, a análise roda de novo sozinha e já sai comparada. Revisão nova quer dizer
  emitida, ou só enviada se a análise usa a versão atual.
- **Comentários:** cada interferência guarda um histórico. Mudanças de estado também ficam
  registradas.
- **BCF 2.1:**
  - **Exportar BCF:** gera um tópico por interferência filtrada, com ponto de vista, os dois
    elementos pelo GlobalId (em vermelho e azul) e a imagem. Abre no Revit (BCF Manager),
    Navisworks, Solibri e BIMcollab.
  - **Importar BCF:** traz de volta o status (Resolved/Closed → resolvida; In Progress → ativa) e
    os comentários feitos nesses softwares, sem duplicar.
- **SmartEasyBIM:** em *Gestão da informação*, o projeto ligado ao CDE mostra as interferências
  em aberto dos seus modelos.
  - **Ver:** seleciona os elementos no 3D pelo GlobalId.
  - **Tratar:** comentar ou marcar como resolvida.

### Revit

O plugin SmartEasyBIM para Revit (`apps/mep-bim/revit-addin`) tem o painel **CDE**:

- **Publicar no CDE:** exporta o IFC do modelo com o exportador do Revit, com coordenadas
  compartilhadas e GUIDs fixos. Envia como nova revisão do documento e, se marcado, compartilha.
  A análise de interferências roda de novo sozinha.
- **Interferências:** lista as pendências em aberto do modelo.
  - **Ver no modelo:** seleciona os elementos, inclusive os dos vínculos, e abre uma vista 3D
    com caixa de corte em volta.
  - Dá para comentar e marcar como em tratamento ou resolvida.

Para quem não usa Revit, continua valendo exportar o IFC e enviar pela página do CDE.

## Dados e backup

Por padrão os dados ficam em `Documentos\SmartEasyBIM CDE`; dá para trocar a pasta no painel. A
pasta contém:

- `cde.sqlite`: o banco;
- `arquivos\`: os arquivos enviados;
- `backups\`: uma cópia do banco por dia, mantendo as 14 mais recentes;
- `cache\`: a geometria processada dos IFCs. Pode ser apagada: é refeita quando necessário.

Para backup, copie a pasta inteira. Para mudar de servidor, copie a pasta para o novo computador
e escolha-a em **Usar outra pasta…**.

## Acesso de fora do escritório

O CDE atende só a rede local. Para acessar de fora, use uma VPN ou um túnel, como Tailscale ou
Cloudflare Tunnel.

## Desenvolvimento

```bash
npm install
npm test                      # API completa (fluxo, permissões, persistência)
npm run build:web             # interface web (web/ → web-dist/)
npm run server -- --porta 4000 --dados ./dados   # servidor sem a janela
npm start                     # aplicativo Electron
```
