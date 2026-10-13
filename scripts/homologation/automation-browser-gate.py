#!/usr/bin/env python3
"""
Zafira Hub 2.1 - F7-4b Automacoes n8n Browser Runtime Gate (Homologation Rehearsal)
Chromium autenticado (Playwright) contra as imagens publicadas, banco de ensaio e o SIMULADOR do n8n
(scripts/homologation/n8n-mock.mjs). NENHUM n8n real, nenhuma conta real, pessoas e clientes ficticios.
Nada e semeado de automacao: o gate configura conexao e fluxo, monta o modelo no construtor e acompanha a
execucao pela interface. O despacho e acionado por um processo auxiliar DENTRO do container da API (o servidor
segue com o despachante desligado); resultados do n8n sao enviados assinados pelo proprio gate.

Cenarios:
  A  Capacidades e menu (administrador, gerente so consulta, membro sem acesso)
  B  Conexao: estado vazio, despachante desligado, segredo salvo e nunca exibido
  C  Fluxos: destino negado, cadastro, ocultacao do caminho, habilitar/desabilitar
  D  Construtor: etapa de automacao, fluxo, publicacao imutavel
  E  Execucao: aguardando envio, sem conclusao manual, aviso de despachante desligado
  F  Envio assinado pelo simulador; enviada nao e concluida
  G  Resultados: falsificado recusado, falha, reenvio com justificativa, sucesso conclui, repeticao e tardio ignorados
  H  Esgotada: dispensa com justificativa
  I  Isolamento da Org B
  J  Responsividade 390 px
  K  Simulador: so POST assinados, sem segredo
"""

import hashlib
import hmac
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, sync_playwright

DLG = '[role="dialog"][data-state="open"]'
ORG_A = "11111111-1111-4111-8111-111111111111"
CLIENT_1 = "f7f7f7f7-c1c1-4c1c-8c1c-000000000001"
CLIENT_2 = "f7f7f7f7-c1c1-4c1c-8c1c-000000000002"


