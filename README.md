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

## O agente: quem decide e como

O "agente" não é uma IA treinada nem um modelo de aprendizado — é uma **política de decisão programática** que roda a cada tick da simulação (e em cada evento relevante). Isso é intencional: no protótipo, o agente serve de *baseline de engenharia* — se uma política simples, explicável e ótima-local já resolve bem, o núcleo definitivo (Java, F4+) sabe exatamente onde a complexidade precisa entrar.

### As duas decisões que ele toma

**1. Decisão macro — que rota e qual caminhão (a cada carga pendente):**

1. **Seleção de carga**: ordena a fila por prioridade (crítica → alta → padrão), FIFO dentro da mesma prioridade.
2. **Seleção de caminhão**: filtra por *hard constraints* (está na cidade de origem · tipo compatível com a classe da carga · capacidade ≥ peso · jornada restante ≥ 1 h) e escolhe o de **maior autonomia disponível**.
3. **Escolha de rota**: Dijkstra no grafo com peso = tempo de travessia; cada aresta com incidente ativo tem o tempo multiplicado (×2,5 comum, ×6 interdição grave). O resultado é a rota de **menor tempo real**, não menor distância.
4. **Planejamento de recursos sobre a rota**: percorre as pernas acumulando km — antes de estourar a autonomia restante, insere parada de reabastecimento (30 min) no último nó viável; a jornada é debitada a cada trecho e, ao fechar 10 h, o motorista dorme 8 h antes de continuar.

**2. Decisão micro — o que acontece com a carga dentro do terminal:**

1. **Doca de recebimento**: na chegada ao hub, o agente tenta alocar uma das 3 docas (45 min de manuseio). Sem doca livre, a carga vai ao **pátio** (12 vagas) e espera — decisão registrada como "sem doca livre".
2. **Momento da expedição**: a carga só disputa caminhão de saída após o transbordo padrão (1,5 h). O despacho da 2ª perna usa a mesma lógica de seleção do item 1–3 macro, partindo de BHZ.
3. **Repositioning**: caminhão ocioso fora da cidade-sede da sua empresa volta vazio para casa — *a menos* que exista carga pendente na cidade onde ele está que ele possa atender.

### Por que cada decisão é "preemptiva"

As restrições formam uma hierarquia lexicográfica: **viabilidade** (hard constraints — autonomia, compatibilidade, jornada) jamais é negociada; dentro dela, **SLA de prioridade** (crítica first); dentro disso, **eficiência** (menor tempo). O agente nunca "paga" uma violação para ganhar velocidade — ele reordena prioridades, não quebra regras.

### Como o agente explica a própria decisão

Cada escolha vai para o feed **🤖 Decisões** com o **motivo** computado no ato:

| Situação detectada | Motivo exibido |
|---|---|
| Incidente(s) na rota de menor distância | `desvio: N incidente(s) na rota curta (aceita +X km)` |
| Incidente(s), mas a rota desviada ainda é a de menor tempo | `incidente(s) na rota, menor tempo mesmo assim` |
| Rota ativa mais longa que a fantasma, sem incidente | `rota mais longa por melhor condição (X km a mais)` |
| Nada anômalo | `menor tempo; sem incidentes na rota` |

E **clicar numa decisão macro desenha a comparação no mapa**: rota ativa em **verde sólido**, rota que a fantasma teria tomado em **rosa tracejado** — a escolha vira uma imagem.

### O termômetro: política fantasma

Para saber se essas decisões **prestam**, cada carga também roda num contrafactual: a **política fantasma** — menor distância (km puros), ignorando incidentes *na escolha*, pela mesma topologia hub-and-spoke. O tempo dela é computado por **replay no mesmo mundo**: a rota fantasma sofre os mesmos incidentes históricos nos mesmos instantes, parte com o mesmo combustível e a mesma jornada residual do motorista real, e paga os mesmos transbordos e descansos. É comparada **rota contra rota, nas mesmas condições** — a fila por caminhão no hub é descontada dos dois lados e medida à parte (é limitação de *frota*, não qualidade de *rota*). O KPI **Δ fantasma** (verde quando o agente ganha, vermelho quando perde) é a métrica de valor do projeto inteiro.

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

## Legenda visual (o que pode aparecer na tela)

### 🗕 Mapa (aba Mapa)

