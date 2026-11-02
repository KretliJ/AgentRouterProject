# AgentRouter — Modelagem do Centro Logístico Rodoviário de Belo Horizonte

**Status:** design v1 — pré-implementação
**Data:** 2026-10-23
**Meta:** amadurecer a modelagem antes de qualquer código.

---

## 1. Enunciado

Simulação de um centro logístico rodoviário sediado em Belo Horizonte que trata qualquer tipo de carga. O sistema é composto de **duas simulações concorrentes e acopladas**:

- **Camada macro (rede):** grafo rodoviário — nós = cidades relevantes (capitais e capitais regionais), arestas = trechos de BR com dados. A carga parte do terminal (BH) rumo ao destino; a decisão é **rota + momento do despacho**.
- **Camada micro (terminal):** o terminal em BH — docas, filas, pátio, equipes. A decisão é **sequenciamento do atendimento, alocação de recursos e consolidação por destino**.

O agente opera nas duas camadas com **otimização preemptiva (lexicográfica)**: respeita as restrições duras; dentro delas, cumpre o SLA das cargas prioritárias; dentro disso, otimiza eficiência (tempo, custo, risco) em ordem declarada de prioridade.

---

## 2. Relógio e semântica temporal

- Simulação em **tempo real (paced)**: o relógio de simulação avança 1:1 com o relógio de parede a 1×; acelerável (10×, 60×, 600×…) e pausável para decisão.
- **Eventos consomem tempo simulado**: viagens, atendimentos e incidentes duram exatamente sua duração no relógio da simulação. Pausa/aceleração nunca alteram durações nem reordenam eventos (determinismo por seed).
- Implementação: motor de eventos discretos (DES) — heap de eventos + thread de relógio. "Pausa para decisão" = breakpoint que suspende o despacho de eventos até a decisão chegar; decisões custam **zero** tempo simulado.
- RNG com **streams separados por subsistema** (mundo, chegadas, terminal): acelerar ou pausar não muda a trajetória estocástica — experimentos a 600× e a apresentação a 1× são a mesma execução.

---

## 3. Camada macro — o grafo

### 3.1 Elementos

- **Nós (V):** BH (sede do terminal) + capitais estaduais e cidades-polo logísticas do raio de operação: Contagem/Betim, Uberlândia, Uberaba, Juiz de Fora, Montes Claros, Governador Valadares, Teófilo Otoni, Ipatinga, Varginha, Divinópolis, São Paulo/ABC, Rio de Janeiro, Vitória, Brasília, Goiânia…
- **Arestas (E):** trechos de BR entre nós **adjacentes fisicamente** (não grafo completo). Atributos: comprimento (km), BR(s), classe de pista, praças de pedágio contidas, nó de reabastecimento.
- **O destino da carga é o goal da busca.** Busca sob demanda (Dijkstra/A*) sobre os custos correntes — sem pré-computar todos os pares.

### 3.2 Peso da aresta — custo de usar a estrada

O peso é função do tempo `t`, da carga `c` e do veículo `v`:

```
w_e(t,c,v) = α·T_e(t,v) + β·C_e(t,v) + γ·R_e(t)
```

- **T_e** — tempo de travessia esperado: `(L_e / v_média)` com modificadores multiplicativos (congestionamento, clima, incidentes).
- **C_e** — custo operacional: combustível (∝ L_e e peso veículo+carga) + pedágio por praça. **Pedágio é componente aditiva**, não multiplicativa (custo fixo por travessia; os modificadores multiplicativos governam tempo e risco).
- **R_e** — risco, expresso em *horas equivalentes* para manter a soma dimensionalmente coerente: `f(taxa histórica de acidentes do trecho × hora × mês, clima atual, valor da carga)`.

**Modificadores multiplicativos** (recalculados em tempo real por componente):

| Modificador | Fonte | Efeito |
|---|---|---|
| `m_acid` | PRF (histórico + incidente ativo) | ↑ tempo e risco; bloqueio em caso grave |
| `m_sazon` | PRF/ANTT (mês, feriados, hora do dia) | ↑ tempo, volume de fluxo |
| `m_clima` | cadeia de Markov sazonal (INMET) | ↓ v_média, ↑ risco |
| `m_cong` | perfil horário de fluxo | ↑ tempo em picos |

