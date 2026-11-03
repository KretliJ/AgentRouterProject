// ============================================================================
// AgentRouter — Tabelas de dados v1 (seed do protótipo)
// ============================================================================
// Fluxo de carga (decisão do usuário, 2026-10-26): TODA carga passa pelo
// terminal de BH. Cada empresa tem destinos que dependem da FUNÇÃO da
// empresa receptora: a carga flui de um tipo funcional para outro
// (ex.: mineradora -> siderurgia; agroindústria -> atacado/frigorífico).
// A rota efetiva é origem -> BHZ (coleta) -> destino (entrega).
// Define os esquemas das três tabelas centrais (CAMINHÃO, CARGA, EMPRESA) e
// popula dados-fantasia determinísticos (PRNG semeado — mesma seed => mesmos
// dados). Nenhuma lógica de rota/custo aqui: só estrutura + dados legíveis.
//
// Empresas fantasia (decisão do usuário, 2026-10-24):
//   - 3 empresas por capital (BHZ, SP, RJ, VIT, BSB, GYN)
//   - 1–2 empresas por cidade regional
// Frota: derivada do porte (grande=3 caminhões, médio=2, pequeno=1).
//
// Base temporal da simulação (T0): 2026-10-24T08:00:00-03:00.

// ----------------------------------------------------------------------------
// TABELA: EMPRESA  (gera e recebe carga)
// ----------------------------------------------------------------------------
// | campo            | tipo            | descrição                             |
// |------------------|-----------------|---------------------------------------|
// | id               | string (PK)     | "EMP-01"                              |
// | nome             | string          | razão/nome fantasia                   |
// | tipo             | enum            | agroindustria|siderurgia|quimica|     |
// |                  |                 | frigorifico|textil|farmaceutica|      |
// |                  |                 | automotiva|mineracao|atacado_varejo|  |
// |                  |                 | operador_logistico|madeireira|        |
// |                  |                 | fruticultura|bebidas|agropecuaria     |
// | no               | string (FK Nó)  | cidade-sede (id do grafo)             |
// | porte            | enum            | grande|medio|pequeno                  |
// | cargas_tipos     | enum[]          | classes de carga que costuma enviar   |
// | volume_mensal_tn | number          | toneladas/mês (calibração futura)     |
// ----------------------------------------------------------------------------
// TABELA: CAMINHÃO  (objeto "veículo" = caminhão da frota da empresa)
// ----------------------------------------------------------------------------
// | campo           | tipo      | descrição                                 |
// |-----------------|-----------|-------------------------------------------|
// | id              | string(PK)| "CAM-001"                                 |
// | placa           | string    | Mercosul LLL9L99 (fictícia)               |
// | empresa_id      | string(FK)| dono da frota                             |
// | tipo            | enum      | bau|sider|refrigerado|tanque|graneleiro|  |
// |                 |           | porta_conteiner|bitrem                    |
// | vel_media_kmh   | number    | velocidade média de cruzeiro              |
// | peso_max_ton    | number    | capacidade útil de carga                  |
// | tara_ton        | number    | peso próprio                              |
// | cap_comb_l      | number    | capacidade do tanque (litros)             |
// | consumo_km_l    | number    | km por litro                              |
// | autonomia_km    | number    | cap_comb_l × consumo_km_l (tanque cheio)  |
// | comb_atual_l    | number    | combustível no momento                    |
// | jornada_h       | number    | horas dirigidas na janela atual           |
// | limite_jornada_h| number    | teto legal/modelado (10 h)                |
// | status          | enum      | disponivel|em_viagem|carregando|manutencao|
// | no_atual        | string(FK)| nó do grafo onde está                     |
// ----------------------------------------------------------------------------
// TABELA: CARGA
// ----------------------------------------------------------------------------
// | campo            | tipo        | descrição                            |
// |------------------|-------------|--------------------------------------|
// | id               | string (PK) | "CARGA-001"                          |
// | empresa_id       | string (FK) | expedidor                            |
// | classe           | enum        | seca|refrigerada|perigosa|granel|    |
// |                  |             | superdimensionada                    |
// | peso_ton         | number      | peso da carga                        |
// | origem           | string (FK) | nó de coleta                         |
// | destino          | string (FK) | nó de entrega (goal da busca)        |
// | criada_em        | ISO string  | instante da simulação (T0-based)     |
// | prazo_limite     | ISO string  | deadline de entrega (SLA)            |
// | prioridade       | enum        | critica|alta|padrao                  |
// | valor_reais      | number      | valor da carga (peso do risco)       |
// | status           | enum        | aguardando_coleta|no_terminal|       |
// |                  |             | em_transito|entregue|atrasada        |
// ----------------------------------------------------------------------------
// Prazo-padrão por prioridade: critica 24 h · alta 48 h · padrao 72 h.

