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

## Dados e backup

Por padrão os dados ficam em `Documentos\SmartEasyBIM CDE`; dá para trocar a pasta no painel. A
pasta contém:

- `cde.sqlite`: o banco;
- `arquivos\`: os arquivos enviados;
- `backups\`: uma cópia do banco por dia, mantendo as 14 mais recentes.

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