### 3.3 Restrições duras (hard constraints)

- **Autonomia:** cada veículo tem autonomia `A_v`; a cadeia de arestas entre reabastecimentos nunca pode exceder o tanque. Modelagem: **grafo expandido por estado** — a busca roda no espaço `(nó, combustível restante)`; recarga é uma transição que custa tempo+dinheiro e só vale em nós. É o clássico RCSP (*gas station problem*); label-setting resolve **exato** em grafos desse tamanho. Autonomia não é penalidade: **é estado**.
- **Capacidade do veículo** (peso/volume) e **compatibilidade classe de carga ↔ tipo de veículo**: duras, filtram rotas/veículos antes da busca.
- **Jornada do motorista** (limite de horas dirigidas): recomendo incluir como 3ª dimensão do estado `(nó, combustível, horas dirigidas)` desde o v1 — cair na armadilha de esquecê-la depois é caro. Ver tópico 2.

---

## 4. Camada micro — o terminal (DES de filas)

**Fluxo:**
```
chegada externa → portaria/check-in → doca de recebimento (por classe)
→ conferência → armazenagem (capacidade finita) → [DECISÃO DE DESPACHO]
→ doca de expedição → carregamento → pátio de veículos → saída p/ rede macro
```

**Recursos finitos:** docas de recebimento/expedição por classe, equipes, empilhadeiras, vagas de pátio, balança.

**Classes de carga** (configuráveis — "qualquer tipo de carga" entra como classe nova, sem mudar código): seca, refrigerada, perigosa, granel, superdimensionada. Cada classe define: docas compatíveis, veículos compatíveis, tempo de serviço, SLA padrão.

**Decisões do agente micro:**
1. **Sequenciamento das filas** — FIFO vs prioridade preemptiva vs EDF (*earliest deadline first*), escolhível por estado.
2. **Alocação de docas e equipes** — inclusive rebalancear equipes entre recebimento e expedição conforme a fila.
3. **Consolidação/batching** — esperar formar lote para um destino (economia de viagem) vs despachar imediato (proteção de SLA).
4. **Reserva antecipada** — o mundo **anuncia** cargas prioritárias com antecedência (job pipeline, tópico 7); o agente reserva doca/equipe/veículo e pode antecipar o despacho de outras cargas para liberar capacidade na janela crítica.
5. **Quando despachar** — o ponto de acoplamento com a macro (seção 7).

---

## 5. Ground truth exógena (evolução das restrições)

Gerador estocástico **independente das decisões** (v1 — ver suposições, seção 12):

- **Incidentes/acidentes:** processo de Poisson não-homogêneo por aresta, `λ_e(mês, hora) = taxa_por_km(PRF) × L_e`. Severidade → duração de interdição (lognormal; PRF não publica tempo de bloqueio — aproximação declarada). Efeito: +tempo (desvio) ou bloqueio total.
- **Clima:** cadeia de Markov por macro-região, matriz de transição sazonal (INMET).
- **Fluxo:** perfil diurno determinístico + ruído; multiplicadores de feriado.
- **Chegadas de carga:** processo calibrado (volumes ANTT) + **anúncios** de chegada prioritária futura.

**Observabilidade:** o agente enxerga o **presente** perfeitamente e o **futuro** apenas como distribuições + anúncios. Ao perceber mudança (incidente à frente, chuva), re-otimiza e pode **re-rotear veículos em trânsito no próximo nó** (tópico 5).

---

## 6. Otimização preemptiva (lexicográfica)

Ordem de prioridade — cada nível só é otimizado sem degradar os anteriores:

1. **Viabilidade** — hard constraints: autonomia, capacidade, compatibilidade, jornada.
2. **SLA prioritário** — cargas críticas/altas dentro do prazo.
3. **Tempo ponderado** — Σ tempo porta-a-porta ponderado pela prioridade da carga.
4. **Custo operacional** — R$ (combustível, pedágio, horas de equipe, recargas).
5. *(Tie-break)* risco residual.

