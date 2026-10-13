#!/usr/bin/env python3
"""
Zafira Hub 2.1 - F7-1 Onboarding Browser Runtime Gate (Homologation Rehearsal) - F7-1b
Navegador Chromium autenticado (Playwright) contra as imagens publicadas e o banco de ensaio.
Pessoas ficticias (seed-f7-gate.mjs). NENHUM modelo/etapa/funcao e semeado: o gate cria tudo
pela interface, e os dados existem so no banco descartavel do CI.

Cenarios:
  A  Login, capacidades e estado vazio
  B  Funcoes operacionais (criar, nome repetido, pessoas)
  C  Construtor: criar modelo, etapas, reordenar por teclado, remover, Calendar disponivel (F7-3c)
  D  Validacao negativa: etapa sem titulo e dependencia circular bloqueiam a publicacao
  E  Publicar v1, leitura imutavel, nova versao v2, historico
  F  Conflito de salvamento (409) entre duas sessoes
  G  Duplicar, arquivar e reativar
  H  Funcao desativada e pessoa removida sem quebrar o historico
  I  Permissoes negativas (gestor, membro) e isolamento da Org B
  J  Responsividade 390 px sem rolagem horizontal
  K  Nenhuma escrita no Asana simulado
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
PERSON_EXIT_ID = "f7f7f7f7-aaaa-4aaa-8aaa-000000000004"


def env_required(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[-] ERRO: variavel obrigatoria '{name}' ausente.", file=sys.stderr)
        sys.exit(1)
    return val


def sanitize(url: str) -> str:
    p = urlparse(url)
    return f"{p.path}?{p.query}" if p.query else p.path


class OnboardingGate:
    def __init__(self) -> None:
        self.base = os.environ.get("WEB_BASE_URL", "http://127.0.0.1:8083").rstrip("/")
        self.api_prefix = os.environ.get("API_PREFIX", "/hub-api")
        self.email_a = os.environ.get("GATE_EMAIL_A", "gate-a@zafira.invalid")
        self.email_b = os.environ.get("GATE_EMAIL_B", "gate-b@zafira.invalid")
        self.email_manager = "gate-manager-a@zafira.invalid"
        self.email_member = "gate-member-a@zafira.invalid"
        self.password_a = env_required("GATE_PASSWORD_A")
        self.password_b = env_required("GATE_PASSWORD_B")
        self.api_container = os.environ.get("API_CONTAINER_NAME", "api-f45-browser")
        self.mock_url = os.environ.get("ASANA_MOCK_INTERNAL_URL", "http://asana-mock:8080")
        self.skip_docker = os.environ.get("GATE_SKIP_DOCKER", "") == "1"
        self.artifacts = pathlib.Path(os.environ.get("ARTIFACT_DIR", "artifacts/onboarding-browser"))
        self.artifacts.mkdir(parents=True, exist_ok=True)
        self.passed: List[str] = []
        self.failed: List[str] = []
        self.blockers: List[str] = []
        self.scenarios: List[str] = []
        self.screenshots: List[str] = []
        self.console_errors: List[str] = []
        self.template_id = ""
        self.template_name = "Onboarding Social Media"

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

    # ------------------------------------------------------------------ helpers de UI
    def goto(self, page: Page, path: str) -> None:
        page.goto(f"{self.base}{path}", wait_until="networkidle", timeout=30000)

    def open_builder(self, page: Page) -> None:
        self.goto(page, f"/onboarding/modelos/{self.template_id}")
        page.get_by_test_id("template-state").wait_for(timeout=20000)

    def notice(self, page: Page) -> str:
        loc = page.get_by_test_id("onboarding-notice")
        loc.first.wait_for(state="visible", timeout=15000)
        return loc.first.inner_text()

    def select_step(self, page: Page, index: int) -> None:
        page.get_by_test_id("step-item").nth(index).locator("button[aria-pressed]").click()
        page.get_by_test_id("step-editor").wait_for(timeout=5000)

    def add_step(self, page: Page, title: str) -> None:
        page.get_by_test_id("add-step").click()
        page.get_by_label("Título da etapa").fill(title)

    def step_titles(self, page: Page) -> List[str]:
        return [t.strip() for t in page.get_by_test_id("step-item").locator(".stepName, [class*=stepName]").all_inner_texts()]

    def template_detail(self, page: Page) -> Dict[str, Any]:
        r = self.api(page, f"/onboarding/templates/{self.template_id}")
        return r.get("body") or {}

    def suspend_person(self) -> bool:
        if self.skip_docker:
            return False
        script = (
            "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();"
            f"p.organizationMember.updateMany({{where:{{userId:'{PERSON_EXIT_ID}'}},data:{{status:'SUSPENDED'}}}})"
            ".then(r=>{console.log(JSON.stringify({count:r.count}));return p.$disconnect();})"
        )
        probe = subprocess.run(["docker", "exec", "-w", "/app", self.api_container, "node", "-e", script], capture_output=True, text=True)
        try:
            return json.loads(probe.stdout.strip().splitlines()[-1]).get("count", 0) == 1
        except Exception:  # noqa: BLE001
            print(probe.stderr[-300:], file=sys.stderr)
            return False

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
            "decision": "F7-1b ONBOARDING GATE PASS" if success else "F7-1b ONBOARDING GATE FAIL",
            "scenariosExecuted": self.scenarios,
            "assertionsPassedCount": len(self.passed),
            "assertionsPassed": self.passed,
            "assertionsFailedCount": len(self.failed),
            "assertionsFailed": self.failed,
            "blockers": self.blockers,
            "screenshots": self.screenshots,
            "consoleErrorsCount": len(self.console_errors),
        }
        (self.artifacts / "onboarding-browser-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({k: report[k] for k in ("decision", "assertionsPassedCount", "assertionsFailedCount")}, ensure_ascii=False))
        for b in self.blockers:
            print(f"[-] BLOCKER: {b}", file=sys.stderr)
        for f in self.failed:
            print(f"[-] FAILED: {f}", file=sys.stderr)
        return 0 if success else 1

    def suite(self, browser: Browser) -> None:
        # A ---------------------------------------------------------------
        self.scenarios.append("A - Login, capacidades e estado vazio")
        page = self.login(browser, self.email_a, self.password_a, "A")
        caps = self.api(page, "/api/v1/auth/capabilities")
        perms = (caps.get("body") or {}).get("permissions") or {}
        self.check("A", "admin tem onboarding.view e manage_templates/manage_functions", all(perms.get(k) is True for k in ["onboarding.view", "onboarding.manage_templates", "onboarding.manage_functions"]), str(perms))
        self.goto(page, "/onboarding/modelos")
        page.get_by_text("Nenhum modelo criado").first.wait_for(timeout=20000)
        self.ok("A", "estado vazio explicito, sem modelos automaticos")
        self.check("A", "menu lateral exibe Onboarding", page.locator("nav a, aside a").filter(has_text="Onboarding").count() > 0)
        self.shot(page, "f7-a-vazio.png")

        # B ---------------------------------------------------------------
        self.scenarios.append("B - Funcoes operacionais")
        self.goto(page, "/onboarding/funcoes")
        page.get_by_text("Nenhuma função criada").first.wait_for(timeout=20000)
        for name in ["Designer", "Atendimento"]:
            page.get_by_test_id("new-function").click()
            dlg = page.locator(DLG)
            dlg.locator("#fn-name").fill(name)
            dlg.get_by_test_id("confirm-function-name").click()
            page.locator(f'[data-testid="function-card"][data-function-name="{name}"]').wait_for(timeout=15000)
        self.ok("B", "funcoes Designer e Atendimento criadas pela interface")
        page.get_by_test_id("new-function").click()
        dlg = page.locator(DLG)
        dlg.locator("#fn-name").fill("designer")
        dlg.get_by_test_id("confirm-function-name").click()
        dlg.get_by_role("alert").wait_for(timeout=10000)
        self.check("B", "nome repetido (sem diferenciar caixa) e recusado", "já existe" in dlg.inner_text().lower(), dlg.inner_text()[:200])
        dlg.get_by_role("button", name="Cancelar").click()
        card = page.locator('[data-testid="function-card"][data-function-name="Designer"]')
        card.get_by_test_id("edit-function-members").click()
        dlg = page.locator(DLG)
        checklist = dlg.get_by_test_id("member-checklist").inner_text()
        self.check("B", "so pessoas da Org A na lista (sem Org B)", "Gate Pessoa Operacao" in checklist and "Gate Admin B" not in checklist, checklist[:200])
        dlg.get_by_label("Gate Pessoa Operacao").check()
        dlg.get_by_test_id("confirm-function-members").click()
        page.locator(DLG).wait_for(state="detached", timeout=15000)
        card.get_by_text("Gate Pessoa Operacao").wait_for(timeout=15000)
        self.ok("B", "pessoa vinculada a funcao")
        self.check("B", "funcao nao concede permissao (aviso na tela)", "não concede nenhuma permissão" in page.locator("main").inner_text())
        self.shot(page, "f7-b-funcoes.png")

        # C ---------------------------------------------------------------
        self.scenarios.append("C - Construtor")
        self.goto(page, "/onboarding/modelos")
        page.get_by_test_id("new-template").first.click()
        dlg = page.locator(DLG)
        dlg.locator("#tpl-name").fill(self.template_name)
        dlg.locator("#tpl-scope").select_option("SERVICE")
        dlg.locator("#tpl-scope-label").fill("Gestão de redes sociais")
        dlg.get_by_test_id("confirm-create").click()
        page.wait_for_url(re.compile(r".*/onboarding/modelos/[0-9a-f-]{36}$"), timeout=20000)
        self.template_id = page.url.rsplit("/", 1)[-1]
        page.get_by_test_id("template-state").wait_for(timeout=20000)
        self.check("C", "modelo novo nasce como Rascunho v1 sem etapas", "Rascunho v1" in page.get_by_test_id("template-state").inner_text() and page.get_by_test_id("steps-empty").count() == 1)

        self.add_step(page, "Reunião de kickoff")
        page.get_by_label("Prazo em dias úteis (opcional)").fill("1")
        self.add_step(page, "Criar identidade visual")
        page.get_by_label("Uma função").check()
        page.get_by_label("Função", exact=True).select_option(label="Designer")
        page.get_by_label("Prazo em dias úteis (opcional)").fill("5")
        page.get_by_label("Evidência", exact=True).select_option("LINK")
        page.get_by_label("Só conclui com a evidência informada").check()
        page.get_by_label("1. Reunião de kickoff").check()
        self.add_step(page, "Confirmar projeto no Asana")
        page.get_by_label("Confirmar projeto do Asana").check()
        page.get_by_label("Uma função").check()
        page.get_by_label("Função", exact=True).select_option(label="Atendimento")
        page.get_by_label("1. Reunião de kickoff").check()
        self.add_step(page, "Etapa temporária")
        self.check("C", "4 etapas na lista", page.get_by_test_id("step-item").count() == 4)

        calendar_radio = page.get_by_label("Reunião no Calendar", exact=True)
        self.check("C", "etapa de Calendar disponivel no construtor (F7-3c, somente leitura)", not calendar_radio.is_disabled())
        automation_radio = page.locator('input[type="radio"][value="AUTOMATION"]')
        self.check("C", "etapa de automacao disponivel no construtor (F7-4b, conclui so pelo resultado do n8n)", automation_radio.count() == 1 and not automation_radio.is_disabled())

        # reordenar por teclado: sobe a etapa 3 (Asana) para a posicao 2
        up = page.get_by_test_id("step-item").nth(2).get_by_test_id("move-up")
        up.focus()
        page.keyboard.press("Enter")
        titles = page.get_by_test_id("step-item").all_inner_texts()
        self.check("C", "reordenacao por teclado (Enter no botao 'subir')", "Confirmar projeto no Asana" in titles[1] and "Criar identidade visual" in titles[2], str([t.replace("\n", " ") for t in titles]))
        # remover a etapa temporaria (ultima)
        page.get_by_test_id("step-item").nth(3).get_by_test_id("remove-step").click()
        self.check("C", "etapa removida", page.get_by_test_id("step-item").count() == 3)
        self.check("C", "alteracoes nao salvas sinalizadas", page.get_by_text("Alterações não salvas").count() == 1)
        page.get_by_test_id("save-draft").click()
        self.check("C", "rascunho salvo", "Rascunho salvo" in self.notice(page))
        self.check("C", "sinal de nao salvo some", page.get_by_text("Alterações não salvas").count() == 0)
        page.reload(wait_until="networkidle")
        page.get_by_test_id("step-item").first.wait_for(timeout=15000)
        self.check("C", "etapas persistem apos recarregar (3, ordem mantida)", page.get_by_test_id("step-item").count() == 3 and "Confirmar projeto no Asana" in page.get_by_test_id("step-item").nth(1).inner_text())
        self.shot(page, "f7-c-construtor.png")

        # D ---------------------------------------------------------------
        self.scenarios.append("D - Validacao negativa")
        page.get_by_test_id("add-step").click()  # etapa sem titulo (4a)
        self.select_step(page, 0)
        page.get_by_label("4. Etapa sem título").check()  # kickoff depende da etapa 4
        self.select_step(page, 3)
        page.get_by_label("1. Reunião de kickoff").check()  # etapa 4 depende do kickoff -> ciclo
        page.get_by_test_id("validate-draft").click()
        panel = page.get_by_test_id("problems-panel")
        panel.wait_for(timeout=15000)
        txt = panel.inner_text()
        self.check("D", "problema indica a etapa e o campo (titulo obrigatorio)", re.search(r"Etapa 4: título obrigatório", txt) is not None, txt[:300])
        self.check("D", "dependencia circular listada com nomes legiveis", "Dependência circular" in txt and "s_" not in txt, txt[:300])
        self.check("D", "botao Publicar fica desabilitado enquanto ha problemas", page.get_by_test_id("publish-draft").is_disabled())
        detail = self.template_detail(page)
        draft = detail.get("draft") or {}
        forced = self.api(page, f"/onboarding/templates/{self.template_id}/versions/{draft.get('id', '')}/publish", "POST", {"expectedUpdatedAt": draft.get("updatedAt"), "changeNote": "Tentativa invalida"})
        self.check("D", "API tambem recusa publicar com problemas (400 NOT_PUBLISHABLE)", forced["status"] == 400 and (forced.get("body") or {}).get("code") == "NOT_PUBLISHABLE", f"{forced['status']} {forced['text'][:150]}")
        detail = self.template_detail(page)
        self.check("D", "nenhuma versao foi publicada", detail.get("published") is None and detail.get("draft") is not None, str(detail.get("published")))
        self.shot(page, "f7-d-problemas.png")
        # corrige: tira a dependencia circular e apaga a etapa vazia
        self.select_step(page, 0)
        page.get_by_label("4. Etapa sem título").uncheck()
        page.get_by_test_id("step-item").nth(3).get_by_test_id("remove-step").click()
        page.get_by_test_id("validate-draft").click()
        self.check("D", "apos corrigir, validacao libera a publicacao", "pode ser publicado" in self.notice(page))
        self.check("D", "painel de problemas some", page.get_by_test_id("problems-panel").count() == 0)

        # E ---------------------------------------------------------------
        self.scenarios.append("E - Publicar e versionar")
        page.get_by_test_id("publish-draft").click()
        page.locator(DLG).locator("#change-note").fill("Primeira versão do onboarding")
        page.locator(DLG).get_by_test_id("confirm-publish").click()
        page.get_by_test_id("published-banner").wait_for(timeout=20000)
        self.check("E", "estado Publicado v1", "Publicado v1" in page.get_by_test_id("template-state").inner_text())
        self.check("E", "versao publicada abre em leitura (campos desabilitados, sem + Etapa)", page.get_by_label("Título da etapa").is_disabled() and page.get_by_test_id("add-step").count() == 0)
        detail = self.template_detail(page)
        v1_id = (detail.get("published") or {}).get("id", "")
        put = self.api(page, f"/onboarding/templates/{self.template_id}/versions/{v1_id}", "PUT", {"expectedUpdatedAt": "2026-01-01T00:00:00.000Z", "steps": []})
        self.check("E", "API recusa escrita na versao publicada (409)", put["status"] == 409 and (put.get("body") or {}).get("code") == "VERSION_PUBLISHED", f"{put['status']} {put['text'][:150]}")
        self.shot(page, "f7-e-publicado.png")

        page.get_by_test_id("create-draft").click()
        page.get_by_test_id("template-state").filter(has_text="Rascunho v2").wait_for(timeout=15000)
        page.get_by_test_id("step-item").first.locator("button[aria-pressed]").click()
        page.get_by_label("Título da etapa").fill("Reunião de kickoff (v2)")
        page.get_by_test_id("save-draft").click()
        self.notice(page)
        page.get_by_test_id("publish-draft").click()
        page.locator(DLG).locator("#change-note").fill("Ajuste do título do kickoff")
        page.locator(DLG).get_by_test_id("confirm-publish").click()
        page.get_by_test_id("template-state").filter(has_text="Publicado v2").wait_for(timeout=20000)
        hist = page.get_by_test_id("version-history").inner_text()
        self.check("E", "historico lista v1 e v2 publicadas com notas", "v1" in hist and "v2" in hist and "Primeira versão do onboarding" in hist and "Ajuste do título do kickoff" in hist, hist[:300])
        detail = self.template_detail(page)
        self.check("E", "v2 vigente com titulo novo; v1 permanece publicada no historico", "(v2)" in json.dumps(detail.get("published", {}), ensure_ascii=False) and len([v for v in detail.get("versions", []) if v.get("status") == "PUBLISHED"]) == 2)

        # F ---------------------------------------------------------------
        self.scenarios.append("F - Conflito de salvamento")
        page.get_by_test_id("create-draft").click()
        page.get_by_test_id("template-state").filter(has_text="Rascunho v3").wait_for(timeout=15000)
        other = self.login(browser, self.email_a, self.password_a, "F")
        self.open_builder(other)
        other.get_by_test_id("step-item").first.locator("button[aria-pressed]").click()
        other.get_by_label("Título da etapa").fill("Kickoff alterado pela sessão 2")
        # sessao 1 salva primeiro
        page.get_by_test_id("step-item").first.locator("button[aria-pressed]").click()
        page.get_by_label("Título da etapa").fill("Kickoff alterado pela sessão 1")
        page.get_by_test_id("save-draft").click()
        self.notice(page)
        other.get_by_test_id("save-draft").click()
        other.get_by_test_id("conflict-banner").wait_for(timeout=15000)
        self.ok("F", "segunda sessao recebe aviso de conflito (409) sem sobrescrever")
        other.get_by_test_id("conflict-banner").get_by_role("button", name="Recarregar rascunho").click()
        other.get_by_test_id("step-item").first.get_by_text("Kickoff alterado pela sessão 1").wait_for(timeout=15000)
        self.ok("F", "recarregar traz a versao da primeira sessao")
        self.shot(other, "f7-f-conflito.png")
        other.context.close()

        # G ---------------------------------------------------------------
        self.scenarios.append("G - Duplicar, arquivar, reativar")
        page.get_by_test_id("discard-draft").click()
        page.locator(DLG).get_by_test_id("confirm-discard").click()
        page.get_by_test_id("template-state").filter(has_text="Publicado v2").wait_for(timeout=15000)
        self.ok("G", "rascunho descartado; versao publicada intacta")
        self.goto(page, "/onboarding/modelos")
        card = page.locator(f'[data-testid="template-card"][data-template-name="{self.template_name}"]')
        card.get_by_test_id("duplicate-template").click()
        copy_name = f"{self.template_name} (cópia)"
        copy_card = page.locator(f'[data-testid="template-card"][data-template-name="{copy_name}"]')
        copy_card.wait_for(timeout=15000)
        self.ok("G", "modelo duplicado como '(cópia)'")
        self.check("G", "copia nasce sem versao publicada", "Nunca publicado" in copy_card.inner_text())
        copy_card.get_by_test_id("archive-template").click()
        page.locator(DLG).get_by_test_id("confirm-archive").click()
        page.locator(f'[data-testid="template-card"][data-template-name="{copy_name}"][data-status="ARCHIVED"]').wait_for(timeout=15000)
        self.ok("G", "modelo arquivado aparece diferenciado (Arquivado)")
        arch = page.locator(f'[data-testid="template-card"][data-template-name="{copy_name}"]')
        arch.get_by_role("link", name=copy_name).click()
        page.get_by_test_id("archived-banner").wait_for(timeout=15000)
        self.check("G", "modelo arquivado nao aceita edicao", page.get_by_test_id("add-step").count() == 0 and page.get_by_test_id("save-draft").count() == 0)
        page.get_by_test_id("toggle-archive").click()
        page.get_by_test_id("template-state").filter(has_text="Rascunho v1").wait_for(timeout=15000)
        self.ok("G", "modelo reativado volta a ser editavel")

        # H ---------------------------------------------------------------
        self.scenarios.append("H - Funcao desativada e pessoa removida")
        self.open_builder(page)
        page.get_by_test_id("create-draft").click()
        page.get_by_test_id("template-state").filter(has_text="Rascunho v3").wait_for(timeout=15000)
        self.goto(page, "/onboarding/funcoes")
        fcard = page.locator('[data-testid="function-card"][data-function-name="Atendimento"]')
        fcard.get_by_test_id("toggle-function").click()
        fcard.get_by_text("Desativada").wait_for(timeout=15000)
        self.ok("H", "funcao Atendimento desativada pela interface")
        self.open_builder(page)
        steps_text = page.get_by_test_id("step-list").inner_text()
        self.check("H", "etapa mostra 'Atendimento (desativada)' e a tela carrega", "Atendimento (desativada)" in steps_text, steps_text[:300])
        page.get_by_test_id("validate-draft").click()
        panel = page.get_by_test_id("problems-panel")
        panel.wait_for(timeout=15000)
        self.check("H", "validacao bloqueia publicar com funcao desativada", "inativa" in panel.inner_text(), panel.inner_text()[:300])
        # historico publicado permanece legivel
        detail = self.template_detail(page)
        self.check("H", "versao publicada v2 permanece inalterada com a funcao desativada", (detail.get("published") or {}).get("versionNumber") == 2 and len((detail.get("published") or {}).get("steps", [])) == 3)
        # pessoa: etapa com responsavel especifico e depois a pessoa sai da organizacao
        page.get_by_test_id("add-step").click()
        page.get_by_label("Título da etapa").fill("Revisão final com a pessoa")
        page.get_by_label("Uma pessoa").check()
        page.get_by_label("Pessoa", exact=True).select_option(label="Gate Pessoa Saida")
        page.get_by_test_id("save-draft").click()
        self.notice(page)
        if self.skip_docker:
            self.ok("H", "pessoa removida: pulado localmente (GATE_SKIP_DOCKER=1)")
        else:
            suspended = self.suspend_person()
            self.check("H", "pessoa desativada na organizacao (ensaio)", suspended)
            page.reload(wait_until="networkidle")
            page.get_by_test_id("step-list").wait_for(timeout=15000)
            body = page.get_by_test_id("step-list").inner_text()
            self.check("H", "etapa mostra 'Pessoa removida ou inativa' sem quebrar a tela", "Pessoa removida ou inativa" in body, body[-300:])
            self.shot(page, "f7-h-pessoa-removida.png")
            page.get_by_test_id("validate-draft").click()
            problems = page.get_by_test_id("problems-panel").inner_text()
            self.check("H", "validacao indica a pessoa inativa", "membro ativo" in problems, problems[:300])

        # I ---------------------------------------------------------------
        self.scenarios.append("I - Permissoes negativas e isolamento")
        for label, email in [("gestor", self.email_manager), ("membro", self.email_member)]:
            pg = self.login(browser, email, self.password_a, "I")
            c = self.api(pg, "/api/v1/auth/capabilities")
            pm = (c.get("body") or {}).get("permissions") or {}
            self.check("I", f"{label}: ve onboarding mas nao gerencia (capacidades)", pm.get("onboarding.view") is True and pm.get("onboarding.manage_templates") is False and pm.get("onboarding.manage_functions") is False, str(pm))
            self.goto(pg, "/onboarding/modelos")
            pg.get_by_test_id("template-list").wait_for(timeout=20000)
            self.check("I", f"{label}: sem botao Novo modelo e sem Duplicar/Arquivar", pg.get_by_test_id("new-template").count() == 0 and pg.get_by_test_id("duplicate-template").count() == 0 and pg.get_by_test_id("archive-template").count() == 0)
            self.goto(pg, f"/onboarding/modelos/{self.template_id}")
            pg.get_by_test_id("readonly-banner").wait_for(timeout=15000)
            self.check("I", f"{label}: construtor em leitura (sem salvar/publicar/+ Etapa)", pg.get_by_test_id("save-draft").count() == 0 and pg.get_by_test_id("publish-draft").count() == 0 and pg.get_by_test_id("add-step").count() == 0)
            r1 = self.api(pg, "/onboarding/templates", "POST", {"name": f"Indevido {label}"})
            r2 = self.api(pg, "/onboarding/functions", "POST", {"name": f"Indevida {label}"})
            r3 = self.api(pg, f"/onboarding/templates/{self.template_id}/archive", "POST")
            self.check("I", f"{label}: API recusa criar modelo, funcao e arquivar (403)", r1["status"] == 403 and r2["status"] == 403 and r3["status"] == 403, f"{r1['status']} {r2['status']} {r3['status']}")
            if label == "gestor":
                self.goto(pg, "/onboarding/funcoes")
                pg.get_by_test_id("function-list").wait_for(timeout=20000)
                self.check("I", "gestor: funcoes em leitura (sem Nova funcao)", pg.get_by_test_id("new-function").count() == 0)
            pg.context.close()
        anon = browser.new_context().new_page()
        anon.goto(f"{self.base}/login", wait_until="networkidle")
        r = self.api(anon, "/onboarding/templates")
        self.check("I", "sem sessao: API devolve 401", r["status"] == 401, str(r["status"]))
        anon.context.close()

        page_b = self.login(browser, self.email_b, self.password_b, "I")
        self.goto(page_b, "/onboarding/modelos")
        page_b.get_by_text("Nenhum modelo criado").first.wait_for(timeout=20000)
        self.ok("I", "Org B nao ve modelos da Org A (lista vazia)")
        self.goto(page_b, f"/onboarding/modelos/{self.template_id}")
        page_b.get_by_text("Modelo não encontrado").first.wait_for(timeout=20000)
        self.ok("I", "Org B recebe 'Modelo nao encontrado' ao abrir modelo da Org A")
        for path in [f"/onboarding/templates/{self.template_id}", "/onboarding/functions"]:
            r = self.api(page_b, path)
            leak = "Designer" in r["text"] or self.template_name in r["text"]
            self.check("I", f"Org B nao le {path.split('/')[2]} da Org A pela API", not leak and r["status"] in (200, 404), f"{r['status']}")
        self.shot(page_b, "f7-i-org-b.png")
        page_b.context.close()

        # J ---------------------------------------------------------------
        self.scenarios.append("J - Responsividade 390 px")
        mobile = self.login(browser, self.email_a, self.password_a, "J", width=390, height=844)
        for path, wait_id in [("/onboarding/modelos", "template-list"), ("/onboarding/funcoes", "function-list"), (f"/onboarding/modelos/{self.template_id}", "step-list")]:
            self.goto(mobile, path)
            mobile.get_by_test_id(wait_id).wait_for(timeout=20000)
            overflow = mobile.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
            self.check("J", f"sem rolagem horizontal em 390 px: {'construtor' if 'modelos/' in path else path}", overflow <= 1, f"excesso={overflow}px")
        mobile.get_by_test_id("step-item").first.locator("button[aria-pressed]").click()
        self.check("J", "configuracao da etapa visivel em 390 px", mobile.get_by_label("Título da etapa").is_visible())
        self.shot(mobile, "f7-j-390-construtor.png")
        mobile.context.close()

        # K ---------------------------------------------------------------
        self.scenarios.append("K - Asana somente leitura")
        if self.skip_docker:
            self.ok("K", "verificacao do Asana simulado pulada localmente")
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
            self.check("K", "nenhuma escrita chegou ao Asana simulado", writes == 0, f"writes={writes}")


if __name__ == "__main__":
    sys.exit(OnboardingGate().run())
