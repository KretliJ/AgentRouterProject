"""
AgentRouter — Shell da aplicação desktop (pywebview).

Decisão de arquitetura (sem reimplementação): a simulação da visualização
conceitual (frontend/prototype/*.js) É o motor v1 do sistema. Este shell:

  1. Serve os arquivos estáticos do protótipo via servidor HTTP local
     (file:// bloqueia fetch/XHR em alguns backends; http://localhost
     resolve e ainda permite evoluir p/ API REST do núcleo Java);
  2. Expõe uma ponte Python (window.pywebview.api) para a UI chamar
     funções nativas — hoje: persistência de cenário/sessão em JSON,
     estatísticas agregadas; amanhã: proxy p/ o núcleo Java via JSON Lines.

Sem banco de dados: a modelagem dos .js é a fonte da verdade; arquivos
JSON são apenas instantânees (snapshots) salvos pelo usuário.

Executar:  python orchestrator/app.py
"""
import json
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

import webview

ROOT = Path(__file__).resolve().parent.parent / "frontend" / "prototype"
PORT = 8765


# ---------------------------------------------------------------------------
# Servidor estático (thread própria, daemon)
# ---------------------------------------------------------------------------
class _Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):  # silencia o console
        pass


def _serve_static():
    server = HTTPServer(("127.0.0.1", PORT), _Handler)
    server.serve_forever()


# ---------------------------------------------------------------------------
# Ponte Python ↔ JS (exposta como window.pywebview.api)
# ---------------------------------------------------------------------------
class Api:
    """Métodos públicos são chamáveis do JS: await pywebview.api.<nome>(...).
    Argumentos e retornos são serializados automaticamente (JSON)."""

    # --- persistência ------------------------------------------------------
    def salvar_sessao(self, nome: str, estado: dict) -> str:
        """Salva um snapshot do estado da simulação (vindo do JS) em JSON.
        Retorna o caminho do arquivo gravado."""
        pasta = Path(__file__).resolve().parent / "sessoes"
        pasta.mkdir(exist_ok=True)
        caminho = pasta / f"{nome}.json"
        caminho.write_text(
            json.dumps(estado, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return str(caminho)

    def listar_sessoes(self) -> list:
        """Lista snapshots salvos: [{nome, arquivo}]"""
        pasta = Path(__file__).resolve().parent / "sessoes"
        if not pasta.exists():
            return []
        return [
            {"nome": arq.stem, "arquivo": str(arq)}
            for arq in sorted(pasta.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        ]

    def carregar_sessao(self, nome: str):
        """Lê um snapshot e devolve o estado (dict) para o JS reidratar."""
        caminho = Path(__file__).resolve().parent / "sessoes" / f"{nome}.json"
        if not caminho.exists():
            return {"erro": "snapshot inexistente"}
        return json.loads(caminho.read_text(encoding="utf-8"))

    # --- estatísticas nativas (fora do GIL do JS) ---------------------------
    def resumo_sessao(self, estado: dict) -> dict:
        """Exemplo de processamento pesado delegado ao Python: agregações
        sobre o estado cru, sem travar a UI."""
        cargas = estado.get("cargas", [])
        por_status: dict = {}
        for c in cargas:
            s = c.get("status", "?")
            por_status[s] = por_status.get(s, 0) + 1
        tempos_h = estado.get("kpis", {}).get("temposH", [])
        return {
            "totalCargas": len(cargas),
            "porStatus": por_status,
            "tempoMedioEntregaH": round(sum(tempos_h) / len(tempos_h), 2) if tempos_h else None,
            "entreguesNoEstado": sum(1 for c in cargas if c.get("status") == "entregue"),
        }

    # --- núcleo Java (futuro; placeholder p/ F1) ----------------------------
    def nucleo_status(self) -> dict:
        """Status do núcleo Java. No F1, aqui vai a checagem do processo
        Java via JSON Lines (stdin/stdout). Hoje: ainda não integrado."""
        return {"integrado": False, "motivo": "núcleo Java entra no F1"}


# ---------------------------------------------------------------------------
def main():
    threading.Thread(target=_serve_static, daemon=True).start()
    api = Api()
    webview.create_window(
        "AgentRouter — centro logístico de Belo Horizonte",
        f"http://127.0.0.1:{PORT}/index.html",
        js_api=api,
        width=1600,
        height=1000,
        min_size=(1100, 700),
    )
    webview.start(gui="edgechromium")  # WebView2 no Windows


if __name__ == "__main__":
    main()