Implementação: **escalarização por perfil de carga** (α, β, γ distintos por prioridade) + label-setting com estado expandido. Fronteira de Pareto completa só se a escalarização se mostrar insuficiente (v2).

---

## 7. Acoplamento das camadas (dupla decisão)

Ciclo de vida de uma carga — cruza as duas simulações no mesmo relógio:

```
[ Mundo ]                  [ Terminal (micro) ]                 [ Rede (macro) ]
chegada anunciada ───────▶ reserva doca/equipe/veículo
chegada efetiva ─────────▶ fila → recebimento → conferência
                          ▶ DECISÃO DE DESPACHO ◀────── tabela custo/tempo por destino
                          ▶ carregamento (veículo v) ─▶ partida na rota escolhida
                                                        incidente à frente → re-rota em trânsito
                          ◀───────────────────────────── entrega no destino; veículo retorna
```

- **Macro → micro:** tabela de custo/tempo previsto por destino, recomputada a cada evento relevante, alimenta sequenciamento e batching.
- **Micro → macro:** deadlines de expedição, disponibilidade de veículos e composição de lotes viram os "pedidos de rota".
- **A decisão conjunta central do projeto:** *despachar agora pela rota disponível vs esperar janela/rota melhor, arriscando o SLA.* Todo o resto serve a esse trade-off.

### 7.1 Política fantasma (baseline contrafactual) — aceito, com emenda do usuário

Política ingênua de referência executada em paralelo à ativa, para **quantificar** a melhora do agente (não apenas demonstrá-la):

**Definição da política fantasma (naive):**
- **Rota:** caminho de **menor distância** (km puros) — ignora tempo, risco, custo e condições dinâmicas.
- **Terminal:** FIFO estrito, despacho imediato, sem consolidação, sem reserva antecipada, sem rebalanceamento de equipes.
- **Em trânsito:** nunca re-roteia — segue a rota original sofrendo o que vier.
- **Viabilidade:** mesma frota, mesmas hard constraints (autonomia/capacidade não são opcionais nem para o fantasma — a menor distância ainda obedece recarga).

**Dois modos de operação:**

1. **Sombra ao vivo (por decisão):** a cada decisão real, o orquestrador também computa a escolha fantasma e projeta sua trajetória sobre o mundo corrente. Consulta pura, sem efeito colateral: o veículo fantasma não consome doca, equipe, vaga nem combustível real; a projeção é atualizada quando o mundo muda.
2. **Replay pareado (por cenário):** execução completa do mesmo cenário (mesma seed, mesmos anúncios, mesma frota) com a política fantasma. Como as streams de RNG são separadas por subsistema e v1 não tem congestionamento induzido, **o mundo evolui identicamente nos dois runs** — qualquer divergência de resultado é atribuível exclusivamente à política (números aleatórios comuns → comparação pareada por carga).

**Métricas de comparação (fantasma → ativa):** SLA por prioridade, tempo ponderado porta-a-porta, custo R$/ton-km, exposição a risco (horas-equivalentes), dwell time, nº de re-roteamentos. Relatório por cenário com delta absoluto e %, pareado por carga.

*A politica fantasma é o termômetro do projeto: se o delta dela for ~0, a complexidade do agente ativo não está pagando o próprio custo.*

---

## 8. Arquitetura de software

```
┌──────────────────────────┐  JSON Lines (TCP/stdio)   ┌───────────────────────────┐
│  Núcleo Java 21          │ ◀───────────────────────▶ │  Orquestrador Python      │
│  - relógio + scheduler   │  STATE / EVENTS →         │  - políticas de decisão   │
│  - ground truth exógena  │  DECISION_REQ →           │  - experimentos em lote   │
│  - terminal + rede (DES) │  ◀ COMMANDS (pause/speed/ │  - análise (pandas)       │
│  - JGraphT, threads JVM  │     decision/policy)      │  - ETL (PRF/ANTT/OSM)     │
└────────────┬─────────────┘                           └────────────┬──────────────┘
             │ EVENT_STREAM (WebSocket)                             │
             ▼                                                      ▼
      Visualização: mapa macro (MapLibre/deck.gl) + planta do terminal + Gantt + KPIs
```

