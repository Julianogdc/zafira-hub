#!/usr/bin/env python3
"""
Zafira Hub 2.1 - F7-3 Agenda Google Calendar Browser Runtime Gate (Homologation Rehearsal) - F7-3b
Chromium autenticado (Playwright) contra as imagens publicadas, banco de ensaio e o SIMULADOR do Google
(scripts/homologation/google-calendar-mock.mjs). NENHUMA conta real. Pessoas e clientes ficticios.
Nada e semeado de agenda: o gate conecta, descobre, monitora e vincula pela interface.

Cenarios:
  A  Capacidades e menu; estado "nao conectado"
  B  Conexao pela interface (consentimento simulado), descoberta, monitoramento e categoria padrao
  C  Agenda mensal e semanal, filtros, vinculo local a cliente e projeto
  D  Privacidade: sem cliente, carteira, privado mascarado, participante por identidade associada
  E  Permissoes negativas (membro, sem calendar.view)
  F  Conexao revogada e agenda desatualizada
  G  Desconectar
  H  Isolamento da Org B
  I  Responsividade 390 px
  J  Simulador: a API de agenda so recebeu GET
  K  Onboarding por evento do Calendar (F7-3c): pendente, atendida, conclusao, cancelado, revogada
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, expect, sync_playwright

DLG = '[role="dialog"][data-state="open"]'
CLIENT_1 = "f7f7f7f7-c1c1-4c1c-8c1c-000000000001"
CLIENT_2 = "f7f7f7f7-c1c1-4c1c-8c1c-000000000002"
NAV = "nav[aria-label='Navegação do sistema'] a"


def env_required(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[-] ERRO: variavel obrigatoria '{name}' ausente.", file=sys.stderr)
        sys.exit(1)
    return val


def sanitize(url: str) -> str:
    p = urlparse(url)
    return f"{p.path}?{p.query}" if p.query else p.path


class CalendarGate:
    def __init__(self) -> None:
        self.base = os.environ.get("WEB_BASE_URL", "http://127.0.0.1:8083").rstrip("/")
        self.api_prefix = os.environ.get("API_PREFIX", "/hub-api")
        self.mock = os.environ.get("GOOGLE_MOCK_URL", "http://127.0.0.1:8091").rstrip("/")
        self.email_admin = os.environ.get("GATE_EMAIL_A", "gate-a@zafira.invalid")
        self.email_b = os.environ.get("GATE_EMAIL_B", "gate-b@zafira.invalid")
        self.email_manager = "gate-manager-a@zafira.invalid"
        self.email_member = "gate-member-a@zafira.invalid"
        self.email_pessoa = "gate-pessoa-a@zafira.invalid"
        self.email_noview = "gate-semview-a@zafira.invalid"
        self.password_a = env_required("GATE_PASSWORD_A")
        self.password_b = env_required("GATE_PASSWORD_B")
        self.api_container = os.environ.get("API_CONTAINER_NAME", "api-f45-browser")
        self.skip_docker = os.environ.get("GATE_SKIP_DOCKER", "") == "1"
        self.artifacts = pathlib.Path(os.environ.get("ARTIFACT_DIR", "artifacts/calendar-browser"))
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
            # o navegador nunca fala com o Google real (o consentimento e do simulador local); so o HOST conta
            if any(host.endswith(t) for t in ["supabase.co", "app.asana.com", "googleapis.com", "accounts.google.com"]):
                self.blockers.append(f"Requisicao proibida pelo navegador: {sanitize(res.url)}")

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("response", on_response)

    def login(self, browser: Browser, email: str, password: str, scenario: str, width: int = 1280, height: int = 900) -> Page:
        # limite de 10 logins/min por IP: espera a janela virar e tenta de novo
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

    def mock_control(self, payload: Dict[str, Any]) -> None:
        req = urllib.request.Request(f"{self.mock}/__control", data=json.dumps(payload).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()

    def mock_methods(self) -> List[str]:
        with urllib.request.urlopen(f"{self.mock}/__requests", timeout=10) as r:
            return json.loads(r.read().decode()).get("methods", [])

    def menu_has_agenda(self, page: Page) -> bool:
        page.wait_for_timeout(1500)
        return page.locator(NAV).filter(has_text="Agenda").count() > 0

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
            "decision": "F7-3b CALENDAR GATE PASS" if success else "F7-3b CALENDAR GATE FAIL",
            "scenariosExecuted": self.scenarios,
            "assertionsPassedCount": len(self.passed),
            "assertionsPassed": self.passed,
            "assertionsFailedCount": len(self.failed),
            "assertionsFailed": self.failed,
            "blockers": self.blockers,
            "screenshots": self.screenshots,
            "consoleErrorsCount": len(self.console_errors),
        }
        (self.artifacts / "calendar-browser-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({k: report[k] for k in ("decision", "assertionsPassedCount", "assertionsFailedCount")}, ensure_ascii=False))
        for b in self.blockers:
            print(f"[-] BLOCKER: {b}", file=sys.stderr)
        for f in self.failed:
            print(f"[-] FAILED: {f}", file=sys.stderr)
        return 0 if success else 1

    # ------------------------------------------------------------------ suite
    def suite(self, browser: Browser) -> None:
        now = datetime.now(timezone.utc)

        def iso(days: int, hour: int = 14) -> str:
            return (now + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")

        def day(days: int) -> str:
            return (now + timedelta(days=days)).strftime("%Y-%m-%d")

        def ev(eid: str, **over: Any) -> Dict[str, Any]:
            base = {"id": eid, "status": "confirmed", "summary": f"Evento {eid}", "start": {"dateTime": iso(1)}, "end": {"dateTime": iso(1, 15)},
                    "updated": iso(-1), "organizer": {"email": "organizador@zafira.invalid"},
                    "attendees": [{"email": "participante@zafira.invalid"}], "htmlLink": f"https://calendar.google.com/event?eid={eid}",
                    "description": "NAO DEVE APARECER", "hangoutLink": "https://meet.google.com/xxx-yyyy-zzz"}
            base.update(over)
            return base

        # evento "hoje" para ficar visivel na grade de qualquer mes corrente
        self.mock_payload = {
            "revoked": False,
            "calendars": [
                {"id": "cal-capt", "summary": "Captações F7-3", "accessRole": "owner", "timeZone": "America/Sao_Paulo"},
                {"id": "cal-reun", "summary": "Reuniões F7-3", "accessRole": "reader", "timeZone": "America/Sao_Paulo"},
                {"id": "cal-ocup", "summary": "Ocupado F7-3", "accessRole": "freeBusyReader"},
            ],
            "events": {
                "cal-capt": [
                    ev("kickoff", summary="Kickoff Cliente 1", start={"dateTime": iso(0, 15)}, end={"dateTime": iso(0, 16)}),
                    ev("privado", summary="Conversa reservada", visibility="private", location="Sala secreta", start={"dateTime": iso(0, 17)}, end={"dateTime": iso(0, 18)}),
                    ev("diainteiro", summary="Dia de captação externa", start={"date": day(1)}, end={"date": day(2)}, attendees=[]),
                    ev("serie-a", summary="Alinhamento semanal", recurringEventId="serie-gate", start={"dateTime": iso(2)}, end={"dateTime": iso(2, 15)}),
                    ev("serie-b", summary="Alinhamento semanal", recurringEventId="serie-gate", start={"dateTime": iso(9)}, end={"dateTime": iso(9, 15)}),
                ],
                "cal-reun": [ev("interna", summary="Reunião interna da equipe", start={"dateTime": iso(0, 19)}, end={"dateTime": iso(0, 20)})],
                "cal-ocup": [],
            },
        }
        self.mock_control(self.mock_payload)

        # A ---------------------------------------------------------------
        self.scenarios.append("A - Capacidades, menu e estado nao conectado")
        admin = self.login(browser, self.email_admin, self.password_a, "A")
        caps = (self.api(admin, "/api/v1/auth/capabilities").get("body") or {}).get("permissions") or {}
        self.check("A", "admin: calendar.view, link, manage_connections e view_all", all(caps.get(f"calendar.{k}") is True for k in ["view", "link", "manage_connections", "view_all"]), str(caps))
        self.goto(admin, "/agenda")
        admin.get_by_text("Google Calendar não conectado").first.wait_for(timeout=20000)
        self.ok("A", "estado vazio: Google nao conectado (sem dados automaticos)")
        self.check("A", "menu lateral exibe Agenda", self.menu_has_agenda(admin))

        # B ---------------------------------------------------------------
        self.scenarios.append("B - Conexao, calendarios e categoria padrao")
        self.goto(admin, "/agenda/configuracao")
        admin.get_by_test_id("connection-state").wait_for(timeout=20000)
        self.check("B", "integracao configurada no ambiente de ensaio", admin.get_by_test_id("not-configured").count() == 0)
        admin.get_by_test_id("connect-google").click()
        admin.wait_for_url(re.compile(r".*/agenda/configuracao\?calendar=connected.*"), timeout=30000)
        admin.get_by_test_id("settings-notice").wait_for(timeout=20000)
        self.check("B", "conta conectada pelo fluxo OAuth (consentimento simulado)", "Conectada" in admin.get_by_test_id("connection-state").inner_text(), admin.get_by_test_id("connection-state").inner_text())
        self.check("B", "conta exibida apenas mascarada", re.search(r"\w\*\*\*@", admin.get_by_test_id("connection-state").inner_text()) is not None)
        admin.get_by_test_id("discover-calendars").click()
        admin.get_by_test_id("source-row").first.wait_for(timeout=20000)
        self.check("B", "tres calendarios descobertos, nenhum monitorado automaticamente", admin.get_by_test_id("source-row").count() == 3 and admin.locator('[data-testid="source-row"] input[type=checkbox]:checked').count() == 0)
        self.check("B", "calendario so livre/ocupado sinalizado", "detalhes limitados" in admin.locator('[data-testid="source-row"][data-name="Ocupado F7-3"]').inner_text())
        for name in ["Captações F7-3", "Reuniões F7-3"]:
            row = admin.locator(f'[data-testid="source-row"][data-name="{name}"]')
            box = row.locator("input[type=checkbox]")
            box.click()
            expect(box).to_be_checked(timeout=15000)
        capt = admin.locator('[data-testid="source-row"][data-name="Captações F7-3"]')
        capt.locator("select").select_option("CAPTURE")
        admin.wait_for_timeout(700)
        admin.get_by_test_id("sync-now").click()
        admin.get_by_text("Leitura concluída").first.wait_for(timeout=30000)
        self.ok("B", "calendarios monitorados e leitura executada pela interface")
        self.check("B", "categoria padrao salva e ultima leitura exibida", "Última leitura" in capt.inner_text() and capt.locator("select").input_value() == "CAPTURE")
        self.shot(admin, "f73-b-configuracao.png")

        # C ---------------------------------------------------------------
        self.scenarios.append("C - Agenda, filtros e vinculos")
        self.goto(admin, "/agenda")
        admin.get_by_test_id("agenda-grid").wait_for(timeout=20000)
        fresh = admin.get_by_test_id("freshness")
        fresh.wait_for(timeout=15000)
        self.check("C", "ultima leitura exibida e nunca apresentada como tempo real", "Última leitura" in fresh.inner_text() and "não em tempo real" in fresh.inner_text(), fresh.inner_text())
        # seleciona hoje: eventos do dia no painel
        sp_day = (now.replace(hour=15, minute=0, second=0, microsecond=0) - timedelta(hours=3)).strftime("%Y-%m-%d")
        admin.locator(f'[data-testid="day-cell"][data-day="{sp_day}"]').click()
        admin.get_by_test_id("event-item").first.wait_for(timeout=15000)
        titles = admin.get_by_test_id("event-item").all_inner_texts()
        joined = " | ".join(titles)
        self.check("C", "eventos do dia listados (3 de hoje)", "Kickoff Cliente 1" in joined and "Reunião interna da equipe" in joined and "Compromisso privado" in joined, joined[:300])
        self.check("C", "dados excluidos nao aparecem (descricao, link de reuniao)", "NAO DEVE APARECER" not in admin.locator("main").inner_text() and "meet.google.com" not in admin.content())
        admin.get_by_test_id("mode-week").click()
        admin.get_by_test_id("day-cell").first.wait_for(timeout=10000)
        self.check("C", "modo semanal mostra 7 dias", admin.get_by_test_id("day-cell").count() == 7)
        admin.get_by_test_id("mode-month").click()
        self.check("C", "modo mensal mostra 42 dias", admin.get_by_test_id("day-cell").count() == 42)
        admin.get_by_label("Calendário").select_option(label="Reuniões F7-3")
        admin.wait_for_timeout(500)
        self.check("C", "filtro por calendario", "Kickoff Cliente 1" not in admin.get_by_test_id("day-panel").inner_text() and "Reunião interna" in admin.get_by_test_id("day-panel").inner_text())
        admin.get_by_label("Calendário").select_option(index=0)
        # vinculo local: kickoff -> Cliente 1, Reuniao, com projeto
        admin.get_by_test_id("event-item").filter(has_text="Kickoff Cliente 1").click()
        dlg = admin.locator(DLG)
        dlg.get_by_label("Cliente").select_option(label="F7 Gate Cliente 1")
        dlg.get_by_label("Categoria").select_option("MEETING")
        dlg.get_by_label("Nota interna").fill("Kickoff presencial")
        dlg.get_by_test_id("save-link").click()
        admin.locator(DLG).wait_for(state="detached", timeout=15000)
        item = admin.get_by_test_id("event-item").filter(has_text="Kickoff Cliente 1")
        try:
            # a lista recarrega depois de o dialogo fechar: espera o vinculo aparecer antes de conferir
            item.filter(has_text="F7 Gate Cliente 1").first.wait_for(timeout=15000)
        except Exception:  # noqa: BLE001
            pass
        self.check("C", "vinculo local salvo: cliente e categoria exibidos", "F7 Gate Cliente 1" in item.inner_text() and "Reunião" in item.inner_text(), item.inner_text())
        admin.get_by_label("Cliente", exact=True).first.select_option(label="F7 Gate Cliente 1")
        admin.wait_for_timeout(500)
        panel = admin.get_by_test_id("day-panel").inner_text()
        self.check("C", "filtro por cliente mostra so os vinculados", "Kickoff Cliente 1" in panel and "Reunião interna" not in panel, panel[:200])
        admin.get_by_label("Cliente", exact=True).first.select_option(index=0)
        # privado: vincula a Cliente 1 (para a carteira do gestor)
        admin.get_by_test_id("event-item").filter(has_text="Compromisso privado").click()
        dlg = admin.locator(DLG)
        self.check("C", "evento privado mascarado ate para o administrador", dlg.get_by_test_id("masked-note").count() == 1)
        dlg.get_by_label("Cliente").select_option(label="F7 Gate Cliente 1")
        dlg.get_by_test_id("save-link").click()
        admin.locator(DLG).wait_for(state="detached", timeout=15000)
        self.ok("C", "evento privado vinculado a Cliente 1 (mascarado)")
        self.shot(admin, "f73-c-agenda.png")

        # D ---------------------------------------------------------------
        self.scenarios.append("D - Privacidade, carteira e participante")
        manager = self.login(browser, self.email_manager, self.password_a, "D")
        mcaps = (self.api(manager, "/api/v1/auth/capabilities").get("body") or {}).get("permissions") or {}
        self.check("D", "gestor: view e link; sem manage_connections nem view_all", mcaps.get("calendar.view") is True and mcaps.get("calendar.link") is True and mcaps.get("calendar.manage_connections") is False and mcaps.get("calendar.view_all") is False, str(mcaps))
        mev = self.api(manager, "/calendar/events").get("body") or []
        titles_m = [e["title"] for e in mev]
        self.check("D", "gestor ve o vinculado a Cliente 1 (carteira) e o privado mascarado", "Kickoff Cliente 1" in titles_m and "Compromisso privado" in titles_m, str(titles_m))
        self.check("D", "gestor NAO ve evento sem cliente (nao e da agencia)", "Reunião interna da equipe" not in titles_m and "Dia de captação externa" not in titles_m, str(titles_m))
        priv = next((e for e in mev if e["title"] == "Compromisso privado"), {})
        self.check("D", "privado: sem local, link ou participantes no que chega ao navegador", priv.get("location") is None and priv.get("htmlLink") is None and priv.get("attendeeCount") == 0 and "Conversa reservada" not in json.dumps(mev) and "Sala secreta" not in json.dumps(mev), str(priv))
        raw = json.dumps(mev)
        self.check("D", "resposta sem e-mails, hashes de participantes ou descricao", "@" not in raw and "attendeeHashes" not in raw and "NAO DEVE" not in raw)
        # navegador nao concede identidade
        sneaky = self.api(manager, "/calendar/events?email=participante@zafira.invalid&participant=true").get("body") or []
        self.check("D", "e-mail/participante enviados pelo navegador nao ampliam o acesso", "Reunião interna da equipe" not in [e["title"] for e in sneaky])
        # outra ocorrencia da serie herda vinculo de serie
        admin_events = self.api(admin, "/calendar/events?to=" + (now + timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")).get("body") or []
        serie_a = next(e for e in admin_events if e["title"] == "Alinhamento semanal")
        r = self.api(admin, f"/calendar/events/{serie_a['id']}/link", "PUT", {"scope": "SERIES", "clientId": CLIENT_1, "category": "MEETING"})
        self.check("D", "vinculo de serie aplicado (API)", r["status"] == 200, f"{r['status']} {r['text'][:150]}")
        after = self.api(manager, "/calendar/events?to=" + (now + timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")).get("body") or []
        series = [e for e in after if e["title"] == "Alinhamento semanal"]
        self.check("D", "todas as ocorrencias da serie ficam vinculadas e visiveis ao gestor", len(series) == 2 and all((e.get("link") or {}).get("clientId") == CLIENT_1 for e in series), str(len(series)))
        # carteira: cliente fora da carteira nao vincula
        out = self.api(manager, f"/calendar/events/{series[0]['id']}/link", "PUT", {"scope": "EVENT", "clientId": CLIENT_2, "category": "OTHER"})
        self.check("D", "gestor nao vincula cliente fora da carteira (404)", out["status"] == 404, str(out["status"]))
        # associacao explicita de identidade por administrador; participante passa a ver
        admin.goto(f"{self.base}/agenda/configuracao", wait_until="networkidle")
        admin.get_by_label("Pessoa").select_option(label="Gate Pessoa Operacao")
        admin.get_by_label("E-mail no Google").fill("Participante@Zafira.invalid")
        admin.get_by_test_id("associate-identity").click()
        admin.get_by_test_id("identity-list").get_by_text("Gate Pessoa Operacao").wait_for(timeout=15000)
        listed = admin.get_by_test_id("identity-list").inner_text()
        self.check("D", "identidade associada exibida apenas mascarada", re.search(r"p\*\*\*@", listed) is not None and "participante@" not in listed.lower(), listed)
        pessoa = self.login(browser, self.email_pessoa, self.password_a, "D")
        pev = self.api(pessoa, "/calendar/events").get("body") or []
        ptitles = [e["title"] for e in pev]
        self.check("D", "participante associado ve evento sem cliente em que consta (e nao os demais)", "Reunião interna da equipe" in ptitles and "Dia de captação externa" not in ptitles, str(ptitles))
        ppriv = [e for e in pev if e["title"] == "Conversa reservada"]
        self.check("D", "participante ve o privado completo (nao mascarado)", len(ppriv) == 1 and ppriv[0]["masked"] is False and ppriv[0]["location"] == "Sala secreta", str(ptitles))

        # K1 --------------------------------------------------------------
        self.scenarios.append("K - Onboarding por evento do Calendar (F7-3c)")
        tpl = self.api(admin, "/onboarding/templates", "POST", {"name": "F7-3c Modelo Reuniao"}).get("body") or {}
        step_def = {"stepKey": "reuniao", "title": "Reunião de alinhamento com o cliente", "kind": "CALENDAR_EVENT",
                    "assigneeMode": "NONE", "dueAnchor": "RELEASED", "evidenceKind": "NONE", "evidenceRequired": False,
                    "completionCondition": "CALENDAR_EVENT_LINKED", "blocksCompletion": False, "dependsOn": []}
        saved = self.api(admin, f"/onboarding/templates/{tpl['id']}/versions/{tpl['draft']['id']}", "PUT",
                         {"expectedUpdatedAt": tpl["draft"]["updatedAt"], "steps": [step_def]})
        pub = self.api(admin, f"/onboarding/templates/{tpl['id']}/versions/{tpl['draft']['id']}/publish", "POST",
                       {"expectedUpdatedAt": (saved.get("body") or {}).get("draft", {}).get("updatedAt"), "changeNote": "modelo F7-3c"})
        self.check("K", "modelo com etapa de Calendar publicavel", saved["status"] == 200 and pub["status"] == 200, f"{saved['status']} {pub['status']}")
        k_tpl = tpl["id"]
        r2 = self.api(admin, "/onboarding/executions", "POST", {"clientId": CLIENT_2, "templateId": k_tpl})
        exec_k2 = (r2.get("body") or {}).get("id", "")
        self.goto(admin, f"/onboarding/execucoes/{exec_k2}")
        admin.get_by_test_id("calendar-condition").wait_for(timeout=20000)
        cond = admin.get_by_test_id("calendar-condition")
        self.check("K", "cliente sem evento vinculado: condicao pendente com mensagem", cond.get_attribute("data-state") == "PENDING" and "pendente" in cond.inner_text(), cond.inner_text())
        now_events = self.api(admin, "/calendar/events").get("body") or []
        internal = next((e for e in now_events if e["title"] == "Reunião interna da equipe"), None)
        self.check("K", "evento do dia encontrado na agenda", internal is not None)
        lk = self.api(admin, f"/calendar/events/{internal['id']}/link", "PUT", {"scope": "EVENT", "clientId": CLIENT_2, "category": "MEETING"})
        self.check("K", "evento vinculado ao cliente (vinculo local)", lk["status"] == 200, str(lk["status"]))
        admin.reload(wait_until="networkidle")
        admin.get_by_test_id("calendar-condition").wait_for(timeout=20000)
        cond = admin.get_by_test_id("calendar-condition")
        self.check("K", "vinculo atende a condicao, mas NAO conclui a etapa nem o onboarding",
                   cond.get_attribute("data-state") == "MET" and admin.locator('[data-testid="exec-step"][data-step-key="reuniao"]').get_attribute("data-status") == "READY"
                   and "Em andamento" in admin.get_by_test_id("execution-state").inner_text(), cond.inner_text())
        admin.locator('[data-testid="exec-step"][data-step-key="reuniao"]').get_by_test_id("action-complete").click()
        kdlg = admin.locator(DLG)
        self.check("K", "conclusao exige escolher o evento (botao desabilitado)", kdlg.get_by_test_id("confirm-complete").is_disabled())
        kdlg.locator("#calendar-event").select_option(index=1)
        kdlg.get_by_test_id("confirm-complete").click()
        admin.get_by_test_id("calendar-snapshot").wait_for(timeout=20000)
        self.check("K", "etapa concluida mostra o evento usado e o onboarding conclui ao fim",
                   "Reunião interna da equipe" in admin.get_by_test_id("calendar-snapshot").inner_text()
                   and "Concluído" in admin.get_by_test_id("execution-state").inner_text(), admin.get_by_test_id("execution-state").inner_text())
        self.shot(admin, "f73c-k-evento-usado.png")
        # Cliente 1 tem eventos vinculados: execucao ativa para os testes de cancelamento e revogacao
        r1 = self.api(admin, "/onboarding/executions", "POST", {"clientId": CLIENT_1, "templateId": k_tpl})
        exec_k1 = (r1.get("body") or {}).get("id", "")
        d1 = (self.api(admin, f"/onboarding/executions/{exec_k1}").get("body") or {})
        c1 = next((s["calendarCondition"] for s in d1.get("steps", []) if s["stepKey"] == "reuniao"), {}) or {}
        self.check("K", "cliente com eventos vinculados: condicao atendida", c1.get("state") == "MET", str(c1.get("state")))
        self.goto(admin, f"/onboarding/execucoes/{exec_k1}")
        admin.get_by_test_id("calendar-condition").wait_for(timeout=20000)
        self.shot(admin, "f73c-k-condicao-atendida.png")

        # E ---------------------------------------------------------------
        self.scenarios.append("E - Permissoes negativas")
        member = self.login(browser, self.email_member, self.password_a, "E")
        c = (self.api(member, "/api/v1/auth/capabilities").get("body") or {}).get("permissions") or {}
        self.check("E", "membro: so calendar.view", c.get("calendar.view") is True and c.get("calendar.link") is False and c.get("calendar.manage_connections") is False, str(c))
        self.goto(member, "/agenda/configuracao")
        member.get_by_text("Sem permissão para administrar a agenda").first.wait_for(timeout=20000)
        self.ok("E", "membro: configuracao mostra 'sem permissao'")
        self.check("E", "membro: API de administracao recusa (403)", self.api(member, "/calendar/connection")["status"] == 403 and self.api(member, "/calendar/sources/discover", "POST")["status"] == 403)
        r = self.api(member, f"/calendar/events/{series[0]['id']}/link", "PUT", {"scope": "EVENT", "category": "OTHER"})
        self.check("E", "membro nao vincula (403)", r["status"] == 403, str(r["status"]))
        self.check("E", "membro nao associa identidades (403)", self.api(member, "/calendar/identities", "PUT", {"memberId": "x", "email": "a@b.co"})["status"] == 403)
        mm = [e["title"] for e in (self.api(member, "/calendar/events").get("body") or [])]
        self.check("E", "membro ve so o vinculado a carteira; nada sem cliente", "Kickoff Cliente 1" in mm and "Reunião interna da equipe" not in mm and "Dia de captação externa" not in mm, str(mm))
        self.goto(member, "/agenda")
        member.get_by_test_id("agenda-page").wait_for(timeout=20000)
        self.check("E", "membro: agenda sem controles de vinculo", member.get_by_test_id("open-settings").count() == 0)
        noview = self.login(browser, self.email_noview, self.password_a, "E")
        self.check("E", "sem calendar.view: menu oculta Agenda", not self.menu_has_agenda(noview))
        self.goto(noview, "/agenda")
        noview.get_by_text("Sem permissão para ver a agenda").first.wait_for(timeout=20000)
        self.ok("E", "sem calendar.view: rota direta mostra 'sem permissao'")
        self.check("E", "sem calendar.view: backend recusa (403)", self.api(noview, "/calendar/events")["status"] == 403)

        # I ---------------------------------------------------------------
        self.scenarios.append("I - Responsividade 390 px")
        mob = self.login(browser, self.email_admin, self.password_a, "I", width=390, height=844)
        for path, wait_id in [("/agenda", None), ("/agenda/configuracao", "connection-state")]:
            self.goto(mob, path)
            if wait_id:
                mob.get_by_test_id(wait_id).wait_for(timeout=20000)
            else:
                mob.wait_for_timeout(2000)
            over = mob.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
            self.check("I", f"sem rolagem horizontal em 390 px: {path}", over <= 1, f"excesso={over}px")
            self.shot(mob, f"f73-i-390-{path.strip('/').replace('/', '-')}.png")

        # F ---------------------------------------------------------------
        self.scenarios.append("F - Conexao revogada e agenda desatualizada")
        # desatualizada: ultima leitura antiga (so com acesso ao container do ensaio)
        if self.skip_docker:
            self.ok("F", "agenda desatualizada: pulado localmente (GATE_SKIP_DOCKER=1)")
        else:
            script = ("const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();"
                      "p.calendarSource.updateMany({where:{isMonitored:true},data:{lastSyncedAt:new Date(Date.now()-6*3600*1000)}})"
                      ".then(r=>{console.log(JSON.stringify({count:r.count}));return p.$disconnect();})")
            probe = subprocess.run(["docker", "exec", "-w", "/app", self.api_container, "node", "-e", script], capture_output=True, text=True)
            okc = probe.returncode == 0
            self.check("F", "ultima leitura envelhecida no ensaio", okc, probe.stderr[-200:])
            self.goto(manager, "/agenda")
            banner = manager.get_by_test_id("freshness")
            banner.wait_for(timeout=20000)
            self.check("F", "agenda desatualizada: aviso claro, nao tempo real", banner.get_attribute("data-kind") == "warn" and "desatualizada" in banner.inner_text() and "não são em tempo real" in banner.inner_text(), banner.inner_text())
            self.shot(manager, "f73-f-desatualizada.png")
        # revogada: o Google passa a recusar a renovacao
        self.mock_control({"revoked": True})
        self.goto(admin, "/agenda/configuracao")
        admin.get_by_test_id("sync-now").click()
        admin.wait_for_timeout(1500)
        admin.reload(wait_until="networkidle")
        admin.get_by_test_id("connection-state").get_by_text("Conexão revogada: reconecte").wait_for(timeout=20000)
        self.ok("F", "configuracao indica conexao revogada")
        self.goto(manager, "/agenda")
        banner = manager.get_by_test_id("freshness")
        banner.wait_for(timeout=20000)
        self.check("F", "agenda: aviso de conexao revogada com a ultima leitura preservada", banner.get_attribute("data-kind") == "danger" and "revogada" in banner.inner_text() and manager.get_by_test_id("agenda-grid").count() == 1, banner.inner_text())
        self.shot(manager, "f73-f-revogada.png")
        dk = (self.api(admin, f"/onboarding/executions/{exec_k1}").get("body") or {})
        ck = next((s["calendarCondition"] for s in dk.get("steps", []) if s["stepKey"] == "reuniao"), {}) or {}
        self.check("F", "onboarding: conexao revogada torna a condicao do Calendar indisponivel", ck.get("state") == "UNAVAILABLE" and ck.get("reason") == "CONNECTION_UNAVAILABLE", str(ck.get("state")))
        rk = self.api(admin, f"/onboarding/executions/{exec_k1}/steps/reuniao/complete", "POST", {"calendarEventId": (ck.get("candidates") or [{"id": "x"}])[0]["id"] if ck.get("candidates") else "x"})
        self.check("F", "onboarding: conclusao recusada com a conexao revogada (409)", rk["status"] == 409, str(rk["status"]))
        # reconecta
        self.mock_control({"revoked": False})
        admin.get_by_test_id("connect-google").click()
        admin.wait_for_url(re.compile(r".*/agenda/configuracao\?calendar=connected.*"), timeout=30000)
        admin.get_by_test_id("connection-state").get_by_text("Conectada").wait_for(timeout=20000)
        self.ok("F", "reconexao restabelece a integracao")
        admin.get_by_test_id("sync-now").click()
        admin.get_by_text("Leitura concluída").first.wait_for(timeout=30000)

        # K2 --------------------------------------------------------------
        cancelled_ids = {"kickoff", "privado", "serie-a", "serie-b"}
        payload = json.loads(json.dumps(self.mock_payload))
        stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        for e in payload["events"]["cal-capt"]:
            if e["id"] in cancelled_ids:
                e["status"] = "cancelled"
                e["updated"] = stamp
        self.mock_control(payload)
        sync_res = self.api(admin, "/calendar/sync", "POST", {"forceFull": True})
        self.check("K", "leitura completa aplica os cancelamentos do Google", sync_res["status"] == 200, str(sync_res["status"]))
        dk2 = (self.api(admin, f"/onboarding/executions/{exec_k1}").get("body") or {})
        ck2 = next((s["calendarCondition"] for s in dk2.get("steps", []) if s["stepKey"] == "reuniao"), {}) or {}
        self.check("K", "eventos cancelados deixam a condicao pendente e a tela explica o motivo",
                   ck2.get("state") == "PENDING" and any("cancelado" in (x.get("reason") or "") for x in ck2.get("ineligible", [])), str(ck2)[:200])
        self.goto(admin, f"/onboarding/execucoes/{exec_k1}")
        txt = admin.get_by_test_id("calendar-condition").inner_text()
        self.check("K", "interface: pendente, com a lista do que nao serve", "pendente" in txt and "cancelado" in txt, txt[:300])
        self.shot(admin, "f73c-k-cancelado.png")

        # G ---------------------------------------------------------------
        self.scenarios.append("G - Desconectar")
        self.goto(admin, "/agenda/configuracao")
        admin.get_by_test_id("connection-state").get_by_text("Conectada").wait_for(timeout=20000)
        admin.get_by_test_id("disconnect-google").click()
        admin.locator(DLG).get_by_test_id("confirm-disconnect").click()
        admin.get_by_test_id("connection-state").get_by_text("Não conectada").wait_for(timeout=20000)
        self.ok("G", "conta desconectada (segredo apagado, leitura pausada)")
        self.goto(manager, "/agenda")
        manager.get_by_text("Google Calendar não conectado").first.wait_for(timeout=20000)
        self.ok("G", "agenda volta ao estado 'nao conectado'")

        # H ---------------------------------------------------------------
        self.scenarios.append("H - Isolamento Org B")
        pb = self.login(browser, self.email_b, self.password_b, "H")
        self.check("H", "Org B: lista de eventos vazia", (self.api(pb, "/calendar/events").get("body") or []) == [])
        self.check("H", "Org B: nao ve calendarios da Org A", (self.api(pb, "/calendar/sources").get("body") or []) == [])
        rr = self.api(pb, f"/calendar/events/{series[0]['id']}/link", "PUT", {"scope": "EVENT", "category": "OTHER"})
        self.check("H", "Org B: nao vincula evento da Org A (404)", rr["status"] == 404, str(rr["status"]))
        self.goto(pb, "/agenda")
        pb.get_by_text("Google Calendar não conectado").first.wait_for(timeout=20000)
        self.ok("H", "Org B: agenda sem dados da Org A")

        # J ---------------------------------------------------------------
        self.scenarios.append("J - Somente leitura no Google")
        methods = self.mock_methods()
        self.check("J", "a API de agenda do Google so recebeu GET", methods == ["GET"], str(methods))


if __name__ == "__main__":
    sys.exit(CalendarGate().run())