// --- PRNG determinístico -----------------------------------------------------

/** mulberry32 — PRNG semeado; garante empresas/frota idênticas a cada carga. */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Empresas fantasia ------------------------------------------------------

/** Quais FUNÇÕES empresariais recebem cada classe de carga (fluxo funcional):
 *  a carga gerada por um tipo pode ser absorvida pelos tipos listados aqui.
 *  Define o DESTINO da carga — não a cidade: a empresa receptora é sorteada
 *  entre as empresas desse tipo no grafo (fora da cidade de origem). */
const DESTINO_POR_CLASSE = {
  seca:              ["atacado_varejo", "operador_logistico", "textil", "bebidas", "farmaceutica"],
  refrigerada:       ["frigorifico", "farmaceutica", "atacado_varejo"],
  perigosa:          ["quimica"],
  granel:            ["siderurgia", "agroindustria", "frigorifico"],
  superdimensionada: ["automotiva", "operador_logistico"],
};

/** @type {Array<Empresa>} 3 por capital, 1–2 por cidade regional. */
const COMPANIES = [
  // Belo Horizonte (hub)
  { id: "EMP-01", nome: "MinasLog Transportes",        tipo: "operador_logistico", no: "BHZ", porte: "grande",  cargas_tipos: ["seca", "superdimensionada"], volume_mensal_tn: 9500 },
  { id: "EMP-02", nome: "Serra Azul Alimentos",        tipo: "agroindustria",      no: "BHZ", porte: "medio",   cargas_tipos: ["seca", "refrigerada"],       volume_mensal_tn: 3200 },
  { id: "EMP-03", nome: "Aços do Vale S.A.",           tipo: "siderurgia",         no: "BHZ", porte: "grande",  cargas_tipos: ["superdimensionada", "seca"], volume_mensal_tn: 12000 },
  // São Paulo
  { id: "EMP-04", nome: "Anhanguera Distribuição",     tipo: "atacado_varejo",     no: "SAO", porte: "grande",  cargas_tipos: ["seca"],                      volume_mensal_tn: 15000 },
  { id: "EMP-05", nome: "Reunidas Paulista Química",   tipo: "quimica",            no: "SAO", porte: "grande",  cargas_tipos: ["perigosa"],                  volume_mensal_tn: 7800 },
  { id: "EMP-06", nome: "Paulista Moda Confecções",    tipo: "textil",             no: "SAO", porte: "medio",   cargas_tipos: ["seca"],                      volume_mensal_tn: 2100 },
  // Rio de Janeiro
  { id: "EMP-07", nome: "Guanabara Petroquímica",      tipo: "quimica",            no: "RIO", porte: "grande",  cargas_tipos: ["perigosa"],                  volume_mensal_tn: 11000 },
  { id: "EMP-08", nome: "Atlântico Frigor do Rio",     tipo: "frigorifico",        no: "RIO", porte: "medio",   cargas_tipos: ["refrigerada"],               volume_mensal_tn: 4100 },
  { id: "EMP-09", nome: "Carioca Comércio Exterior",   tipo: "atacado_varejo",     no: "RIO", porte: "medio",   cargas_tipos: ["seca"],                      volume_mensal_tn: 3600 },
  // Vitória
  { id: "EMP-10", nome: "Capixaba Exportadora de Café", tipo: "agroindustria",     no: "VIT", porte: "medio",   cargas_tipos: ["seca"],                      volume_mensal_tn: 1800 },
  { id: "EMP-11", nome: "Porto Celeste Logística",     tipo: "operador_logistico", no: "VIT", porte: "medio",   cargas_tipos: ["seca", "superdimensionada"], volume_mensal_tn: 5200 },
  { id: "EMP-12", nome: "Celeste Mineração Capixaba",  tipo: "mineracao",          no: "VIT", porte: "grande",  cargas_tipos: ["granel"],                    volume_mensal_tn: 20000 },
  // Brasília
  { id: "EMP-13", nome: "Cerrado Cereais do Planalto", tipo: "agroindustria",      no: "BSB", porte: "grande",  cargas_tipos: ["granel"],                    volume_mensal_tn: 16500 },
  { id: "EMP-14", nome: "Planalto Farmacêutica",       tipo: "farmaceutica",       no: "BSB", porte: "medio",   cargas_tipos: ["refrigerada", "seca"],       volume_mensal_tn: 700 },
  { id: "EMP-15", nome: "Distral Transportes Federais", tipo: "operador_logistico", no: "BSB", porte: "medio",  cargas_tipos: ["seca"],                      volume_mensal_tn: 4400 },
  // Goiânia
  { id: "EMP-16", nome: "Bandeirantes do Cerrado Agro", tipo: "agroindustria",     no: "GYN", porte: "grande",  cargas_tipos: ["granel"],                    volume_mensal_tn: 14000 },
  { id: "EMP-17", nome: "Goiás Frigorífico Central",   tipo: "frigorifico",        no: "GYN", porte: "grande",  cargas_tipos: ["refrigerada"],               volume_mensal_tn: 8800 },
  { id: "EMP-18", nome: "Emas Distribuidora",          tipo: "atacado_varejo",     no: "GYN", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 900 },
  // Minas Gerais (regionais)
  { id: "EMP-19", nome: "Triângulo Grãos Ltda.",       tipo: "agroindustria",      no: "UDI", porte: "medio",   cargas_tipos: ["granel"],                    volume_mensal_tn: 6200 },
  { id: "EMP-20", nome: "Uberlândia Máquinas e Implementos", tipo: "automotiva",   no: "UDI", porte: "pequeno", cargas_tipos: ["superdimensionada"],         volume_mensal_tn: 600 },
  { id: "EMP-21", nome: "Pecuária Zebu do Triângulo",  tipo: "agropecuaria",       no: "UBA", porte: "pequeno", cargas_tipos: ["seca", "refrigerada"],       volume_mensal_tn: 500 },
  { id: "EMP-22", nome: "Patos Café Beneficiadora",    tipo: "agroindustria",      no: "PTL", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 450 },
  { id: "EMP-23", nome: "Frutas do Norte de Minas",    tipo: "fruticultura",       no: "MOC", porte: "pequeno", cargas_tipos: ["refrigerada"],               volume_mensal_tn: 700 },
  { id: "EMP-24", nome: "Pirapora Solar Agroalimentos", tipo: "agroindustria",     no: "PMC", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 380 },
  { id: "EMP-25", nome: "Madeireira Rio Doce",         tipo: "madeireira",         no: "GVL", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 520 },
  { id: "EMP-26", nome: "Doce Gemas Mineração",        tipo: "mineracao",          no: "GVL", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 300 },
  { id: "EMP-27", nome: "Mucuri Cacau e Extrativos",   tipo: "agroindustria",      no: "TEO", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 260 },
  { id: "EMP-28", nome: "Usipra Aços Ipatinga",        tipo: "siderurgia",         no: "IPS", porte: "grande",  cargas_tipos: ["superdimensionada", "granel"], volume_mensal_tn: 13000 },
  { id: "EMP-29", nome: "Mantiqueira Têxtil JDF",      tipo: "textil",             no: "JDF", porte: "medio",   cargas_tipos: ["seca"],                      volume_mensal_tn: 950 },
  { id: "EMP-30", nome: "Zona da Mata Bebidas",        tipo: "bebidas",            no: "JDF", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 640 },
  { id: "EMP-31", nome: "Divinópolis Confecções",      tipo: "textil",             no: "DIV", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 320 },
  { id: "EMP-32", nome: "Varginha Café Especial",      tipo: "agroindustria",      no: "VRG", porte: "pequeno", cargas_tipos: ["seca"],                      volume_mensal_tn: 410 },
  { id: "EMP-33", nome: "Alta Mogiana Açúcar e Álcool", tipo: "agroindustria",     no: "RPT", porte: "grande",  cargas_tipos: ["granel"],                    volume_mensal_tn: 17500 },
  { id: "EMP-34", nome: "Ribeirão Agro Máquinas",      tipo: "automotiva",         no: "RPT", porte: "pequeno", cargas_tipos: ["superdimensionada"],         volume_mensal_tn: 550 },
  { id: "EMP-35", nome: "Paraíba Valley Automotivo",   tipo: "automotiva",         no: "SJK", porte: "grande",  cargas_tipos: ["superdimensionada", "seca"], volume_mensal_tn: 9800 },
  { id: "EMP-36", nome: "São José Componentes",        tipo: "automotiva",         no: "SJK", porte: "medio",   cargas_tipos: ["seca"],                      volume_mensal_tn: 1300 },
];

