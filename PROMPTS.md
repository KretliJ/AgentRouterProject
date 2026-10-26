# PROMPTS

Registro cronológico dos prompts do usuário (Jonas) durante a fase de modelagem e a resposta do agente (Hermes / GLM, resumida). Objetivo: rastreabilidade das decisões conceituais do projeto — cada prompt que alterou o design gerou uma emenda documentada em `MODELAGEM.md`.

---

## 1 — Proposta inicial

> **Prompt:** "Proposta: Simulação e modelagem de centro logístico rodoviário que trata qualquer tipo de carga. Objetivo: Otimizar de forma preemptiva para decisões de eficiência dentro das restrições. Restrições: Distância, Taxa de acidentes, Efeitos Sazonais, Tempo de Chegada, Autonomia e Características dos Veículos, Prioridade da Carga. Conceito: Grafo onde o centro é a capital onde reside o centro logístico (Belo Horizonte). Arestas são as BRs onde existem dados para alimentar as restrições. Nós são outras cidades (à priori, capitais estaduais e capitais regionais, como Governador Valadares, o ABC paulista, entre outras relevantes). Goal para o algoritmo de busca será o destino da carga. O agente deve não apenas gerenciar decisões sobre os tempos de atendimento dentro do terminal logístico, como decidir as rotas de cargas de acordo com o peso das arestas (custo total de usar uma estrada). Modificadores: As restrições podem ser desenhadas como modificadores multiplicativos do peso de uma aresta que representa uma estrada. Ou seja, uma modelagem de duas simulações concorrentes com dupla decisão, micro dentro do terminal de carga, carga para rotas de entrega. Visualizações gráficas das duas camadas são essenciais. Antes de programar qualquer coisa, amadureça esta modelagem do projeto."

**Resposta (resumo):** criado `MODELAGEM.md` (design v1, 13 seções). Estruturou as duas camadas (micro terminal / macro grafo de BRs); peso da aresta como `α·tempo + β·custo + γ·risco` com risco em horas-equivalentes e pedágio aditivo; autonomia como **estado** da busca (grafo expandido `(nó, combustível)`), não penalidade; relógio como DES *paced*; ground truth exógena calibrada em dados reais (PRF/ANTT verificados); arquitetura Java (núcleo DES) + Python (orquestrador) com JSON Lines; frontend web MapLibre/deck.gl. Encerrou com 8 tópicos numerados para accept/reject do usuário.

---

## 2 — Evoluções conceituais (interrompeu a resposta inicial)

> **Prompt:** "O relógio de ambas as simulações é em tempo real. Pode ser pausado para tomar decisões e acelerado para efeitos de simulação, mas os eventos devem necessariamente tomar o tempo que levam. As restrições são evolutivas. Uma escolha de caminho não 'trava' as mudanças de condições, que são simuladas à parte como 'ground truth dinâmica'. Restrições de autonomia são hard-constraints. Saber que um trabalho de prioridade está vindo em x horas deve ser levado em conta para gestão micro do terminal. O núcleo de simulação deve ser escrito em Java com FFI para python como orquestrador para evitar bloqueio de GIL."

**Resposta (resumo):** incorporadas ao `MODELAGEM.md`: relógio real pausável/acelerável com durações imutáveis (streams de RNG separadas por subsistema para preservar trajetória estocástica); ground truth como gerador exógeno independente das decisões, com observabilidade perfeita do presente e probabilística do futuro; autonomia tratada como hard-constraint estrutural; anúncio antecipado de carga prioritária alimentando reserva de recursos no terminal (decisão micro nº 4); arquitetura definitiva Java 21 + FFI Python.

---

## 3 — Fechamento dos tópicos + política fantasma

> **Prompt:** "Sim para todos mas: 5- O agente deve também mandar uma 'versão fantasma' de uma decisão feita com base apenas na menor distância possível para termos a métrica para comparar se o agente ativo oferece melhora."

**Resposta (resumo):** aceitos os 8 tópicos (seção 13 fechada). Criada a **seção 7.1 — Política fantasma**: baseline ingênuo (menor distância em km, FIFO estrito, sem re-rota, mesmas hard-constraints) rodando em dois modos — **sombra ao vivo** (projeção contrafactual por decisão, sem consumir recursos reais) e **replay pareado** (mesma seed → mundo idêntico; delta de KPI atribuível só à política). Métricas de comparação pareadas por carga. F5 do roadmap atualizado.

---

## 4 — Documentação

> **Prompt:** "Gere o README.md"

**Resposta (resumo):** criado `README.md` (porta de entrada do projeto): visão geral com tabela macro/micro, relógio, ground truth, peso da aresta, hard constraints, otimização lexicográfica, política fantasma, arquitetura, fontes de dados, roadmap F0–F6, estrutura de pastas planejada e comandos de execução. `MODELAGEM.md` permanece a autoridade conceitual.

---

## 5 — Documentação (attribution + histórico)

> **Prompt:** "Gere também o ATTRIBUTION.md e o PROMPTS.md. O segundo você deverá colocar os prompts que eu enviei e qual foi sua resposta (de forma resumida)"

**Resposta (resumo):** criado `ATTRIBUTION.md` (créditos e licenças: PRF, ANTT, DNIT, INMET, OSM/ODbL com obrigação de crédito visual, software de terceiros e sugestão de citação ABNT) e este `PROMPTS.md`.

---

## 6 — Visualização básica do grafo

