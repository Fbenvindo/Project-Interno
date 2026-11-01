# MEP BIM — aplicativo desktop

Aplicativo **local (desktop)** para projetos de instalações MEP em BIM: hidráulica, incêndio, gás, climatização (HVAC), elétrica e telecom.
Trabalha sobre modelos **IFC** de qualquer software (Revit, Archicad, Tekla, etc.) e **não depende** do app de gestão técnica de projetos que está na raiz deste repositório: são dependências, build e execução separados.

![Modelo de exemplo aberto no app](docs/tela-modelo.png)

## O que já faz (fase 1)

| Módulo | Recursos |
| --- | --- |
| **Visualizador IFC** | Abre IFC2x3 / IFC4 (botão, menu `Ctrl+O`, arrastar e soltar ou duplo clique no arquivo), navegação 3D, seleção (Ctrl+clique soma), duplo clique enquadra, cores por disciplina ou cores originais do IFC. |
| **Filtros** | Por disciplina (com "só" para isolar), pavimento, sistema e busca por nome, tipo ou dimensão. |
| **Propriedades** | Disciplina, tipo, pavimento, sistema, dimensão nominal, comprimento, GlobalId e todos os Psets/Qto do elemento e do seu tipo. |
| **Quantitativos** | Tubos, dutos, eletrodutos e eletrocalhas em metros; conexões, acessórios, terminais e equipamentos em unidades. Agrupa por disciplina, tipo, descrição, dimensão, sistema e pavimento. Clique na linha para selecionar no modelo. Exporta **CSV** compatível com Excel pt-BR. |
| **Interferências** | Grupo A × Grupo B por disciplina, tolerância de penetração, **folga mínima** (interferência "de folga"), ignora elementos do mesmo sistema. Clique para destacar o par e deixar o resto translúcido. Exporta CSV com GlobalIds. |
| **Dimensionamento** | Queda de tensão e seção mínima (NBR 5410), trecho de água fria por pesos/Fair-Whipple-Hsiao (NBR 5626), Hazen-Williams, velocidade e diâmetro equivalente de dutos. Usa comprimento e dimensão do segmento selecionado. |

![Verificação de interferências](docs/tela-interferencias.png)

### Como a disciplina é definida

1. Tipos IFC que já definem a disciplina (duto = HVAC, luminária = elétrica, sprinkler = incêndio…).
2. Para tubulações e tipos genéricos (`IfcFlowSegment` do IFC2x3), o **sistema**: o `PredefinedType` do `IfcDistributionSystem` e o nome do sistema (ex.: "Sprinkler", "GLP", "Água gelada", "Esgoto").
3. Sistemas exportados apenas como propriedade ("System Name" / "Nome do sistema", comum no Revit) também são reconhecidos.

Comprimentos vêm das quantidades IFC (`Qto_*`), depois das propriedades e, por último, da maior dimensão da geometria.

## Como executar

Requisitos: Node.js 20+.

```bash
cd apps/mep-bim
npm install          # baixa o Electron e prepara o WebAssembly do web-ifc
npm run dev          # abre o app desktop em modo desenvolvimento
```

Outros comandos:

| Comando | Para quê |
| --- | --- |
| `npm test` | Testes do núcleo (cálculos, classificação, quantitativos, interferências) e de leitura do IFC de exemplo |
| `npm run typecheck` | Verificação de tipos TypeScript |
| `npm run dev:web` | Só a interface no navegador (http://localhost:5180), útil para desenvolvimento rápido |
| `npm run build` | Build de produção em `out/` |
| `npm run dist:win` / `dist:mac` / `dist:linux` | Gera o instalador em `release/` (rode no sistema operacional correspondente) |
| `npm run sample` | Regenera `samples/exemplo-mep.ifc` |

O modelo `samples/exemplo-mep.ifc` (botão **Abrir modelo de exemplo**) tem água fria, sprinklers, duto com difusores, eletrocalha, luminárias, tomadas, ponto de dados, quadro e **interferências propositais** para demonstração.

## Estrutura

```
apps/mep-bim/
├── src/
│   ├── core/            # Domínio puro, sem UI e sem IFC (testável)
│   │   ├── disciplines.ts   # Classificação de tipos IFC por disciplina
│   │   ├── quantities.ts    # Comprimento, dimensão nominal e quantitativos
│   │   ├── clash.ts         # Detecção de interferências (sweep and prune)
│   │   └── calc/            # eletrica.ts, hidraulica.ts, hvac.ts
│   ├── ifc/loadIfc.ts   # Leitura do IFC com web-ifc (geometria, pavimentos, sistemas, Psets)
│   ├── main/            # Processo principal do Electron (janela, menus, diálogos, protocolo app://)
│   ├── preload/         # Ponte segura entre Electron e a interface
│   ├── shared/ipc.ts    # Contrato de comunicação main ⇄ renderer
│   └── renderer/        # Interface React + visualizador Three.js
├── samples/             # Modelo IFC de exemplo
├── scripts/             # Gerador do IFC de exemplo e preparação de assets
└── tests/               # Vitest
```

**Stack:** Electron, React, TypeScript, Three.js, [web-ifc](https://github.com/ThatOpen/engine_web-ifc) (leitura IFC em WebAssembly), electron-vite, Vitest.

**Segurança:** a interface roda com `sandbox` e `contextIsolation`, sem acesso ao Node. Arquivos são lidos e gravados apenas pelo processo principal, via diálogos. Em produção ela é servida pelo protocolo `app://` com CSP. O `'unsafe-eval'` da CSP é exigido pelo web-ifc.

## Limitações conhecidas

- A leitura do IFC roda na thread da interface: modelos muito grandes (centenas de MB) travam a janela durante o carregamento.
- Interferências por caixa envolvente: rápido, mas trechos inclinados ou curvos geram falsos positivos.
- A queda de tensão não substitui a verificação por **capacidade de condução de corrente** (NBR 5410, tabelas 36–39), que ainda não está implementada.
- `web-ifc-api.js` tem ~6 MB (traz todas as classes do schema IFC). Num app desktop isso não pesa.

## Roadmap

### Fase 2 — robustez e coordenação
- Leitura do IFC em *Web Worker*, com barra de progresso real e janela responsiva.
- Interferência exata por malha (BVH) aplicada sobre a triagem por caixas.
- Gestão de interferências: status (nova, em análise, resolvida), responsável, comentários, histórico entre versões do modelo, exportação **BCF** e relatório com imagens.
- Caixa de corte (*section box*), planos de corte, medição e vistas salvas.
- Federação: vários IFCs abertos juntos (arquitetura + estrutura + cada disciplina MEP).
- Exportação XLSX formatada.

### Fase 3 — locação e autoria MEP
- Modelo de arquitetura/estrutura como referência, com edição MEP por cima.
- Biblioteca de componentes parametrizados: luminárias, tomadas, interruptores, quadros, caixas de passagem, louças, ralos, registros, sprinklers, hidrantes, detectores, difusores, grelhas, evaporadoras e condensadoras.
- Inserção com *snap* em paredes, forros, pisos e ambientes (`IfcSpace`), alturas de montagem configuráveis por tipo de ponto, distribuição automática em grade (ex.: luminárias por ambiente).
- Traçado de **tubulações, eletrodutos, eletrocalhas, leitos e dutos** com conexões automáticas (curvas, tês, reduções), declividade para esgoto e pluvial e desvio de obstáculos.
- Sistemas e conectividade (portas IFC), com verificação de redes desconectadas.
- Gravação em **IFC4** (o web-ifc suporta escrita), para levar o modelo MEP de volta ao Revit e às demais ferramentas.

### Fase 4 — dimensionamento integrado ao modelo
- **Elétrica:** quadro de cargas, divisão de circuitos, demanda, capacidade de condução com fatores de agrupamento e temperatura, disjuntores e DR, taxa de ocupação de eletrodutos e queda de tensão acumulada pelo percurso real.
- **Hidráulica:** pesos por aparelho, percurso crítico, pressão disponível × requerida, água quente, esgoto (UHC, NBR 8160) e pluvial (NBR 10844).
- **Incêndio:** cálculo hidráulico de sprinklers (NBR 10897) e hidrantes (NBR 13714).
- **HVAC:** dimensionamento de dutos por igual perda de carga e balanço de vazões por difusor.
- Resultados gravados como propriedades no IFC e memória de cálculo exportável.

### Fase 5 — integração opcional com a gestão técnica
- Enviar quantitativos e status de interferências para o empreendimento/disciplina correspondente no app de gestão, via API, sem acoplar os dois aplicativos.