// --- Frota derivada (grande=3, medio=2, pequeno=1) ---------------------------

const TRUCK_SPECS = {
  bau:             { vel: 70, pesoMax: 14, tara: 9,  cap: 300, cons: 3.0 },
  sider:           { vel: 70, pesoMax: 20, tara: 10, cap: 350, cons: 2.8 },
  refrigerado:     { vel: 65, pesoMax: 16, tara: 12, cap: 350, cons: 2.6 },
  tanque:          { vel: 60, pesoMax: 25, tara: 13, cap: 400, cons: 2.4 },
  graneleiro:      { vel: 60, pesoMax: 26, tara: 12, cap: 400, cons: 2.5 },
  porta_conteiner: { vel: 65, pesoMax: 30, tara: 14, cap: 450, cons: 2.3 },
  bitrem:          { vel: 65, pesoMax: 40, tara: 20, cap: 800, cons: 2.2 },
};

const TRUCK_TYPE_BY_CLASS = {
  seca: ["bau", "sider"],
  refrigerada: ["refrigerado"],
  perigosa: ["tanque"],
  granel: ["graneleiro", "bitrem"],
  superdimensionada: ["porta_conteiner", "bitrem"],
};

const TRUCK_STATUS = ["disponivel", "disponivel", "disponivel", "em_viagem", "em_viagem", "carregando", "manutencao"];