- **Por que Java no núcleo:** a JVM move os N veículos, gera a ground truth e coleta estatística em threads nativas, sem GIL. Honesto sobre o limite: o loop de eventos de um DES é **sequencial por natureza** (ordem temporal); o paralelismo Java acelera tudo ao redor dele, não o próprio loop.
- **FFI:** processo Java separado + **JSON Lines** (decisões são esparsas → overhead irrelevante; FlatBuffers/snapshot binário só se o profiling exigir). **JPype** (JNI) como fallback para depuração integrada. O Python fica fora do caminho quente: responde apenas em breakpoints de decisão.
- **Determinismo e replay:** todo evento relevante vai a log (Parquet/CSV); a visualização é *replay* do log — a mesma UI serve experimento e apresentação.

---

## 9. Visualização (essencial)

- **Mapa macro:** MapLibre GL com o grafo sobre tiles; arestas coloridas pelo peso atual (heatmap de custo/tempo), veículos animados (deck.gl TripLayer), ícones de incidente/clima; painel da decisão com **decomposição α/β/γ** (por que esta rota).
- **Planta micro:** vista esquemática (SVG/Canvas) — portaria, docas por classe com filas animadas, pátio, balança; **Gantt docas × tempo** com cargas coloridas por prioridade.
- **Sincronia:** relógio compartilhado (scrubber comum, pausa/velocidade); em pausa por decisão, cartões de escolha aparecem na camada correspondente.
- **KPIs ao vivo:** SLA por prioridade, dwell time, throughput, utilização de docas, R$/ton-km, re-roteamentos por evento.

### 9.1 Protótipo v1 do mapa (implementado — `frontend/prototype/`)

Decisões do usuário para esta fase (fechadas):
- **Contorno do país = outline básico, sem preenchimento** (linha sobre fundo escuro).
- **Arestas = retas geodésicas** entre nós — não seguem o traçado das rodovias 1:1.
- **Somente as cidades já escolhidas** no design (19 nós do corte v1); sem novas cidades.
- **Sem recursos/rotas/custos por enquanto** — o módulo governa apenas a visualização do grafo (geometria + estilos).
- Fonte de referência das rodovias: mapa **Rodoviário Federal (BIT/Ministério dos Transportes, 2023)**.

