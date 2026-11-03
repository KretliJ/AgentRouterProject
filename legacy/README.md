# Visualização conceitual web (versão legacy)

> **Esta pasta é um artefato congelado.** É a versão web original do AgentRouter — mantida para demonstração visual e conceitual do sistema enquanto o núcleo real (Java + Python, na raiz do repositório) é implementado. **Não recebe mais desenvolvimento.** Abra `index.html` direto no navegador (`file://`, zero dependências) para ver a simulação funcionando.

---

## O que esta versão é

Uma **simulação funcional completa do design**, implementada inteiramente em JavaScript client-side. Ela já contém todos os conceitos do sistema real, em miniatura:

| Conceito do sistema real | Onde está aqui |
|---|---|
| Relógio paced (pausa/1×/60×/600×) | `sim.js` — subticks de ≤30 min; eventos consomem tempo simulado |
| Ground truth exógena | Incidentes estocásticos por aresta (12% graves, ×6); novas cargas a cada 1,5–3 h |
| Grafo rodoviário | 19 nós / 28 arestas de BRs reais (fonte: mapa Rodoviário BIT/MTrans 2023), contorno Natural Earth |
| Fluxo hub-and-spoke | Toda carga: origem → **[BHZ]** → destino, transbordo de 1,5 h |
| Destino funcional | Empresa receptora escolhida pela FUNÇÃO (`DESTINO_POR_CLASSE` em `data.js`) |
| Despacho ativo | Fila por prioridade > FIFO; rota de menor tempo (Dijkstra + penalidade de incidente ×2,5/×6) |
| Hard constraints | Autonomia (reabastecimento planejado, 30 min), jornada de 10 h (descanso de 8 h), compatibilidade carga↔veículo |
| Política fantasma | Contrafactual de menor distância **replayado no mesmo mundo** (mesmos incidentes históricos, mesmo combustível/jornada do caminhão real) |
| Terminal micro | 3 docas de recebimento + 3 de expedição + pátio de 12 vagas (decisões de alocação) |
| KPIs + Δ fantasma | SLA, entregues/atrasadas, fila no hub (capacidade ≠ rota), log de eventos |
| Visualizações | Mapa 3D (Three.js), planta do terminal, Gantt de docas, feed de decisões do agente |

## Como funciona, em uma passada

### Relógio e determinismo
O motor é um **loop de eventos discretos *paced***: um `setInterval` de 250 ms de tempo real dispara ticks que avançam o relógio de simulação em `250 ms × velocidade` (1×, 60×, 600×). Ticks longos são fatiados em subticks de ≤30 min para que movimentos e prazos não "pulsem". Pausar só para o intervalo — as durações dos eventos nunca mudam. O PRNG é semeado (`mulberry32`), então a mesma sessão é reproduzível.

### Duas camadas, um acoplamento
- **Macro**: quando uma carga fica pronta para despacho, o agente roda um **Dijkstra** sobre o grafo com peso = tempo de travessia, multiplicado pela penalidade do incidente ativo em cada aresta. O resultado define a rota; sobre ela, um planejador insere reabastecimentos onde a autonomia estouraria e pausas de descanso quando a jornada fecha 10 h.
- **Micro**: a carga chega ao hub e disputa uma doca de recebimento. Sem doca livre → pátio (capacidade finita). Após o transbordo, disputa caminhão de expedição para a 2ª perna.

O **acoplamento** é a decisão central: *despachar agora pela rota disponível, ou esperar*. Nesta versão a política é "despachar o quanto antes"; no sistema real, esse é o ponto onde a otimização preemptiva entra de verdade.

### A política fantasma (o termômetro)
Para cada despacho, o agente também computa o contrafactual de **menor distância** — a rota que uma política ingênua tomaria — e o **replaya no mesmo mundo**: a rota fantasma sofre os mesmos incidentes históricos nos mesmos instantes, parte com o mesmo combustível e a mesma jornada residual do motorista real, paga os mesmos transbordos e descansos. O delta fantasma→ativa, por carga entregue, é o KPI **Δ fantasma** — a medida de quanto as decisões "inteligentes" valem. A fila por caminhão no hub é descontada dos dois lados e medida à parte (é limitação de frota, não de rota).

### Ground truth independente
Incidentes nascem por processo estocástico (probabilidade proporcional ao km da aresta), sem qualquer relação com as decisões — o agente **reage**, não controla. Novas cargas chegam pelo mesmo mecanismo. Isso garante que a comparação fantasma→ativa seja justa: ambos veem o mesmo mundo.

## Arquivos

```
├── index.html    # UI: abas Mapa/Terminal/Decisões/Gantt/Legenda, barra de simulação
├── graph.js      # projeção equiretangular + helpers (mantido p/ referência de moldura)
├── data.js       # tabelas CAMINHÃO/CARGA/EMPRESA, 36 empresas fantasia (PRNG semeado)
├── sim.js        # o motor completo (relógio, mundo, despacho, fantasma, docas, KPIs)
├── view3d.js     # renderer Three.js (cena 3D, caminhões GLB, órbita, render sob demanda)
└── assets/       # contorno do Brasil, wireframe/GLB do caminhão, Three.js local
```

## O que esta versão NÃO é

- Não é o núcleo definitivo: sem persistência, sem multi-thread da JVM, sem replay de log binário, sem calibração com dados reais da PRF/ANTT (usa processo estocástico sintético calibrado à mão).
- A política do agente é **gulosa explicável** (menor tempo, prioridade FIFO), não otimização verdadeira — serve de baseline para medir o ganho das políticas do sistema real.
- Uma aresta = um trecho reto entre nós; o traçado real das rodovias entra no F0 do sistema real (OSM).
