#!/usr/bin/env python3
"""
Zafira Hub 2.1 - F7-2 Execucao do Onboarding Browser Runtime Gate (Homologation Rehearsal) - F7-2b
Navegador Chromium autenticado (Playwright) contra as imagens publicadas e o banco de ensaio.
Pessoas e clientes ficticios (seed-f7-gate.mjs / seed-f7-exec-gate.mjs). NENHUM modelo, etapa ou
execucao e semeado: o gate cria tudo pela API/interface, so no banco descartavel do CI.

Cenarios:
  A  Login, capacidades, menu e estado vazio
  B  Iniciar onboarding pela interface (atribuicoes a resolver, prazos, dependencias)
  C  B2: segundo inicio ativo recusado, simultaneo 201/409
  D  Colaborador: minhas etapas, concluir, evidencia obrigatoria, sem acoes excepcionais
  E  Gestor: Asana (somente vinculo), bloquear/desbloquear, reatribuir (carteira), conclusao automatica
  F  Conflito 409 entre duas sessoes sem sobrescrever
  G  Dispensa de etapa obrigatoria, conclusao antecipada (previa e bloqueio)
  H  Cancelamento e novo inicio
  I  Permissoes negativas, menu sem onboarding.view, carteira
  J  Isolamento da Org B
  K  Responsividade 390 px
  L  Nenhuma escrita no Asana simulado
"""

import json
import os
import pathlib
import re
import subprocess
import sys
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, sync_playwright

DLG = '[role="dialog"][data-state="open"]'
CLIENT_1 = "f7f7f7f7-c1c1-4c1c-8c1c-000000000001"
CLIENT_2 = "f7f7f7f7-c1c1-4c1c-8c1c-000000000002"
CONFIRM_TEXT = "Entendo que esta ação não pode ser desfeita."


