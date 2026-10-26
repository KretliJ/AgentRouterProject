# ATTRIBUTION

Créditos e licenças dos dados e software de terceiros usados pelo AgentRouter.

> **Nota:** este arquivo será atualizado na fase **F0 (ETL)**, quando cada conjunto de dados for baixado — aí serão fixadas a URL exata do snapshot, a data de download e a licença confirmada no próprio arquivo.

---

## Autores

### Jonas (KretliJ) — autoria e direção
- **Concepção do projeto:** proposta original do centro logístico rodoviário de Belo Horizonte, das duas simulações concorrentes (micro/terminal + macro/grafo) e da dupla decisão.
- **Formulação do modelo:** restrições do problema (distância, acidentes, sazonalidade, tempo de chegada, autonomia/veículos, prioridade), modificadores multiplicativos do peso da aresta e busca tendo o destino da carga como goal.
- **Evoluções conceituais (decisões de design):** relógio em tempo real pausável/acelerável com durações imutáveis; ground truth dinâmica exógena às decisões; autonomia como hard-constraint; uso do aviso antecipado de carga prioritária na gestão micro do terminal; núcleo em Java com FFI para Python (anti-GIL); **política fantasma de menor distância como métrica de comparação** do agente ativo.; **fluxo hub-and-spoke pelo terminal de BH com destino funcional** (empresa receptora define o destino pela sua função)
- **Curadoria:** aceitação/rejeição dos tópicos de modelagem e validação de todo o design fechado em `MODELAGEM.md`.

### Hermes Agent (Nous Research) · modelo GLM (Z.ai) — design assistido e documentação
- **Estruturação da modelagem:** consolidação técnica do design em `MODELAGEM.md` — peso da aresta `α·T + β·C + γ·R` com risco em horas-equivalentes, autonomia/jornada como estado do grafo expandido (label-setting exato), otimização preemptiva lexicográfica, semântica do DES *paced* com streams de RNG por subsistema.
- **Arquitetura de software:** núcleo Java 21 (DES) ↔ orquestrador Python via JSON Lines, frontend web MapLibre/deck.gl, logs de replay determinísticos.
- **Especificação da política fantasma** (sombra ao vivo + replay pareado) a partir da diretriz do autor.
- **Documentação:** `README.md`, `ATTRIBUTION.md`, `PROMPTS.md`; verificação das fontes de dados (portais PRF e ANTT).

---

## Dados

### PRF — Polícia Rodoviária Federal (acidentes)
- **Portal:** https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf
- **Uso:** acidentes 2007–2026 (BAT) — BR, km, município, data/hora, tipo, severidade → taxas por aresta (`λ_e`), perfis horários/mensais, severidade → duração de interdição.
- **Licença:** dados abertos institucionais (uso, reutilização e redistribuição livres, conforme LAI e Decreto nº 8.777/2016). Texto legal exato a confirmar no download.

### ANTT — Agência Nacional de Transportes Terrestres
- **Portal:** https://dados.antt.gov.br
- **Uso:** volumes de carga por corredor (CIOT, RNTRC), frota típica.
- **Licença:** portal de dados abertos; termos exatos a confirmar por dataset.

### BIT / Ministério dos Transportes — Mapa Rodoviário Federal (2023)
- **Portal:** https://www.gov.br/transportes/pt-br/assuntos/dados-de-transportes/bit/mapas/
- **Uso:** referência da topologia das rodovias federais do grafo v1 (arestas/nós) e do protótipo de visualização.
- **Licença:** documento público do governo federal; termos a confirmar.

### Natural Earth
- **Uso:** contorno do Brasil no mapa (polígono ne_50m simplificado).
- **Licença:** **domínio público** (https://www.naturalearthdata.com).

### DNIT / ANTT — Pedágios
- **Uso:** tarifas por praça → componente de custo `C_e`.
- **Licença:** a confirmar na coleta.

### INMET — Instituto Nacional de Meteorologia
- **Portal:** https://portal.inmet.gov.br
- **Uso:** normais climatológicas → matrizes sazonais da cadeia de Markov de clima.
- **Licença:** a confirmar na coleta.

### OpenStreetMap
- **Uso:** topologia e comprimentos das rodovias (construção do grafo).
- **Licença:** **ODbL 1.0** — © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).
- **Obrigação visual:** qualquer mapa que use tiles OSM deve exibir o crédito *"© OpenStreetMap contributors"* (o frontend via MapLibre já carrega esse atributo por padrão — não remover).

---

## Software de terceiros

| Componente | Uso no projeto | Licença |
|---|---|---|
| **JGraphT** | grafo e algoritmos de rota no núcleo Java | dual LGPL 2.1 / EPL 2.0 |
| **MapLibre GL JS** | mapa macro interativo | BSD-3-Clause |
| **deck.gl** | camadas de visualização (TripLayer, heatmap de arestas) | MIT |
| **pandas / NumPy** | ETL, análise e experimentos no orquestrador | BSD-3-Clause |
| **Apache Arrow (pyarrow)** | logs de replay em Parquet | Apache-2.0 |
| **Java 21 / Gradle** | runtime e build do núcleo | GPL+CE / Apache-2.0 |

---

## Sugestão de citação (uso acadêmico)

Para publicações derivadas, citar as fontes de dados pelo portal institucional (ex.: *"POLÍCIA RODOVIÁRIA FEDERAL. Dados abertos: acidentes. Brasília, 2026. Disponível em: <URL>. Acesso em: <data>."* — formato ABNT) e o OpenStreetMap pelo seu termo padrão. Este bloco será refinado na F0 com os snapshots efetivamente usados.