/** Gera frota determinística a partir das empresas. */
function buildTrucks() {
  const rnd = mulberry32(20261024);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const jitter = (v, pct = 0.1) => Math.round(v * (1 + (rnd() * 2 - 1) * pct) * 10) / 10;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const plate = () =>
    letters[Math.floor(rnd() * 26)] + letters[Math.floor(rnd() * 26)] + letters[Math.floor(rnd() * 26)] +
    Math.floor(rnd() * 10) + letters[Math.floor(rnd() * 26)] +
    Math.floor(rnd() * 10) + Math.floor(rnd() * 10);

  const trucks = [];
  let n = 0;
  for (const emp of COMPANIES) {
    const fleetSize = emp.porte === "grande" ? 3 : emp.porte === "medio" ? 2 : 1;
    for (let i = 0; i < fleetSize; i++) {
      const tipo = pick(TRUCK_TYPE_BY_CLASS[emp.cargas_tipos[0]]);
      const s = TRUCK_SPECS[tipo];
      n += 1;
      const cap = Math.round(s.cap * (1 + (rnd() * 2 - 1) * 0.08));
      const cons = jitter(s.cons);
      trucks.push({
        id: "CAM-" + String(n).padStart(3, "0"),
        placa: plate(),
        empresa_id: emp.id,
        tipo,
        vel_media_kmh: Math.round(s.vel + (rnd() * 2 - 1) * 5),
        peso_max_ton: s.pesoMax,
        tara_ton: s.tara,
        cap_comb_l: cap,
        consumo_km_l: cons,
        autonomia_km: Math.round(cap * cons),
        comb_atual_l: Math.round(cap * (0.3 + rnd() * 0.7)),
        jornada_h: Math.round(rnd() * 8 * 10) / 10,
        limite_jornada_h: 10,
        status: pick(TRUCK_STATUS),
        no_atual: emp.no,
      });
    }
  }
  return trucks;
}