Implementação: SVG gerado por `graph.js` (dados `NODES`/`EDGES`, projeção equiretangular com moldura fixa lon [-75,-33] × lat [-35,7], contorno Natural Earth 50m em `assets/brazil_outline.js`), hospedado em `index.html` (standalone, abre via file://). Estilos usam as variáveis de tema do app com fallback para standalone. Verificação: render real em navegador + captura de página inteira (19 nós, 28 arestas, 10 rótulos de BR, contorno completo).

---

## 10. Fontes de dados (verificadas)

| Fonte | Uso | Status |
|---|---|---|
| **PRF — Dados Abertos (BAT)** | acidentes 2007–2026, CSV por ocorrência/pessoa: BR, km, município, data/hora, tipo, severidade → `λ_e`, perfis horários/mensais, severidade→duração | ✓ confirmado |
| **ANTT — Portal de Dados Abertos** | cargas (CIOT, RNTRC, VLT/FLT) → volume por corredor, frota típica, OD aproximado | ✓ confirmado |
| DNIT/ANTT — pedágios | tarifas por praça → `C_e` | a confirmar granularidade |
| INMET | normais climatológicas → matriz sazonal de clima | rotina |
| OSM | topologia e comprimentos das BRs → construção do grafo | rotina |
| Frota (tabela própria) | autonomia, capacidade, tipos — parâmetros configuráveis | modelagem |

---

## 11. Escopo v1 e fases

**Corte geográfico inicial (recomendação):** Sudeste + DF, ~60–100 nós e 150–250 arestas — denso o bastante para rotas alternativas reais (MG tem redundância natural: BR-040, BR-116, BR-262, BR-365, BR-381/Fernão Dias), pequeno o bastante para busca exata e visualização limpa. Brasil inteiro depois.

1. **F0 — Dados e grafo:** ETL PRF/ANTT/OSM, calibração de `λ_e`, perfis sazonais; grafo em JSON.
2. **F1 — Núcleo Java:** relógio, scheduler, mundo exógeno; replay **sem agente** (baseline natural do mundo).
3. **F2 — Macro:** RCSP com autonomia, rota estática, frota pequena; mapa básico.
4. **F3 — Micro:** terminal DES (docas, filas, classes); planta + Gantt.
5. **F4 — Acoplamento:** despacho/batching/prioridade; políticas gulosas de referência.
6. **F5 — Agente online:** re-rota em trânsito, reserva antecipada, **política fantasma (sombra ao vivo + replays pareados)**; experimentos baseline vs política; cenários (feriado, crise climática, pico).
7. **F6 — Polish:** KPIs, replay scrubber, relatórios.

---

## 12. Suposições declaradas

- **Sem congestionamento induzido** — decisões não alteram as taxas da ground truth (v1; redirecionamento em massa empurrando fluxo para a BR alternativa é extensão futura).
- **Informação perfeita do presente**, futuro estocástico.
- **Pedágio aditivo**; demais modificadores multiplicativos.
- **Reabastecimento em toda cidade-nó**; tempo de parada parametrizável.
- **Duração de interdição aproximada por severidade** (PRF não publica tempo de bloqueio).

---

## 13. Decisões (fechadas em 2026-10-23 — aceitas pelo usuário)

1. **Corte geográfico v1:** Sudeste + DF (~80 nós), Brasil depois. ✅
2. **Jornada do motorista como 3ª dimensão do estado** `(nó, combustível, horas dirigidas)` desde o v1. ✅
3. **Classes de carga** (5 iniciais, configuráveis) em vez de carga genérica. ✅
4. **Protocolo FFI:** processo Java separado + JSON Lines; JPype só se doer. ✅
5. **Re-rota em trânsito** em nós intermediários + **política fantasma de menor distância** como métrica de comparação (sombra ao vivo por decisão + replay pareado por cenário — seção 7.1). ✅
6. **3 níveis de prioridade** (crítica/alta/padrão) com SLA alvo por nível. ✅
7. **Anúncio de cargas prioritárias** com lead time configurável (4–24 h) — alimenta a reserva antecipada do terminal. ✅
8. **Frontend web** (MapLibre/deck.gl via WebSocket do núcleo) para as duas camadas. ✅

### 9.2 Zoom/pan + tabelas de dados + painel de inspeção (implementado)

Decisões do usuário para esta fase (fechadas):
- **Zoom no mapa** — roda do mouse (ancorado no cursor), arrastar = pan, duplo clique/botão ⌂ = reenquadrar, teclas +/−/0. Contra-escala de rótulos e nós para legibilidade.
- **Tabelas de dados** (esquemas documentados em `data.js`):
  - **CAMINHÃO** (objeto "veículo"): tipo, velocidade média, peso máx., tara, capacidade de combustível, consumo, autonomia (derivada), combustível atual, jornada/limite, status, nó atual.
  - **CARGA**: classe, peso, origem, destino, criada_em, prazo limite (SLA por prioridade: crítica 24 h, alta 48 h, padrão 72 h), prioridade (3 níveis), valor, status.
  - **EMPRESA**: tipo (agroindústria, siderurgia, química…), cidade-sede (nó), porte, classes de carga que envia, volume mensal.
- **Empresas fantasia**: 3 por capital (BHZ, SP, RJ, VIT, BSB, GYN) e 1–2 por cidade regional — 36 no total, nomes fictícios temáticos; frota derivada do porte (grande=3, médio=2, pequeno=1 → 71 caminhões) e 15 cargas de exemplo. Geração determinística (PRNG semeado, mulberry32) — mesmos dados a cada abertura.
- **Painel de inspeção**: clique num nó abre painel lateral com empresas da cidade, ficha de cada caminhão da frota e cargas com origem/destino no nó; se o nó ficar oculto atrás do painel, a câmera desliza para alinhá-lo.

Notas de implementação: SVG com grupo `world` transformável (translate+scale), conversão client→viewBox via `getScreenCTM` (robusta ao letterbox de `preserveAspectRatio`), hit-test de clique resolvido em coordenadas do mundo dentro do `graph.js` (evento `graphclick` com `nodeId`). `window.__g` exposto para testes.

### 9.3 Motor de simulação do protótipo (implementado — `sim.js`)

Antecipa a semântica do núcleo Java (F1+) em JS client-side. Componentes:

- **Relógio paced**: pausa (▶/espaço), velocidades 1×/60×/600×; subticks de ≤30 min simulados; eventos consomem tempo simulado.
- **Ground truth exógena**: incidentes por processo estocástico semeado (1 a cada 20–80 min de simulação, aresta sorteada ∝ km, 12% graves com penalidade ×6, duração 2–8 h) — independentes das decisões; exibidos como arestas tracejadas laranja/vermelho no mapa. Novas cargas nascem a cada 1,5–3 h nas empresas.
- **Despacho ativo**: fila por prioridade > FIFO; caminhão compatível (classe↔tipo, peso) com maior autonomia na origem; rota de **menor tempo** (Dijkstra com penalidade de incidente ×2,5/×6); reabastecimento planejado no grafo quando a perna excede a autonomia (30 min); descanso obrigatório ao fechar 10 h de jornada (8 h); repositioning vazio de volta à sede.
- **Política fantasma (§7.1)**: contrafactual de **menor distância** por despacho, **replayado no mesmo mundo** — sofre os mesmos incidentes históricos nos instantes em que os encontraria, e parte com o **mesmo combustível e a mesma jornada residual** do caminhão real (comparação simétrica; sem vieses de tanque cheio/motorista descansado). Delta fantasma→ativa por entrega alimenta o KPI "Δ fantasma".
- **KPIs ao vivo** (barra inferior): entregues/atrasadas, SLA %, em trânsito, fila, incidentes ativos, Δ fantasma médio; log de eventos (☰); relógio de parede da simulação.

Verificação (3 execuções independentes de 96 h simuladas): 21–23 entregas, SLA 67–87%, hard constraints respeitadas em todas (jornada ≤10 h, combustível ≥0), delta heterogêneo e honesto (−1,6 a +0,7 h médios; ativa ganha quando incidentes atingem a rota curta). Simplificações declaradas: sem terminal físico (docas = tempos fixos), fantasma por despacho (não replay pareado completo), reabastecimento em qualquer cidade-nó.

### 9.6 Mapa 3D (implementado — `view3d.js`)

Substituição do renderer SVG por Three.js r128 (local, `assets/vendor/`), mantendo os mesmos dados e o mesmo motor:

- **Cena**: contorno do Brasil (Natural Earth 50m), grafo de arestas azuis, nós cilíndricos, rótulos com halo (sprites de canvas), grid de chão para vender a perspectiva.
- **Caminhões**: wireframe derivado do `caminhao.glb` do usuário (frente +X, pivô no chão; wireframe de 1400 arestas amostradas embutido em `assets/caminhao_wireframe.js`). Cores por estado idênticas às dos triângulos SVG (azul viagem, amarelo manuseio, roxo descanso, cinza ocioso).
- **Câmera orbital manual**: botão esquerdo = orbitar; Shift+esquerdo/botão do meio = pan; roda = zoom; duplo clique = reenquadrar. Clique curto sem arrasto resolve o nó mais próximo (mesma interação do SVG).
- **Enquadramento calibrado**: target (982, 0, 671) e radius 2500 (phi 0.8 rad = ~36° do horizonte) — Brasil ocupa ~51% da largura, centro do bbox do contorno no centro da tela. Calibração feita por loop fechado de projeção (unproject do centro ↔ mover target).
- Bugs pegos: `insertBefore` com pai errado abortava a montagem; TDZ mascarando a causa; fog dava a impressão de contorno "apagado"; far-plane 6000 < radius 8500 clipava a cena inteira (canvas preto); centro do grafo ≠ centro do contorno (o Brasil não é simétrico em torno da origem da moldura).

### 9.4 Segunda visualização (Terminal) e visibilidade do agente (implementado)

- **Aba Terminal** (plant + Gantt): planta esquemática do centro logístico de BH — docas de recebimento R1–R3, pátio com 12 vagas (cargas em espera visíveis com id), estrada de acesso, docas de expedição E1–E3; **Gantt de docas** (janela de 12 h, barras coloridas por prioridade, tooltip por carga).
- **Terminal físico no motor** (para haver o que visualizar): 3 docas de recebimento (45 min) + 3 de expedição + 12 vagas de pátio; chegada ao hub disputa doca — sem doca livre, a carga vai ao pátio (`no_hub`).
- **Decisões do agente visíveis nas duas camadas**: feed `🤖 Decisões` com cada escolha — **macro** (rota escolhida, com motivo: desvio por incidente / rota mais longa por condição / menor tempo, e comparação implícita com a fantasma) e **micro** (alocação de doca / espera no pátio). Clicar numa decisão macro **destaca no mapa** a rota ativa (verde) sobreposta à rota fantasma (rosa tracejado).
- Verificação real: 63 decisões em 96 h (42 macro + 21 micro), 6 docas montadas, 12 vagas de pátio, barras de Gantt no DOM, destaque verde/rosa no mapa funcionando. Bugs pegos: `insertBefore` com pai errado (hiLayer abortava a montagem de tudo abaixo — sintoma mascarado como TDZ de `PRIO_BAR`/`hiEdges`), TDZ por ordem de execução no script inline (render inicial isolado da montagem), `#map` com `visibility:hidden` empurrando a planta para fora da tela (`display:none`), pátio sob o Gantt (layout compactado à esquerda).

### 9.5 Fluxo hub-and-spoke com destino funcional (implementado)

Decisão do usuário: **toda carga passa pelo terminal de BH**, e o destino de cada carga é uma **empresa receptora** cuja FUNÇÃO absorve a classe da carga — não uma cidade sorteada.

- **`DESTINO_POR_CLASSE`** (`data.js`): mapa classe→funções receptoras (ex.: granel → siderurgia/agroindústria/frigorífico; perigosa → química; refrigerada → frigorífico/farmacêutica/atacado; superdimensionada → automotiva/operador logístico; seca → atacado/têxtil/bebidas/…). `sortearReceptor()` sorteia a empresa receptora entre as do tipo funcional, excluindo a própria expedidora e sua cidade.
- **Ciclo da carga**: coleta na origem → viagem até BHZ → **transbordo no terminal (1,5 h)** → despacho da 2ª perna → entrega no destino. Estados: `aguardando_coleta → coleta_em_curso → no_hub → coleta_em_curso (2ª perna) → entregue/atrasada`.
- **Fantasma pela mesma topologia**: o contrafactual de menor distância também roda origem→[BHZ]→destino e paga o mesmo transbordo (compara estratégia de rota, não a topologia hub — regra do usuário vale para ambos).
- **Rota vs capacidade**: a fila no hub (espera por caminhão disponível além do transbordo) é efeito de **capacidade da frota**, não de rota — descontada do delta, medida como KPI próprio (`filaHubMediaH`, ~6–9 h nas execuções) e logada por carga (`⏳`). Sem essa separação, o gargalo da frota contaminava a métrica de rota (−6 a −11 h espúrios).
- Painel do nó: carga exibe expedidor, **receptor**, rota `origem → [BHZ] → destino` e status do pipeline.

Verificação (3×96 h): 100% das cargas com hub=BHZ (seed normalizado incluso), destino funcional válido em 100% das entregas, zero carga na cidade do expedidor, hard constraints ok; delta de rota −0,7 a −1,6 h (honesto). Bug pego no teste: `planoAtivo` devolvendo perna vazia quando origem==destino (BHZ→BHZ) — guard `!legs.length`.

