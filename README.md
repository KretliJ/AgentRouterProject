# AgentRouter

> Simulação dual de um centro logístico rodoviário sediado em **Belo Horizonte**: uma camada **micro** (operação interna do terminal de cargas) e uma camada **macro** (roteamento de cargas na malha de rodovias federais), concorrentes no mesmo relógio, geridas por um agente de **otimização preemptiva** — e mensuradas contra uma **política fantasma**.

**Status:** 🚧 protótipo funcional (out/2026) · design fechado · implementação do núcleo definitivo não iniciada · design completo em [`MODELAGEM.md`](MODELAGEM.md)

---

## Visão geral

O projeto simula, em tempo real (pausável e acelerável), a operação de um hub logístico que trata **qualquer tipo de carga**:

| Camada | Escopo | Decisão do agente |
|---|---|---|
| **Macro (rede)** | Grafo rodoviário — nós: capitais e polos regionais; arestas: trechos de BR | Rota da carga e momento do despacho |
| **Micro (terminal)** | Docas de recebimento/expedição, pátio, filas | Alocação de docas, sequenciamento, despacho da 2ª perna |

As duas camadas se acoplam na decisão central do projeto: **despachar agora pela rota disponível, ou esperar uma janela/rota melhor — arriscando o SLA.**

## Como funciona

### Relógio de simulação
- Tempo real *paced*: pausável (▶/espaço), acelerável (1×/60×/600×); subticks de ≤30 min.
- Eventos consomem exatamente o tempo que levam — pausa/aceleração nunca alteram durações nem reordenam eventos.
- RNG semeado → a mesma sessão é reproduzível.

### Ground truth dinâmica
Condições da rede evoluem **por conta própria** (gerador estocástico exógeno, independente das decisões):
- **Incidentes** — processo estocástico por aresta (∝ km, 12% graves com penalidade ×6, duração 2–8 h), exibidos no mapa como tracejado laranja/vermelho.
- **Novas cargas** — nascem nas empresas a cada 1,5–3 h, com prioridade (crítica/alta/padrão) e SLA (24/48/72 h).

O agente enxerga o **presente** perfeitamente e o futuro apenas como distribuições. Ao perceber incidente à frente, re-otimiza.

### Fluxo hub-and-spoke
**Toda carga circula origem → [BHZ] → destino**, com transbordo no terminal (1,5 h). O destino é uma **empresa receptora** cuja função absorve a classe da carga (`DESTINO_POR_CLASSE`): granel → siderurgia/agroindústria/frigorífico; perigosa → química; refrigerada → frigorífico/farmacêutica; etc.

### Peso da aresta e rotas
- Despacho ativo por **menor tempo** (Dijkstra com penalidade de incidente ×2,5/×6).
- **Autonomia como estado**: reabastecimento planejado no grafo (30 min); descanso obrigatório ao fechar 10 h de jornada; repositioning vazio à sede.

### Política fantasma (baseline)
Toda entrega é comparada ao contrafactual de **menor distância** pela mesma topologia (origem→[BHZ]→destino), **replayado no mesmo mundo** — mesmos incidentes históricos, mesmo combustível e jornada residual do caminhão real. O delta alimenta o KPI "Δ fantasma"; a fila no hub é medida separadamente como efeito de **capacidade** (`filaHubMediaH`), não de rota.

## Arquitetura do protótipo

```
frontend/prototype/  (abre index.html direto no navegador — file://, zero dependências)
├── index.html       # UI: abas Mapa/Terminal, painéis, barra de simulação
├── graph.js         # grafo SVG: 19 nós / 28 arestas de BRs reais, zoom/pan
├── data.js          # tabelas CAMINHÃO/CARGA/EMPRESA + 36 empresas fantasia (PRNG semeado)
├── sim.js           # motor: relógio, ground truth, despacho, fantasma, docas, KPIs
└── assets/          # contorno do Brasil (Natural Earth)
```

## Visualização

- **🗺 Mapa** — contorno do Brasil (Natural Earth, domínio público), grafo de BRs (fonte: mapa Rodoviário BIT/MTrans 2023), caminhões animados coloridos por estado, incidentes tracejados, **clicar numa decisão destaca a rota ativa (verde) vs fantasma (rosa)**.
- **🏭 Terminal** — planta do centro logístico: docas de recebimento R1–R3, pátio (12 vagas com cargas visíveis), estrada de acesso, docas de expedição E1–E3.
- **📊 Gantt de docas** — ocupação das últimas 12 h, barras por prioridade.
- **🤖 Decisões do agente** — feed de cada escolha nas duas camadas (macro: rota+motivo; micro: doca/pátio).
- **Barra de simulação** — relógio, velocidade, entregues/atrasadas, SLA, trânsito, fila, incidentes, Δ fantasma; log de eventos.

## Dados

| Fonte | Uso |
|---|---|
| [PRF — Dados Abertos](https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf) | acidentes 2007–2026 → taxas por aresta (uso futuro; v1 usa processo estocástico) |
| [ANTT](https://dados.antt.gov.br) | volumes por corredor (uso futuro) |
| [Mapa Rodoviário BIT/MTrans 2023](https://www.gov.br/transportes/pt-br/assuntos/dados-de-transportes/bit/mapas/) | topologia das BRs do grafo |
| [Natural Earth](https://www.naturalearthdata.com) | contorno do Brasil (domínio público) |

Créditos completos e licenças: [`ATTRIBUTION.md`](ATTRIBUTION.md). Histórico de decisões: [`PROMPTS.md`](PROMPTS.md).

## Roadmap

| Fase | Estado | Entrega |
|---|---|---|
| Protótipo | ✅ | grafo, simulação dual, hub-and-spoke, fantasma, 2 visualizações |
| F0 | ⬜ | ETL PRF/ANTT/OSM → grafo calibrado em JSON |
| F1 | ⬜ | núcleo Java 21 (DES) com FFI Python |
| F2–F3 | ⬜ | RCSP com autonomia/jornada (label-setting); terminal DES completo |
| F4–F5 | ⬜ | acoplamento total, agente online, experimentos baseline vs política |
| F6 | ⬜ | replay scrubber, relatórios comparativos |

## Executando o protótipo

```bash
# basta abrir no navegador (zero dependências, funciona via file://)
start frontend/prototype/index.html   # Windows
```

Ligue a simulação (▶ ou espaço), ajuste a velocidade, explore as abas.