const TRUCKS = buildTrucks();

// --- Cargas de exemplo (mesma seed; prazos por prioridade) -------------------

function buildCargas() {
  const rnd = mulberry32(20261024 + 1);
  const NODE_IDS = AgentRouterGraphNodes(); // ids válidos do grafo
  const T0 = Date.parse("2026-10-24T08:00:00-03:00");
  const h = (n) => new Date(T0 + n * 3600e3).toISOString();
  const SLA_H = { critica: 24, alta: 48, padrao: 72 };
  const PESO = {
    seca: [4, 24], refrigerada: [3, 15], perigosa: [10, 24],
    granel: [20, 38], superdimensionada: [12, 38],
  };
  const statuses = [
    ...Array(9).fill("aguardando_coleta"),
    ...Array(3).fill("aguardando_coleta"),
    ...Array(2).fill("aguardando_coleta"),
    ...Array(1).fill("aguardando_coleta"),
  ];

  const cargas = [];
  for (let i = 0; i < 15; i++) {
    const emp = COMPANIES[Math.floor(rnd() * COMPANIES.length)];
    const classe = emp.cargas_tipos[Math.floor(rnd() * emp.cargas_tipos.length)];
    const receptor = sortearReceptor(classe, emp, rnd);
    if (!receptor) continue;
    const prio = i < 2 ? "critica" : i < 7 ? "alta" : "padrao";
    const [pmin, pmax] = PESO[classe];
    const criada = -(6 + Math.floor(rnd() * 42)); // criada 6–48 h antes de T0
    cargas.push({
      id: "CARGA-" + String(i + 1).padStart(3, "0"),
      empresa_id: emp.id,
      receptor_id: receptor.id,
      classe,
      peso_ton: Math.round((pmin + rnd() * (pmax - pmin)) * 10) / 10,
      origem: emp.no,
      hub: "BHZ",                       // TODO fluxo passa pelo terminal (regra do usuário)
      destino: receptor.no,
      criada_em: h(criada),
      prazo_limite: h(criada + SLA_H[prio]),
      prioridade: prio,
      valor_reais: Math.round(5000 + rnd() * 495000),
      status: statuses[i % statuses.length],
      fase: "coleta",
    });
  }
  return cargas;
}

const CARGAS = buildCargas();

// --- Consultas (a "leitura" das tabelas) ------------------------------------

const companiesAt = (noId) => COMPANIES.filter((e) => e.no === noId);
const trucksOf = (empresaId) => TRUCKS.filter((t) => t.empresa_id === empresaId);
const cargasAt = (noId) =>
  CARGAS.filter((c) => c.origem === noId || c.destino === noId);
const companyById = (id) => COMPANIES.find((e) => e.id === id);

/** Sorteia uma empresa RECEPTORA para a carga, pela FUNÇÃO (DESTINO_POR_CLASSE).
 *  Exclui a própria empresa expedidora e empresas da mesma cidade-sede.
 *  Determinístico: usa `rnd` (PRNG semeado do chamador). */
function sortearReceptor(classe, empresaOrigem, rnd) {
  const funcoes = DESTINO_POR_CLASSE[classe] || ["atacado_varejo"];
  const cand = COMPANIES.filter(
    (e) => funcoes.includes(e.tipo) && e.id !== empresaOrigem.id && e.no !== empresaOrigem.no
  );
  if (!cand.length) return null;
  return cand[Math.floor(rnd() * cand.length)];
}

if (typeof window !== "undefined") {
  window.AgentRouterData = {
    COMPANIES, TRUCKS, CARGAS,
    companiesAt, trucksOf, cargasAt, companyById,
    DESTINO_POR_CLASSE, sortearReceptor,
  };
}
