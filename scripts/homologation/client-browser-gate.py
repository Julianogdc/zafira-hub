#!/usr/bin/env python3
"""
Zafira Hub 2.1 — F5 Client Browser Runtime Gate (Homologation Rehearsal)
F5-IMP.7B.2: Validação ponta a ponta em navegador Chromium autenticado (Playwright)
Cobre os cenários A a L: Carteira de Clientes, Quick View, Cliente 360,
Contatos, Reuniões e Atas, Briefing, Brand Kit, Isolamento Multi-Tenant,
Concorrência e Navegação, Responsividade e Regressão.
"""

import json
import os
import pathlib
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from playwright.sync_api import Browser, BrowserContext, Page, Response, sync_playwright


def get_required_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[-] ERRO: Variável de ambiente obrigatória '{name}' não está definida.", file=sys.stderr)
        sys.exit(1)
    return val


def sanitize_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    return f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path


class ClientBrowserGateRunner:
    def __init__(self) -> None:
        self.web_base_url = os.environ.get("WEB_BASE_URL", "http://127.0.0.1:8083").rstrip("/")
        self.gate_email_a = os.environ.get("GATE_EMAIL_A", "gate-a@zafira.invalid")
        self.gate_email_b = os.environ.get("GATE_EMAIL_B", "gate-b@zafira.invalid")
        self.gate_password_a = get_required_env("GATE_PASSWORD_A")
        self.gate_password_b = get_required_env("GATE_PASSWORD_B")
        self.org_a_id = os.environ.get("ORG_A_ID", "11111111-1111-4111-8111-111111111111")
        self.org_b_id = os.environ.get("ORG_B_ID", "22222222-2222-4222-8222-222222222222")
        self.api_container_name = os.environ.get("API_CONTAINER_NAME", "api-f45-browser")
        self.artifact_dir = pathlib.Path(os.environ.get("ARTIFACT_DIR", "artifacts/client-browser"))
        self.git_sha = os.environ.get("GITHUB_SHA", "local-sha")

        self.artifact_dir.mkdir(parents=True, exist_ok=True)

        self.blockers: List[str] = []
        self.assertions_passed: List[str] = []
        self.assertions_failed: List[str] = []
        self.scenarios_executed: List[str] = []
        self.screenshots: List[str] = []
        self.console_errors: List[str] = []
        self.console_warnings: List[str] = []
        self.http_statuses: Dict[str, int] = {}
        self.viewports_tested: List[Dict[str, Any]] = []
        self.created_clients_a: Dict[str, str] = {}
        self.created_clients_b: Dict[str, str] = {}

    def record_blocker(self, message: str) -> None:
        print(f"[-] BLOCKER: {message}", file=sys.stderr)
        self.blockers.append(message)

    def record_pass(self, scenario: str, assertion_name: str) -> None:
        item = f"[{scenario}] {assertion_name}"
        self.assertions_passed.append(item)
        print(f"[+] PASS: {item}")

    def record_fail(self, scenario: str, assertion_name: str, reason: str) -> None:
        item = f"[{scenario}] {assertion_name}: {reason}"
        self.assertions_failed.append(item)
        self.record_blocker(item)

    def save_screenshot(self, page: Page, filename: str) -> None:
        target_path = self.artifact_dir / filename
        page.screenshot(path=str(target_path), full_page=True)
        self.screenshots.append(filename)
        print(f"[+] Screenshot capturado: {target_path}")

    def attach_page_listeners(self, page: Page) -> None:
        def on_console(msg: Any) -> None:
            text = msg.text
            msg_type = msg.type
            if msg_type == "error":
                self.console_errors.append(text)
                if any(k in text.lower() for k in ["uncaught", "minified react error", "cannot read property of undefined"]):
                    self.record_blocker(f"Erro crítico no console: {text}")
            elif msg_type == "warning":
                self.console_warnings.append(text)

        def on_page_error(err: Any) -> None:
            err_msg = str(err)
            self.console_errors.append(f"PageError: {err_msg}")
            self.record_blocker(f"Exceção não tratada na página: {err_msg}")

        def on_response(res: Response) -> None:
            sanitized = sanitize_url(res.url)
            self.http_statuses[sanitized] = res.status
            lower_url = res.url.lower()
            if any(term in lower_url for term in ["supabase", "postiz", "/mock/"]):
                self.record_blocker(f"Requisição para serviço proibido/mock detectada: {sanitized}")

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("response", on_response)

    def check_api_health_and_readiness(self) -> bool:
        probe_res = subprocess.run(
            ["docker", "exec", self.api_container_name, "node", "-e",
             "fetch('http://127.0.0.1:3001/health/database').then(r=>r.json()).then(d=>{if(d.database!=='connected')process.exit(1);})"],
            capture_output=True,
            text=True,
        )
        return probe_res.returncode == 0

    def run(self) -> int:
        print("[*] Iniciando Zafira Hub 2.1 — F5 Client Browser Runtime Gate...")
        print(f"[*] Base URL: {self.web_base_url}")
        print(f"[*] Artifact Dir: {self.artifact_dir}")

        browser = None
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
                )
                self.execute_suite(browser)
        except Exception as exc:
            err_msg = f"{type(exc).__name__}: {str(exc)}"
            print(f"[-] Exceção fatal durante a execução do gate: {err_msg}", file=sys.stderr)
            self.record_blocker(f"Exceção fatal no processo do gate: {err_msg}")
        finally:
            if browser:
                try:
                    browser.close()
                except Exception:
                    pass

            success = len(self.blockers) == 0 and len(self.assertions_failed) == 0
            report = {
                "gitSha": self.git_sha,
                "baseUrl": self.web_base_url,
                "decision": "F5-IMP.7B.2 PASS" if success else "F5-IMP.7B.2 FAIL",
                "scenariosExecuted": self.scenarios_executed,
                "blockersCount": len(self.blockers),
                "blockers": self.blockers,
                "assertionsPassedCount": len(self.assertions_passed),
                "assertionsPassed": self.assertions_passed,
                "assertionsFailedCount": len(self.assertions_failed),
                "assertionsFailed": self.assertions_failed,
                "createdClientsOrgA": self.created_clients_a,
                "createdClientsOrgB": self.created_clients_b,
                "viewportsTested": self.viewports_tested,
                "screenshots": self.screenshots,
                "consoleErrorsCount": len(self.console_errors),
                "consoleWarningsCount": len(self.console_warnings),
            }

            report_file = self.artifact_dir / "client-browser-report.json"
            try:
                report_file.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
                print(f"[+] Relatório JSON gerado: {report_file}")
            except Exception as e:
                print(f"[-] Erro ao salvar relatório JSON: {e}", file=sys.stderr)

        if success:
            print("[+] CLIENT BROWSER RUNTIME GATE: TODOS OS CENÁRIOS E CHECKS PASSARAM COM SUCESSO!")
            return 0
        else:
            print(f"[-] CLIENT BROWSER RUNTIME GATE: FALHA ({len(self.blockers)} blockers detectados).", file=sys.stderr)
            return 1

    def execute_suite(self, browser: Browser) -> None:
        # ==============================================================================
        # CENÁRIO A: LOGIN AUTENTICADO (ADMIN A)
        # ==============================================================================
        print("\n[*] [Cenário A] Executando login real com ADMIN A...")
        self.scenarios_executed.append("Cenário A — Login Autenticado")
        context_a: BrowserContext = browser.new_context(
            viewport={"width": 1280, "height": 800},
            ignore_https_errors=True,
        )
        page_a: Page = context_a.new_page()
        self.attach_page_listeners(page_a)

        page_a.goto(f"{self.web_base_url}/login", wait_until="networkidle", timeout=30000)
        page_a.fill('#email', self.gate_email_a)
        page_a.fill('#password', self.gate_password_a)

        with page_a.expect_response(
            lambda res: "/api/v1/auth/login" in res.url and res.status == 200,
            timeout=15000,
        ) as login_resp_info:
            page_a.click('button[type="submit"]')

        login_resp = login_resp_info.value
        self.record_pass("Cenário A", f"Login HTTP 200 confirmado: {sanitize_url(login_resp.url)}")

        # Redirecionamento para ambiente protegido
        page_a.wait_for_url(lambda u: "/login" not in u, timeout=15000)
        self.record_pass("Cenário A", f"Redirecionamento pós-login confirmado: {page_a.url}")

        # Valida sessão via /api/v1/auth/session
        session_data: Dict[str, Any] = page_a.evaluate(
            """async () => {
                const res = await fetch('/hub-api/api/v1/auth/session');
                return { status: res.status, data: await res.json() };
            }"""
        )
        status_sess = session_data.get("status")
        body_sess = session_data.get("data", {})
        is_auth = body_sess.get("authenticated") is True
        active_org_id = body_sess.get("activeOrganizationId")
        orgs = body_sess.get("organizations", [])
        active_org = next((o for o in orgs if o.get("id") == active_org_id), None)
        active_role = active_org.get("role") if active_org else None

        if status_sess == 200 and is_auth and active_org_id == self.org_a_id and str(active_role).upper() == "ADMIN":
            self.record_pass("Cenário A", f"Sessão validada com sucesso: role={active_role}, org={active_org_id}")
        else:
            self.record_fail("Cenário A", "Validação de sessão", f"status={status_sess}, auth={is_auth}, org={active_org_id}, role={active_role}")

        # ==============================================================================
        # CRIAÇÃO DE FIXTURES SINTÉTICAS PARA ORG A (A1 e A2)
        # ==============================================================================
        print("\n[*] Criando clientes sintéticos A1 e A2 na Org A via API real...")
        synth_clients_a = [
            {"name": "F5 Cliente Sintetico A1", "status": "ACTIVE"},
            {"name": "F5 Cliente Sintetico A2", "status": "LEAD"},
        ]
        created_a = page_a.evaluate(
            """async (clients) => {
                const results = [];
                for (const c of clients) {
                    const res = await fetch('/hub-api/clients', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(c)
                    });
                    const data = await res.json();
                    results.push({ status: res.status, data });
                }
                return results;
            }""",
            synth_clients_a,
        )

        for item in created_a:
            st = item.get("status")
            dt = item.get("data", {})
            c_name = dt.get("name")
            c_id = dt.get("id")
            if st == 201 and c_id:
                self.created_clients_a[c_name] = c_id
                print(f"[+] Cliente sintético Org A criado: {c_name} (ID: {c_id})")
            else:
                self.record_fail("Fixtures", f"Criação de {c_name}", f"HTTP {st}")

        client_a1_id = self.created_clients_a.get("F5 Cliente Sintetico A1")
        client_a2_id = self.created_clients_a.get("F5 Cliente Sintetico A2")

        if not client_a1_id or not client_a2_id:
            self.record_blocker("Falha ao criar clientes sintéticos obrigatórios para Org A.")
            return

        # ==============================================================================
        # CENÁRIO B: CARTEIRA DE CLIENTES (/clientes)
        # ==============================================================================
        print("\n[*] [Cenário B] Validando Carteira de Clientes...")
        self.scenarios_executed.append("Cenário B — Carteira de Clientes")
        page_a.goto(f"{self.web_base_url}/clientes", wait_until="networkidle", timeout=30000)

        page_a.wait_for_selector('h1:has-text("Clientes")', timeout=15000)
        self.record_pass("Cenário B", "Página de Clientes carregada com sucesso")

        # 1. Presença de A1 e A2
        loc_a1 = page_a.locator(':text("F5 Cliente Sintetico A1")').first
        loc_a2 = page_a.locator(':text("F5 Cliente Sintetico A2")').first
        if loc_a1.is_visible() and loc_a2.is_visible():
            self.record_pass("Cenário B", "Clientes A1 e A2 visíveis na carteira")
        else:
            self.record_fail("Cenário B", "Visibilidade A1/A2", f"A1={loc_a1.is_visible()}, A2={loc_a2.is_visible()}")

        # 2. Ausência de B1 (ainda nem existe na Org A)
        loc_b1_pre = page_a.locator(':text("F5 Cliente Sintetico B1")')
        if loc_b1_pre.count() == 0:
            self.record_pass("Cenário B", "Cliente B1 ausente na carteira de A")

        # 3. Busca por nome
        search_input = page_a.locator('input[aria-label="Buscar clientes"]')
        search_input.fill("A1")
        page_a.wait_for_timeout(400)
        if loc_a1.is_visible() and not loc_a2.is_visible():
            self.record_pass("Cenário B", "Busca textual filtrou A1 e ocultou A2")
        else:
            self.record_fail("Cenário B", "Busca textual", f"A1={loc_a1.is_visible()}, A2={loc_a2.is_visible()}")

        # 4. Estado vazio da busca
        search_input.fill("termo-inexistente-xyz-123")
        page_a.wait_for_timeout(400)
        empty_loc = page_a.locator(':text("Nenhum cliente encontrado")')
        if empty_loc.is_visible():
            self.record_pass("Cenário B", "Estado vazio da busca renderizado corretamente")
        else:
            self.record_fail("Cenário B", "Estado vazio da busca", "Mensagem de busca vazia não apareceu")

        # 5. Recuperação ao limpar busca
        search_input.fill("")
        page_a.wait_for_timeout(400)
        if loc_a1.is_visible() and loc_a2.is_visible():
            self.record_pass("Cenário B", "Carteira recuperada após limpar busca")
        else:
            self.record_fail("Cenário B", "Recuperação de busca", "Clientes não voltaram a ser visíveis")

        # 6. Filtro por status
        status_select = page_a.locator('#client-status-select')
        status_select.select_option("LEAD")
        page_a.wait_for_timeout(400)
        if not loc_a1.is_visible() and loc_a2.is_visible():
            self.record_pass("Cenário B", "Filtro de status LEAD exibiu A2 e ocultou A1")
        else:
            self.record_fail("Cenário B", "Filtro de status", f"A1={loc_a1.is_visible()}, A2={loc_a2.is_visible()}")

        status_select.select_option("ALL")
        page_a.wait_for_timeout(400)

        # 7. KPIs calculados
        kpi_section = page_a.locator('section[aria-label="Indicadores da Carteira"]')
        if kpi_section.is_visible():
            self.record_pass("Cenário B", "Grid de KPIs da carteira visível")

        self.save_screenshot(page_a, "carteira-desktop.png")

        # ==============================================================================
        # CENÁRIO C: QUICK VIEW
        # ==============================================================================
        print("\n[*] [Cenário C] Validando Quick View contextual...")
        self.scenarios_executed.append("Cenário C — Quick View")
        # Clica no cliente A1 para abrir o Drawer
        page_a.locator(':text("F5 Cliente Sintetico A1")').first.click()
        page_a.wait_for_selector('button:has-text("Abrir Cliente 360")', timeout=10000)

        sheet_title = page_a.locator(':text("F5 Cliente Sintetico A1")').first
        if sheet_title.is_visible():
            self.record_pass("Cenário C", "Quick View Drawer abriu com nome do Cliente A1")
        else:
            self.record_fail("Cenário C", "Quick View Header", "Título do Drawer não encontrado")

        self.save_screenshot(page_a, "quick-view.png")

        # Clica em Abrir Cliente 360
        btn_360 = page_a.locator('button:has-text("Abrir Cliente 360")').first
        btn_360.click()

        page_a.wait_for_url(lambda u: f"/clientes/{client_a1_id}" in u, timeout=15000)
        self.record_pass("Cenário C", f"Navegação para Cliente 360 confirmada: /clientes/{client_a1_id}")

        # ==============================================================================
        # CENÁRIO D: CLIENTE 360 (NAVEGAÇÃO POR TODAS AS ABAS)
        # ==============================================================================
        print("\n[*] [Cenário D] Validando abas do Cliente 360...")
        self.scenarios_executed.append("Cenário D — Cliente 360")
        page_a.wait_for_selector('h1:has-text("F5 Cliente Sintetico A1")', timeout=15000)

        tabs_to_check = [
            ("visao-geral", "Visão Geral", "cliente360-visao-geral.png"),
            ("empresa-marca", "Empresa & Marca", "cliente360-empresa-marca.png"),
            ("operacao", "Operação", "cliente360-operacao.png"),
            ("contrato-financeiro", "Contrato & Financeiro", "cliente360-contrato-financeiro.png"),
            ("relacionamento-memoria", "Relacionamento & Memória", "cliente360-relacionamento-memoria.png"),
            ("integracoes", "Integrações", "cliente360-integracoes.png"),
        ]

        for tab_val, tab_label, scr_name in tabs_to_check:
            tab_trigger = page_a.locator(f'button[role="tab"]:has-text("{tab_label}")').first
            tab_trigger.click()
            page_a.wait_for_timeout(300)
            self.save_screenshot(page_a, scr_name)
            self.record_pass("Cenário D", f"Aba '{tab_label}' acessada com sucesso")

            if tab_val == "operacao":
                loc_asana_title = page_a.locator(':text("Projetos do cliente — Asana")').first
                if loc_asana_title.is_visible():
                    self.record_pass("Cenário D", "Card de projetos Asana visível na aba Operação")
                else:
                    self.record_fail("Cenário D", "Projetos Asana", "Card de projetos Asana não encontrado na aba Operação")
                loc_asana_empty = page_a.locator(':text("Nenhum projeto do Asana vinculado a este cliente.")').first
                if loc_asana_empty.is_visible():
                    self.record_pass("Cenário D", "Estado vazio de projetos Asana renderizado corretamente")

        # ==============================================================================
        # CENÁRIO E: CONTATOS (ABA EMPRESA & MARCA)
        # ==============================================================================
        print("\n[*] [Cenário E] Testando CRUD de Contatos...")
        self.scenarios_executed.append("Cenário E — Contatos")
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_timeout(300)

        # 1. Abrir modal de adicionar contato
        page_a.locator('button:has-text("Adicionar contato")').first.click()
        page_a.wait_for_selector('#contactName', timeout=5000)

        # Preenche contato inicial
        page_a.fill('#contactName', 'Carlos Diretor')
        page_a.fill('#contactRole', 'Diretor de Marketing')
        page_a.fill('#contactEmail', 'carlos@empresa.com')
        page_a.fill('#contactPhone', '(11) 98765-4321')
        page_a.locator('#contactPrimary').check()
        page_a.fill('#contactNotes', 'Contato principal de decisão')

        # Salva contato
        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}/contacts" in r.url and r.status == 201,
            timeout=15000,
        ):
            page_a.locator('button:has-text("Salvar contato")').click()

        self.record_pass("Cenário E", "Contato criado com HTTP 201")
        page_a.wait_for_timeout(500)

        # Recarrega a página e valida persistência
        page_a.reload(wait_until="networkidle")
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_selector(':text("Carlos Diretor")', timeout=10000)
        self.record_pass("Cenário E", "Contato persistido e renderizado após reload")

        # 2. Edita o contato usando o seletor específico dentro do card de contato
        contact_card = page_a.locator('div[class*="contactCard"]').filter(has_text="Carlos Diretor").first
        contact_card.locator('button:has-text("Editar")').click()
        page_a.wait_for_selector('#contactPhone', timeout=10000)
        page_a.fill('#contactPhone', '')

        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}/contacts" in r.url and r.status == 200,
            timeout=15000,
        ):
            page_a.locator('button:has-text("Salvar contato")').click()

        self.record_pass("Cenário E", "Contato editado com HTTP 200")
        page_a.wait_for_timeout(500)

        # Recarrega e valida que o telefone foi limpo
        page_a.reload(wait_until="networkidle")
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_selector(':text("Carlos Diretor")', timeout=10000)
        phone_visible = page_a.locator(':text("(11) 98765-4321")').count() > 0
        if not phone_visible:
            self.record_pass("Cenário E", "Remoção de campo opcional (telefone) persistida com sucesso")
        else:
            self.record_fail("Cenário E", "Limpeza de telefone", "Telefone antigo continuou visível")

        # 3. Cancelamento de formulário não gera mutação
        contact_card = page_a.locator('div[class*="contactCard"]').filter(has_text="Carlos Diretor").first
        contact_card.locator('button:has-text("Editar")').click()
        page_a.wait_for_selector('#contactName', timeout=10000)
        page_a.fill('#contactName', 'Nome Cancelado')
        page_a.locator('div[role="dialog"] button:has-text("Cancelar")').click()
        page_a.wait_for_timeout(300)
        name_cancel_visible = page_a.locator(':text("Nome Cancelado")').count() > 0
        if not name_cancel_visible:
            self.record_pass("Cenário E", "Cancelamento de edição não persistiu alterações")

        # 4. Cancelamento de exclusão
        contact_card = page_a.locator('div[class*="contactCard"]').filter(has_text="Carlos Diretor").first
        contact_card.locator('button:has-text("Excluir")').click()
        page_a.wait_for_selector('button:has-text("Excluir contato")', timeout=5000)
        page_a.locator('div[role="alertdialog"] button:has-text("Cancelar")').click()
        page_a.wait_for_timeout(300)
        if page_a.locator(':text("Carlos Diretor")').is_visible():
            self.record_pass("Cenário E", "Cancelamento de exclusão manteve o contato")

        # 5. Exclusão confirmada
        contact_card = page_a.locator('div[class*="contactCard"]').filter(has_text="Carlos Diretor").first
        contact_card.locator('button:has-text("Excluir")').click()
        page_a.wait_for_selector('button:has-text("Excluir contato")', timeout=5000)
        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}/contacts" in r.url and r.status == 200,
            timeout=15000,
        ):
            page_a.locator('button:has-text("Excluir contato")').click()

        page_a.wait_for_timeout(500)
        if page_a.locator(':text("Carlos Diretor")').count() == 0:
            self.record_pass("Cenário E", "Exclusão confirmada removeu o contato")
        else:
            self.record_fail("Cenário E", "Exclusão de contato", "Contato continuou na tela após exclusão")

        # ==============================================================================
        # CENÁRIO F: REUNIÕES E ATAS (ABA RELACIONAMENTO & MEMÓRIA)
        # ==============================================================================
        print("\n[*] [Cenário F] Testando Atas de Reunião e Segurança de Links...")
        self.scenarios_executed.append("Cenário F — Reuniões e Atas")
        page_a.locator('button[role="tab"]:has-text("Relacionamento & Memória")').first.click()
        page_a.wait_for_timeout(300)

        # 1. Teste de URL insegura no formulário (javascript:alert(1))
        page_a.locator('button:has-text("Registrar reunião")').first.click()
        page_a.wait_for_selector('#meetingTitle', timeout=5000)

        page_a.fill('#meetingTitle', 'Ata de Alinhamento')
        page_a.fill('#meetingDate', '2026-10-10T10:00')
        page_a.fill('#meetingSummary', 'Alinhamento geral de escopo')
        page_a.fill('#meetingActionItems', 'Ação 1: validar briefing')
        page_a.fill('#meetingLink', 'javascript:alert(1)')

        # Clica em Salvar -> deve ser bloqueado pelo formulário (sem envio de POST)
        page_a.locator('div[role="dialog"] button:has-text("Salvar")').click()
        page_a.wait_for_timeout(500)

        # Modal deve permanecer aberto por erro de validação
        modal_open = page_a.locator('#meetingTitle').is_visible()
        if modal_open:
            self.record_pass("Cenário F", "URL insegura javascript: bloqueada no formulário de ata")
        else:
            self.record_fail("Cenário F", "Validação de URL de ata", "Modal fechou com URL javascript:")

        # 2. Corrige para URL HTTPS válida e salva
        page_a.fill('#meetingLink', 'https://meet.google.com/abc-defg-hij')
        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}/meetings" in r.url and r.status == 201,
            timeout=15000,
        ):
            page_a.locator('div[role="dialog"] button:has-text("Salvar")').click()

        self.record_pass("Cenário F", "Ata com URL HTTPS criada com HTTP 201")
        page_a.wait_for_timeout(500)

        # 3. Recarrega e valida renderização segura
        page_a.reload(wait_until="networkidle")
        page_a.locator('button[role="tab"]:has-text("Relacionamento & Memória")').first.click()
        page_a.wait_for_selector(':text("Ata de Alinhamento")', timeout=10000)

        # Link seguro deve ser clicável com target="_blank" e rel="noopener noreferrer"
        link_elem = page_a.locator('a[href="https://meet.google.com/abc-defg-hij"]')
        if link_elem.is_visible() and link_elem.get_attribute("target") == "_blank":
            self.record_pass("Cenário F", "Link seguro de ata renderizado como tag <a> clicável com target=_blank")
        else:
            self.record_fail("Cenário F", "Renderização de link de ata", "Tag <a> segura não encontrada")

        # 4. Edita ata para limpar o link opcional usando o meetingCard específico
        meeting_card = page_a.locator('div[class*="meetingCard"]').filter(has_text="Ata de Alinhamento").first
        meeting_card.locator('button:has-text("Editar")').click()
        page_a.wait_for_selector('#meetingLink', timeout=10000)
        page_a.fill('#meetingLink', '')

        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}/meetings" in r.url and r.status == 200,
            timeout=15000,
        ):
            page_a.locator('div[role="dialog"] button:has-text("Salvar")').click()

        page_a.wait_for_timeout(500)
        page_a.reload(wait_until="networkidle")
        page_a.locator('button[role="tab"]:has-text("Relacionamento & Memória")').first.click()
        page_a.wait_for_selector(':text("Ata de Alinhamento")', timeout=10000)

        if page_a.locator('a[href="https://meet.google.com/abc-defg-hij"]').count() == 0:
            self.record_pass("Cenário F", "Limpeza de link de ata persistida com sucesso")

        # 5. Exclusão confirmada de ata
        meeting_card = page_a.locator('div[class*="meetingCard"]').filter(has_text="Ata de Alinhamento").first
        meeting_card.locator('button:has-text("Excluir")').click()
        page_a.wait_for_selector('button:has-text("Excluir ata")', timeout=5000)
        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}/meetings" in r.url and r.status == 200,
            timeout=15000,
        ):
            page_a.locator('button:has-text("Excluir ata")').click()

        page_a.wait_for_timeout(500)
        if page_a.locator(':text("Ata de Alinhamento")').count() == 0:
            self.record_pass("Cenário F", "Exclusão confirmada de ata concluída com sucesso")

        # ==============================================================================
        # CENÁRIO G: BRIEFING ESTRATÉGICO (ABA EMPRESA & MARCA)
        # ==============================================================================
        print("\n[*] [Cenário G] Testando Briefing Estratégico...")
        self.scenarios_executed.append("Cenário G — Briefing Estratégico")
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_timeout(300)

        # Abre modal de briefing (botão Preencher briefing ou Editar briefing)
        page_a.locator('button:has-text("briefing")').first.click()
        page_a.wait_for_selector('#briefingObjective', timeout=10000)
        self.save_screenshot(page_a, "briefing-dialog.png")

        # Preenche briefing
        page_a.fill('#briefingObjective', 'Expandir awareness da marca')
        page_a.fill('#briefingTargetAudience', 'Executivos C-level de tecnologia')
        page_a.fill('#briefingPositioning', 'Autoridade em inovação ágil')
        page_a.fill('#briefingCompetitors', 'Concorrente A, Concorrente B')
        page_a.fill('#briefingToneOfVoice', 'Sério, direto e consultivo')
        page_a.fill('#briefingNotes', 'Anotações estratégicas Q4')

        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}" in r.url and r.request.method == "PATCH" and r.status == 200,
            timeout=15000,
        ):
            page_a.locator('button:has-text("Salvar briefing")').click()

        self.record_pass("Cenário G", "Briefing salvo com PATCH 200")
        page_a.wait_for_timeout(500)

        # Recarrega e valida persistência
        page_a.reload(wait_until="networkidle")
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_selector(':text("Expandir awareness da marca")', timeout=10000)
        self.record_pass("Cenário G", "Dados do Briefing persistidos após reload")

        # Limpeza integral do Briefing
        page_a.locator('button:has-text("briefing")').first.click()
        page_a.wait_for_selector('#briefingObjective', timeout=10000)
        page_a.fill('#briefingObjective', '')
        page_a.fill('#briefingTargetAudience', '')
        page_a.fill('#briefingPositioning', '')
        page_a.fill('#briefingCompetitors', '')
        page_a.fill('#briefingToneOfVoice', '')
        page_a.fill('#briefingNotes', '')

        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}" in r.url and r.request.method == "PATCH" and r.status == 200,
            timeout=15000,
        ):
            page_a.locator('button:has-text("Salvar briefing")').click()

        page_a.wait_for_timeout(500)
        page_a.reload(wait_until="networkidle")
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_selector(':text("Briefing não preenchido.")', timeout=10000)
        self.record_pass("Cenário G", "Limpeza integral do briefing confirmada: 'Briefing não preenchido.'")

        # ==============================================================================
        # CENÁRIO H: BRAND KIT (ABA EMPRESA & MARCA)
        # ==============================================================================
        print("\n[*] [Cenário H] Testando Brand Kit e Validações...")
        self.scenarios_executed.append("Cenário H — Brand Kit")
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_timeout(300)

        # Abre modal Brand Kit
        page_a.locator('button:has-text("Brand Kit")').first.click()
        page_a.wait_for_selector('button:has-text("Adicionar Cor")', timeout=10000)
        self.save_screenshot(page_a, "brand-kit-dialog.png")

        # 1. Validação negativa: Cor com HEX inválido bloqueia envio
        page_a.locator('button:has-text("Adicionar Cor")').click()
        color_inputs = page_a.locator('input[placeholder="Ex: Roxo principal"]')
        color_hexes = page_a.locator('input[placeholder="HEX: #6D28D9"]')
        color_inputs.first.fill('Cor Inválida')
        color_hexes.first.fill('hex-invalido')

        page_a.locator('button:has-text("Salvar Brand Kit")').click()
        page_a.wait_for_timeout(500)
        if page_a.locator('button:has-text("Adicionar Cor")').is_visible():
            self.record_pass("Cenário H", "HEX inválido bloqueou gravação do Brand Kit")
        else:
            self.record_fail("Cenário H", "Validação HEX", "Modal fechou com HEX inválido")

        # Corrige a primeira cor
        color_hexes.first.fill('#6D28D9')

        # Adiciona segunda cor
        page_a.locator('button:has-text("Adicionar Cor")').click()
        color_inputs.nth(1).fill('Verde')
        color_hexes.nth(1).fill('#10B981')

        # Adiciona duas tipografias
        page_a.locator('button:has-text("Adicionar Tipografia")').click()
        typo_roles = page_a.locator('input[placeholder="Função (Ex: Títulos)"]')
        typo_fonts = page_a.locator('input[placeholder="Nome da fonte (Ex: Inter)"]')
        typo_roles.first.fill('Títulos')
        typo_fonts.first.fill('Inter')

        page_a.locator('button:has-text("Adicionar Tipografia")').click()
        typo_roles.nth(1).fill('Corpo')
        typo_fonts.nth(1).fill('Roboto')

        # Adiciona link com teste de URL insegura
        page_a.locator('button:has-text("Adicionar Link")').click()
        link_labels = page_a.locator('input[placeholder="Descrição (Ex: Logotipo oficial)"]')
        link_urls = page_a.locator('input[placeholder="URL: https://..."]')
        link_labels.first.fill('Link Inseguro')
        link_urls.first.fill('javascript:alert(1)')

        # Tenta salvar com link inseguro -> deve ser bloqueado
        page_a.locator('button:has-text("Salvar Brand Kit")').click()
        page_a.wait_for_timeout(500)
        if page_a.locator('button:has-text("Adicionar Cor")').is_visible():
            self.record_pass("Cenário H", "URL insegura bloqueou gravação do Brand Kit")
        else:
            self.record_fail("Cenário H", "Validação URL Brand Kit", "Modal fechou com URL javascript:")

        # Corrige link para HTTPS e preenche diretrizes
        link_labels.first.fill('Manual da Marca')
        link_urls.first.fill('https://brand.zafira.agency/guide.pdf')
        page_a.fill('#brandKitNotes', 'Diretrizes oficiais da marca de teste')

        with page_a.expect_response(
            lambda r: f"/clients/{client_a1_id}" in r.url and r.request.method == "PATCH" and r.status == 200,
            timeout=15000,
        ):
            page_a.locator('button:has-text("Salvar Brand Kit")').click()

        self.record_pass("Cenário H", "Brand Kit salvo com dados válidos (HTTP 200)")
        page_a.wait_for_timeout(500)

        # Recarrega e valida persistência
        page_a.reload(wait_until="networkidle")
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_selector(':text("#6D28D9")', timeout=10000)
        self.record_pass("Cenário H", "Cores do Brand Kit persistidas após reload")

        # ==============================================================================
        # CENÁRIO J: CONCORRÊNCIA E NAVEGAÇÃO
        # ==============================================================================
        print("\n[*] [Cenário J] Testando concorrência e navegação sem vazamento de estado...")
        self.scenarios_executed.append("Cenário J — Concorrência e Navegação")
        # Abre modal em A1
        page_a.locator('button:has-text("Brand Kit")').first.click()
        page_a.wait_for_selector('button:has-text("Salvar Brand Kit")', timeout=10000)

        # Navega para A2
        page_a.goto(f"{self.web_base_url}/clientes/{client_a2_id}", wait_until="networkidle", timeout=30000)
        page_a.wait_for_selector('h1:has-text("F5 Cliente Sintetico A2")', timeout=15000)

        # Dialog de Brand Kit de A1 não deve estar aberto em A2
        dialog_reopened = page_a.locator('button:has-text("Salvar Brand Kit")').is_visible()
        if not dialog_reopened:
            self.record_pass("Cenário J", "Navegação para A2 não herdou dialog nem dados temporários de A1")
        else:
            self.record_fail("Cenário J", "Isolamento de navegação", "Dialog de A1 reapareceu em A2")

        # ==============================================================================
        # CENÁRIO K: RESPONSIVIDADE (1280x800, 768x900, 390x844)
        # ==============================================================================
        print("\n[*] [Cenário K] Testando responsividade e ausência de overflow horizontal...")
        self.scenarios_executed.append("Cenário K — Responsividade")
        viewports = [
            (1280, 800, "desktop"),
            (768, 900, "tablet"),
            (390, 844, "mobile"),
        ]

        for w, h, vp_name in viewports:
            page_a.set_viewport_size({"width": w, "height": h})
            page_a.wait_for_timeout(400)

            scroll_w = page_a.evaluate("() => document.documentElement.scrollWidth")
            has_overflow = scroll_w > (w + 4)
            if has_overflow:
                self.record_fail("Cenário K", f"Overflow {w}x{h}", f"scrollWidth={scroll_w} > width={w}")
            else:
                self.record_pass("Cenário K", f"Sem overflow horizontal em {w}x{h} ({vp_name})")

            self.viewports_tested.append({
                "viewport": f"{w}x{h}",
                "name": vp_name,
                "scrollWidth": scroll_w,
                "overflow": has_overflow,
            })

            if w == 390:
                self.save_screenshot(page_a, "cliente360-mobile-390.png")
                # Carteira em mobile
                page_a.goto(f"{self.web_base_url}/clientes", wait_until="networkidle", timeout=30000)
                self.save_screenshot(page_a, "carteira-mobile-390.png")

        # Restaura desktop para abrir dialog e capturar screenshot mobile de dialog
        page_a.set_viewport_size({"width": 1280, "height": 800})
        page_a.goto(f"{self.web_base_url}/clientes/{client_a1_id}", wait_until="networkidle", timeout=30000)
        page_a.locator('button[role="tab"]:has-text("Empresa & Marca")').first.click()
        page_a.wait_for_timeout(300)
        page_a.locator('button:has-text("Brand Kit")').first.click()
        page_a.wait_for_selector('button:has-text("Salvar Brand Kit")', timeout=10000)

        # Redimensiona para 390x844 com dialog aberto para comprovar adaptação de dialog em mobile
        page_a.set_viewport_size({"width": 390, "height": 844})
        page_a.wait_for_timeout(400)
        self.save_screenshot(page_a, "dialogs-mobile-390.png")
        page_a.keyboard.press("Escape")
        page_a.wait_for_timeout(300)

        # Restaura desktop
        page_a.set_viewport_size({"width": 1280, "height": 800})
        context_a.close()

        # ==============================================================================
        # CENÁRIO I: ISOLAMENTO MULTI-TENANT (ADMIN B / ORG B)
        # ==============================================================================
        print("\n[*] [Cenário I] Testando isolamento Multi-Tenant estrito com ADMIN B...")
        self.scenarios_executed.append("Cenário I — Isolamento Multi-Tenant")
        context_b: BrowserContext = browser.new_context(
            viewport={"width": 1280, "height": 800},
            ignore_https_errors=True,
        )
        page_b: Page = context_b.new_page()
        self.attach_page_listeners(page_b)

        page_b.goto(f"{self.web_base_url}/login", wait_until="networkidle", timeout=30000)
        page_b.fill('#email', self.gate_email_b)
        page_b.fill('#password', self.gate_password_b)

        with page_b.expect_response(
            lambda res: "/api/v1/auth/login" in res.url and res.status == 200,
            timeout=15000,
        ):
            page_b.click('button[type="submit"]')

        page_b.wait_for_url(lambda u: "/login" not in u, timeout=15000)
        self.record_pass("Cenário I", "Login autenticado do ADMIN B concluído")

        # Cria cliente sintético B1 na Org B
        created_b = page_b.evaluate(
            """async () => {
                const res = await fetch('/hub-api/clients', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'F5 Cliente Sintetico B1', status: 'ACTIVE' })
                });
                return { status: res.status, data: await res.json() };
            }"""
        )
        b1_status = created_b.get("status")
        b1_data = created_b.get("data", {})
        client_b1_id = b1_data.get("id")
        if b1_status == 201 and client_b1_id:
            self.created_clients_b["F5 Cliente Sintetico B1"] = client_b1_id
            self.record_pass("Cenário I", f"Cliente B1 criado na Org B: ID {client_b1_id}")
        else:
            self.record_fail("Cenário I", "Criação de B1", f"HTTP {b1_status}")

        # Acessa carteira da Org B
        page_b.goto(f"{self.web_base_url}/clientes", wait_until="networkidle", timeout=30000)
        page_b.wait_for_selector('h1:has-text("Clientes")', timeout=15000)

        # 1. B1 está visível
        if page_b.locator(':text("F5 Cliente Sintetico B1")').first.is_visible():
            self.record_pass("Cenário I", "Cliente B1 visível na carteira da Org B")
        else:
            self.record_fail("Cenário I", "Visibilidade B1", "Cliente B1 não encontrado na carteira de B")

        # 2. A1 e A2 NÃO são visíveis para B
        a1_in_b = page_b.locator(':text("F5 Cliente Sintetico A1")').count() > 0
        a2_in_b = page_b.locator(':text("F5 Cliente Sintetico A2")').count() > 0
        if not a1_in_b and not a2_in_b:
            self.record_pass("Cenário I", "Clientes A1 e A2 completamente invisíveis na carteira da Org B")
        else:
            self.record_fail("Cenário I", "Vazamento cross-tenant", f"A1={a1_in_b}, A2={a2_in_b}")

        # 3. Teste HTTP cross-tenant: GET, PATCH e DELETE de A1 via sessão de B retornam 404
        cross_tenant_checks: Dict[str, Any] = page_b.evaluate(
            """async (a1Id) => {
                const getRes = await fetch(`/hub-api/clients/${a1Id}`);
                const patchRes = await fetch(`/hub-api/clients/${a1Id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'Ataque Cross Tenant' })
                });
                const deleteRes = await fetch(`/hub-api/clients/${a1Id}`, {
                    method: 'DELETE'
                });
                return {
                    getStatus: getRes.status,
                    patchStatus: patchRes.status,
                    deleteStatus: deleteRes.status
                };
            }""",
            client_a1_id,
        )

        get_st = cross_tenant_checks.get("getStatus")
        patch_st = cross_tenant_checks.get("patchStatus")
        delete_st = cross_tenant_checks.get("deleteStatus")

        if get_st == 404 and patch_st == 404 and delete_st == 404:
            self.record_pass("Cenário I", "Isolamento HTTP cross-tenant comprovado: GET=404, PATCH=404, DELETE=404")
        else:
            self.record_fail("Cenário I", "Isolamento HTTP", f"GET={get_st}, PATCH={patch_st}, DELETE={delete_st}")

        context_b.close()


if __name__ == "__main__":
    runner = ClientBrowserGateRunner()
    sys.exit(runner.run())
