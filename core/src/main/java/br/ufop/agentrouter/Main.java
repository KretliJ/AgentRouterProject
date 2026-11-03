// ============================================================================
// AgentRouter — Núcleo Java (F1): relógio, scheduler, mundo, protocolo
// ============================================================================
// Protocolo: JSON Lines no stdin/stdout (uma mensagem por linha).
//   → comandos do orquestrador:  {"cmd":"ping"|"status"|"tick"|"run"|"pause"...}
//   ← respostas/eventos:         {"evt":..., dados...}
//
// O relógio é paced (como o sim.js): ticks em passos fixos, durações reais.
// Esta classe é o esqueleto F1 — o mundo exógeno e o despacho migram do
// sim.js nas próximas iterações (F2+).
//
// Build:  javac core/src/main/java/br/ufop/agentrouter/*.java
// Run:    java -cp core/src/main/java br.ufop.agentrouter.Main
// ============================================================================

package br.ufop.agentrouter;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Random;

public final class Main {

    // ------------------------------------------------------------------
    // Eventos agendados (scheduler — heap por instante de simulação)
    // ------------------------------------------------------------------
    static final class Evento implements Comparable<Evento> {
        final long quandoMs;          // instante na linha do tempo simulada
        final String tipo;
        final Map<String, Object> dados;

        Evento(long quandoMs, String tipo, Map<String, Object> dados) {
            this.quandoMs = quandoMs;
            this.tipo = tipo;
            this.dados = dados == null ? Map.of() : dados;
        }

        @Override public int compareTo(Evento o) {
            int c = Long.compare(quandoMs, o.quandoMs);
            return c != 0 ? c : tipo.compareTo(o.tipo);  // determinismo
        }
    }

    // ------------------------------------------------------------------
    // Estado do mundo
    // ------------------------------------------------------------------
    static final class Mundo {
        long simMs = 0;                       // relógio simulado (ms desde T0)
        long velocidade = 60;                 // 1×, 60×, 600×
        boolean pausado = true;
        final PriorityQueue<Evento> fila = new PriorityQueue<>();
        final ArrayDeque<String> log = new ArrayDeque<>();
        final Random rng;                     // stream única (F2: separa por subsistema)
        long seed;

        Mundo(long seed) {
            this.seed = seed;
            this.rng = new Random(seed);
        }

        void log(String msg) {
            log.addFirst(simMs + " | " + msg);
            while (log.size() > 60) log.removeLast();
        }
    }

    static final Mundo mundo = new Mundo(424242L);
    static volatile boolean rodando = true;

    // ------------------------------------------------------------------
    // Saída JSON Lines (stdout) — sem dependências externas (F1 mínimo)
    // ------------------------------------------------------------------
    static synchronized void emitir(String json) {
        System.out.println(json);
        System.out.flush();
    }

    static String escapar(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }

    static String evento(String tipo, String corpo) {
        return "{\"evt\":\"" + tipo + "\"" + (corpo.isEmpty() ? "" : "," + corpo) + "}";
    }

    // ------------------------------------------------------------------
    // Comandos aceitos
    // ------------------------------------------------------------------
    static void processar(String linha) {
        linha = linha.trim();
        if (linha.isEmpty()) return;
        // parser mínimo: extraímos "cmd" e "valor" sem biblioteca JSON (F1).
        String cmd = extrair(linha, "cmd");
        switch (cmd == null ? "" : cmd) {
            case "ping" -> emitir(evento("pong", "\"t\":" + Instant.now().toEpochMilli()));
            case "status" -> status();
            case "setSpeed" -> {
                mundo.velocidade = (long) numero(linha, "valor", 60);
                mundo.log("velocidade " + mundo.velocidade + "×");
                status();
            }
            case "pause" -> { mundo.pausado = true; mundo.log("pausado"); status(); }
            case "run" -> { mundo.pausado = false; mundo.log("rodando"); status(); }
            case "tick" -> {
                long horas = (long) numero(linha, "valor", 1);
                avancar(horas * 3_600_000L);
                status();
            }
            case "agendar" -> {
                // {"cmd":"agendar","tipo":"incidente","emMs":60000,"dados":{...}}
                String tipo = extrair(linha, "tipo");
                long em = (long) numero(linha, "emMs", 0);
                mundo.fila.add(new Evento(mundo.simMs + em, tipo == null ? "generico" : tipo, Map.of()));
                mundo.log("agendado: " + tipo + " em " + em + " ms");
            }
            case "seed" -> {
                // reinicia o mundo com outra seed (determinismo controlado)
                long s = (long) numero(linha, "valor", 424242L);
                mundo.seed = s;
                mundo.fila.clear(); mundo.log.clear(); mundo.simMs = 0;
                mundo.rng.setSeed(s);
                mundo.log("mundo reiniciado com seed " + s);
                status();
            }
            case "sair" -> rodando = false;
            default -> emitir(evento("erro", "{\"msg\":\"comando desconhecido\"}"));
        }
    }