| Elemento | Aparência | Significado |
|---|---|---|
| Contorno do Brasil | Linha cinza fina, sem preenchimento | Referência geográfica (Natural Earth) |
| **Nó capital** | Ponto branco médio + rótulo em negrito | Capital estadual ou DF |
| **Nó regional** | Ponto cinza menor + rótulo normal | Polo logístico regional |
| **Nó hub (BH)** | Ponto azul maior com contorno claro, rótulo ⭑ | Sede do centro logístico — todo fluxo passa por aqui |
| **Aresta (rodovia)** | Linha azul fina e contínua | Trecho de BR conectando dois nós adjacentes (aresta reta, traçado não é 1:1) |
| **Rótulo `BR-XXX`** | Texto cinza pequeno junto à aresta | Rodovia que forma aquela cadeia de arestas |
| **Incidente comum** | Aresta **laranja tracejada** sobreposta | Incidente ativo — tempo da aresta ×2,5 |
| **Incidente grave** | Aresta **vermelha tracejada** sobreposta | Interdição severa — tempo ×6 |
| **Caminhão em viagem** | **Triângulo azul** deslizando pela aresta | Transportando carga; aponta na direção do movimento |
| **Caminhão manuseando** | Triângulo **amarelo** (parado) | Carregando/descarregando (doca ou coleta) |
| **Caminhão em descanso** | Triângulo **roxo** (parado) | Motorista cumprindo descanso obrigatório (jornada de 10 h fechou) |
| **Caminhão ocioso** | Triângulo **cinza** (parado num nó) | Disponível aguardando despacho |
| **Rota ativa destacada** | Arestas **verde-sólido grossas** | Rota que o agente escolheu (aparece ao clicar numa decisão) |
| **Rota fantasma destacada** | Arestas **rosa tracejadas** grossas | Rota que a política de menor distância teria tomado |

### 🏭 Terminal (aba Terminal)

| Elemento | Aparência | Significado |
|---|---|---|
| Docas de recebimento R1–R3 | Cartões no topo; **borda azul** quando ocupadas | Carga em manuseio de chegada (45 min); mostram id, rota e minutos restantes |
| Docas de expedição E1–E3 | Cartões na base | Carga sendo carregada para a 2ª perna |
| Vaga de pátio | Quadrado com **borda amarela + fundo amarelo translúcido** quando ocupada | Carga esperando doca/caminhão (id reduzido: `C108`) |
| Estrada de acesso | Faixa cinza horizontal (`BR-040 / BR-116 →`) | Conexão da planta com a rede macro |

### 📊 Gantt de docas

| Elemento | Significado |
|---|---|
| Linhas R1–R3 / E1–E3 | Uma linha por doca, tempo correndo da esquerda (−12 h) para a direita (agora) |
| **Barra verde** | Ocupação por carga de prioridade **padrão** |
| **Barra amarela** | Prioridade **alta** |
| **Barra vermelha** | Prioridade **crítica** |
| Barra vazia/livre | Doca disponível naquele intervalo |

### 🤖 Painel de decisões

| Elemento | Significado |
|---|---|
| Borda **azul** + tag `macro` | Decisão de rota/caminhão — clicável, destaca rotas no mapa |
| Borda **amarela** + tag `micro` | Decisão de doca/pátio no terminal |
| Timestamp à esquerda | Hora da simulação em que a decisão foi tomada |

### Barra de simulação (rodapé)

| Elemento | Significado |
|---|---|
| ▶ / ⏸ + seletor 1×/60×/600× | Controle do relógio (espaço também pausa) |
| Relógio `dd/mm/aaaa hh:mm` | Data/hora **simulada** (não a do seu computador) |
| `entregues N (+X atrasadas)` | Entregas concluídas; atrasadas = fora do prazo (vermelho) |
| `SLA %` | % de entregas dentro do prazo — verde ≥90%, vermelho <70% |
| `trânsito / fila` | Caminhões rodando / cargas esperando coleta ou doca |
| `incidentes` | Incidentes ativos neste instante |
| `Δ fantasma +X.X h` | **Métrica central**: tempo médio que a política fantasma levaria **a mais** que o agente. Verde = agente ganhando; vermelho = perdendo |
| ≡ / ⟲ | Log de eventos / reiniciar simulação |

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

- **🗺 Mapa 3D** (Three.js) — contorno do Brasil sobre grid em perspectiva, grafo de BRs (fonte: mapa Rodoviário BIT/MTrans 2023), caminhões como modelos 3D sólidos (`caminhao.glb`) coloridos por estado (ociosos ocultos), incidentes tracejados, órbita/pan/zoom no mouse, render sob demanda; **clicar numa decisão destaca a rota ativa (verde) vs fantasma (rosa)**.
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