> **Prompts:** "Vamos construir primeiro a visualização básica - O mapa e as capitais, as arestas como rodovias federais. A cada novo prompt, atualize também a documentação com as instruções anteriores" · "O outline do mapa pode ser um outline básico do país sem preenchimento. As arestas podem ser retas, não precisam seguir a posição das rodovias 1:1" · "Evite pensar nos recursos de cada rota no momento. Gere apenas o código que governa a visualização do grafo." · "Se ajudar, aqui um PDF das principais rodoviais federais. Use apenas as cidades que já escolheu" (PDF: *Rodoviario Federal 2023.06.29.pdf*) · fonte indicada: portal de mapas do BIT/MTrans.

**Resposta (resumo):** criado o protótipo em `frontend/prototype/` — `graph.js` (dados `NODES` 19 cidades / `EDGES` 28 arestas de BRs confirmadas, projeção equiretangular, render SVG puro sem dependências) + `index.html` standalone + `assets/brazil_outline.js` (Natural Earth 50m, domínio público). Contorno do Brasil como linha sem preenchimento, arestas retas, rótulos de BR por cadeia, BH destacado como hub. Um bug de moldura de projeção (frame 25° vs intervalo real de 35° de latitude) foi detectado na verificação visual e corrigido (moldura 42°×42° cobrindo o país). Verificado com render real em navegador + captura de página inteira. Documentação atualizada: MODELAGEM §9.1 (decisões desta fase), ATTRIBUTION (BIT/MTrans + Natural Earth), README (estrutura).

---

## 7 — Zoom, tabelas de dados e painel de inspeção

> **Prompt:** "Okay, funciona! Agora vamos fazer o seguinte: 1- Adicionar função de zoom no mapa 2- Definir tabelas que serão úteis para ler as informações necessárias depois: Objeto veículo = caminhão, carga. Objeto caminhão = Velocidade, peso max, autonomia, combustível atual, etc. Objeto carga = Peso, origem, destino, data de vencimento/limite, prioridade, etc. Objeto Empresa = tipo, localização, porte, carga que envia, etc (crie empresas fantasia, umas 3 para cada capital, 1 ou 2 para cada outra cidade."

**Resposta (resumo):** zoom/pan completo (roda ancorada no cursor, arrastar, duplo clique/⌂ para reenquadrar, teclas +/−/0; contra-escala de nós e rótulos). Criado `data.js` com os esquemas documentados — CAMINHÃO (velocidade, peso máx., tara, tanque, consumo, autonomia derivada, combustível atual, jornada, status), CARGA (classe, peso, origem, destino, criada_em, prazo limite com SLA por prioridade, valor, status) e EMPRESA (tipo, nó-sede, porte, cargas que envia, volume mensal) — e dados fantasia determinísticos: 36 empresas (3 por capital, 1–2 por regional), 71 caminhões (frota por porte) e 15 cargas. Painel de inspeção: clique num nó mostra empresas, fichas de caminhões e cargas do nó; câmera desliza se o nó ficar atrás do painel. Bugs pegos na verificação: `setPointerCapture` com ponteiro sintético (try/catch), svg sem altura fixa transbordando a viewport (letterbox + `getScreenCTM`), e re-render em teste substituindo listeners (exposto `window.__g`). Documentação: MODELAGEM §9.2.

---

## 8 — Motor de simulação (funcionalidades esperadas)

> **Prompt:** "Agora implemente as funcionalidades esperadas"

**Resposta (resumo):** criado `sim.js` — relógio paced (pausa/1×/60×/600×, subticks de 30 min), ground truth exógena (incidentes estocásticos por aresta, 12% graves, novas cargas a cada 1,5–3 h), despacho ativo (prioridade>FIFO, menor tempo via Dijkstra com penalidade de incidente, reabastecimento planejado, descanso de jornada, repositioning), política fantasma por despacho **replayada no mesmo mundo** (mesmos incidentes históricos, mesmo combustível e jornada residual do caminhão real) e KPIs ao vivo com log. UI: barra de simulação (▶, velocidade, relógio, entregues/SLA/trânsito/fila/incidentes/Δ fantasma), caminhões animados no mapa e arestas de incidente tracejadas. Verificado com 3 execuções de 96 h (SLA 67–87%, hard constraints ok, delta −1,6 a +0,7 h). Bugs pegos em teste: fantasma injusta (replay sem descanso/descarga → corrigido p/ simetria total), jornada estourando por overshoot de subtick (clamp), reabastecimento de emergência instantâneo (virou parada de 30 min). Documentação: MODELAGEM §9.3.

---

## 9 — Fluxo hub-and-spoke com destino funcional

> **Prompt:** "Vamos colocar o seguinte funcionamento: Cada empresa tem um destino para sua carga, que depende de qual é a função da empresa receptora. Todas as empresas enviam pelo terminal de BH."

**Resposta (resumo):** modelo hub-and-spoke: toda carga circula origem → [BHZ] → destino, com transbordo de 1,5 h no terminal. Criado `DESTINO_POR_CLASSE` (classe → funções receptoras: granel→siderurgia/agro/frigorífico, perigosa→química, refrigerada→frigorífico/farma, etc.) e `sortearReceptor()`, que sorteia a empresa receptora pela função, fora da cidade de origem. Estados da carga: aguardando_coleta → coleta_em_curso → no_hub → 2ª perna → entregue/atrasada. Fantasma também roda pela topologia (paga o mesmo transbordo). A fila por caminhão no hub (5,7–9,3 h de média) foi separada como KPI de capacidade (`filaHubMediaH`), fora do delta de rota (que caiu de −6/−11 h espúrios para −0,7/−1,6 h honestos). Seed de 15 cargas normalizado para o novo pipeline. Bugs pegos: perna vazia em origem==destino (BHZ→BHZ) e seed antigo violando a regra do hub. Documentação: MODELAGEM §9.4.

