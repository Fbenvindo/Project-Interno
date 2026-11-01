# MEP BIM — aplicativo desktop

Aplicativo **local (desktop)** para projetos de instalações MEP em BIM: hidráulica, incêndio, gás, climatização (HVAC), elétrica e telecom.
Trabalha sobre modelos **IFC** de qualquer software (Revit, Archicad, Tekla, etc.) e **não depende** do app de gestão técnica de projetos que está na raiz deste repositório: são dependências, build e execução separados.

![Modelo de exemplo aberto no app](docs/tela-modelo.png)

## O que já faz

| Módulo | Recursos |
| --- | --- |
| **Visualizador IFC** | Abre IFC2x3 / IFC4 (botão, menu `Ctrl+O`, arrastar e soltar ou duplo clique no arquivo), navegação 3D, seleção (Ctrl+clique soma), duplo clique enquadra, cores por disciplina ou cores originais do IFC. |
| **Locação de pontos** | Biblioteca com 35 componentes (iluminação, tomadas e comandos, quadros, telecom e CFTV, incêndio, louças e ralos, climatização). Clique para locar com encaixe automático na **parede**, no **teto/forro** ou no **piso**, distribuição em **área** (linhas × colunas ou espaçamento máximo), etiquetas automáticas (L1, T1, SPK1…), sistema, circuito e parâmetros. Mover, girar, editar em lote, desfazer/refazer. Salva a locação (`.locacao.json`) e **exporta IFC4** para federar com o modelo. |
| **Filtros** | Por disciplina (com "só" para isolar), pavimento, sistema e busca por nome, tipo ou dimensão. |
| **Propriedades** | Disciplina, tipo, pavimento, sistema, dimensão nominal, comprimento, GlobalId e todos os Psets/Qto do elemento e do seu tipo. |
| **Quantitativos** | Tubos, dutos, eletrodutos e eletrocalhas em metros; conexões, acessórios, terminais e equipamentos em unidades. Agrupa por disciplina, tipo, descrição, dimensão, sistema e pavimento. Clique na linha para selecionar no modelo. Exporta **CSV** compatível com Excel pt-BR. |
| **Interferências** | Grupo A × Grupo B por disciplina, tolerância de penetração, **folga mínima** (interferência "de folga"), ignora elementos do mesmo sistema. Clique para destacar o par e deixar o resto translúcido. Exporta CSV com GlobalIds. |
| **Dimensionamento** | Queda de tensão e seção mínima (NBR 5410), trecho de água fria por pesos/Fair-Whipple-Hsiao (NBR 5626), Hazen-Williams, velocidade e diâmetro equivalente de dutos. Usa comprimento e dimensão do segmento selecionado. |

![Verificação de interferências](docs/tela-interferencias.png)

### Locação de pontos

![Tomadas locadas nas paredes do modelo de exemplo](docs/tela-locacao.png)

1. Na aba **Locação**, escolha um componente da biblioteca e ajuste altura, sistema, circuito e parâmetros.
2. Passe o mouse no modelo: a pré-visualização fica **verde** onde o componente pode ser fixado e **vermelha** com o motivo (ex.: "Aponte para uma parede").
3. Clique para locar. O modo continua ativo até `Esc`, para locar vários pontos seguidos.

Como cada fixação funciona:

| Fixação | Posição |
| --- | --- |
| Parede | Centro na altura informada acima do **piso abaixo** (laje ou revestimento detectados por raio vertical; sem piso modelado, usa a cota do pavimento), alinhado e encostado na face da parede. O arredondamento corre ao longo da parede. |
| Teto / forro | Face superior encostada na face inferior do teto, menos o afastamento. Pertence ao pavimento **abaixo** do teto. |
| Piso | Base sobre o piso, mais o afastamento. |