def env_required(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[-] ERRO: variavel obrigatoria '{name}' ausente.", file=sys.stderr)
        sys.exit(1)
    return val


def sanitize(url: str) -> str:
    p = urlparse(url)
    return f"{p.path}?{p.query}" if p.query else p.path


class ExecutionGate:
    def __init__(self) -> None:
        self.base = os.environ.get("WEB_BASE_URL", "http://127.0.0.1:8083").rstrip("/")
        self.api_prefix = os.environ.get("API_PREFIX", "/hub-api")
        self.email_admin = os.environ.get("GATE_EMAIL_A", "gate-a@zafira.invalid")
        self.email_b = os.environ.get("GATE_EMAIL_B", "gate-b@zafira.invalid")
        self.email_manager = "gate-manager-a@zafira.invalid"
        self.email_member = "gate-pessoa-a@zafira.invalid"  # responsavel das etapas (funcao Designer)
        self.email_member2 = "gate-member-a@zafira.invalid"
        self.email_noview = "gate-semview-a@zafira.invalid"
        self.password_a = env_required("GATE_PASSWORD_A")
        self.password_b = env_required("GATE_PASSWORD_B")
        self.api_container = os.environ.get("API_CONTAINER_NAME", "api-f45-browser")
        self.mock_url = os.environ.get("ASANA_MOCK_INTERNAL_URL", "http://asana-mock:8080")
        self.skip_docker = os.environ.get("GATE_SKIP_DOCKER", "") == "1"
        self.artifacts = pathlib.Path(os.environ.get("ARTIFACT_DIR", "artifacts/onboarding-execution-browser"))
        self.artifacts.mkdir(parents=True, exist_ok=True)
        self.passed: List[str] = []
        self.failed: List[str] = []
        self.blockers: List[str] = []
        self.scenarios: List[str] = []
        self.screenshots: List[str] = []
        self.console_errors: List[str] = []
        self.template_id = ""
        self.exec1 = ""
        self.pessoa_member_id = ""

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
            low = res.url.lower()
            if any(t in low for t in ["supabase", "app.asana.com/api", "googleapis.com/calendar"]):
                self.blockers.append(f"Requisicao proibida pelo navegador: {sanitize(res.url)}")

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("response", on_response)

    def login(self, browser: Browser, email: str, password: str, scenario: str, width: int = 1280, height: int = 900) -> Page:
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

    # ------------------------------------------------------------------ helpers
    def goto(self, page: Page, path: str) -> None:
        page.goto(f"{self.base}{path}", wait_until="networkidle", timeout=30000)

    def open_exec(self, page: Page, exec_id: str) -> None:
        self.goto(page, f"/onboarding/execucoes/{exec_id}")
        page.get_by_test_id("exec-step-list").wait_for(timeout=20000)

    def step(self, page: Page, key: str):
        return page.locator(f'[data-testid="exec-step"][data-step-key="{key}"]')

    def status_of(self, page: Page, key: str) -> str:
        return self.step(page, key).get_attribute("data-status") or ""

    def wait_status(self, page: Page, key: str, status: str, timeout: int = 15000) -> bool:
        try:
            page.locator(f'[data-testid="exec-step"][data-step-key="{key}"][data-status="{status}"]').wait_for(timeout=timeout)
            return True
        except Exception:  # noqa: BLE001
            return False

    def make_steps(self, pessoa_id: str, fn_id: str) -> List[Dict[str, Any]]:
        def s(key: str, **over: Any) -> Dict[str, Any]:
            base = {"stepKey": key, "title": key, "kind": "MANUAL", "assigneeMode": "NONE", "dueAnchor": "RELEASED",
                    "evidenceKind": "NONE", "evidenceRequired": False, "completionCondition": "CONFIRMATION",
                    "blocksCompletion": False, "dependsOn": []}
            base.update(over)
            return base

        return [
            s("kickoff", title="Reunião de kickoff", assigneeMode="MEMBER", memberId=pessoa_id, dueBusinessDays=1),
            s("identidade", title="Criar identidade visual", assigneeMode="FUNCTION", functionId=fn_id, dependsOn=["kickoff"],
              dueBusinessDays=3, evidenceKind="LINK", evidenceRequired=True, completionCondition="EVIDENCE_PROVIDED", blocksCompletion=True),
            s("asana", title="Confirmar projeto no Asana", kind="CONFIRM_ASANA_PROJECT", completionCondition="ASANA_PROJECT_LINKED", dependsOn=["kickoff"]),
            s("opcional", title="Etapa opcional"),
        ]

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
            "decision": "F7-2b EXECUTION GATE PASS" if success else "F7-2b EXECUTION GATE FAIL",
            "scenariosExecuted": self.scenarios,
            "assertionsPassedCount": len(self.passed),
            "assertionsPassed": self.passed,
            "assertionsFailedCount": len(self.failed),
            "assertionsFailed": self.failed,
            "blockers": self.blockers,
            "screenshots": self.screenshots,
            "consoleErrorsCount": len(self.console_errors),
        }
        (self.artifacts / "onboarding-execution-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({k: report[k] for k in ("decision", "assertionsPassedCount", "assertionsFailedCount")}, ensure_ascii=False))
        for b in self.blockers:
            print(f"[-] BLOCKER: {b}", file=sys.stderr)
        for f in self.failed:
            print(f"[-] FAILED: {f}", file=sys.stderr)
        return 0 if success else 1

    # ------------------------------------------------------------------ suite
    def suite(self, browser: Browser) -> None:
        # A ---------------------------------------------------------------
        self.scenarios.append("A - Login, capacidades, menu e estado vazio")
        admin = self.login(browser, self.email_admin, self.password_a, "A")
        caps = (self.api(admin, "/api/v1/auth/capabilities").get("body") or {}).get("permissions") or {}
        self.check("A", "admin tem start, execute, override e cancel", all(caps.get(f"onboarding.{k}") is True for k in ["view", "start", "execute", "override", "cancel"]), str(caps))
        self.goto(admin, "/onboarding/execucoes")
        admin.get_by_text("Nenhum onboarding encontrado").first.wait_for(timeout=20000)
        self.ok("A", "estado vazio explicito, sem execucoes automaticas")
        self.check("A", "menu lateral exibe Onboarding", admin.locator("nav[aria-label='Navegação do sistema'] a").filter(has_text="Onboarding").count() > 0)
        self.check("A", "painel mostra indicadores zerados", admin.get_by_test_id("kpi-active").inner_text().strip() == "0")

        # setup pela API (so no banco de ensaio)
        members = self.api(admin, "/onboarding/members").get("body") or []
        self.pessoa_member_id = next(m["id"] for m in members if m["name"] == "Gate Pessoa Operacao")
        fns = self.api(admin, "/onboarding/functions", "POST", {"name": "F7-2 Designer"}).get("body") or []
        fn_id = next(f["id"] for f in fns if f["name"] == "F7-2 Designer")
        self.api(admin, f"/onboarding/functions/{fn_id}/members", "PUT", {"memberIds": [self.pessoa_member_id]})
        tpl = self.api(admin, "/onboarding/templates", "POST", {"name": "F7-2 Modelo Social"}).get("body") or {}
        self.template_id = tpl["id"]
        saved = self.api(admin, f"/onboarding/templates/{tpl['id']}/versions/{tpl['draft']['id']}", "PUT",
                         {"expectedUpdatedAt": tpl["draft"]["updatedAt"], "steps": self.make_steps(self.pessoa_member_id, fn_id)})
        pub = self.api(admin, f"/onboarding/templates/{tpl['id']}/versions/{tpl['draft']['id']}/publish", "POST",
                       {"expectedUpdatedAt": (saved.get("body") or {}).get("draft", {}).get("updatedAt"), "changeNote": "modelo do gate F7-2"})
        self.check("A", "modelo de teste publicado (via API, so no banco de ensaio)", saved["status"] == 200 and pub["status"] == 200, f"{saved['status']} {pub['status']}")

        # B ---------------------------------------------------------------
        self.scenarios.append("B - Iniciar onboarding")
        manager = self.login(browser, self.email_manager, self.password_a, "B")
        self.goto(manager, "/onboarding/execucoes")
        manager.get_by_test_id("start-onboarding").click()
        dlg = manager.locator(DLG)
        dlg.locator("#start-client").select_option(label="F7 Gate Cliente 1")
        dlg.locator("#start-template").select_option(label="F7-2 Modelo Social (v1)")
        dlg.get_by_test_id("confirm-start").click()
        manager.wait_for_url(re.compile(r".*/onboarding/execucoes/[0-9a-f-]{36}$"), timeout=20000)
        self.exec1 = manager.url.rsplit("/", 1)[-1]
        manager.get_by_test_id("exec-step-list").wait_for(timeout=20000)
        self.check("B", "kickoff pronta, identidade e Asana aguardando dependencia",
                   self.status_of(manager, "kickoff") == "READY" and self.status_of(manager, "identidade") == "WAITING" and self.status_of(manager, "asana") == "WAITING")
        attention = manager.get_by_test_id("attention-panel").inner_text()
        self.check("B", "atribuicoes a resolver listadas com mensagem compreensivel",
                   "Confirmar projeto no Asana" in attention and "Etapa opcional" in attention and "responsável elegível" in attention, attention[:300])
        self.check("B", "selo 'Sem responsável' nas etapas sem responsavel", self.step(manager, "asana").get_by_text("Sem responsável").count() >= 1)
        self.check("B", "responsavel da funcao resolvido (pessoa ativa com o cliente na carteira)", "Gate Pessoa Operacao" in self.step(manager, "identidade").inner_text())
        self.check("B", "prazo calculado na liberacao e 'definido ao liberar' nas dependentes",
                   "Prazo: " in self.step(manager, "kickoff").inner_text() and "definido ao liberar" in self.step(manager, "identidade").inner_text())
        self.check("B", "dependencias exibidas por nome", "Depende de: Reunião de kickoff" in self.step(manager, "identidade").inner_text())
        self.shot(manager, "f7b-b-detalhe.png")

        # C ---------------------------------------------------------------
        self.scenarios.append("C - B2")
        self.goto(manager, "/onboarding/execucoes")
        manager.get_by_test_id("execution-card").first.wait_for(timeout=15000)
        manager.get_by_test_id("start-onboarding").click()
        dlg = manager.locator(DLG)
        dlg.locator("#start-client").select_option(label="F7 Gate Cliente 1")
        dlg.locator("#start-template").select_option(label="F7-2 Modelo Social (v1)")
        dlg.get_by_test_id("confirm-start").click()
        err = dlg.get_by_test_id("start-error")
        err.wait_for(timeout=15000)
        self.check("C", "segundo inicio ativo e recusado com mensagem e link para o existente", "onboarding ativo" in err.inner_text() and err.get_by_role("link").count() == 1, err.inner_text()[:200])
        dlg.get_by_role("button", name="Cancelar").click()
        conc = admin.evaluate(
            """async ([prefix, clientId, templateId]) => {
                const call = () => fetch(prefix + '/onboarding/executions', { method: 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, templateId }) }).then(r => r.status);
                return Promise.all([call(), call()]);
            }""",
            [self.api_prefix, CLIENT_2, self.template_id],
        )
        self.check("C", "dois inicios simultaneos: um 201 e um 409", sorted(conc) == [201, 409], str(conc))

        # D ---------------------------------------------------------------
        self.scenarios.append("D - Colaborador")
        member = self.login(browser, self.email_member, self.password_a, "D")
        self.goto(member, "/onboarding/minhas-etapas")
        member.get_by_test_id("my-steps").wait_for(timeout=20000)
        mine = member.get_by_test_id("my-steps").inner_text()
        self.check("D", "minhas etapas lista a etapa atribuida, so da propria carteira", "Reunião de kickoff" in mine and "F7 Gate Cliente 2" not in mine, mine[:200])
        self.goto(member, "/onboarding/execucoes")
        member.get_by_test_id("execution-list").wait_for(timeout=20000)
        self.check("D", "membro nao tem botao de iniciar onboarding", member.get_by_test_id("start-onboarding").count() == 0)
        self.open_exec(member, self.exec1)
        self.check("D", "sem cancelar nem concluir antecipadamente", member.get_by_test_id("cancel-execution").count() == 0 and member.get_by_test_id("early-complete").count() == 0)
        kick_actions = self.step(member, "kickoff").get_by_test_id("step-actions").inner_text()
        self.check("D", "etapa propria: concluir permitido; dispensar e reatribuir ausentes",
                   "Concluir" in kick_actions and "Dispensar" not in kick_actions and "Reatribuir" not in kick_actions, kick_actions)
        self.check("D", "etapa sem responsavel: nenhuma acao para o membro", self.step(member, "asana").get_by_test_id("step-actions").count() == 0)
        self.step(member, "kickoff").get_by_test_id("action-complete").click()
        dlg = member.locator(DLG)
        self.check("D", "confirmacao obrigatoria para concluir (botao desabilitado)", dlg.get_by_test_id("confirm-complete").is_disabled())
        dlg.get_by_label("Confirmo que esta etapa foi concluída.").check()
        dlg.get_by_test_id("confirm-complete").click()
        self.check("D", "kickoff concluida e dependentes liberadas", self.wait_status(member, "kickoff", "DONE") and self.wait_status(member, "identidade", "READY"))
        self.step(member, "identidade").get_by_test_id("action-complete").click()
        dlg = member.locator(DLG)
        self.check("D", "evidencia obrigatoria: botao desabilitado sem link", dlg.get_by_test_id("confirm-complete").is_disabled())
        dlg.locator("#ev-link").fill("https://exemplo.test/identidade")
        dlg.get_by_test_id("confirm-complete").click()
        self.check("D", "identidade concluida com evidencia", self.wait_status(member, "identidade", "DONE"))
        self.shot(member, "f7b-d-colaborador.png")

        # E ---------------------------------------------------------------
        self.scenarios.append("E - Gestor")
        self.open_exec(manager, self.exec1)
        self.step(manager, "asana").get_by_test_id("action-complete").click()
        dlg = manager.locator(DLG)
        proj = dlg.locator("#asana-project")
        proj.wait_for(timeout=15000)
        if proj.evaluate("el => el.tagName") == "SELECT":
            proj.select_option(index=1)
        else:
            proj.fill("gate-proj-a1")
        dlg.get_by_test_id("confirm-complete").click()
        self.check("E", "etapa do Asana concluida so com projeto ja vinculado (sem escrita)", self.wait_status(manager, "asana", "DONE"))
        self.step(manager, "opcional").get_by_test_id("action-block").click()
        dlg = manager.locator(DLG)
        self.check("E", "bloqueio exige motivo", dlg.get_by_test_id("confirm-block").is_disabled())
        dlg.locator("#reason").fill("Aguardando briefing do cliente")
        dlg.get_by_test_id("confirm-block").click()
        manager.locator('[data-testid="exec-step"][data-step-key="opcional"]').get_by_text("Bloqueada", exact=True).first.wait_for(timeout=15000)
        self.check("E", "etapa bloqueada destacada e sem acao de concluir",
                   self.step(manager, "opcional").get_by_test_id("action-complete").count() == 0 and "Aguardando briefing" in self.step(manager, "opcional").inner_text())
        self.step(manager, "opcional").get_by_test_id("action-unblock").click()
        manager.locator(DLG).get_by_test_id("confirm-unblock").click()
        self.step(manager, "opcional").get_by_test_id("action-complete").wait_for(timeout=15000)
        self.ok("E", "etapa desbloqueada")
        # reatribuir: pessoa fora da carteira recusada; membro da carteira aceito
        self.step(manager, "opcional").get_by_test_id("action-reassign").click()
        dlg = manager.locator(DLG)
        dlg.locator("#assignee").select_option(label="Gate Pessoa Saida")
        dlg.locator("#reason").fill("Teste de carteira")
        dlg.get_by_test_id("confirm-reassign").click()
        derr = dlg.get_by_test_id("dialog-error")
        derr.wait_for(timeout=15000)
        self.check("E", "reatribuir fora da carteira e recusado com mensagem clara", "carteira" in derr.inner_text(), derr.inner_text())
        dlg.locator("#assignee").select_option(label="Gate Membro A")
        dlg.get_by_test_id("confirm-reassign").click()
        self.step(manager, "opcional").get_by_text("Responsável: Gate Membro A").wait_for(timeout=15000)
        self.ok("E", "reatribuido para pessoa elegivel")
        self.shot(manager, "f7b-e-gestor.png")

        # F ---------------------------------------------------------------
        self.scenarios.append("F - Conflito 409")
        stale = manager  # ja mostra 'opcional' pronta e com acoes
        stale.get_by_test_id("exec-step-list").wait_for()
        stale.reload(wait_until="networkidle")
        stale.get_by_test_id("exec-step-list").wait_for(timeout=15000)
        stale_btn = self.step(stale, "opcional").get_by_test_id("action-complete")
        stale_btn.wait_for(timeout=15000)
        # outra sessao conclui a mesma etapa (por override) e o onboarding conclui sozinho
        done = self.api(admin, f"/onboarding/executions/{self.exec1}/steps/opcional/complete", "POST", {"confirm": True})
        self.check("F", "outra sessao concluiu a etapa (e o onboarding concluiu automaticamente)", done["status"] == 200 and (done.get("body") or {}).get("status") == "COMPLETED", f"{done['status']} {done['text'][:120]}")
        stale_btn.click()
        dlg = stale.locator(DLG)
        dlg.get_by_label("Confirmo que esta etapa foi concluída.").check()
        dlg.get_by_test_id("confirm-complete").click()
        stale.get_by_test_id("conflict-banner").wait_for(timeout=15000)
        self.ok("F", "aviso de conflito exibido sem sobrescrever dados")
        stale.get_by_test_id("execution-state").get_by_text("Conclusão automática").wait_for(timeout=15000)
        self.check("F", "tela recarregada com a situacao atual (concluido, sem acoes)", stale.get_by_test_id("step-actions").count() == 0)
        self.shot(stale, "f7b-f-conflito.png")

        # G ---------------------------------------------------------------
        self.scenarios.append("G - Dispensa e conclusao antecipada")
        r2 = self.api(manager, "/onboarding/executions", "POST", {"clientId": CLIENT_1, "templateId": self.template_id})
        self.check("G", "concluido libera novo inicio (B2)", r2["status"] == 201, f"{r2['status']} {r2['text'][:120]}")
        exec2 = (r2.get("body") or {}).get("id", "")
        self.open_exec(manager, exec2)
        manager.get_by_test_id("early-complete").click()
        dlg = manager.locator(DLG)
        dlg.get_by_test_id("early-blocked").wait_for(timeout=10000)
        self.check("G", "conclusao antecipada bloqueada com etapa obrigatoria aberta", dlg.get_by_test_id("confirm-early").is_disabled() and "Criar identidade visual" in dlg.get_by_test_id("early-blocked").inner_text())
        dlg.get_by_role("button", name="Cancelar").click()
        manager.locator(DLG).wait_for(state="detached", timeout=10000)
        self.step(manager, "identidade").get_by_test_id("action-skip").click()
        dlg = manager.locator(DLG)
        self.check("G", "dispensa de etapa obrigatoria avisa e exige justificativa e confirmacao",
                   "obrigatória para concluir" in dlg.inner_text() and dlg.get_by_test_id("confirm-skip").is_disabled())
        dlg.locator("#reason").fill("Cliente ja possui identidade visual")
        dlg.get_by_label(CONFIRM_TEXT).check()
        dlg.get_by_test_id("confirm-skip").click()
        self.check("G", "etapa obrigatoria dispensada", self.wait_status(manager, "identidade", "SKIPPED"))
        self.check("G", "historico destaca a dispensa da etapa obrigatoria", manager.get_by_test_id("execution-history").get_by_text("etapa obrigatória dispensada").count() >= 1)
        manager.get_by_test_id("early-complete").click()
        dlg = manager.locator(DLG)
        preview = dlg.inner_text()
        self.check("G", "previa lista as etapas que serao dispensadas", "Serão dispensadas" in preview and "Reunião de kickoff" in preview, preview[:300])
        self.check("G", "exige justificativa e confirmacao", dlg.get_by_test_id("confirm-early").is_disabled())
        dlg.locator("#reason").fill("Cliente encerrou o contrato")
        dlg.get_by_label(CONFIRM_TEXT).check()
        dlg.get_by_test_id("confirm-early").click()
        manager.get_by_test_id("execution-state").get_by_text("Conclusão antecipada").wait_for(timeout=15000)
        statuses = [self.status_of(manager, k) for k in ["kickoff", "identidade", "asana", "opcional"]]
        self.check("G", "nenhuma etapa aberta apos a conclusao antecipada", all(s in ("DONE", "SKIPPED") for s in statuses), str(statuses))
        self.shot(manager, "f7b-g-antecipada.png")

        # H ---------------------------------------------------------------
        self.scenarios.append("H - Cancelamento")
        r3 = self.api(manager, "/onboarding/executions", "POST", {"clientId": CLIENT_1, "templateId": self.template_id})
        exec3 = (r3.get("body") or {}).get("id", "")
        self.open_exec(manager, exec3)
        manager.get_by_test_id("cancel-execution").click()
        dlg = manager.locator(DLG)
        self.check("H", "cancelar exige motivo e confirmacao", dlg.get_by_test_id("confirm-cancel").is_disabled())
        dlg.locator("#reason").fill("Cliente desistiu da contratacao")
        dlg.get_by_label(CONFIRM_TEXT).check()
        dlg.get_by_test_id("confirm-cancel").click()
        manager.get_by_test_id("cancelled-banner").wait_for(timeout=15000)
        self.check("H", "onboarding cancelado: etapas canceladas e sem acoes", manager.get_by_test_id("step-actions").count() == 0 and all(self.status_of(manager, k) == "CANCELLED" for k in ["kickoff", "asana"]))
        r4 = self.api(manager, "/onboarding/executions", "POST", {"clientId": CLIENT_1, "templateId": self.template_id})
        self.check("H", "cancelado libera novo inicio (B2)", r4["status"] == 201, f"{r4['status']}")
        exec4 = (r4.get("body") or {}).get("id", "")

        # I ---------------------------------------------------------------
        self.scenarios.append("I - Permissoes negativas")
        m2 = self.login(browser, self.email_member2, self.password_a, "I")
        r = self.api(m2, "/onboarding/executions", "POST", {"clientId": CLIENT_1, "templateId": self.template_id})
        self.check("I", "membro nao inicia onboarding (API 403)", r["status"] == 403, str(r["status"]))
        r = self.api(m2, f"/onboarding/executions/{exec4}/cancel", "POST", {"reason": "sem permissao"})
        self.check("I", "membro nao cancela (API 403)", r["status"] == 403, str(r["status"]))
        r = self.api(m2, f"/onboarding/executions/{exec4}/steps/kickoff/skip", "POST", {"reason": "sem permissao"})
        self.check("I", "membro nao dispensa (API 403)", r["status"] == 403, str(r["status"]))
        r = self.api(m2, f"/onboarding/executions/{exec4}/steps/kickoff/complete", "POST", {"confirm": True})
        self.check("I", "membro que nao e o responsavel nao conclui (API 403)", r["status"] == 403, str(r["status"]))
        # carteira: execucao do Cliente 2 nao e visivel ao membro
        c2 = self.api(admin, "/onboarding/executions?clientId=" + CLIENT_2).get("body") or []
        c2_id = c2[0]["id"] if c2 else ""
        self.goto(m2, f"/onboarding/execucoes/{c2_id}")
        m2.get_by_text("Onboarding não encontrado").first.wait_for(timeout=20000)
        self.ok("I", "execucao fora da carteira: 'Onboarding nao encontrado' (404)")
        lst = self.api(m2, "/onboarding/executions").get("body") or []
        self.check("I", "lista do membro so traz clientes da propria carteira", len(lst) > 0 and all(i["clientId"] == CLIENT_1 for i in lst))
        # sem onboarding.view
        nv = self.login(browser, self.email_noview, self.password_a, "I")
        pv = (self.api(nv, "/api/v1/auth/capabilities").get("body") or {}).get("permissions") or {}
        self.check("I", "usuario sem onboarding.view: capacidade negada", pv.get("onboarding.view") is False, str(pv))
        self.goto(nv, "/")
        nv.wait_for_timeout(1500)
        self.check("I", "menu lateral oculta Onboarding sem onboarding.view", nv.locator("nav[aria-label='Navegação do sistema'] a").filter(has_text="Onboarding").count() == 0)
        self.goto(nv, "/onboarding/execucoes")
        nv.get_by_text("Sem permissão para ver o onboarding").first.wait_for(timeout=20000)
        self.ok("I", "rota direta mostra 'sem permissao'")
        rr = self.api(nv, "/onboarding/executions")
        self.check("I", "backend recusa a leitura (403) mesmo com a rota direta", rr["status"] == 403, str(rr["status"]))
        self.shot(nv, "f7b-i-sem-permissao.png")

        # J ---------------------------------------------------------------
        self.scenarios.append("J - Isolamento Org B")
        pb = self.login(browser, self.email_b, self.password_b, "J")
        self.goto(pb, "/onboarding/execucoes")
        pb.get_by_text("Nenhum onboarding encontrado").first.wait_for(timeout=20000)
        self.ok("J", "Org B nao ve execucoes da Org A")
        self.goto(pb, f"/onboarding/execucoes/{self.exec1}")
        pb.get_by_text("Onboarding não encontrado").first.wait_for(timeout=20000)
        self.ok("J", "Org B recebe 'nao encontrado' ao abrir execucao da Org A")
        for path, method, body in [
            (f"/onboarding/executions/{self.exec1}", "GET", None),
            (f"/onboarding/executions/{exec4}/cancel", "POST", {"reason": "invasao"}),
            (f"/onboarding/executions/{exec4}/steps/kickoff/skip", "POST", {"reason": "invasao"}),
            (f"/onboarding/executions/{exec4}/steps/kickoff/reassign", "POST", {"memberId": self.pessoa_member_id, "reason": "invasao"}),
        ]:
            rr = self.api(pb, path, method, body)
            self.check("J", f"Org B: {method} {path.split('/')[3]} => 404", rr["status"] == 404, str(rr["status"]))
        ov = self.api(pb, "/onboarding/overview").get("body") or {}
        self.check("J", "painel da Org B zerado", ov.get("activeExecutions") == 0)

        # K ---------------------------------------------------------------
        self.scenarios.append("K - Responsividade 390 px")
        mob = self.login(browser, self.email_manager, self.password_a, "K", width=390, height=844)
        for path, wait_id in [("/onboarding/execucoes", "execution-list"), ("/onboarding/minhas-etapas", None), (f"/onboarding/execucoes/{exec4}", "exec-step-list")]:
            self.goto(mob, path)
            if wait_id:
                mob.get_by_test_id(wait_id).wait_for(timeout=20000)
            else:
                mob.wait_for_timeout(1500)
            over = mob.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
            self.check("K", f"sem rolagem horizontal em 390 px: {path.split('/')[2] if path.count('/') > 2 else path}", over <= 1, f"excesso={over}px")
        self.step(mob, "kickoff").get_by_test_id("action-complete").click()
        dlg = mob.locator(DLG)
        rect = dlg.evaluate("el => { const r = el.getBoundingClientRect(); return [r.left, r.right, window.innerWidth]; }")
        self.check("K", "dialogo cabe na tela de 390 px", rect[0] >= -1 and rect[1] <= rect[2] + 1, str(rect))
        self.shot(mob, "f7b-k-390-dialogo.png")
        dlg.get_by_role("button", name="Cancelar").click()
        self.goto(mob, "/onboarding/execucoes")
        mob.get_by_test_id("execution-list").wait_for(timeout=20000)
        self.shot(mob, "f7b-k-390-painel.png")

        # painel desktop para evidencia visual
        self.goto(manager, "/onboarding/execucoes")
        manager.get_by_test_id("execution-list").wait_for(timeout=20000)
        self.shot(manager, "f7b-painel-desktop.png")

        # L ---------------------------------------------------------------
        self.scenarios.append("L - Asana somente leitura")
        if self.skip_docker:
            self.ok("L", "verificacao do Asana simulado pulada localmente")
        else:
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
            self.check("L", "nenhuma escrita chegou ao Asana simulado", writes == 0, f"writes={writes}")


if __name__ == "__main__":
    sys.exit(ExecutionGate().run())
