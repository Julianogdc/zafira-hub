#!/usr/bin/env python3
"""
Zafira Hub 2.1 — F6 Projetos Browser Runtime Gate (Homologation Rehearsal) — F6-IMP.9
Navegador Chromium autenticado (Playwright) contra as imagens publicadas, banco de ensaio
e Asana SIMULADO somente leitura (scripts/homologation/asana-mock.mjs). Dados fictícios.

Cenários:
  A  Login e sessão (fuso da organização)
  B  /projetos: cliente, projeto Asana e métricas confirmadas
  C  Lista: tarefas, atraso, busca
  D  Quadro: colunas por seção, sem arrastar (somente leitura)
  E  Calendário: tarefas no mês
  F  Entregas: plano, indicadores, registrar e avançar peça até "postada"
  G  Evolução no Asana: frescor, fotos e mudanças
  H  Asana somente leitura: nenhuma escrita chegou ao Asana simulado
  I  Isolamento entre organizações (A x B), pela tela e pela API
  J  Responsividade 390 px sem rolagem horizontal
"""

import json
import os
import pathlib
import re
import subprocess
import sys
from typing import Any, Dict, List
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, sync_playwright


def env_required(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[-] ERRO: variável obrigatória '{name}' ausente.", file=sys.stderr)
        sys.exit(1)
    return val


def sanitize(url: str) -> str:
    p = urlparse(url)
    return f"{p.path}?{p.query}" if p.query else p.path


CLIENT_A = "f6f6f6f6-0000-4000-8000-0000000000a1"
CLIENT_B = "f6f6f6f6-0000-4000-8000-0000000000b1"


class ProjectsGate:
    def __init__(self) -> None:
        self.base = os.environ.get("WEB_BASE_URL", "http://127.0.0.1:8083").rstrip("/")
        self.email_a = os.environ.get("GATE_EMAIL_A", "gate-a@zafira.invalid")
        self.email_b = os.environ.get("GATE_EMAIL_B", "gate-b@zafira.invalid")
        self.password_a = env_required("GATE_PASSWORD_A")
        self.password_b = env_required("GATE_PASSWORD_B")
        self.org_a = os.environ.get("ORG_A_ID", "11111111-1111-4111-8111-111111111111")
        self.api_container = os.environ.get("API_CONTAINER_NAME", "api-f45-browser")
        self.mock_url = os.environ.get("ASANA_MOCK_INTERNAL_URL", "http://asana-mock:8080")
        self.artifacts = pathlib.Path(os.environ.get("ARTIFACT_DIR", "artifacts/projects-browser"))
        self.artifacts.mkdir(parents=True, exist_ok=True)
        self.passed: List[str] = []
        self.failed: List[str] = []
        self.blockers: List[str] = []
        self.scenarios: List[str] = []
        self.screenshots: List[str] = []
        self.console_errors: List[str] = []

    # ------------------------------------------------------------------ registro
    def ok(self, scenario: str, what: str) -> None:
        self.passed.append(f"[{scenario}] {what}")
        print(f"[+] PASS [{scenario}] {what}")

    def fail(self, scenario: str, what: str, why: str) -> None:
        item = f"[{scenario}] {what}: {why}"
        self.failed.append(item)
        print(f"[-] FAIL {item}", file=sys.stderr)

    def check(self, scenario: str, what: str, condition: bool, why: str = "condição falsa") -> None:
        (self.ok(scenario, what) if condition else self.fail(scenario, what, why))

    def shot(self, page: Page, name: str) -> None:
        page.screenshot(path=str(self.artifacts / name), full_page=True)
        self.screenshots.append(name)

    def listen(self, page: Page) -> None:
        def on_console(msg: Any) -> None:
            if msg.type == "error":
                self.console_errors.append(msg.text)
                if any(k in msg.text.lower() for k in ["uncaught", "minified react error"]):
                    self.blockers.append(f"Erro crítico no console: {msg.text}")

        def on_page_error(err: Any) -> None:
            self.blockers.append(f"Exceção não tratada na página: {err}")

        def on_response(res: Any) -> None:
            low = res.url.lower()
            if any(t in low for t in ["supabase", "app.asana.com/api"]):
                self.blockers.append(f"Requisição proibida pelo navegador: {sanitize(res.url)}")

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("response", on_response)

    def login(self, browser: Browser, email: str, password: str, scenario: str, width: int = 1280, height: int = 800) -> Page:
        context = browser.new_context(viewport={"width": width, "height": height}, ignore_https_errors=True)
        page = context.new_page()
        self.listen(page)
        page.goto(f"{self.base}/login", wait_until="networkidle", timeout=30000)
        page.fill("#email", email)
        page.fill("#password", password)
        with page.expect_response(lambda r: "/api/v1/auth/login" in r.url and r.status == 200, timeout=15000):
            page.click('button[type="submit"]')
        page.wait_for_url(lambda u: "/login" not in u, timeout=15000)
        self.ok(scenario, f"login {email}")
        return page

    def api(self, page: Page, path: str, method: str = "GET") -> Dict[str, Any]:
        return page.evaluate(
            """async ([path, method]) => {
                const res = await fetch('/hub-api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
                let body = null; try { body = await res.json(); } catch (e) {}
                return { status: res.status, body, text: JSON.stringify(body) };
            }""",
            [path, method],
        )

    def section_text(self, page: Page, label: str) -> str:
        loc = page.locator(f'[aria-label="{label}"]')
        loc.first.wait_for(state="visible", timeout=20000)
        return loc.first.inner_text()

    def click_button(self, page: Page, text: str, scope: str = "body") -> None:
        page.locator(scope).get_by_role("button", name=text, exact=False).first.click()

    # ------------------------------------------------------------------ execução
    def run(self) -> int:
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
                try:
                    self.suite(browser)
                finally:
                    browser.close()
        except Exception as exc:  # noqa: BLE001
            self.blockers.append(f"Exceção fatal: {type(exc).__name__}: {exc}")

        success = not self.failed and not self.blockers
        report = {
            "gitSha": os.environ.get("GITHUB_SHA", "local"),
            "decision": "F6-IMP.9 PROJECTS GATE PASS" if success else "F6-IMP.9 PROJECTS GATE FAIL",
            "scenariosExecuted": self.scenarios,
            "assertionsPassedCount": len(self.passed),
            "assertionsPassed": self.passed,
            "assertionsFailedCount": len(self.failed),
            "assertionsFailed": self.failed,
            "blockers": self.blockers,
            "screenshots": self.screenshots,
            "consoleErrorsCount": len(self.console_errors),
        }
        (self.artifacts / "projects-browser-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({k: report[k] for k in ("decision", "assertionsPassedCount", "assertionsFailedCount")}, ensure_ascii=False))
        for b in self.blockers:
            print(f"[-] BLOCKER: {b}", file=sys.stderr)
        return 0 if success else 1

    def suite(self, browser: Browser) -> None:
        # A ---------------------------------------------------------------
        self.scenarios.append("A — Login e sessão")
        page = self.login(browser, self.email_a, self.password_a, "A")
        sess = self.api(page, "/api/v1/auth/session")
        orgs = (sess.get("body") or {}).get("organizations") or []
        org_a = next((o for o in orgs if o.get("id") == self.org_a), {})
        self.check("A", "sessão autenticada na Org A", sess["status"] == 200 and bool(org_a), str(sess["status"]))
        self.check("A", "fuso da organização informado (padrão São Paulo)", org_a.get("timezone") == "America/Sao_Paulo", str(org_a.get("timezone")))

        # B ---------------------------------------------------------------
        self.scenarios.append("B — Projetos do cliente")
        page.goto(f"{self.base}/projetos?clientId={CLIENT_A}", wait_until="networkidle", timeout=30000)
        page.get_by_text("F6 Gate Social Media A").first.wait_for(timeout=30000)
        body = page.locator("main").first.inner_text()
        self.check("B", "projeto Asana vinculado aparece", "F6 Gate Social Media A" in body)
        self.check("B", "métricas confirmadas (6 tarefas, 1 em atraso)", re.search(r"TOTAL\s+6\s", body.upper()) is not None and re.search(r"EM ATRASO\s+1\s", body.upper()) is not None, body[:300])
        self.check("B", "nada da Org B na tela da Org A", "Sigiloso" not in body and "SIGILOSO" not in body)
        self.shot(page, "f6-b-projetos.png")

        # C ---------------------------------------------------------------
        self.scenarios.append("C — Lista")
        page.get_by_text("F6 Gate Roteiro atrasado").first.wait_for(timeout=30000)
        list_text = page.locator("main").first.inner_text()
        for name in ["F6 Gate Roteiro atrasado", "F6 Gate Arte para hoje", "F6 Gate Legendas da semana"]:
            self.check("C", f"tarefa listada: {name}", name in list_text)
        self.check("C", "tarefa vencida marcada como Atrasada", "Atrasada" in list_text)
        search = page.get_by_label("Buscar tarefas")
        search.fill("Legendas")
        page.wait_for_timeout(500)
        filtered = page.locator("main").first.inner_text()
        self.check("C", "busca filtra a lista", "F6 Gate Legendas da semana" in filtered and "F6 Gate Roteiro atrasado" not in filtered)
        search.fill("")
        page.wait_for_timeout(300)

        # D ---------------------------------------------------------------
        self.scenarios.append("D — Quadro somente leitura")
        page.get_by_role("button", name="Quadro").first.click()
        board = page.locator('[aria-label="Quadro de tarefas, somente leitura"]')
        board.wait_for(timeout=15000)
        board_text = board.inner_text()
        self.check("D", "colunas por seção (Produção, Revisão)", "Produção" in board_text and "Revisão" in board_text)
        self.check("D", "nenhum cartão arrastável", page.locator('[draggable="true"]').count() == 0)
        self.shot(page, "f6-d-quadro.png")

        # E ---------------------------------------------------------------
        self.scenarios.append("E — Calendário")
        page.get_by_role("button", name="Calendário").first.click()
        page.wait_for_timeout(800)
        cal_text = page.locator("main").first.inner_text()
        self.check("E", "tarefa com prazo hoje no calendário", "F6 Gate Arte para hoje" in cal_text)
        self.shot(page, "f6-e-calendario.png")

        # F ---------------------------------------------------------------
        self.scenarios.append("F — Entregas")
        page.get_by_role("button", name="Entregas").first.click()
        page.get_by_text("F6 Gate Plano A").first.wait_for(timeout=20000)
        ent = page.locator('[data-testid="deliverables-view-container"]').inner_text()
        self.check("F", "plano do mês com meta 10 e 2 entregues", re.search(r"ENTREGAS DO CONTRATO\s+2\s+DE 10", ent.upper()) is not None, ent[:300])
        container = page.locator('[data-testid="deliverables-view-container"]')
        container.get_by_role("button", name="Peças (3)").first.click()
        container.get_by_label("Título da peça").first.fill("F6 Gate Stories novo")
        container.get_by_label("Formato").first.select_option("STORIES")
        container.get_by_role("button", name="Registrar peça produzida").first.click()
        page.get_by_text("F6 Gate Stories novo").first.wait_for(timeout=15000)
        self.ok("F", "peça registrada como produzida")
        row = container.locator("li", has_text="F6 Gate Stories novo")
        row.get_by_role("button", name="Marcar como aprovada").click()
        row.get_by_role("button", name="Marcar como postada").wait_for(timeout=15000)
        row.get_by_role("button", name="Marcar como postada").click()
        # Selo exato "Postada" (o botão "Marcar como postada" também contém a palavra) e
        # espera ativa até o indicador refletir a resposta da API.
        row.get_by_text("Postada", exact=True).wait_for(timeout=15000)
        ent_after = ""
        for _ in range(30):
            ent_after = container.inner_text().upper()
            if re.search(r"ENTREGAS DO CONTRATO\s+3\s+DE 10", ent_after):
                break
            page.wait_for_timeout(500)
        self.check("F", "contagem sobe para 3 só ao postar", re.search(r"ENTREGAS DO CONTRATO\s+3\s+DE 10", ent_after) is not None, ent_after[:300])
        self.shot(page, "f6-f-entregas.png")

        # G ---------------------------------------------------------------
        self.scenarios.append("G — Evolução no Asana")
        page.get_by_role("button", name="Lista").first.click()
        hist = self.section_text(page, "Evolução no Asana")
        self.check("G", "frescor exibido (Conferido em)", "Conferido em" in hist)
        self.check("G", "fotos diárias no período", "dia(s) com foto" in hist)
        self.check("G", "mudanças recentes listadas", "Marcada como concluída" in hist and "Responsável: Bruno Gate → Ana Gate" in hist)
        self.shot(page, "f6-g-historico.png")

        # H ---------------------------------------------------------------
        self.scenarios.append("H — Asana somente leitura")
        probe = subprocess.run(
            ["docker", "exec", self.api_container, "node", "-e",
             f"fetch('{self.mock_url}/__writes').then(r=>r.json()).then(d=>{{console.log(JSON.stringify(d));}})"],
            capture_output=True, text=True,
        )
        writes = -1
        try:
            writes = json.loads(probe.stdout.strip().splitlines()[-1]).get("count", -1)
        except Exception:  # noqa: BLE001
            pass
        self.check("H", "nenhuma escrita chegou ao Asana simulado", writes == 0, f"writes={writes} stderr={probe.stderr[-200:]}")

        # I ---------------------------------------------------------------
        self.scenarios.append("I — Isolamento entre organizações")
        for path in [f"/clients/{CLIENT_B}/deliverables?period=2026-10", f"/clients/{CLIENT_B}/asana/history", f"/clients/{CLIENT_B}/asana/tasks"]:
            r = self.api(page, path)
            self.check("I", f"Org A não lê {path.split('?')[0].replace(CLIENT_B, ':clienteB')}", r["status"] == 404 and "SIGILOSO" not in (r["text"] or "").upper(), str(r["status"]))
        page_b = self.login(browser, self.email_b, self.password_b, "I")
        for path in [f"/clients/{CLIENT_A}/deliverables?period=2026-10", f"/clients/{CLIENT_A}/asana/history", f"/clients/{CLIENT_A}/asana/tasks"]:
            r = self.api(page_b, path)
            self.check("I", f"Org B não lê {path.split('?')[0].replace(CLIENT_A, ':clienteA')}", r["status"] == 404 and "Plano A" not in (r["text"] or ""), str(r["status"]))
        page_b.goto(f"{self.base}/projetos?clientId={CLIENT_A}", wait_until="networkidle", timeout=30000)
        page_b.wait_for_timeout(1500)
        b_text = page_b.locator("main").first.inner_text()
        self.check("I", "tela da Org B não mostra dados da Org A", "F6 Gate Social Media A" not in b_text and "F6 Gate Plano A" not in b_text)
        page_b.goto(f"{self.base}/projetos?clientId={CLIENT_B}", wait_until="networkidle", timeout=30000)
        page_b.get_by_text("F6 Gate Projeto Sigiloso B").first.wait_for(timeout=30000)
        self.ok("I", "Org B vê o próprio projeto")
        self.shot(page_b, "f6-i-org-b.png")

        # J ---------------------------------------------------------------
        self.scenarios.append("J — Responsividade 390 px")
        mobile = self.login(browser, self.email_a, self.password_a, "J", width=390, height=844)
        mobile.goto(f"{self.base}/projetos?clientId={CLIENT_A}", wait_until="networkidle", timeout=30000)
        mobile.get_by_text("F6 Gate Social Media A").first.wait_for(timeout=30000)
        overflow = mobile.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        self.check("J", "sem rolagem horizontal em 390 px", overflow <= 1, f"excesso={overflow}px")
        mobile.get_by_text("F6 Gate Roteiro atrasado").first.wait_for(timeout=30000)
        clipped = mobile.evaluate(
            """() => [...document.querySelectorAll('[aria-label="Forma de visualização"] button')]
                .filter(b => b.getBoundingClientRect().right > window.innerWidth + 1)
                .map(b => b.innerText.trim())"""
        )
        self.check("J", "Lista/Quadro/Calendário/Entregas visíveis em 390 px", clipped == [], f"cortados={clipped}")
        self.shot(mobile, "f6-j-390.png")


if __name__ == "__main__":
    sys.exit(ProjectsGate().run())
