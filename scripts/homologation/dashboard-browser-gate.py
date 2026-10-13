#!/usr/bin/env python3
"""
Zafira Hub 2.1 — Browser Runtime Gate (Homologation Rehearsal)
F4.5-C1.R: Validação de navegador real com login humano, checagem de tokens de tema,
query key inédita para ErrorState, checkpoints N+1 determinísticos, e relatório resiliente.
"""

import json
import os
import pathlib
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Browser, BrowserContext, Page, Response, Route, sync_playwright


def get_required_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[-] ERRO: Variável de ambiente obrigatória '{name}' não está definida.", file=sys.stderr)
        sys.exit(1)
    return val


def sanitize_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    return f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path


class BrowserGateRunner:
    def __init__(self) -> None:
        self.web_base_url = os.environ.get("WEB_BASE_URL", "http://127.0.0.1:8083").rstrip("/")
        self.gate_email_a = os.environ.get("GATE_EMAIL_A", "gate-a@zafira.invalid")
        self.gate_email_b = os.environ.get("GATE_EMAIL_B", "gate-b@zafira.invalid")
        self.gate_password_a = get_required_env("GATE_PASSWORD_A")
        self.gate_password_b = get_required_env("GATE_PASSWORD_B")
        self.org_a_id = os.environ.get("ORG_A_ID", "11111111-1111-4111-8111-111111111111")
        self.org_b_id = os.environ.get("ORG_B_ID", "22222222-2222-4222-8222-222222222222")
        self.api_container_name = os.environ.get("API_CONTAINER_NAME", "api-f45-browser")
        self.artifact_dir = pathlib.Path(os.environ.get("ARTIFACT_DIR", "artifacts/dashboard-browser"))
        self.git_sha = os.environ.get("GITHUB_SHA", "local-sha")

        self.artifact_dir.mkdir(parents=True, exist_ok=True)

        self.blockers: List[str] = []
        self.console_errors: List[str] = []
        self.console_warnings: List[str] = []
        self.expected_request_failures: List[str] = []
        self.unexpected_request_failures: List[str] = []
        self.summary_requests: List[Dict[str, Any]] = []
        self.summary_checkpoints: List[Dict[str, Any]] = []
        self.forbidden_requests: List[str] = []
        self.screenshots: List[str] = []
        self.theme_computed: Dict[str, Any] = {}
        self.dom_assertions: Dict[str, bool] = {}
        self.viewports_tested: List[Dict[str, Any]] = []
        self.auth_session_validation: Dict[str, Any] = {}
        self.initial_summary: Dict[str, Any] = {}
        self.error_injection_report: Dict[str, Any] = {}
        self.mobile_usability: Dict[str, Any] = {}
        self.in_expected_error_window: bool = False

    def record_blocker(self, message: str) -> None:
        print(f"[-] BLOCKER: {message}", file=sys.stderr)
        self.blockers.append(message)

    def check_api_health_and_readiness(self) -> bool:
        inspect_res = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Health.Status}}", self.api_container_name],
            capture_output=True,
            text=True,
        )
        if inspect_res.stdout.strip() != "healthy":
            return False

        probe_res = subprocess.run(
            ["docker", "exec", self.api_container_name, "node", "-e",
             "fetch('http://127.0.0.1:3001/health/database').then(r=>r.json()).then(d=>{if(d.database!=='connected')process.exit(1);})"],
            capture_output=True,
            text=True,
        )
        return probe_res.returncode == 0

    def attach_page_listeners(self, page: Page) -> None:
        def on_console(msg: Any) -> None:
            text = msg.text
            msg_type = msg.type
            if msg_type == "error":
                self.console_errors.append(text)
                if any(k in text.lower() for k in ["uncaught", "react", "zod", "minified react error"]):
                    self.record_blocker(f"Erro crítico no console do navegador: {text}")
            elif msg_type == "warning":
                self.console_warnings.append(text)

        def on_page_error(err: Any) -> None:
            err_msg = str(err)
            self.console_errors.append(f"PageError: {err_msg}")
            self.record_blocker(f"Exceção não tratada na página: {err_msg}")

        def on_request_failed(req: Any) -> None:
            url_sanitized = sanitize_url(req.url)
            fail_entry = f"{req.method} {url_sanitized}"
            if self.in_expected_error_window and "/api/v1/dashboard/admin/summary" in req.url:
                self.expected_request_failures.append(fail_entry)
                print(f"[+] Request failure esperado capturado (route.abort): {fail_entry}")
            else:
                self.unexpected_request_failures.append(fail_entry)
                self.record_blocker(f"Falha de rede inesperada: {fail_entry}")

        def on_response(res: Response) -> None:
            url = res.url
            sanitized = sanitize_url(url)
            lower_url = url.lower()

            if any(term in lower_url for term in ["supabase", "postiz", "/mock/"]):
                self.forbidden_requests.append(sanitized)
                self.record_blocker(f"Requisição para serviço proibido/mock detectada: {sanitized}")

            if "/api/v1/dashboard/admin/summary" in url:
                parsed = urlparse(url)
                self.summary_requests.append({
                    "path": parsed.path,
                    "query": parsed.query,
                    "status": res.status,
                })

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("requestfailed", on_request_failed)
        page.on("response", on_response)

    def save_screenshot(self, page: Page, filename: str) -> None:
        target_path = self.artifact_dir / filename
        page.screenshot(path=str(target_path), full_page=True)
        self.screenshots.append(filename)
        print(f"[+] Screenshot capturado: {target_path}")

    def assert_summary_checkpoint(
        self,
        action_name: str,
        action_fn: Any,
        expected_deltas: Any = 1,
    ) -> None:
        valid_deltas: set[int]
        if isinstance(expected_deltas, (list, tuple, set)):
            valid_deltas = set(expected_deltas)
        else:
            valid_deltas = {int(expected_deltas)}

        before_count = len(self.summary_requests)
        action_fn()
        after_count = len(self.summary_requests)
        delta = after_count - before_count
        passed = delta in valid_deltas
        record = {
            "action": action_name,
            "beforeCount": before_count,
            "afterCount": after_count,
            "delta": delta,
            "expectedDeltas": sorted(list(valid_deltas)),
            "pass": passed,
        }
        self.summary_checkpoints.append(record)
        print(f"[*] Checkpoint N+1 '{action_name}': delta={delta} (esperado {sorted(list(valid_deltas))}) -> {'PASS' if passed else 'FAIL'}")
        if not passed:
            self.record_blocker(
                f"Checkpoint N+1 falhou em '{action_name}': esperado {sorted(list(valid_deltas))} novas requests, ocorrido {delta}"
            )

    def validate_and_capture_theme(self, page: Page, target_theme: str, screenshot_name: str) -> None:
        print(f"[*] Validando e configurando tema visual '{target_theme}'...")
        # 1. Detecta tema atual no DOM
        current_data_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme') || 'dark'")

        if current_data_theme != target_theme:
            # Alterna usando exclusivamente o controle real da Topbar
            button_label = "Ativar tema claro" if target_theme == "light" else "Ativar tema escuro"
            toggle_btn = page.locator(f'button[aria-label="{button_label}"]')
            if toggle_btn.count() == 0:
                self.record_blocker(f"Botão para alternar tema para {target_theme} ('{button_label}') não encontrado.")
                return
            toggle_btn.click()
            page.wait_for_selector(f"html[data-theme='{target_theme}']", timeout=5000)

        # 2. Confirma atributo data-theme resultante
        effective_data_theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        if effective_data_theme != target_theme:
            self.record_blocker(f"Atributo data-theme incorreto: esperado '{target_theme}', encontrado '{effective_data_theme}'")

        # 3. Asserts dos tokens CSS canônicos
        tokens = page.evaluate("""() => {
            const rootStyle = getComputedStyle(document.documentElement);
            const mainEl = document.querySelector('main');
            const mainStyle = mainEl ? getComputedStyle(mainEl) : null;
            return {
                surfaceBg: rootStyle.getPropertyValue('--z-surface-bg').trim(),
                surfaceCard: rootStyle.getPropertyValue('--z-surface-card').trim(),
                mainComputedBg: mainStyle ? mainStyle.backgroundColor : null
            };
        }""")

        expected_surface_bg = "#F5F6F8" if target_theme == "light" else "#0F0F12"
        expected_surface_card = "#FFFFFF" if target_theme == "light" else "#18181D"

        if tokens.get("surfaceBg", "").lower() != expected_surface_bg.lower():
            self.record_blocker(
                f"Token --z-surface-bg em {target_theme} inválido: esperado {expected_surface_bg}, encontrado {tokens.get('surfaceBg')}"
            )
        if tokens.get("surfaceCard", "").lower() != expected_surface_card.lower():
            self.record_blocker(
                f"Token --z-surface-card em {target_theme} inválido: esperado {expected_surface_card}, encontrado {tokens.get('surfaceCard')}"
            )

        self.theme_computed[target_theme] = {
            "dataTheme": effective_data_theme,
            "tokens": tokens,
            "valid": True,
        }
        print(f"[+] Tema '{target_theme}' validado com sucesso com tokens canônicos!")
        self.save_screenshot(page, screenshot_name)

    def validate_responsive_viewport(self, page: Page, width: int, height: int, screenshot_name: str) -> None:
        print(f"[*] Validando responsividade em {width}x{height}...")
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(300)

        scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
        has_overflow = scroll_width > (width + 4)
        if has_overflow:
            self.record_blocker(f"Overflow horizontal detectado no viewport {width}x{height}: scrollWidth={scroll_width}")

        h1_visible = page.locator('h1:has-text("Visão geral")').is_visible()
        kpi_section = page.locator('section[aria-label="Indicadores principais"]')
        period_sel = page.locator('select[aria-label="Selecionar período do dashboard"]')
        client_sel = page.locator('select[aria-label="Filtrar por cliente"]')
        carteira_title = page.locator(':text("Carteira de clientes")').first
        fin_title = page.locator(':text("Resumo financeiro")').first

        kpi_box = kpi_section.bounding_box() if kpi_section.count() > 0 else None
        period_box = period_sel.bounding_box() if period_sel.count() > 0 else None
        client_box = client_sel.bounding_box() if client_sel.count() > 0 else None
        carteira_box = carteira_title.bounding_box() if carteira_title.count() > 0 else None
        fin_box = fin_title.bounding_box() if fin_title.count() > 0 else None

        boxes_valid = all([
            h1_visible,
            kpi_box and kpi_box["width"] > 0 and kpi_box["height"] > 0,
            period_box and period_box["width"] > 0 and period_box["height"] > 0,
            client_box and client_box["width"] > 0 and client_box["height"] > 0,
            carteira_box and carteira_box["width"] > 0 and carteira_box["height"] > 0,
            fin_box and fin_box["width"] > 0 and fin_box["height"] > 0,
        ])

        if not boxes_valid:
            self.record_blocker(f"Elementos essenciais do Dashboard sem geometria ou visibilidade válida em {width}x{height}")

        # Asserções específicas de proteção para 1280px (Desktop baseline)
        if width == 1280:
            sidebar_locator = page.locator('aside[aria-label="Menu principal de navegação"]')
            if sidebar_locator.count() > 0:
                is_expanded = sidebar_locator.get_attribute("data-expanded") == "true"
                sidebar_box = sidebar_locator.bounding_box()
                sidebar_w = sidebar_box["width"] if sidebar_box else 0
                print(f"[*] Verificação 1280px Desktop: sidebar data-expanded={is_expanded}, width={sidebar_w}px")
                if not is_expanded or sidebar_w < 200:
                    self.record_blocker(
                        f"Sidebar em 1280px desktop não permaneceu expandida: data-expanded={is_expanded}, width={sidebar_w}"
                    )

        # Asserções específicas de usabilidade mobile para 390px
        if width == 390:
            print("[*] Executando validação detalhada de usabilidade mobile (390px)...")
            sidebar_locator = page.locator('aside[aria-label="Menu principal de navegação"]')
            is_collapsed = sidebar_locator.get_attribute("data-expanded") == "false" if sidebar_locator.count() > 0 else False
            sidebar_box = sidebar_locator.bounding_box() if sidebar_locator.count() > 0 else None
            sidebar_w = sidebar_box["width"] if sidebar_box else 0
            sidebar_valid = is_collapsed and sidebar_w <= 72

            if not sidebar_valid:
                self.record_blocker(
                    f"Sidebar em 390px não colapsou corretamente: data-expanded={sidebar_locator.get_attribute('data-expanded')}, width={sidebar_w} (esperado <= 72px)"
                )

            # Área útil principal (mainContent)
            main_content_locator = page.locator('div[class*="mainContent"], main').first
            main_box = main_content_locator.bounding_box() if main_content_locator.count() > 0 else None
            main_width = main_box["width"] if main_box else 0
            main_valid = main_width >= 300

            if not main_valid:
                self.record_blocker(
                    f"Área principal comprimida em 390px: width={main_width} (esperado >= 300px)"
                )

            # Largura dos filtros
            period_w = period_box["width"] if period_box else 0
            client_w = client_box["width"] if client_box else 0
            filters_valid = period_w >= 180 and client_w >= 180

            if not filters_valid:
                self.record_blocker(
                    f"Filtros comprimidos em 390px: periodWidth={period_w}, clientWidth={client_w} (esperado ambos >= 180px)"
                )

            # Largura mínima de KPI (1 coluna)
            first_kpi = page.locator('section[aria-label="Indicadores principais"] a, section[aria-label="Indicadores principais"] div[class*="kpiCard"]').first
            first_kpi_box = first_kpi.bounding_box() if first_kpi.count() > 0 else None
            kpi_w = first_kpi_box["width"] if first_kpi_box else (kpi_box["width"] if kpi_box else 0)
            kpi_valid = kpi_w >= 220

            if not kpi_valid:
                self.record_blocker(
                    f"Cards de KPI comprimidos em 390px: width={kpi_w} (esperado >= 220px)"
                )

            # Elementos da topbar em mobile
            sidebar_toggle_vis = page.locator('button[class*="toggleBtn"]').first.is_visible()
            theme_toggle_vis = page.locator('button[aria-label*="tema"], button[aria-label*="Tema"]').first.is_visible()
            avatar_vis = page.locator('div[class*="topbarAvatar"], div[class*="topbarUserMenu"]').first.is_visible()

            search_vis = page.locator('div[class*="searchBox"]').is_visible()
            admin_badge_vis = page.locator('div[class*="adminBadge"]').is_visible()

            if not sidebar_toggle_vis or not theme_toggle_vis or not avatar_vis:
                self.record_blocker("Controles essenciais da topbar não visíveis em 390px (toggle/theme/avatar).")

            if search_vis or admin_badge_vis:
                self.record_blocker("Elementos desnecessários da topbar (searchBox/adminBadge) permaneceram visíveis em 390px.")

            # Clipping check: selects e KPI não ultrapassam a área útil do mainContent
            clipping_valid = True
            if main_box:
                tol = 4.0
                main_right = main_box["x"] + main_box["width"] + tol
                if period_box and ((period_box["x"] + period_box["width"]) > main_right or period_box["x"] < main_box["x"] - tol):
                    clipping_valid = False
                if client_box and ((client_box["x"] + client_box["width"]) > main_right or client_box["x"] < main_box["x"] - tol):
                    clipping_valid = False
                if first_kpi_box and ((first_kpi_box["x"] + first_kpi_box["width"]) > main_right or first_kpi_box["x"] < main_box["x"] - tol):
                    clipping_valid = False

            if not clipping_valid:
                self.record_blocker("Clipping horizontal detectado em 390px: elementos essenciais ultrapassam área útil.")

            self.mobile_usability = {
                "viewport": "390x844",
                "sidebarCollapsed": is_collapsed,
                "sidebarWidth": round(sidebar_w, 1),
                "mainContentWidth": round(main_width, 1),
                "periodSelectWidth": round(period_w, 1),
                "clientSelectWidth": round(client_w, 1),
                "minimumKpiWidth": round(kpi_w, 1),
                "searchHidden": not search_vis,
                "adminBadgeHidden": not admin_badge_vis,
                "clippingValid": clipping_valid,
                "valid": all([
                    sidebar_valid,
                    main_valid,
                    filters_valid,
                    kpi_valid,
                    sidebar_toggle_vis,
                    theme_toggle_vis,
                    avatar_vis,
                    not search_vis,
                    not admin_badge_vis,
                    clipping_valid,
                ]),
            }

        self.viewports_tested.append({
            "viewport": f"{width}x{height}",
            "scrollWidth": scroll_width,
            "overflowDetected": has_overflow,
            "essentialsValid": boxes_valid,
        })

        self.save_screenshot(page, screenshot_name)

    def run(self) -> int:
        print("[*] Iniciando Zafira Hub 2.1 Browser Runtime Gate...")
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

            success = len(self.blockers) == 0
            report = {
                "gitSha": self.git_sha,
                "baseUrl": self.web_base_url,
                "decision": "F4.5-C1.R PASS" if success else "F4.5-C1.R FAIL",
                "blockersCount": len(self.blockers),
                "blockers": self.blockers,
                "errorInjection": self.error_injection_report,
                "mobileUsability": self.mobile_usability,
                "authSessionValidation": self.auth_session_validation,
                "initialSummary": self.initial_summary,
                "summaryRequestsTotal": len(self.summary_requests),
                "summaryCheckpoints": self.summary_checkpoints,
                "forbiddenRequests": self.forbidden_requests,
                "themeComputed": self.theme_computed,
                "domAssertions": self.dom_assertions,
                "viewports": self.viewports_tested,
                "screenshots": self.screenshots,
                "consoleErrorsCount": len(self.console_errors),
                "consoleWarningsCount": len(self.console_warnings),
                "expectedRequestFailures": self.expected_request_failures,
                "unexpectedRequestFailures": self.unexpected_request_failures,
            }

            report_file = self.artifact_dir / "dashboard-browser-report.json"
            try:
                report_file.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
                print(f"[+] Relatório JSON gerado: {report_file}")
            except Exception as e:
                print(f"[-] Erro ao salvar relatório JSON: {e}", file=sys.stderr)

        if success:
            print("[+] BROWSER RUNTIME GATE: TODOS OS CHECKS PASSARAM COM SUCESSO!")
            return 0
        else:
            print(f"[-] BROWSER RUNTIME GATE: FALHA ({len(self.blockers)} blockers detectados).", file=sys.stderr)
            return 1

    def execute_suite(self, browser: Browser) -> None:
        # ==============================================================================
        # 1. Login Humano Real com ADMIN A
        # ==============================================================================
        print("\n[*] [1/9] Executando login real com ADMIN A...")
        context_a: BrowserContext = browser.new_context(
            viewport={"width": 1280, "height": 800},
            ignore_https_errors=True,
        )
        page_a: Page = context_a.new_page()
        self.attach_page_listeners(page_a)

        login_url = f"{self.web_base_url}/login"
        page_a.goto(login_url, wait_until="networkidle", timeout=30000)

        # Preenche formulário real
        page_a.fill('#email', self.gate_email_a)
        page_a.fill('#password', self.gate_password_a)

        with page_a.expect_response(
            lambda res: "/api/v1/auth/login" in res.url and res.status == 200,
            timeout=15000,
        ) as login_resp_info:
            page_a.click('button[type="submit"]')

        login_resp = login_resp_info.value
        print(f"[+] Login HTTP 200 confirmado: {sanitize_url(login_resp.url)}")

        # Aguarda redirecionamento para Home /
        page_a.wait_for_url(lambda u: "/login" not in u, timeout=15000)
        print(f"[+] Redirecionamento da URL pós-login confirmado: {page_a.url}")

        # Aguarda carregamento do DashboardAdminDs
        page_a.wait_for_selector('h1:has-text("Visão geral")', timeout=20000)
        print("[+] DashboardAdminDs renderizado no DOM com 'Visão geral'!")

        # ==============================================================================
        # 2. Autenticação Explícita e Validação de Sessão
        # ==============================================================================
        print("\n[*] [2/9] Validando autenticação explícita e role ADMIN na sessão...")
        session_data: Dict[str, Any] = page_a.evaluate(
            """async () => {
                const res = await fetch('/hub-api/api/v1/auth/session');
                return { status: res.status, data: await res.json() };
            }"""
        )

        status_session = session_data.get("status")
        body_session = session_data.get("data", {})
        is_auth = body_session.get("authenticated") is True
        active_org_id = body_session.get("activeOrganizationId")

        # Localiza role na organização ativa
        orgs = body_session.get("organizations", [])
        active_org = next((o for o in orgs if o.get("id") == active_org_id), None)
        active_role = active_org.get("role") if active_org else None

        self.auth_session_validation = {
            "status": status_session,
            "authenticated": is_auth,
            "activeOrganizationId": active_org_id,
            "activeRole": active_role,
        }

        if status_session != 200 or not is_auth:
            self.record_blocker(f"Consulta de /auth/session falhou: status={status_session}, authenticated={is_auth}")
        if active_org_id != self.org_a_id:
            self.record_blocker(f"activeOrganizationId diverge: esperado {self.org_a_id}, obtido {active_org_id}")
        if str(active_role).upper() != "ADMIN":
            self.record_blocker(f"Role na organização ativa diverge de ADMIN: {active_role}")

        print(f"[+] Sessão autenticada validada: role={active_role}, org={active_org_id}")

        # Valida presença e visibilidade real dos textos requeridos no DOM
        required_texts = [
            "Visão geral",
            "Clientes ativos",
            "MRR da carteira",
            "Recebíveis vencidos",
            "Total da carteira",
            "Carteira de clientes",
            "Resumo financeiro",
        ]
        for t in required_texts:
            loc = page_a.locator(f':text("{t}")').first
            is_vis = loc.is_visible() if loc.count() > 0 else False
            self.dom_assertions[f"dom_visible_{t}"] = is_vis
            if not is_vis:
                self.record_blocker(f"Texto obrigatório não visível no DOM: '{t}'")

        # ==============================================================================
        # 3. Summary Inicial Explícito
        # ==============================================================================
        print("\n[*] [3/9] Validando requisição de Summary inicial...")
        if not self.summary_requests:
            self.record_blocker("Nenhuma requisição para dashboard/admin/summary foi capturada no carregamento inicial.")
        else:
            initial_req = self.summary_requests[0]
            query_params = parse_qs(initial_req.get("query", ""))
            period_val = query_params.get("period", [""])[0]
            has_client_id = "clientId" in query_params

            self.initial_summary = {
                "status": initial_req.get("status"),
                "period": period_val,
                "hasClientId": has_client_id,
            }

            if initial_req.get("status") != 200:
                self.record_blocker(f"Summary inicial retornou HTTP {initial_req.get('status')} (esperado 200)")
            if period_val != "30d":
                self.record_blocker(f"Summary inicial executou com period='{period_val}' (esperado '30d')")
            if has_client_id:
                self.record_blocker("Summary inicial executou com clientId específico (esperado ausente/all)")

            print(f"[+] Summary inicial explícito confirmado: status={initial_req.get('status')}, period={period_val}")

        # ==============================================================================
        # 4. Criação de Clientes Sintéticos via API Real na Sessão de A
        # ==============================================================================
        print("\n[*] [4/9] Criando clientes sintéticos via API real...")
        clients_to_create = [
            {"name": "F45 Client Alpha", "status": "ACTIVE", "contractValue": 5000},
            {"name": "F45 Client Beta", "status": "ACTIVE", "contractValue": 7500},
            {"name": "F45 Client Gamma", "status": "PAUSED", "contractValue": 3000},
            {"name": "F45 Client Delta", "status": "INACTIVE", "contractValue": 2000},
            {"name": "F45 Client Lead", "status": "LEAD"},
        ]

        created_clients: List[Dict[str, Any]] = page_a.evaluate(
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
            clients_to_create,
        )

        alpha_client_id: Optional[str] = None
        beta_client_id: Optional[str] = None
        for item in created_clients:
            status = item.get("status")
            c_data = item.get("data", {})
            name = c_data.get("name", "Unknown")
            c_id = c_data.get("id")
            if status != 201 or not c_id:
                self.record_blocker(f"Falha ao criar cliente sintético '{name}': HTTP {status}")
            else:
                print(f"[+] Cliente criado: {name} (ID: {c_id})")
                if name == "F45 Client Alpha":
                    alpha_client_id = c_id
                elif name == "F45 Client Beta":
                    beta_client_id = c_id

        if not alpha_client_id or not beta_client_id:
            self.record_blocker("IDs dos clientes sintéticos Alpha e Beta não puderam ser determinados.")

        # Recarrega o Dashboard pós-fixture via checkpoint N+1
        self.assert_summary_checkpoint(
            "refresh_pos_fixture",
            lambda: (
                page_a.click('button[aria-label="Atualizar dados do dashboard"]'),
                page_a.wait_for_timeout(1000)
            ),
            expected_deltas=1
        )

        # ==============================================================================
        # 5. Checkpoints de Filtros de Cliente e Período (N+1 Verificado)
        # ==============================================================================
        print("\n[*] [5/9] Testando filtros com checkpoints determinísticos...")
        client_select = page_a.locator('select[aria-label="Filtrar por cliente"]')
        period_select = page_a.locator('select[aria-label="Selecionar período do dashboard"]')

        # 5.1 Filtro por F45 Client Alpha (checkpoint)
        if alpha_client_id:
            self.assert_summary_checkpoint(
                "filter_client_alpha",
                lambda: (
                    client_select.select_option(value=alpha_client_id),
                    page_a.wait_for_timeout(800)
                ),
                expected_deltas=1
            )

            # Retorno para "Todos os clientes" (checkpoint — aceita 0 por cache fresh ou 1)
            self.assert_summary_checkpoint(
                "return_all_clients",
                lambda: (
                    client_select.select_option(value="all"),
                    page_a.wait_for_timeout(800)
                ),
                expected_deltas={0, 1}
            )

        # 5.2 Troca de Período: 30d -> 7d -> 90d -> 30d
        self.assert_summary_checkpoint(
            "change_period_7d",
            lambda: (
                period_select.select_option(value="7d"),
                page_a.wait_for_timeout(800)
            ),
            expected_deltas=1
        )

        self.assert_summary_checkpoint(
            "change_period_90d",
            lambda: (
                period_select.select_option(value="90d"),
                page_a.wait_for_timeout(800)
            ),
            expected_deltas=1
        )

        # Retorno para 30d (checkpoint — aceita 0 por cache fresh ou 1)
        self.assert_summary_checkpoint(
            "return_period_30d",
            lambda: (
                period_select.select_option(value="30d"),
                page_a.wait_for_timeout(800)
            ),
            expected_deltas={0, 1}
        )

        # ==============================================================================
        # 6. Temas Light e Dark com Assert de Tokens Canônicos
        # ==============================================================================
        print("\n[*] [6/9] Validando temas Light e Dark com assert de tokens...")
        page_a.set_viewport_size({"width": 1280, "height": 800})

        # Valida Light
        self.validate_and_capture_theme(page_a, "light", "dashboard-1280-light.png")

        # Valida Dark
        self.validate_and_capture_theme(page_a, "dark", "dashboard-1280-dark.png")

        # Retorna para Light para os testes de layout
        self.validate_and_capture_theme(page_a, "light", "dashboard-1280-light-restored.png")

        # ==============================================================================
        # 7. Responsividade com Asserts de Geometria Funcional
        # ==============================================================================
        print("\n[*] [7/9] Testando responsividade com geometria funcional...")
        self.validate_responsive_viewport(page_a, 1280, 800, "dashboard-1280.png")
        self.validate_responsive_viewport(page_a, 1024, 800, "dashboard-1024.png")
        self.validate_responsive_viewport(page_a, 768, 900, "dashboard-768.png")
        self.validate_responsive_viewport(page_a, 390, 844, "dashboard-390.png")

        # Restaura 1280x800
        page_a.set_viewport_size({"width": 1280, "height": 800})

        # ==============================================================================
        # 8. Loading State com Assert Obrigatório
        # ==============================================================================
        print("\n[*] [8/9] Testando Loading State (assert obrigatório com latência CDP)...")
        cdp_session = context_a.new_cdp_session(page_a)
        try:
            # Aplica latência de rede real sem alterar o payload
            cdp_session.send("Network.emulateNetworkConditions", {
                "offline": False,
                "latency": 2000,
                "downloadThroughput": 1024 * 1024,
                "uploadThroughput": 1024 * 1024,
            })

            refresh_btn = page_a.locator('button[aria-label="Atualizar dados do dashboard"]')
            with page_a.expect_response(
                lambda r: "/api/v1/dashboard/admin/summary" in r.url and r.status == 200,
                timeout=15000,
            ):
                refresh_btn.click(no_wait_after=True)
                page_a.wait_for_timeout(250)
                is_busy = refresh_btn.get_attribute("aria-busy") == "true"
                print(f"[*] Loading observado: aria-busy={is_busy}")
                if not is_busy:
                    self.record_blocker("Botão de refresh não apresentou aria-busy='true' durante o loading")
        finally:
            cdp_session.send("Network.emulateNetworkConditions", {
                "offline": False,
                "latency": 0,
                "downloadThroughput": -1,
                "uploadThroughput": -1,
            })
            cdp_session.detach()

        # ==============================================================================
        # 9. Error State com Fault Injection Determinístico (Playwright route.abort) & Recovery Real
        # ==============================================================================
        print("\n[*] [9/9] Testando Error State determinístico (Fault Injection route.abort) e Recovery...")
        # A) Ordem prescrita:
        # 1. UI atualmente em: Todos os clientes + period 30d
        # 2. Selecionar período 7d ENQUANTO a rede ainda está normal (está fresh no cache)
        # 3. Provar API healthy antes do fault injection
        # 4. Instalar route.abort para summary
        # 5. Ativar in_expected_error_window
        # 6. Selecionar Client Beta -> gera a query inédita (Client Beta + 7d) sob fault injection
        if beta_client_id:
            # Seleciona 7d com rede normal (já visitado, cache fresh)
            print("[*] Selecionando período '7d' com rede normal (cache fresh)...")
            period_select.select_option(value="7d")
            page_a.wait_for_timeout(500)

            # Prova que a API está healthy antes de ativar o route.abort
            api_healthy_before = self.check_api_health_and_readiness()
            print(f"[*] API e Database readiness antes da injeção: healthy={api_healthy_before}")
            if not api_healthy_before:
                self.record_blocker("API ou Database não estavam healthy antes do fault injection de ErrorState.")

            summary_abort_pattern = "**/api/v1/dashboard/admin/summary*"

            def abort_dashboard_summary(route: Route) -> None:
                print(f"[+] route.abort acionado para summary: {route.request.url}")
                route.abort("failed")

            # Instala route.abort específico para summary
            page_a.route(summary_abort_pattern, abort_dashboard_summary)

            self.in_expected_error_window = True
            failures_before = len(self.expected_request_failures)

            # Dispara a query inédita que forçará o ErrorState por ausência de cache
            print("[*] Selecionando Client Beta (criando query inédita Client Beta + 7d sob fault injection)...")
            client_select.select_option(value=beta_client_id)

            error_locator = page_a.locator(':text("Não foi possível carregar o dashboard")')
            error_visible = False
            try:
                error_locator.wait_for(state="visible", timeout=30000)
                error_visible = True
                print("[+] ErrorState determinístico confirmado no DOM!")

                # Asserções semânticas do ErrorState
                retry_btn_locator = page_a.locator('button:has-text("Tentar novamente")')
                retry_btn_visible = retry_btn_locator.is_visible()
                stale_kpi_visible = page_a.locator(':text("Clientes ativos")').is_visible()

                if not retry_btn_visible:
                    self.record_blocker("Botão 'Tentar novamente' não está visível no ErrorState.")
                if stale_kpi_visible:
                    self.record_blocker("KPIs de dados continuaram visíveis como conteúdo stale no ErrorState.")

                # Captura obrigatória do screenshot do ErrorState ANTES de remover o fault injection
                self.save_screenshot(page_a, "dashboard-error.png")
            except Exception as e:
                self.record_blocker(f"ErrorState não foi renderizado com query inédita sob route.abort: {e}")

            failures_observed = len(self.expected_request_failures) - failures_before
            print(f"[*] Request failures de summary observadas sob fault injection: {failures_observed}")
            if failures_observed < 1:
                self.record_blocker("Nenhuma tentativa de requisição para summary foi abortada durante o fault injection.")

            # Desativa o fault injection antes do recovery
            page_a.unroute(summary_abort_pattern, abort_dashboard_summary)
            self.in_expected_error_window = False
            route_removed = True
            print("[*] Fault injection route.abort desativado com sucesso.")

            # Valida que a API continua healthy após a injeção (provando que a falha foi puramente no transporte do browser)
            api_healthy_after = self.check_api_health_and_readiness()
            print(f"[*] API e Database readiness após remoção do abort: healthy={api_healthy_after}")
            if not api_healthy_after:
                self.record_blocker("API ou Database apresentaram instabilidade após o teste de ErrorState.")

            # Recovery Real acionando o botão REAL de "Tentar novamente" aguardando summary 200
            print("[*] Acionando botão 'Tentar novamente' para recovery com backend real...")
            recovery_status = None
            try:
                with page_a.expect_response(
                    lambda r: "/api/v1/dashboard/admin/summary" in r.url and r.status == 200,
                    timeout=15000,
                ) as resp_info:
                    retry_btn = page_a.locator('button:has-text("Tentar novamente")')
                    if retry_btn.count() > 0:
                        retry_btn.click()
                    else:
                        page_a.click('button[aria-label="Atualizar dados do dashboard"]')
                recovery_status = resp_info.value.status
            except Exception as exc:
                self.record_blocker(f"Falha ao aguardar resposta HTTP 200 no recovery: {exc}")

            page_a.wait_for_timeout(1000)

            # Comprova que mensagem de erro desapareceu e blocos voltaram
            is_error_gone = not page_a.locator(':text("Não foi possível carregar o dashboard")').is_visible()
            cards_restored = page_a.locator(':text("Clientes ativos")').is_visible() and \
                             page_a.locator(':text("Carteira de clientes")').is_visible()

            if not is_error_gone or not cards_restored:
                self.record_blocker("Recovery incompleto: dashboard não restabeleceu visão geral após retry.")
            else:
                print("[+] Recovery com health e summary 200 concluído com sucesso!")
                self.save_screenshot(page_a, "dashboard-recovered.png")

            self.error_injection_report = {
                "method": "PLAYWRIGHT_ROUTE_ABORT",
                "target": "/api/v1/dashboard/admin/summary",
                "query": {
                    "period": "7d",
                    "client": "F45 Client Beta"
                },
                "apiHealthyBefore": api_healthy_before,
                "requestFailuresObserved": failures_observed,
                "errorStateVisible": error_visible,
                "apiHealthyAfter": api_healthy_after,
                "routeRemovedBeforeRecovery": route_removed,
                "recoverySummaryStatus": recovery_status,
            }

        context_a.close()

        # ==============================================================================
        # 10. Empty State com ADMIN B (ORG B vazia)
        # ==============================================================================
        print("\n[*] [10/10] Testando Empty State na ORG B (ADMIN B)...")
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
        page_b.wait_for_selector('h1:has-text("Visão geral")', timeout=20000)

        # Valida que na ORG B vazia aparece "Nenhum cliente cadastrado"
        empty_text_locator = page_b.locator(':text("Nenhum cliente cadastrado")')
        try:
            empty_text_locator.wait_for(state="visible", timeout=10000)
            print("[+] EmptyState confirmado no DOM para a Organização B vazia!")
            self.save_screenshot(page_b, "dashboard-empty.png")
            self.dom_assertions["dom_has_empty_state_org_b"] = True
        except Exception as e:
            self.record_blocker(f"Texto de EmptyState 'Nenhum cliente cadastrado' não foi encontrado na Org B: {e}")
            self.dom_assertions["dom_has_empty_state_org_b"] = False

        context_b.close()


if __name__ == "__main__":
    runner = BrowserGateRunner()
    sys.exit(runner.run())