def env_required(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[-] ERRO: variavel obrigatoria '{name}' ausente.", file=sys.stderr)
        sys.exit(1)
    return val


def sanitize(url: str) -> str:
    p = urlparse(url)
    return f"{p.path}?{p.query}" if p.query else p.path


class AutomationGate:
    def __init__(self) -> None:
        self.base = os.environ.get("WEB_BASE_URL", "http://127.0.0.1:8083").rstrip("/")
        self.api_prefix = os.environ.get("API_PREFIX", "/hub-api")
        self.mock = os.environ.get("N8N_MOCK_URL", "http://127.0.0.1:8092").rstrip("/")
        self.mock_internal_host = os.environ.get("N8N_MOCK_INTERNAL_HOST", "n8n-mock:8092")
        self.secret = env_required("GATE_N8N_SECRET")
        self.email_admin = os.environ.get("GATE_EMAIL_A", "gate-a@zafira.invalid")
        self.email_b = os.environ.get("GATE_EMAIL_B", "gate-b@zafira.invalid")
        self.email_manager = "gate-manager-a@zafira.invalid"
        self.email_member = "gate-member-a@zafira.invalid"
        self.password_a = env_required("GATE_PASSWORD_A")
        self.password_b = env_required("GATE_PASSWORD_B")
        self.api_container = os.environ.get("API_CONTAINER_NAME", "api-f45-browser")
        self.artifacts = pathlib.Path(os.environ.get("ARTIFACT_DIR", "artifacts/automation-browser"))
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

    def check(self, scenario: str, what: str, condition: bool, why: str = "condicao falsa") -> None:
        (self.ok(scenario, what) if condition else self.fail(scenario, what, why))

    def shot(self, page: Page, name: str) -> None:
        page.screenshot(path=str(self.artifacts / name), full_page=True)
        self.screenshots.append(name)

    def listen(self, page: Page) -> None:
        def on_console(msg: Any) -> None:
            if msg.type == "error":
                self.console_errors.append(msg.text)
                if any(k in msg.text.lower() for k in ["uncaught", "minified react error"]):
                    self.blockers.append(f"Erro critico no console: {msg.text}")

        def on_page_error(err: Any) -> None:
            self.blockers.append(f"Excecao nao tratada na pagina: {err}")

        def on_response(res: Any) -> None:
            host = urlparse(res.url).netloc.lower()
            # o navegador nunca fala com o n8n (nem com o simulador): so o servidor despacha
            if any(host.endswith(t) for t in ["supabase.co", "app.asana.com", "googleapis.com", "n8n.cloud"]) or host.startswith("n8n-mock") or host.endswith(":8092"):
                self.blockers.append(f"Requisicao proibida pelo navegador: {sanitize(res.url)}")

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("response", on_response)

    def login(self, browser: Browser, email: str, password: str, scenario: str, width: int = 1280, height: int = 900) -> Page:
        last: Optional[Exception] = None
        for attempt in range(3):
            context = browser.new_context(viewport={"width": width, "height": height}, ignore_https_errors=True)
            page = context.new_page()
            self.listen(page)
            try:
                page.goto(f"{self.base}/login", wait_until="networkidle", timeout=30000)
                page.fill("#email", email)
                page.fill("#password", password)
                with page.expect_response(lambda r: "/api/v1/auth/login" in r.url and r.status == 200, timeout=15000):
                    page.click('button[type="submit"]')
                page.wait_for_url(lambda u: "/login" not in u, timeout=15000)
                self.ok(scenario, f"login {email}")
                return page
            except Exception as exc:  # noqa: BLE001
                last = exc
                context.close()
                print(f"[*] login {email}: tentativa {attempt + 1} falhou ({type(exc).__name__})", file=sys.stderr)
                time.sleep(65)
        raise RuntimeError(f"login falhou apos 3 tentativas: {last}")

    def api(self, page: Page, path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return page.evaluate(
            """async ([prefix, path, method, body]) => {
                const res = await fetch(prefix + path, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' },
                  body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
                let data = null; try { data = await res.json(); } catch (e) {}
                return { status: res.status, body: data, text: JSON.stringify(data) };
            }""",
            [self.api_prefix, path, method, body],
        )

    def goto(self, page: Page, path: str) -> None:
        page.goto(f"{self.base}{path}", wait_until="networkidle", timeout=30000)

    # ------------------------------------------------------------------ simulador e processo auxiliar
    def mock_control(self, payload: Dict[str, Any]) -> None:
        req = urllib.request.Request(f"{self.mock}/__control", data=json.dumps(payload).encode(), method="POST", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()

    def mock_requests(self) -> List[Dict[str, Any]]:
        with urllib.request.urlopen(f"{self.mock}/__requests", timeout=10) as r:
            return json.loads(r.read().decode())

    def dispatch(self) -> int:
        """Aciona um ciclo de despacho em processo auxiliar (o servidor segue com o despachante desligado)."""
        script = (
            "import('./dist/modules/onboarding/automation.service.js').then(async (m)=>{"
            "const r=await m.automationService.dispatchDue({limit:50});"
            "console.log(JSON.stringify({claimed:r.claimed}));process.exit(0);}).catch((e)=>{console.error(String(e));process.exit(1);})"
        )
        proc = subprocess.run(
            ["docker", "exec", "-w", "/app/apps/api", "-e", "N8N_DISPATCH_ENABLED=true", "-e", "N8N_ALLOWED_HOSTS=n8n-mock",
             "-e", "N8N_ALLOW_INSECURE_HTTP=true", "-e", "N8N_CALLBACK_BASE_URL=http://hub.invalid", self.api_container, "node", "-e", script],
            capture_output=True, text=True,
        )
        try:
            return int(json.loads(proc.stdout.strip().splitlines()[-1]).get("claimed", -1))
        except Exception:  # noqa: BLE001
            print(proc.stdout[-300:], proc.stderr[-500:], file=sys.stderr)
            return -1

    def db_exec(self, js: str) -> str:
        proc = subprocess.run(
            ["docker", "exec", "-w", "/app/apps/api", self.api_container, "node", "-e",
             "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{" + js + "})().then((r)=>{console.log(JSON.stringify(r));return p.$disconnect();}).catch((e)=>{console.error(String(e));process.exit(1);})"],
            capture_output=True, text=True,
        )
        return proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""

    def callback(self, org: str, payload: Dict[str, Any], secret: Optional[str] = None, ts: Optional[int] = None) -> int:
        body = json.dumps(payload)
        stamp = ts if ts is not None else int(time.time())
        sig = hmac.new((secret or self.secret).encode(), f"{stamp}.{body}".encode(), hashlib.sha256).hexdigest()
        req = urllib.request.Request(
            f"{self.base}{self.api_prefix}/integrations/n8n/callback/{org}", data=body.encode(), method="POST",
            headers={"Content-Type": "application/json", "X-Zafira-Timestamp": str(stamp), "X-Zafira-Signature": f"sha256={sig}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                self.last_callback = json.loads(r.read().decode() or "{}")
                return r.status
        except urllib.error.HTTPError as e:
            self.last_callback = {}
            return e.code

    # ------------------------------------------------------------------ execucao
    def run(self) -> int:
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
                try:
                    self.suite(browser)
                finally:
                    browser.close()
        except Exception as exc:  # noqa: BLE001
            self.blockers.append(f"Excecao fatal: {type(exc).__name__}: {exc}")

        success = not self.failed and not self.blockers
        report = {
            "gitSha": os.environ.get("GITHUB_SHA", "local"),
            "decision": "F7-4b AUTOMATION GATE PASS" if success else "F7-4b AUTOMATION GATE FAIL",
            "scenariosExecuted": self.scenarios,
            "assertionsPassedCount": len(self.passed),
            "assertionsPassed": self.passed,
            "assertionsFailedCount": len(self.failed),
            "assertionsFailed": self.failed,
            "blockers": self.blockers,
            "screenshots": self.screenshots,
            "consoleErrorsCount": len(self.console_errors),
        }
        (self.artifacts / "automation-browser-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({k: report[k] for k in ("decision", "assertionsPassedCount", "assertionsFailedCount")}, ensure_ascii=False))
        for b in self.blockers:
            print(f"[-] BLOCKER: {b}", file=sys.stderr)
        for f in self.failed:
            print(f"[-] FAILED: {f}", file=sys.stderr)
        return 0 if success else 1

    # ------------------------------------------------------------------ suite
    def step_card(self, page: Page, step_key: str) -> Any:
        return page.locator(f'[data-testid="exec-step"][data-step-key="{step_key}"]')

    def status_text(self, page: Page, step_key: str) -> str:
        loc = self.step_card(page, step_key).get_by_test_id("automation-status")
        loc.wait_for(timeout=20000)
        return loc.inner_text()

    def suite(self, browser: Browser) -> None:
        self.last_callback: Dict[str, Any] = {}
        self.mock_control({"reset": True, "script": [], "defaultStatus": 200})

        # A ---------------------------------------------------------------
        self.scenarios.append("A - Capacidades e menu")
        admin = self.login(browser, self.email_admin, self.password_a, "A")
        caps = (self.api(admin, "/api/v1/auth/capabilities").get("body") or {}).get("permissions", {})
        self.check("A", "administrador: automation.manage e automation.view", caps.get("automation.manage") is True and caps.get("automation.view") is True, str(caps))
        self.goto(admin, "/onboarding/execucoes")
        admin.get_by_test_id("tab-automacoes").wait_for(timeout=15000)
        self.ok("A", "administrador ve a aba Automacoes")

        manager = self.login(browser, self.email_manager, self.password_a, "A")
        mcaps = (self.api(manager, "/api/v1/auth/capabilities").get("body") or {}).get("permissions", {})
        self.check("A", "gerente: so consulta (view sem manage)", mcaps.get("automation.view") is True and mcaps.get("automation.manage") is False, str(mcaps))
        member = self.login(browser, self.email_member, self.password_a, "A")
        bcaps = (self.api(member, "/api/v1/auth/capabilities").get("body") or {}).get("permissions", {})
        self.check("A", "membro: sem automation.*", bcaps.get("automation.view") is False and bcaps.get("automation.manage") is False, str(bcaps))
        self.goto(member, "/onboarding/execucoes")
        member.wait_for_timeout(1500)
        self.check("A", "membro: aba Automacoes ausente", member.get_by_test_id("tab-automacoes").count() == 0)
        self.goto(member, "/onboarding/automacoes")
        member.get_by_text("Sem permissão para ver as automações").wait_for(timeout=15000)
        self.ok("A", "membro: tela recusa com mensagem de permissao")
        self.check("A", "membro: API recusa fluxos (403)", self.api(member, "/automation/flows")["status"] == 403)

        # B ---------------------------------------------------------------
        self.scenarios.append("B - Conexao")
        self.goto(admin, "/onboarding/automacoes")
        admin.get_by_test_id("no-connection").wait_for(timeout=15000)
        self.ok("B", "estado sem conexao explicado")
        self.check("B", "aviso de despachante desligado", admin.get_by_test_id("dispatcher-off").count() == 1)
        self.check("B", "politica do Asana visivel", "Asana" in admin.get_by_test_id("asana-policy").inner_text())
        admin.locator("#n8n-secret").fill("curto")
        admin.get_by_test_id("save-connection").click()
        admin.get_by_test_id("connection-error").wait_for(timeout=10000)
        self.ok("B", "segredo curto recusado na tela")
        admin.locator("#n8n-secret").fill(self.secret)
        admin.get_by_test_id("save-connection").click()
        admin.get_by_test_id("connection-status").get_by_text("Conexão configurada").wait_for(timeout=15000)
        self.ok("B", "conexao configurada")
        html = admin.content()
        self.check("B", "segredo nunca aparece na pagina nem fica no campo", self.secret not in html and admin.locator("#n8n-secret").input_value() == "")
        self.check("B", "so a impressao digital e mostrada", "Impressão digital" in admin.get_by_test_id("connection-status").inner_text())
        got = self.api(admin, "/automation/connection")
        self.check("B", "API de conexao nao devolve o segredo", self.secret not in got["text"], got["text"][:120])
        self.shot(admin, "f74-b-conexao.png")

        # C ---------------------------------------------------------------
        self.scenarios.append("C - Fluxos")
        admin.get_by_test_id("new-flow").click()
        admin.locator("#flow-name").fill("Boas-vindas")
        admin.locator("#flow-url").fill("https://evil.example/webhook/x")
        admin.get_by_test_id("save-flow").click()
        err = admin.get_by_test_id("flow-error")
        err.wait_for(timeout=10000)
        self.check("C", "destino fora da lista de hosts e recusado", "host" in err.inner_text().lower(), err.inner_text())
        admin.locator("#flow-url").fill(f"http://{self.mock_internal_host}/webhook/caminho-secreto-do-fluxo")
        admin.get_by_test_id("save-flow").click()
        admin.locator('[data-testid="flow-card"][data-flow-key="boas-vindas"]').wait_for(timeout=15000)
        self.ok("C", "fluxo cadastrado com identificador sugerido")
        card = admin.locator('[data-testid="flow-card"][data-flow-key="boas-vindas"]')
        # o caminho do webhook nunca e exibido (texto visivel) nem devolvido pela API
        listed = self.api(admin, "/automation/flows")
        self.check("C", "caminho do webhook nunca aparece na tela nem na API",
                   "caminho-secreto" not in admin.inner_text("body") and "caminho-secreto" not in listed["text"] and "n8n-mock" in card.inner_text(),
                   listed["text"][:200])
        card.get_by_test_id("toggle-flow").click()
        admin.locator('[data-testid="flow-card"][data-flow-key="boas-vindas"][data-enabled="false"]').wait_for(timeout=15000)
        card.get_by_test_id("toggle-flow").click()
        admin.locator('[data-testid="flow-card"][data-flow-key="boas-vindas"][data-enabled="true"]').wait_for(timeout=15000)
        self.ok("C", "desabilitar e habilitar o fluxo")
        self.shot(admin, "f74-c-fluxos.png")
        self.goto(manager, "/onboarding/automacoes")
        manager.locator('[data-testid="flow-card"][data-flow-key="boas-vindas"]').wait_for(timeout=15000)
        self.check("C", "gerente consulta mas nao gerencia (sem Novo fluxo, sem Editar, conexao oculta)",
                   manager.get_by_test_id("new-flow").count() == 0 and manager.get_by_test_id("edit-flow").count() == 0 and manager.get_by_test_id("connection-hidden").count() == 1)
        self.check("C", "gerente: API recusa alterar conexao (403)", self.api(manager, "/automation/connection", "PUT", {"secret": "x" * 40})["status"] == 403)

        # D ---------------------------------------------------------------
        self.scenarios.append("D - Construtor")
        name = f"Gate F7-4 Automacao {int(time.time())}"
        tpl = (self.api(admin, "/onboarding/templates", "POST", {"name": name}).get("body") or {})
        tpl_id = tpl.get("id", "")
        self.goto(admin, f"/onboarding/modelos/{tpl_id}")
        admin.get_by_test_id("add-step").click()
        admin.get_by_label("Título da etapa").fill("Disparar boas-vindas")
        admin.locator('input[type="radio"][value="AUTOMATION"]').check()
        admin.get_by_test_id("automation-flow-select").select_option("boas-vindas")
        admin.get_by_test_id("add-step").click()
        admin.get_by_label("Título da etapa").fill("Revisar entrega")
        admin.get_by_label("1. Disparar boas-vindas").check()
        admin.get_by_test_id("save-draft").click()
        admin.get_by_text("Rascunho salvo").first.wait_for(timeout=15000)
        self.ok("D", "rascunho com etapa de automacao salvo")
        detail = self.api(admin, f"/onboarding/templates/{tpl_id}").get("body") or {}
        steps = (detail.get("draft") or {}).get("steps", [])
        auto = next((s for s in steps if s.get("kind") == "AUTOMATION"), {})
        self.check("D", "etapa guarda tipo, condicao e fluxo", auto.get("completionCondition") == "AUTOMATION_SUCCEEDED" and auto.get("automationKey") == "boas-vindas", str(auto)[:200])
        admin.get_by_test_id("validate-draft").click()
        admin.get_by_text("pode ser publicado").first.wait_for(timeout=15000)
        admin.get_by_test_id("publish-draft").click()
        admin.locator(DLG).locator("#change-note").fill("Modelo com automacao")
        admin.locator(DLG).get_by_test_id("confirm-publish").click()
        admin.get_by_test_id("published-banner").wait_for(timeout=20000)
        self.ok("D", "versao publicada (imutavel)")
        self.check("D", "publicada abre em leitura (fluxo nao editavel)", admin.get_by_test_id("automation-flow-select").count() == 0 or admin.get_by_test_id("automation-flow-select").is_disabled())
        self.shot(admin, "f74-d-construtor.png")

        # E ---------------------------------------------------------------
        self.scenarios.append("E - Execucao aguardando envio")
        started = self.api(admin, "/onboarding/executions", "POST", {"clientId": CLIENT_1, "templateId": tpl_id})
        self.check("E", "onboarding iniciado", started["status"] == 201, started["text"][:200])
        exec_id = (started.get("body") or {}).get("id", "")
        auto_key = next((s["stepKey"] for s in (started.get("body") or {}).get("steps", []) if s.get("kind") == "AUTOMATION"), "")
        next_key = next((s["stepKey"] for s in (started.get("body") or {}).get("steps", []) if s.get("kind") != "AUTOMATION"), "")
        self.goto(admin, f"/onboarding/execucoes/{exec_id}")
        self.check("E", "estado: aguardando envio", "Aguardando envio" in self.status_text(admin, auto_key))
        card = self.step_card(admin, auto_key)
        self.check("E", "aviso: envio automatico desligado", "desligado" in card.get_by_test_id("automation-notice-step").inner_text())
        self.check("E", "sem botao de concluir na etapa de automacao", card.get_by_test_id("action-complete").count() == 0)
        manual = self.api(admin, f"/onboarding/executions/{exec_id}/steps/{auto_key}/complete", "POST", {})
        self.check("E", "API recusa conclusao manual (409)", manual["status"] == 409 and (manual.get("body") or {}).get("code") == "AUTOMATION_MANUAL_COMPLETION_NOT_ALLOWED", manual["text"][:160])
        off = self.api(admin, "/automation/dispatch", "POST", {})
        self.check("E", "despacho manual nao envia com o despachante desligado", (off.get("body") or {}).get("enabled") is False and len(self.mock_requests()) == 0)
        self.shot(admin, "f74-e-aguardando.png")

        # F ---------------------------------------------------------------
        self.scenarios.append("F - Envio assinado")
        claimed = self.dispatch()
        self.check("F", "ciclo de despacho reservou o pedido", claimed == 1, str(claimed))
        reqs = self.mock_requests()
        self.check("F", "simulador recebeu um POST assinado do tipo da etapa", len(reqs) == 1 and reqs[0]["signatureValid"] is True and reqs[0]["event"] == "STEP_AUTOMATION" and reqs[0]["method"] == "POST", str(reqs)[:300])
        pl = (reqs[0].get("payload") or {}) if reqs else {}
        self.check("F", "pedido minimo: organizacao, execucao, etapa, cliente e chave; sem nome do cliente", pl.get("organizationId") == ORG_A and pl.get("executionId") == exec_id and pl.get("stepKey") == auto_key and pl.get("clientId") == CLIENT_1 and "clientName" not in pl, str(pl)[:300])
        self.check("F", "sem cabecalho de credencial do Hub", reqs[0].get("hasSecretLikeHeader") is False if reqs else False)
        admin.reload(wait_until="networkidle")
        st = self.status_text(admin, auto_key)
        self.check("F", "enviada, aguardando resultado (nao concluida)", "Enviada" in st and self.step_card(admin, auto_key).get_attribute("data-status") != "DONE", st)
        self.check("F", "a tela explica que enviado nao e concluido", "Enviado não é concluído" in self.step_card(admin, auto_key).inner_text())
        self.shot(admin, "f74-f-enviada.png")

        # G ---------------------------------------------------------------
        self.scenarios.append("G - Resultados")
        idem = reqs[0].get("idempotencyKey") if reqs else ""
        forged = self.callback(ORG_A, {"idempotencyKey": idem, "callbackId": "gate-forged-0001", "status": "SUCCEEDED"}, secret="segredo-errado-0123456789-0123456789")
        self.check("G", "resultado com assinatura falsa recusado (401)", forged == 401, str(forged))
        stale = self.callback(ORG_A, {"idempotencyKey": idem, "callbackId": "gate-stale-0001", "status": "SUCCEEDED"}, ts=int(time.time()) - 3600)
        self.check("G", "resultado com carimbo de tempo vencido recusado (401)", stale == 401, str(stale))
        admin.reload(wait_until="networkidle")
        self.check("G", "nada mudou na tela apos tentativas invalidas", "Enviada" in self.status_text(admin, auto_key))

        failed = self.callback(ORG_A, {"idempotencyKey": idem, "callbackId": "gate-fail-0001", "status": "FAILED", "resultCode": "E_FLOW", "message": "Falha simulada do fluxo"})
        self.check("G", "falha autenticada registrada", failed == 200 and self.last_callback.get("applied") is True, str(self.last_callback))
        admin.reload(wait_until="networkidle")
        self.check("G", "estado: falhou, com a mensagem do fluxo", "Falhou" in self.status_text(admin, auto_key) and "Falha simulada do fluxo" in self.step_card(admin, auto_key).inner_text())
        self.check("G", "etapa segue aberta sem conclusao manual", self.step_card(admin, auto_key).get_attribute("data-status") != "DONE" and self.step_card(admin, auto_key).get_by_test_id("action-complete").count() == 0)
        self.check("G", "administrador ve Reenviar e Refazer", self.step_card(admin, auto_key).get_by_test_id("action-resend").count() == 1 and self.step_card(admin, auto_key).get_by_test_id("action-redo").count() == 1)
        self.shot(admin, "f74-g-falha.png")
        self.goto(member, f"/onboarding/execucoes/{exec_id}")
        member.get_by_test_id("automation-noperm").wait_for(timeout=15000)
        self.check("G", "membro sem excecao nao ve botoes de reenvio e e orientado", self.step_card(member, auto_key).get_by_test_id("action-resend").count() == 0)
        self.check("G", "membro: API recusa reenvio (403)", self.api(member, f"/onboarding/executions/{exec_id}/steps/{auto_key}/automation/resend", "POST", {"mode": "RETRY", "reason": "tentativa indevida"})["status"] == 403)

        self.step_card(admin, auto_key).get_by_test_id("action-resend").click()
        admin.locator(DLG).get_by_test_id("confirm-resend").wait_for(timeout=5000)
        self.check("G", "reenvio exige justificativa", admin.locator(DLG).get_by_test_id("confirm-resend").is_disabled())
        admin.locator(DLG).locator("#reason").fill("Fluxo corrigido no n8n")
        admin.locator(DLG).get_by_test_id("confirm-resend").click()
        admin.get_by_text("Reenvio solicitado").first.wait_for(timeout=15000)
        self.check("G", "reenvio volta para aguardando envio", "Aguardando envio" in self.status_text(admin, auto_key))
        self.mock_control({"reset": True})
        claimed2 = self.dispatch()
        reqs2 = self.mock_requests()
        self.check("G", "reenvio usa a MESMA chave de idempotencia", claimed2 == 1 and len(reqs2) == 1 and reqs2[0].get("idempotencyKey") == idem, str(reqs2)[:200])

        ok = self.callback(
            ORG_A,
            {"idempotencyKey": idem, "callbackId": "gate-ok-0001", "status": "SUCCEEDED", "resultCode": "OK", "message": "Concluido pelo fluxo",
             "externalRefs": [{"type": "n8n", "label": "Execucao 42 no n8n", "url": "https://n8n.example.invalid/execution/42"}]},
        )
        self.check("G", "resultado de sucesso autenticado aplicado", ok == 200 and self.last_callback.get("reason") == "STEP_COMPLETED", str(self.last_callback))
        admin.reload(wait_until="networkidle")
        self.check("G", "estado: concluida com sucesso", "Concluída com sucesso" in self.status_text(admin, auto_key))
        card = self.step_card(admin, auto_key)
        self.check("G", "concluida automaticamente (sistema) e etapa DONE", card.get_attribute("data-status") == "DONE" and card.get_by_test_id("completed-by-system").count() == 1)
        self.check("G", "referencia externa e resultado exibidos", card.get_by_test_id("automation-refs").get_by_text("Execucao 42 no n8n").count() == 1 and "Concluido pelo fluxo" in card.get_by_test_id("automation-result").inner_text())
        self.check("G", "etapa seguinte liberada", self.step_card(admin, next_key).get_attribute("data-status") == "READY")
        self.check("G", "historico registra eventos de automacao e conclusao pelo sistema", admin.get_by_test_id("execution-history").locator('[data-event-type="AUTOMATION_SENT"]').count() >= 1 and "Sistema" in admin.get_by_test_id("execution-history").inner_text())
        replay = self.callback(ORG_A, {"idempotencyKey": idem, "callbackId": "gate-ok-0001", "status": "SUCCEEDED"})
        self.check("G", "repeticao do mesmo resultado nao reaplica", replay == 200 and self.last_callback.get("applied") is False, str(self.last_callback))
        late = self.callback(ORG_A, {"idempotencyKey": idem, "callbackId": "gate-late-0001", "status": "FAILED", "message": "tarde"})
        self.check("G", "resultado tardio nao reverte a conclusao", late == 200 and self.last_callback.get("applied") is False, str(self.last_callback))
        admin.reload(wait_until="networkidle")
        self.check("G", "tela segue concluida", "Concluída com sucesso" in self.status_text(admin, auto_key))
        self.shot(admin, "f74-g-concluida.png")

        # H ---------------------------------------------------------------
        self.scenarios.append("H - Esgotada e dispensa")
        s2 = self.api(admin, "/onboarding/executions", "POST", {"clientId": CLIENT_2, "templateId": tpl_id})
        exec2 = (s2.get("body") or {}).get("id", "")
        self.mock_control({"reset": True, "defaultStatus": 200})
        self.dispatch()
        self.db_exec(f"return await p.automationOutbox.updateMany({{where:{{executionId:'{exec2}',stepKey:'{auto_key}'}},data:{{status:'DEAD',lastError:'Tentativas esgotadas (simulado)'}}}});")
        self.goto(admin, f"/onboarding/execucoes/{exec2}")
        self.check("H", "estado: tentativas esgotadas", "Tentativas esgotadas" in self.status_text(admin, auto_key))
        card = self.step_card(admin, auto_key)
        self.check("H", "reenviar, refazer e dispensar disponiveis; concluir nao", card.get_by_test_id("action-resend").count() == 1 and card.get_by_test_id("action-skip").count() == 1 and card.get_by_test_id("action-complete").count() == 0)
        card.get_by_test_id("action-skip").click()
        admin.locator(DLG).locator("#reason").fill("Boas-vindas enviadas manualmente pelo atendimento")
        admin.locator(DLG).locator('input[type="checkbox"]').check()
        admin.locator(DLG).get_by_test_id("confirm-skip").click()
        admin.locator(f'[data-testid="exec-step"][data-step-key="{auto_key}"][data-status="SKIPPED"]').wait_for(timeout=15000)
        self.ok("H", "dispensa com justificativa encerra a etapa (sem sucesso fabricado)")
        self.shot(admin, "f74-h-esgotada.png")

        # I ---------------------------------------------------------------
        self.scenarios.append("I - Isolamento Org B")
        pb = self.login(browser, self.email_b, self.password_b, "I")
        self.check("I", "Org B: nenhum fluxo da Org A", (self.api(pb, "/automation/flows").get("body") or []) == [])
        self.check("I", "Org B: sem historico de automacao da execucao da Org A", (self.api(pb, f"/onboarding/executions/{exec_id}/automation").get("body") or []) == [])
        self.check("I", "Org B: reenvio na execucao da Org A recusado", self.api(pb, f"/onboarding/executions/{exec_id}/steps/{auto_key}/automation/resend", "POST", {"mode": "RETRY", "reason": "tentativa indevida"})["status"] in (403, 404, 409))
        cross = self.callback("22222222-2222-4222-8222-222222222222", {"idempotencyKey": idem, "callbackId": "gate-cross-0001", "status": "SUCCEEDED"})
        self.check("I", "resultado assinado com o segredo da Org A recusado na URL da Org B (401)", cross == 401, str(cross))
        self.goto(pb, "/onboarding/automacoes")
        pb.get_by_test_id("no-connection").wait_for(timeout=15000)
        self.check("I", "Org B: tela sem fluxos nem conexao da Org A", pb.get_by_test_id("flow-card").count() == 0)

        # J ---------------------------------------------------------------
        self.scenarios.append("J - Responsividade 390 px")
        admin.set_viewport_size({"width": 390, "height": 800})
        for path, label in [("/onboarding/automacoes", "configuracao"), (f"/onboarding/execucoes/{exec_id}", "execucao")]:
            self.goto(admin, path)
            admin.wait_for_timeout(800)
            overflow = admin.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            self.check("J", f"390 px: {label} sem rolagem horizontal", overflow <= 1, f"excesso {overflow}px")
        self.shot(admin, "f74-j-390.png")

        # K ---------------------------------------------------------------
        self.scenarios.append("K - Simulador")
        self.mock_control({"reset": False})
        allr = self.mock_requests()
        self.check("K", "so POST assinados chegaram ao simulador", all(r["method"] == "POST" and r["signatureValid"] for r in allr), str(allr)[:200])
        self.check("K", "nenhum segredo trafegou no corpo", self.secret not in json.dumps(allr))


if __name__ == "__main__":
    sys.exit(AutomationGate().run())