    static void status() {
        StringBuilder kpis = new StringBuilder();
        kpis.append("\"simMs\":").append(mundo.simMs)
            .append(",\"velocidade\":").append(mundo.velocidade)
            .append(",\"pausado\":").append(mundo.pausado)
            .append(",\"filaEventos\":").append(mundo.fila.size())
            .append(",\"seed\":").append(mundo.seed);
        emitir(evento("status", kpis.toString()));
    }

    static String extrair(String linha, String chave) {
        int i = linha.indexOf("\"" + chave + "\"");
        if (i < 0) return null;
        int d = linha.indexOf(':', i + chave.length() + 2);
        if (d < 0) return null;
        int a = linha.indexOf('"', d);
        int f = linha.indexOf('"', a + 1);
        return (a >= 0 && f > a) ? linha.substring(a + 1, f) : null;
    }

    static double numero(String linha, String chave, double def) {
        int i = linha.indexOf("\"" + chave + "\"");
        if (i < 0) return def;
        int d = linha.indexOf(':', i + chave.length() + 2);
        if (d < 0) return def;
        int f = d + 1;
        while (f < linha.length() && (Character.isDigit(linha.charAt(f)) || linha.charAt(f) == '-' || linha.charAt(f) == '.' || linha.charAt(f) == 'e')) f++;
        try { return Double.parseDouble(linha.substring(d + 1, f)); } catch (Exception e) { return def; }
    }

    // ------------------------------------------------------------------
    // Avanço do relógio (paced): consome a fila de eventos na ordem
    // ------------------------------------------------------------------
    static void avancar(long dtMs) {
        if (mundo.pausado) return;
        long fim = mundo.simMs + dtMs;
        while (!mundo.fila.isEmpty() && mundo.fila.peek().quandoMs <= fim) {
            Evento ev = mundo.fila.poll();
            mundo.simMs = ev.quandoMs;   // eventos "teleportam" o relógio p/ o instante dele
            disparar(ev);
        }
        mundo.simMs = Math.max(mundo.simMs, fim);
    }

    static void disparar(Evento ev) {
        switch (ev.tipo) {
            case "incidente" -> {
                int br = 100 + mundo.rng.nextInt(500);
                boolean grave = mundo.rng.nextInt(100) < 12;
                mundo.log("incidente BR-" + br + (grave ? " (grave)" : ""));
                emitir(evento("incidente",
                    "\"br\":\"BR-" + br + "\",\"grave\":" + grave +
                    ",\"penalty\":" + (grave ? 6 : 2.5)));
            }
            case "carga" -> {
                int prio = mundo.rng.nextInt(100);
                String p = prio < 10 ? "critica" : prio < 40 ? "alta" : "padrao";
                mundo.log("nova carga (" + p + ")");
                emitir(evento("carga", "\"prioridade\":\"" + p + "\""));
            }
            default -> mundo.log("evento: " + ev.tipo);
        }
    }

    // ------------------------------------------------------------------
    // Loop principal: stdin (comandos) + relógio paced em thread própria
    // ------------------------------------------------------------------
    public static void main(String[] args) throws IOException {
        emitir(evento("pronto", "\"versao\":\"F1\",\"java\":\"" + System.getProperty("java.version") + "\""));

        // relógio paced: thread que avança o mundo de acordo com a velocidade
        Thread relogio = new Thread(() -> {
            long ultimo = System.nanoTime();
            while (rodando) {
                try { Thread.sleep(250); } catch (InterruptedException e) { return; }
                long agora = System.nanoTime();
                double dtRealMs = (agora - ultimo) / 1_000_000.0;
                ultimo = agora;
                if (!mundo.pausado) {
                    avancar((long) (dtRealMs * mundo.velocidade));
                }
            }
        }, "relogio-paced");
        relogio.setDaemon(true);
        relogio.start();

        // stdin: um comando JSON por linha
        try (BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String linha;
            while (rodando && (linha = in.readLine()) != null) {
                processar(linha);
            }
        }
        emitir(evento("adeus", ""));
    }
}