- **Distribuir em área** (itens de teto e piso): clique em dois cantos. Os pontos ficam no centro das células, por linhas × colunas ou pelo espaçamento máximo, como em sprinklers e luminárias.
- **Atalhos:** `R` gira (teto e piso), `Delete` exclui, `Ctrl+Z`/`Ctrl+Y` desfaz/refaz, `Ctrl+S` salva.
- Os pontos locados entram nos **filtros**, nas **propriedades**, nos **quantitativos** e nas **interferências** junto com os elementos do IFC.
- **Arquivo de locação** (`.locacao.json`): guarda os pontos em coordenadas do projeto IFC. Reabre no lugar certo mesmo que o app desloque a cena de outra forma.
- **Exportar IFC:** gera um IFC4 só com os pontos (mesmos pavimentos e coordenadas do modelo de origem, `IfcDistributionSystem` por sistema e `Pset_MEP_Locacao` com etiqueta, altura, circuito e parâmetros). Abra junto com o modelo original no Revit, Navisworks, Solibri ou BIMcollab para federar.
- Para locar no teto vendo por baixo, oculte Arquitetura/Estrutura que estiverem na frente pelos filtros: elementos ocultos não recebem cliques.

As alturas padrão da biblioteca são valores usuais de projeto no Brasil, não exigências de norma. Ajuste-as ao padrão do cliente e ao memorial.

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
│   │   ├── library.ts       # Biblioteca de componentes para locação
│   │   ├── placement.ts     # Encaixe em parede/teto/piso e distribuição em grade
│   │   ├── points.ts        # Pontos locados, etiquetas e arquivo .locacao.json
│   │   ├── ifcExport.ts     # Exportação dos pontos para IFC4
│   │   ├── math.ts          # Matrizes e conversão cena ⇄ coordenadas do IFC
│   │   └── calc/            # eletrica.ts, hidraulica.ts, hvac.ts
│   ├── ifc/loadIfc.ts   # Leitura do IFC com web-ifc (geometria, pavimentos, sistemas, Psets)
│   ├── main/            # Processo principal do Electron (janela, menus, diálogos, protocolo app://)
│   ├── preload/         # Ponte segura entre Electron e a interface
│   ├── shared/ipc.ts    # Contrato de comunicação main ⇄ renderer
│   └── renderer/        # Interface React + visualizador Three.js (locacao/ = aba de locação)
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
- Locação: a grade da distribuição em área segue os eixos X/Y do projeto (não gira com ambientes inclinados). Itens de parede ficam sobrepostos à face, não embutidos. O piso de referência só é detectado em lajes e revestimentos modelados.
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
Concluído (etapa 1, locação de pontos):
- ✅ Biblioteca de componentes com fixação em parede, teto ou piso, alturas configuráveis e parâmetros.
- ✅ Locação por clique com pré-visualização, encaixe em superfícies e arredondamento; distribuição em grade.
- ✅ Edição, mover, girar, desfazer/refazer; arquivo de locação; exportação **IFC4** federável.

Próximas etapas:
- Locação por **ambiente** (`IfcSpace`): distribuir luminárias, sprinklers e detectores pelo contorno real do ambiente, com área, iluminância e cobertura.
- Biblioteca editável pelo usuário (tipos próprios, dimensões, alturas e parâmetros do escritório), com importação e exportação.
- Cópia e matriz de pontos, alinhamento, distância a cantos e vãos, cotas.
- Traçado de **tubulações, eletrodutos, eletrocalhas, leitos e dutos** ligando os pontos, com conexões automáticas (curvas, tês, reduções), declividade para esgoto e pluvial e desvio de obstáculos.
- Sistemas e conectividade (portas IFC), circuitos ligados ao quadro, verificação de redes desconectadas.
- Planta 2D por pavimento com simbologia (NBR 5444 para elétrica) para conferência e pranchas.

### Fase 4 — dimensionamento integrado ao modelo
- **Elétrica:** quadro de cargas, divisão de circuitos, demanda, capacidade de condução com fatores de agrupamento e temperatura, disjuntores e DR, taxa de ocupação de eletrodutos e queda de tensão acumulada pelo percurso real.
- **Hidráulica:** pesos por aparelho, percurso crítico, pressão disponível × requerida, água quente, esgoto (UHC, NBR 8160) e pluvial (NBR 10844).
- **Incêndio:** cálculo hidráulico de sprinklers (NBR 10897) e hidrantes (NBR 13714).
- **HVAC:** dimensionamento de dutos por igual perda de carga e balanço de vazões por difusor.
- Resultados gravados como propriedades no IFC e memória de cálculo exportável.

### Fase 5 — integração opcional com a gestão técnica
- Enviar quantitativos e status de interferências para o empreendimento/disciplina correspondente no app de gestão, via API, sem acoplar os dois aplicativos.
