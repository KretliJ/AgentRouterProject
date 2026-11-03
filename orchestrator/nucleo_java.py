"""
Ponte com o núcleo Java (F1): gerencia o processo e fala JSON Lines.

Uso:
    nucleo = NucleoJava(java_exe="C:/Users/jonas/jdk-26/bin/java.exe",
                        classpath="core/build")
    nucleo.iniciar()
    nucleo.comando({"cmd": "ping"})
    resposta = nucleo.ler_evento(timeout=2)      # {"evt": "pong", ...}
    nucleo.encerrar()

O processo Java roda em thread de leitura dedicada; eventos chegam numa
fila thread-safe para consumo pelo orquestrador/UI.
"""
import json
import queue
import subprocess
import threading
from pathlib import Path

JAVA_EXE_CANDIDATOS = [
    r"C:/Users/jonas/jdk-26/bin/java.exe",   # JDK 26 (detectado nesta máquina)
    "java",                                   # PATH
]
CLASSPATH_DEFAULT = str(Path(__file__).resolve().parent.parent / "core" / "build")


class NucleoJava:
    def __init__(self, java_exe: str | None = None, classpath: str | None = None,
                 main_class: str = "br.ufop.agentrouter.Main"):
        self.java_exe = java_exe or next(
            (c for c in JAVA_EXE_CANDIDATOS if Path(c).exists()), JAVA_EXE_CANDIDATOS[-1]
        )
        self.classpath = classpath or CLASSPATH_DEFAULT
        self.main_class = main_class
        self.proc: subprocess.Popen | None = None
        self.eventos: "queue.Queue[dict]" = queue.Queue()
        self._leitor: threading.Thread | None = None

    # ------------------------------------------------------------------
    def iniciar(self) -> bool:
        """Sobe o processo Java e a thread de leitura de eventos."""
        if self.proc and self.proc.poll() is None:
            return True  # já rodando
        try:
            self.proc = subprocess.Popen(
                [self.java_exe, "-cp", self.classpath, self.main_class],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1,
            )
        except OSError as e:
            self.eventos.put({"evt": "erro_java", "msg": str(e)})
            return False
        self._leitor = threading.Thread(target=self._ler_stdout, daemon=True)
        self._leitor.start()
        return True

    def _ler_stdout(self):
        """Lê JSON Lines do stdout do Java e enfileira eventos."""
        assert self.proc and self.proc.stdout
        for linha in self.proc.stdout:
            linha = linha.strip()
            if not linha:
                continue
            try:
                self.eventos.put(json.loads(linha))
            except json.JSONDecodeError:
                self.eventos.put({"evt": "linha_invalida", "bruto": linha[:200]})

    # ------------------------------------------------------------------
    def comando(self, obj: dict) -> None:
        """Envia um comando JSON Lines para o núcleo."""
        if self.proc and self.proc.stdin:
            self.proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
            self.proc.stdin.flush()

    def ler_evento(self, timeout: float = 2.0) -> dict | None:
        """Consome o próximo evento (bloqueia até timeout). None se vazio."""
        try:
            return self.eventos.get(timeout=timeout)
        except queue.Empty:
            return None

    def drenar(self) -> list[dict]:
        """Drena todos os eventos pendentes sem bloquear."""
        out = []
        while True:
            try:
                out.append(self.eventos.get_nowait())
            except queue.Empty:
                return out

    # ------------------------------------------------------------------
    def encerrar(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.comando({"cmd": "sair"})
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None

    def vivo(self) -> bool:
        return bool(self.proc and self.proc.poll() is None)
