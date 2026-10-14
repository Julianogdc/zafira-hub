#!/usr/bin/env python3
"""
Zafira Hub 2.1 - F8 Conteudo e Aprovacao do cliente por link - Browser Runtime Gate (Homologation Rehearsal)
Chromium autenticado (Playwright) contra as imagens publicadas e o banco de ensaio. NENHUM BrightBean, Asana ou
cliente real; arquivos sao bytes de teste com assinatura valida; pessoas e clientes ficticios.
Cobre a F8-1 (cadastro e upload), a F8-2 (link seguro, pagina publica, decisao, nova versao, revogacao)
e a F8-3 (contador de Entregas por estagio, somente leitura, publicados indisponivel)
e a F8-4b (agendamento pela versao aprovada, sem envio real: despachante desligado)
e a F8-5 (desempenho com dados sinteticos: coletor desligado).

Cenarios:
  A  Capacidades e menu
  B  Cadastro e upload pela interface (tipo real, extensao enganosa recusada, previa)
  C  Permissoes: quem nao tem envio ao cliente nao gera link
  D  Geracao do link (exibido uma vez) e congelamento da versao
  E  Pagina publica sem login: sem dados internos, sem terceiros, token fora de URLs, cabecalhos
  F  Decisao: validacoes, N1 declarado, decisao unica, resultado persistente
  G  Acompanhamento interno (status, decisao, identificacao declarada)
  H  Alteracao solicitada: nova versao, novo link, aprovacao
  I  Reemissao, revogacao e expiracao: respostas identicas
  J  Isolamento da Org B
  K  Responsividade 390 px
  L  Contador de Entregas por estagio (F8-3): sem duplicidade, publicados indisponivel, meta intacta
  M  Agendamento no Instagram (F8-4b): despachante desligado, versao aprovada, conta vinculada, estados que bloqueiam, legado so leitura
  N  Desempenho (F8-5): dados sinteticos, aguardando coleta sem zeros, coletado com datas, historico sem duplicar, Publicados indisponivel
  O  Correcoes pre-piloto (F8-5p): dimensoes e aviso acima de 30 MP, aviso de publicacao, politica do piloto em modo de simulacao
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from playwright.sync_api import Browser, Page, sync_playwright

CLIENT_1 = "f7f7f7f7-c1c1-4c1c-8c1c-000000000001"
PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf"
    "c0f01f0005000201a1a9b52a0000000049454e44ae426082"
)


def env_required(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[-] ERRO: variavel obrigatoria '{name}' ausente.", file=sys.stderr)
        sys.exit(1)
    return val


def unique_png(seed: int) -> bytes:
    """PNG valido e unico por teste (bytes extras apos o IEND nao invalidam a assinatura)."""
    return PNG_1X1 + (b"zafira-gate-%d" % seed)


class ContentGate:
    def __init__(self) -> None:
        self.base = os.environ.get("WEB_BASE_URL", "http://127.0.0.1:8083").rstrip("/")
        self.api_prefix = os.environ.get("API_PREFIX", "/hub-api")
        self.email_admin = os.environ.get("GATE_EMAIL_A", "gate-a@zafira.invalid")
        self.email_b = os.environ.get("GATE_EMAIL_B", "gate-b@zafira.invalid")
        self.email_member = "gate-member-a@zafira.invalid"
        self.password_a = env_required("GATE_PASSWORD_A")
        self.password_b = env_required("GATE_PASSWORD_B")
        self.api_container = os.environ.get("API_CONTAINER_NAME", "api-f45-browser")
        self.artifacts = pathlib.Path(os.environ.get("ARTIFACT_DIR", "artifacts/content-browser"))
        self.artifacts.mkdir(parents=True, exist_ok=True)
        self.passed: List[str] = []
        self.failed: List[str] = []
        self.blockers: List[str] = []
        self.scenarios: List[str] = []
        self.screenshots: List[str] = []
        self.console_errors: List[str] = []
        self.seed = int(time.time())

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

        page.on("console", on_console)
        page.on("pageerror", on_page_error)

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

    def public_post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        req = urllib.request.Request(
            f"{self.base}{self.api_prefix}{path}", data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return {"status": r.status, "headers": {k.lower(): v for k, v in r.headers.items()}, "text": r.read().decode()}
        except urllib.error.HTTPError as e:
            return {"status": e.code, "headers": {k.lower(): v for k, v in e.headers.items()}, "text": e.read().decode()}

    def db_exec(self, js: str) -> str:
        proc = subprocess.run(
            ["docker", "exec", "-w", "/app/apps/api", self.api_container, "node", "-e",
             "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{" + js
             + "})().then((r)=>{console.log(JSON.stringify(r));return p.$disconnect();}).catch((e)=>{console.error(String(e));process.exit(1);})"],
            capture_output=True, text=True,
        )
        return proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""

    def stages(self, page: Page) -> Dict[str, Any]:
        """F8-3: contador do mes corrente no fuso da organizacao (devolvido pela propria API)."""
        tz = "America/Sao_Paulo"
        out: Dict[str, Any] = {}
        for _ in range(2):
            period = datetime.now(ZoneInfo(tz)).strftime("%Y-%m")
            r = self.api(page, f"/clients/{CLIENT_1}/deliverables/content-stages?period={period}")
            body = r.get("body") or {}
            out = {"status": r["status"], "body": body, "period": period}
            if r["status"] != 200 or body.get("timeZone") in (None, tz):
                break
            tz = body["timeZone"]
        return out

    def plan_snapshot(self, page: Page, period: str) -> str:
        """Meta contratual e pecas do cliente no periodo (prova de que a F8-3 nao altera Entregas)."""
        plan = (self.api(page, f"/clients/{CLIENT_1}/deliverables?period={period}").get("body") or {}).get("plan")
        if not plan:
            return "sem plano"
        return json.dumps([plan.get("targetCount"), plan.get("status"),
                           [(i.get("targetQuantity"), i.get("deliveredQuantity"),
                             [(p.get("stage"), p.get("approvedAt"), p.get("deliveredAt")) for p in i.get("pieces", [])])
                            for i in plan.get("items", [])]])

    # ------------------------------------------------------------------ helpers de tela
    def new_content(self, page: Page, title: str, caption: str) -> str:
        self.goto(page, "/conteudo")
        page.get_by_test_id("new-content").click()
        page.locator("#new-client").select_option(label="F7 Gate Cliente 1")
        page.locator("#new-title").fill(title)
        page.locator('input[name="new-format"][value="FEED_IMAGE"]').check()
        page.locator("#new-caption").fill(caption)
        page.get_by_test_id("save-content").click()
        page.wait_for_url(re.compile(r".*/conteudo/[0-9a-f-]{36}$"), timeout=20000)
        return page.url.rsplit("/", 1)[-1]

    def upload_png(self, page: Page, seed: int, name: str = "arte-final.png") -> None:
        page.get_by_test_id("media-list").count()
        page.set_input_files('[data-testid="file-input"]', files=[{"name": name, "mimeType": "image/png", "buffer": unique_png(seed)}])

    def generate_link(self, page: Page) -> str:
        page.get_by_test_id("create-approval-link").click()
        field = page.get_by_test_id("approval-link-url")
        field.wait_for(timeout=15000)
        return field.input_value()

    def open_public(self, browser: Browser, url: str, width: int = 1280) -> Page:
        context = browser.new_context(viewport={"width": width, "height": 900}, ignore_https_errors=True)
        page = context.new_page()
        self.listen(page)
        page.goto(url, wait_until="networkidle", timeout=30000)
        return page

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
            "decision": "F8 CONTENT APPROVAL GATE PASS" if success else "F8 CONTENT APPROVAL GATE FAIL",
            "scenariosExecuted": self.scenarios,
            "assertionsPassedCount": len(self.passed),
            "assertionsPassed": self.passed,
            "assertionsFailedCount": len(self.failed),
            "assertionsFailed": self.failed,
            "blockers": self.blockers,
            "screenshots": self.screenshots,
            "consoleErrorsCount": len(self.console_errors),
        }
        (self.artifacts / "content-browser-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({k: report[k] for k in ("decision", "assertionsPassedCount", "assertionsFailedCount")}, ensure_ascii=False))
        for b in self.blockers:
            print(f"[-] BLOCKER: {b}", file=sys.stderr)
        for f in self.failed:
            print(f"[-] FAILED: {f}", file=sys.stderr)
        return 0 if success else 1

    # ------------------------------------------------------------------ suite
    def suite(self, browser: Browser) -> None:
        title1 = f"Gate F8 Peca interna {self.seed}"
        caption1 = "Legenda publica de teste do gate F8"

        # A ---------------------------------------------------------------
        self.scenarios.append("A - Capacidades e menu")
        admin = self.login(browser, self.email_admin, self.password_a, "A")
        caps = (self.api(admin, "/api/v1/auth/capabilities").get("body") or {}).get("permissions", {})
        self.check("A", "administrador: view, create e send_to_client", caps.get("content.view") is True and caps.get("content.create") is True and caps.get("content.send_to_client") is True, str(caps))
        self.check("A", "administrador: agenda publicacoes (content.schedule)", caps.get("content.schedule") is True, str(caps))
        member = self.login(browser, self.email_member, self.password_a, "A")
        mcaps = (self.api(member, "/api/v1/auth/capabilities").get("body") or {}).get("permissions", {})
        self.check("A", "membro: ve e cria, mas nao envia ao cliente", mcaps.get("content.view") is True and mcaps.get("content.create") is True and mcaps.get("content.send_to_client") is False, str(mcaps))
        self.goto(admin, "/conteudo")
        admin.get_by_test_id("content-page").wait_for(timeout=15000)
        self.check("A", "membro: nao agenda publicacoes", mcaps.get("content.schedule") is False, str(mcaps))
        self.check("A", "menu lateral exibe Arquivos de conteudo", admin.locator("nav[aria-label='Navegação do sistema'] a").filter(has_text="Arquivos de conteúdo").count() > 0)
        # F8-3: ponto de partida do contador e da meta, antes de qualquer conteudo deste gate
        stages_before = self.stages(admin)
        plan_before = self.plan_snapshot(admin, stages_before["period"])

        # B ---------------------------------------------------------------
        self.scenarios.append("B - Cadastro e upload")
        item_id = self.new_content(admin, title1, caption1)
        self.ok("B", "conteudo cadastrado pela interface (F8-1)")
        # extensao enganosa: HTML com nome .jpg
        admin.set_input_files('[data-testid="file-input"]', files=[{"name": "foto.jpg", "mimeType": "image/jpeg", "buffer": b"<html><script>alert(1)</script></html>"}])
        notice = admin.get_by_test_id("content-notice")
        notice.wait_for(timeout=15000)
        self.check("B", "arquivo com extensao enganosa e recusado pelo tipo real", "Tipo de arquivo não aceito" in notice.inner_text(), notice.inner_text())
        self.upload_png(admin, self.seed)
        admin.get_by_test_id("media-item").first.wait_for(timeout=20000)
        self.ok("B", "arquivo final enviado")
        admin.get_by_test_id("preview-image").first.wait_for(timeout=15000)
        self.check("B", "previa exibida no painel interno", admin.get_by_test_id("preview-panel").count() == 1)
        self.shot(admin, "f8-b-detalhe.png")

        # C ---------------------------------------------------------------
        self.scenarios.append("C - Permissoes")
        self.goto(member, f"/conteudo/{item_id}")
        member.get_by_test_id("approval-noperm").wait_for(timeout=15000)
        self.check("C", "membro nao ve o botao de gerar link e e orientado", member.get_by_test_id("create-approval-link").count() == 0)
        r = self.api(member, f"/content/items/{item_id}/approval-links", "POST", {})
        self.check("C", "API recusa envio ao cliente pelo membro (403)", r["status"] == 403, str(r["status"]))

        # D ---------------------------------------------------------------
        self.scenarios.append("D - Geracao do link")
        self.goto(admin, f"/conteudo/{item_id}")
        url1 = self.generate_link(admin)
        self.check("D", "link usa fragmento (#) e token longo", re.search(r"/aprovacao#[A-Za-z0-9_-]{40,}$", url1) is not None, url1[:80])
        token1 = url1.split("#", 1)[1]
        admin.get_by_test_id("frozen-banner").wait_for(timeout=15000)
        self.ok("D", "versao enviada fica congelada (nao editavel)")
        admin.reload(wait_until="networkidle")
        admin.get_by_test_id("approval-links").wait_for(timeout=15000)
        self.check("D", "token nao e exibido de novo depois de recarregar", admin.get_by_test_id("approval-link-url").count() == 0 and token1 not in admin.content())
        self.check("D", "status interno: aguardando o cliente", "Aguardando o cliente" in admin.get_by_test_id("approval-panel").inner_text())
        self.shot(admin, "f8-d-link.png")

        # E ---------------------------------------------------------------
        self.scenarios.append("E - Pagina publica")
        requests: List[str] = []
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, ignore_https_errors=True)
        pub = ctx.new_page()
        self.listen(pub)
        pub.on("request", lambda rq: requests.append(rq.url))
        pub.goto(url1, wait_until="networkidle", timeout=30000)
        pub.get_by_test_id("approval-page").wait_for(timeout=20000)
        self.check("E", "abre sem login (sem redirecionar para /login)", "/login" not in pub.url and "/aprovacao" in pub.url)
        text = pub.inner_text("body")
        self.check("E", "mostra a marca e a legenda do conteudo", "F7 Gate Cliente 1" in text and caption1 in text)
        self.check("E", "nao mostra o titulo interno nem dados internos", title1 not in text and item_id not in pub.content())
        pub.get_by_test_id("preview-image").wait_for(timeout=15000)
        self.ok("E", "previa inspirada no Instagram renderizada (imagem)")
        origin = urlparse(self.base).netloc
        foreign = [u for u in requests if urlparse(u).netloc not in ("", origin) and not u.startswith("data:") and not u.startswith("blob:")]
        self.check("E", "nenhum recurso de terceiros", not foreign, str(foreign[:3]))
        self.check("E", "o token nunca aparece em URL de requisicao", all(token1 not in u for u in requests))
        view = self.public_post("/public/approval/view", {"token": token1})
        self.check("E", "cabecalhos no-store, noindex e no-referrer na API publica",
                   view["headers"].get("cache-control") == "no-store" and "noindex" in view["headers"].get("x-robots-tag", "") and view["headers"].get("referrer-policy") == "no-referrer", str(view["headers"])[:200])
        self.check("E", "resposta publica sem chave de storage, hash de arquivo ou ids internos", all(k not in view["text"] for k in ["storageKey", "sha256", item_id, "org/"]))
        self.shot(pub, "f8-e-publica.png")

        # F ---------------------------------------------------------------
        self.scenarios.append("F - Decisao")
        approve = pub.get_by_test_id("approval-approve")
        changes = pub.get_by_test_id("approval-request-changes")
        self.check("F", "botoes desabilitados sem identificacao e declaracao", approve.is_disabled() and changes.is_disabled())
        pub.locator("#ap-name").fill("Maria da Marca")
        pub.locator("#ap-contact").fill("maria@marca.invalid")
        self.check("F", "aprovar segue desabilitado sem a declaracao de autoridade", approve.is_disabled())
        pub.get_by_test_id("approval-authority").check()
        self.check("F", "aprovar habilita com N1 completo", not approve.is_disabled())
        self.check("F", "solicitar alteracao exige comentario", changes.is_disabled())
        pub.locator("#ap-comment").fill("Trocar a cor do fundo e revisar a legenda.")
        self.check("F", "com comentario, solicitar alteracao habilita", not changes.is_disabled())
        self.check("F", "a tela nao apresenta N1 como identidade verificada", "Não é identidade autenticada nem verificada" in pub.inner_text("body"))
        changes.click()
        pub.get_by_test_id("approval-confirm").wait_for(timeout=5000)
        pub.get_by_test_id("approval-confirm-yes").click()
        result = pub.get_by_test_id("approval-result")
        result.wait_for(timeout=20000)
        self.check("F", "resposta registrada: alteracao solicitada", result.get_attribute("data-decision") == "CHANGES_REQUESTED")
        pub.reload(wait_until="networkidle")
        pub.get_by_test_id("approval-result").wait_for(timeout=15000)
        self.ok("F", "ao recarregar, a resposta continua registrada (decisao unica)")
        again = self.public_post("/public/approval/decision", {"token": token1, "decision": "APPROVED", "contentHash": "a" * 64,
                                                               "approverName": "Outra Pessoa", "approverContact": "x@y.invalid", "authorityDeclared": True})
        self.check("F", "segunda decisao na mesma versao e recusada (409)", again["status"] == 409, str(again["status"]))
        self.shot(pub, "f8-f-decisao.png")
        pub.context.close()

        # G ---------------------------------------------------------------
        self.scenarios.append("G - Acompanhamento interno")
        self.goto(admin, f"/conteudo/{item_id}")
        panel = admin.get_by_test_id("approval-panel")
        panel.get_by_test_id("approval-decisions").wait_for(timeout=15000)
        ptxt = panel.inner_text()
        self.check("G", "status: alteracao solicitada", "Alteração solicitada" in ptxt)
        self.check("G", "decisao com nome, contato, comentario e identificacao declarada (N1)",
                   "Maria da Marca" in ptxt and "maria@marca.invalid" in ptxt and "Trocar a cor do fundo" in ptxt and "identificação declarada (N1), não verificada" in ptxt)
        self.check("G", "historico registra a resposta do cliente", admin.get_by_test_id("content-history").locator('[data-event-type="CLIENT_CHANGES_REQUESTED"]').count() == 1)
        self.shot(admin, "f8-g-acompanhamento.png")

        # H ---------------------------------------------------------------
        self.scenarios.append("H - Nova versao")
        admin.get_by_test_id("new-version").click()
        admin.get_by_text("Nova versão criada").first.wait_for(timeout=15000)
        admin.locator("#c-caption").fill("Legenda revisada na versao 2")
        admin.get_by_test_id("save-content-data").click()
        admin.get_by_text("Alterações salvas").first.wait_for(timeout=15000)
        self.check("H", "versao 1 preservada e versao 2 editavel",
                   admin.get_by_test_id("versions-panel").locator('[data-version="1"]').count() == 1 and admin.get_by_test_id("versions-panel").locator('[data-version="2"]').count() == 1)
        url2 = self.generate_link(admin)
        pub2 = self.open_public(browser, url2)
        pub2.get_by_test_id("approval-page").wait_for(timeout=20000)
        self.check("H", "novo link mostra a versao 2 com a legenda revisada", "versão 2" in pub2.inner_text("body") and "Legenda revisada na versao 2" in pub2.inner_text("body"))
        pub2.locator("#ap-name").fill("Maria da Marca")
        pub2.locator("#ap-contact").fill("maria@marca.invalid")
        pub2.get_by_test_id("approval-authority").check()
        pub2.get_by_test_id("approval-approve").click()
        pub2.get_by_test_id("approval-confirm-yes").click()
        res2 = pub2.get_by_test_id("approval-result")
        res2.wait_for(timeout=20000)
        self.check("H", "aprovacao da versao 2 registrada", res2.get_attribute("data-decision") == "APPROVED")
        pub2.context.close()
        admin.reload(wait_until="networkidle")
        admin.get_by_test_id("approval-panel").get_by_text("Aprovado pelo cliente").wait_for(timeout=15000)
        self.check("H", "status interno: aprovado e duas decisoes preservadas", admin.get_by_test_id("approval-decisions").locator("li").count() == 2)
        self.shot(admin, "f8-h-aprovado.png")

        # I ---------------------------------------------------------------
        self.scenarios.append("I - Reemissao, revogacao e expiracao")
        item2 = self.new_content(admin, f"Gate F8 Reemissao {self.seed}", "Legenda reemissao")
        self.upload_png(admin, self.seed + 1)
        admin.get_by_test_id("media-item").first.wait_for(timeout=20000)
        link_a = self.generate_link(admin)
        admin.get_by_test_id("create-approval-link").click()
        admin.wait_for_function(
            "() => { const el = document.querySelector('[data-testid=approval-link-url]'); return el && el.value && !el.value.endsWith('%s'); }" % link_a.split("#", 1)[1]
        )
        link_b = admin.get_by_test_id("approval-link-url").input_value()
        self.check("I", "reemissao gera outro token", link_a != link_b)
        unknown_url = f"{self.base}/aprovacao#" + "x" * 43

        def unavailable(url: str) -> bool:
            pg = self.open_public(browser, url)
            try:
                pg.get_by_test_id("approval-unavailable").wait_for(timeout=15000)
                return "Este link não está disponível" in pg.inner_text("body")
            except Exception:  # noqa: BLE001
                return False
            finally:
                pg.context.close()

        self.check("I", "link anterior (reemitido) fica indisponivel", unavailable(link_a))
        self.check("I", "link desconhecido mostra a mesma tela", unavailable(unknown_url))
        # revogar o link B pela interface
        admin.get_by_test_id("revoke-approval-link").first.click()
        admin.get_by_text("Link revogado").first.wait_for(timeout=15000)
        self.check("I", "link revogado fica indisponivel (mesma tela)", unavailable(link_b))
        # novo link e expiracao forcada
        link_c = self.generate_link(admin)
        self.db_exec(f"return await p.approvalLink.updateMany({{where:{{itemId:'{item2}',revokedAt:null}},data:{{expiresAt:new Date(Date.now()-60000)}}}});")
        self.check("I", "link expirado fica indisponivel (mesma tela)", unavailable(link_c))
        admin.reload(wait_until="networkidle")
        admin.get_by_test_id("approval-panel").get_by_text("Link expirado").first.wait_for(timeout=15000)
        self.ok("I", "status interno distingue expirado do revogado")
        r = self.public_post("/public/approval/decision", {"token": link_c.split("#", 1)[1], "decision": "APPROVED", "contentHash": "b" * 64,
                                                           "approverName": "Pessoa", "approverContact": "p@q.invalid", "authorityDeclared": True})
        self.check("I", "expirado e revogado nao aceitam decisao (404 generico)", r["status"] == 404, str(r["status"]))

        # L ---------------------------------------------------------------
        self.scenarios.append("L - Contador de Entregas por estagio (F8-3)")
        after = self.stages(admin)
        self.check("L", "endpoint do contador responde (200)", after["status"] == 200 and stages_before["status"] == 200,
                   f"{stages_before['status']} / {after['status']}")
        cb = stages_before["body"].get("counts") or {}
        ca = after["body"].get("counts") or {}
        delta = {k: (ca.get(k) or 0) - (cb.get(k) or 0) for k in ("received", "sent", "approved")}
        self.check("L", "duas pecas recebidas, duas enviadas e uma aprovada: versoes, reenvios e revogacoes nao duplicam",
                   delta == {"received": 2, "sent": 2, "approved": 1}, str(delta))
        self.check("L", "contagem cumulativa: recebidos >= enviados >= aprovados",
                   (ca.get("received") or 0) >= (ca.get("sent") or 0) >= (ca.get("approved") or 0), str(ca))
        self.check("L", "publicados indisponivel (null), nunca 0",
                   "published" in ca and ca.get("published") is None and ca.get("publishedSource") == "NOT_INTEGRATED", str(ca))
        stage_of = {i.get("id"): i.get("stage") for i in after["body"].get("items", [])}
        self.check("L", "peca com alteracao pedida e nova versao conta uma vez, como aprovada", stage_of.get(item_id) == "APPROVED", str(stage_of.get(item_id)))
        self.check("L", "peca reemitida, revogada e expirada conta como enviada", stage_of.get(item2) == "SENT", str(stage_of.get(item2)))
        self.check("L", "resposta sem midia, storage ou dados do aprovador",
                   all(k not in json.dumps(after["body"]) for k in ["storageKey", "sha256", "approverName", "approverContact", "tokenHash"]))
        self.check("L", "meta contratual e pecas de Entregas intactas", self.plan_snapshot(admin, after["period"]) == plan_before, plan_before[:120])
        rm = self.api(member, f"/clients/{CLIENT_1}/deliverables/content-stages?period={after['period']}")
        self.check("L", "membro com ver Entregas e ver Conteudos tambem consulta (somente leitura)", rm["status"] == 200, str(rm["status"]))
        self.goto(admin, f"/projetos?clientId={CLIENT_1}")
        panel = admin.get_by_test_id("content-stages-panel")
        try:
            panel.wait_for(timeout=8000)
        except Exception:  # noqa: BLE001 - cliente com projeto Asana: Entregas fica em uma aba
            admin.get_by_role("button", name="Entregas").first.click()
        panel.get_by_test_id("content-stage-received-value").wait_for(timeout=20000)
        ui = {k: panel.get_by_test_id(f"content-stage-{k}-value").inner_text().strip() for k in ("received", "sent", "approved", "published")}
        self.check("L", "cartoes mostram os mesmos numeros da API",
                   [ui["received"], ui["sent"], ui["approved"]] == [str(ca.get("received")), str(ca.get("sent")), str(ca.get("approved"))], str(ui))
        self.check("L", "cartao Publicados: aguardando integracao, nunca 0",
                   ui["published"] == "—" and "Aguardando integração" in panel.get_by_test_id("content-stage-published").inner_text(), ui["published"])
        bar = panel.get_by_test_id("content-stages-bar")
        self.check("L", "barra neutra, sem percentual, enquanto a publicacao nao estiver integrada",
                   bar.get_attribute("data-state") == "NOT_INTEGRATED" and "%" not in bar.inner_text(), bar.inner_text()[:120])
        self.check("L", "painel somente leitura (nenhum botao de acao)", panel.locator("button").count() == 0)
        self.shot(admin, "f8-l-contador-entregas.png")

        # M ---------------------------------------------------------------
        # F8-4b (DEC-F8-027): agendamento no Instagram pela versao aprovada, com o despachante DESLIGADO.
        # Nada sai do Hub: sem BrightBean real, sem publicacao. A conta Instagram e um vinculo ficticio no banco de ensaio.
        self.scenarios.append("M - Agendamento no Instagram (F8-4b, despachante desligado)")
        ig_account = f"gate-ig-{self.seed}"
        fb_account = f"gate-fb-{self.seed}"
        self.db_exec(
            "await p.clientIntegration.create({data:{clientId:'" + CLIENT_1 + "',provider:'BRIGHTBEAN',externalId:'" + ig_account
            + "',metadata:{platform:'instagram_login',accountName:'Conta Gate Instagram'}}});"
            + "await p.clientIntegration.create({data:{clientId:'" + CLIENT_1 + "',provider:'BRIGHTBEAN',externalId:'" + fb_account
            + "',metadata:{platform:'facebook',accountName:'Pagina Gate Facebook'}}});return true;"
        )
        settings = self.api(admin, "/content/publication-settings").get("body") or {}
        self.check("M", "despachante desligado por padrao no ensaio", settings.get("dispatchEnabled") is False, str(settings))
        targets = self.api(admin, f"/content/items/{item_id}/publication-targets").get("body") or []
        self.check("M", "somente contas Instagram vinculadas ao cliente (Facebook fora do piloto)",
                   [t.get("socialAccountId") for t in targets] == [ig_account], str(targets))

        self.goto(admin, f"/conteudo/{item_id}")
        panel = admin.get_by_test_id("publication-panel")
        panel.get_by_test_id("publication-form").wait_for(timeout=15000)
        ptxt = admin.inner_text("body")
        self.check("M", "painel abaixo de Aprovacao do cliente",
                   -1 < ptxt.find("Aprovação do cliente") < ptxt.find("Publicação no Instagram") < ptxt.find("Versões"))
        self.check("M", "aviso honesto: envio ao Instagram desligado", panel.get_by_test_id("publication-dispatch-off").count() == 1)
        panel.get_by_test_id("publication-account").select_option(ig_account)
        panel.get_by_test_id("publication-review").click()
        confirm = panel.get_by_test_id("publication-confirm")
        confirm.wait_for(timeout=10000)
        self.check("M", "confirmacao em dois passos mostra versao, conta e horario",
                   "versão 2" in confirm.inner_text() and "Conta Gate Instagram" in confirm.inner_text())
        self.check("M", "nada e registrado antes de confirmar", (self.api(admin, f"/content/items/{item_id}/publications").get("body") or []) == [])
        confirm.get_by_test_id("publication-confirm-yes").click()
        panel.get_by_test_id("publication-done").wait_for(timeout=15000)
        pubs = self.api(admin, f"/content/items/{item_id}/publications").get("body") or []
        p1 = pubs[0] if pubs else {}
        self.check("M", "agendamento registrado no Hub, nao enviado ao Instagram",
                   len(pubs) == 1 and p1.get("state") == "PENDING" and p1.get("sentToProvider") is False and p1.get("versionNumber") == 2, str(pubs)[:300])
        item_el = panel.locator('[data-testid="publication-item"][data-publication-state="PENDING"]')
        self.check("M", "tela distingue: Registrado no Hub e envio nao ativo",
                   "Registrado no Hub" in item_el.inner_text() and "não está ativo" in item_el.get_by_test_id("publication-delivery").inner_text())
        self.check("M", "conta ja agendada fica indisponivel para nova solicitacao", panel.get_by_test_id("publication-review").is_disabled())
        dup = self.api(admin, f"/content/items/{item_id}/publications", "POST", {"socialAccountId": ig_account, "scheduledAt": p1.get("scheduledAt")})
        self.check("M", "segunda publicacao ativa da mesma versao e conta recusada (409)",
                   dup["status"] == 409 and (dup.get("body") or {}).get("code") == "PUBLICATION_ALREADY_ACTIVE", dup["text"][:160])
        other = self.api(admin, f"/content/items/{item_id}/publications", "POST", {"socialAccountId": fb_account, "scheduledAt": p1.get("scheduledAt")})
        self.check("M", "conta fora do piloto recusada", other["status"] in (403, 404, 409, 422), str(other["status"]))
        self.shot(admin, "f8-m-agendado-hub.png")

        # reagendar pela tela
        before_at = p1.get("scheduledAt")
        item_el.get_by_test_id("publication-reschedule").click()
        rs = panel.get_by_test_id("publication-reschedule-form")
        rs.wait_for(timeout=10000)
        new_day = datetime.fromordinal(datetime.now(ZoneInfo("America/Sao_Paulo")).date().toordinal() + 3)
        rs.get_by_test_id("publication-reschedule-date").fill(new_day.strftime("%Y-%m-%d"))
        rs.get_by_test_id("publication-reschedule-time").fill("15:30")
        rs.get_by_test_id("publication-reschedule-review").click()
        panel.get_by_test_id("publication-confirm").wait_for(timeout=10000)
        panel.get_by_test_id("publication-confirm-yes").click()
        panel.get_by_test_id("publication-done").wait_for(timeout=15000)
        p1b = (self.api(admin, f"/content/items/{item_id}/publications").get("body") or [{}])[0]
        self.check("M", "reagendamento registrado (novo horario, mesmo registro)",
                   p1b.get("id") == p1.get("id") and p1b.get("scheduledAt") != before_at, str(p1b)[:200])
        soon = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 60))
        r = self.api(admin, f"/content/publications/{p1.get('id')}/reschedule", "POST", {"scheduledAt": soon})
        self.check("M", "horario com menos de 5 minutos recusado (422)", r["status"] == 422, str(r["status"]))
        r = self.api(admin, f"/content/publications/{p1.get('id')}/reschedule", "POST", {"scheduledAt": "2030-01-10T10:00:00"})
        self.check("M", "horario sem fuso explicito recusado (422)", r["status"] == 422, str(r["status"]))

        # cancelar pela tela e agendar de novo
        panel.locator('[data-testid="publication-item"][data-publication-state="PENDING"]').get_by_test_id("publication-cancel").click()
        panel.get_by_test_id("publication-confirm").wait_for(timeout=10000)
        panel.get_by_test_id("publication-confirm-yes").click()
        panel.get_by_test_id("publication-done").wait_for(timeout=15000)
        p1c = (self.api(admin, f"/content/items/{item_id}/publications").get("body") or [{}])[0]
        self.check("M", "cancelamento antes do envio encerra no Hub", p1c.get("state") == "CANCELLED", str(p1c.get("state")))
        again = self.api(admin, f"/content/items/{item_id}/publications", "POST", {"socialAccountId": ig_account, "scheduledAt": p1b.get("scheduledAt")})
        self.check("M", "depois do cancelamento, novo agendamento e aceito (201)", again["status"] == 201, again["text"][:160])
        p2_id = (again.get("body") or {}).get("id", "")

        # estados que bloqueiam acoes (simulados no banco de ensaio; o despachante esta desligado)
        for state, label in [("AMBIGUOUS", "Em conferência"), ("PROVIDER_RETRY", "Nova tentativa automática"), ("PUBLISHING", "Publicando")]:
            self.db_exec(f"return await p.contentPublication.update({{where:{{id:'{p2_id}'}},data:{{state:'{state}'}}}}).then(()=>true);")
            self.goto(admin, f"/conteudo/{item_id}")
            el = admin.locator(f'[data-testid="publication-item"][data-publication-state="{state}"]')
            el.wait_for(timeout=15000)
            self.check("M", f"{state}: rotulo '{label}' e nenhuma acao na tela", label in el.inner_text() and el.locator("button").count() == 0)
            rc = self.api(admin, f"/content/publications/{p2_id}/cancel", "POST", {})
            rr = self.api(admin, f"/content/publications/{p2_id}/reschedule", "POST", {"scheduledAt": p1b.get("scheduledAt")})
            self.check("M", f"{state}: API recusa cancelar e reagendar (409)", rc["status"] == 409 and rr["status"] == 409, f"{rc['status']} {rr['status']}")
        self.db_exec(f"return await p.contentPublication.update({{where:{{id:'{p2_id}'}},data:{{state:'PENDING'}}}}).then(()=>true);")

        # conteudo nao aprovado
        self.goto(admin, f"/conteudo/{item2}")
        admin.get_by_test_id("publication-not-approved").wait_for(timeout=15000)
        self.check("M", "conteudo nao aprovado: sem formulario, com orientacao", admin.get_by_test_id("publication-form").count() == 0)
        r = self.api(admin, f"/content/items/{item2}/publications", "POST", {"socialAccountId": ig_account, "scheduledAt": p1b.get("scheduledAt")})
        self.check("M", "API recusa agendar versao nao aprovada (409)",
                   r["status"] == 409 and (r.get("body") or {}).get("code") == "VERSION_NOT_APPROVED", r["text"][:160])

        # membro: acompanha, nao agenda
        self.goto(member, f"/conteudo/{item_id}")
        member.get_by_test_id("publication-noperm").wait_for(timeout=15000)
        mpanel = member.get_by_test_id("publication-panel")
        self.check("M", "membro ve o acompanhamento sem botoes de acao",
                   mpanel.get_by_test_id("publication-item").count() >= 1 and mpanel.locator("button").count() == 0)
        r1 = self.api(member, f"/content/items/{item_id}/publications", "POST", {"socialAccountId": ig_account, "scheduledAt": p1b.get("scheduledAt")})
        r2 = self.api(member, f"/content/publications/{p2_id}/cancel", "POST", {})
        self.check("M", "API recusa agendar e cancelar pelo membro (403)", r1["status"] == 403 and r2["status"] == 403, f"{r1['status']} {r2['status']}")

        # telas legadas: somente leitura, com orientacao
        self.goto(admin, "/conteudos")
        admin.get_by_test_id("legacy-readonly-notice").wait_for(timeout=15000)
        self.check("M", "Conteudos & Agenda: orientacao e sem compositor", admin.get_by_text("Criar conteúdo", exact=True).count() == 0)
        r = self.api(admin, "/api/v1/social/upload", "POST", {})
        self.check("M", "escrita legada desativada na API (410)", r["status"] == 410, str(r["status"]))
        sent = self.db_exec(f"return await p.contentPublication.count({{where:{{itemId:'{item_id}',externalPostId:{{not:null}}}}}});")
        self.check("M", "nenhuma publicacao foi enviada ao provedor", sent == "0", sent)
        self.shot(admin, "f8-m-legado-leitura.png")

        # N ---------------------------------------------------------------
        # F8-5d (DEC-F8-029): desempenho com dados SINTETICOS no banco de ensaio. Nenhum provedor, nenhum coletor:
        # a publicacao confirmada e a coleta sao gravadas aqui como o coletor gravaria (despachante e coletor desligados).
        self.scenarios.append("N - Desempenho da publicacao (F8-5, dados sinteticos)")
        self.db_exec(
            f"return await p.contentPublication.update({{where:{{id:'{p2_id}'}},data:{{state:'PUBLISHED',externalPostId:'gate-sim-post-{self.seed}',"
            f"platformPostId:'gate-sim-{self.seed}',permalink:'https://simulador.invalid/p/{self.seed}',publishedAt:new Date(Date.now()-2*3600000)}}}}).then(()=>true);"
        )
        m0 = self.api(admin, f"/content/publications/{p2_id}/metrics")
        b0 = m0.get("body") or {}
        self.check("N", "publicado sem coleta: aguardando, sem numero", m0["status"] == 200 and b0.get("status") == "AWAITING_COLLECTION" and b0.get("latest") is None and b0.get("history") == [], m0["text"][:200])
        self.goto(admin, f"/conteudo/{item_id}")
        blk = admin.get_by_test_id("publication-metrics")
        blk.wait_for(timeout=15000)
        btxt = blk.inner_text()
        self.check("N", "tela: Aguardando coleta, nenhum valor e nenhum zero exibido",
                   "Aguardando coleta" in btxt and blk.get_by_test_id("publication-metrics-values").count() == 0 and re.search(r"\d", btxt) is None, btxt[:200])
        self.shot(admin, "f8-n-aguardando-coleta.png")

        # coleta sintetica: capturedAt (provedor) uma hora antes de fetchedAt (consulta do Hub)
        ins = self.db_exec(
            f"const pub=await p.contentPublication.findUniqueOrThrow({{where:{{id:'{p2_id}'}}}});"
            f"const cap=new Date(Date.now()-90*60000);const fet=new Date(Date.now()-30*60000);"
            f"await p.contentPublicationMetric.create({{data:{{organizationId:pub.organizationId,publicationId:pub.id,capturedAt:cap,fetchedAt:fet,"
            f"reach:1234,views:2500,likes:87,comments:9,saves:null,shares:4,engagementPct:3.25,metricKinds:{{engagement:'percent'}}}}}});"
            f"await p.contentPublication.update({{where:{{id:pub.id}},data:{{metricsCheckedAt:fet,metricsLastOutcome:'COLLECTED'}}}});return cap.toISOString();"
        )
        cap_iso = ins.strip('"')
        m1 = (self.api(admin, f"/content/publications/{p2_id}/metrics").get("body") or {})
        latest = m1.get("latest") or {}
        self.check("N", "API: coletado, com capturedAt do provedor distinto de fetchedAt do Hub",
                   m1.get("status") == "COLLECTED" and latest.get("capturedAt") == cap_iso and latest.get("fetchedAt") not in (None, cap_iso), str(m1)[:300])
        self.check("N", "API: indicador ausente segue nulo (nunca 0)", "saves" in latest and latest.get("saves") is None, str(latest))
        dup = self.db_exec(
            f"const pub=await p.contentPublication.findUniqueOrThrow({{where:{{id:'{p2_id}'}}}});"
            f"return await p.contentPublicationMetric.create({{data:{{organizationId:pub.organizationId,publicationId:pub.id,capturedAt:new Date('{cap_iso}'),fetchedAt:new Date(),reach:1}}}}).then(()=>'gravou');"
        )
        self.check("N", "mesma coleta nao duplica (unico por publicacao + capturedAt)", dup != '"gravou"', dup)
        upd = self.db_exec(f"return await p.contentPublicationMetric.updateMany({{where:{{publicationId:'{p2_id}'}},data:{{reach:1}}}}).then(()=>'alterou');")
        self.check("N", "historico de coletas nao e reescrito (UPDATE bloqueado)", upd != '"alterou"', upd)

        self.goto(admin, f"/conteudo/{item_id}")
        vals = admin.get_by_test_id("publication-metrics-values")
        vals.wait_for(timeout=15000)
        vtxt = vals.inner_text()
        self.check("N", "tela: valores coletados (alcance, engajamento em %)", "1.234" in vtxt and "3,25%" in vtxt, vtxt[:200])
        self.check("N", "tela: indicador ausente aparece como travessao", vals.locator('[data-metric="saves"]').inner_text().strip().startswith("—"))
        self.check("N", "tela: data da coleta do Instagram e da consulta do Hub", "Coletado pelo Instagram em" in admin.get_by_test_id("publication-metrics-captured").inner_text()
                   and "última consulta do Hub" in admin.get_by_test_id("publication-metrics-captured").inner_text())
        self.check("N", "publicado: nenhuma acao de reagendar ou cancelar", admin.locator('[data-testid="publication-item"][data-publication-state="PUBLISHED"] button').count() == 0)
        self.shot(admin, "f8-n-metricas-coletadas.png")

        # permissoes e isolamento
        self.goto(member, f"/conteudo/{item_id}")
        member.get_by_test_id("publication-metrics-values").wait_for(timeout=15000)
        self.check("N", "membro le o desempenho sem botoes de acao", member.get_by_test_id("publication-panel").locator("button").count() == 0)
        self.check("N", "membro: API de metricas 200 (somente leitura)", self.api(member, f"/content/publications/{p2_id}/metrics")["status"] == 200)

        # contador Publicados: com o envio desligado no ensaio continua indisponivel, mesmo com publicacao confirmada (D-F85-2)
        st = self.api(admin, f"/clients/{CLIENT_1}/deliverables/content-stages?period={after['period']}").get("body") or {}
        counts = st.get("counts") or {}
        self.check("N", "Publicados indisponivel (null, nunca 0) com o envio desligado",
                   counts.get("published") is None and counts.get("publishedSource") == "NOT_INTEGRATED", str(counts))

        # O ---------------------------------------------------------------
        # F8-5p (DEC-F8-031): correcoes pre-piloto. Positivos e negativos com dados sinteticos; nada e enviado.
        self.scenarios.append("O - Correcoes pre-piloto (F8-5p: P35, P37, P39)")
        self.goto(admin, f"/conteudo/{item_id}")
        dim = admin.get_by_test_id("media-dimensions").first
        dim.wait_for(timeout=15000)
        self.check("O", "P35: dimensoes lidas do arquivo exibidas (positivo)", "1×1" in dim.inner_text(), dim.inner_text())
        note = admin.get_by_test_id("publish-note").inner_text()
        self.check("O", "P37: aviso com limites tecnicos e formatos ainda sem publicacao real",
                   "30 megapixels" in note and "Nem todos os formatos foram homologados" in note, note[:200])
        big_id = self.new_content(admin, f"Gate F8 P35 {self.seed}", "Legenda imagem grande")
        big = (b"\x89PNG\r\n\x1a\n" + (13).to_bytes(4, "big") + b"IHDR" + (6000).to_bytes(4, "big") + (6000).to_bytes(4, "big")
               + bytes([8, 6, 0, 0, 0]) + (b"zafira-gate-big-%d" % self.seed))
        admin.set_input_files('[data-testid="file-input"]', files=[{"name": "grande.png", "mimeType": "image/png", "buffer": big}])
        # espera o aviso especifico (a lista ja existe antes do upload com "Envie os arquivos finais"); sem atraso fixo
        probs = admin.get_by_test_id("media-problems")
        try:
            probs.filter(has_text="30 megapixels").wait_for(timeout=20000)
        except Exception:  # noqa: BLE001 - a checagem abaixo registra a falha com o texto encontrado
            pass
        self.check("O", "P35: aviso ja no upload para imagem acima de 30 MP (negativo)", "30 megapixels" in probs.inner_text(), probs.inner_text()[:200])
        bd = self.api(admin, f"/content/items/{big_id}").get("body") or {}
        self.check("O", "P35: API sinaliza MEDIA_TOO_MANY_PIXELS antes da aprovacao",
                   any(p.get("code") == "MEDIA_TOO_MANY_PIXELS" for p in bd.get("problems", [])), str(bd.get("problems"))[:200])
        pol = (self.api(admin, "/content/publication-settings").get("body") or {}).get("pilotPolicy") or {}
        self.check("O", "P39: ensaio em modo de simulacao (politica nao exigida no pedido; envio seguiria bloqueado)",
                   pol.get("enforced") is False and pol.get("valid") is False and pol.get("organizationAuthorized") is False, str(pol))
        self.check("O", "P39: politica nao expoe outras organizacoes", "organizationIds" not in pol, str(pol))
        self.shot(admin, "f8-o-imagem-acima-de-30mp.png")

        # J ---------------------------------------------------------------
        self.scenarios.append("J - Isolamento Org B")
        pb = self.login(browser, self.email_b, self.password_b, "J")
        self.check("J", "Org B: nenhum conteudo da Org A", (self.api(pb, "/content/items").get("body") or []) == [])
        self.check("J", "Org B: acompanhamento da Org A recusado (404)", self.api(pb, f"/content/items/{item_id}/approval")["status"] == 404)
        self.check("J", "Org B: nao gera link para conteudo da Org A (404)", self.api(pb, f"/content/items/{item_id}/approval-links", "POST", {})["status"] == 404)
        self.check("J", "Org B: contador de Entregas do cliente da Org A recusado (404)",
                   self.api(pb, f"/clients/{CLIENT_1}/deliverables/content-stages?period={after['period']}")["status"] == 404)
        self.check("J", "Org B: agendamentos e contas da Org A recusados (404)",
                   self.api(pb, f"/content/items/{item_id}/publications")["status"] == 404
                   and self.api(pb, f"/content/items/{item_id}/publication-targets")["status"] == 404)
        rb = [
            self.api(pb, f"/content/items/{item_id}/publications", "POST", {"socialAccountId": ig_account, "scheduledAt": p1b.get("scheduledAt")})["status"],
            self.api(pb, f"/content/publications/{p2_id}/reschedule", "POST", {"scheduledAt": p1b.get("scheduledAt")})["status"],
            self.api(pb, f"/content/publications/{p2_id}/cancel", "POST", {})["status"],
        ]
        self.check("J", "Org B: nao agenda, reagenda nem cancela na Org A (404)", rb == [404, 404, 404], str(rb))
        self.check("J", "Org B: metricas da publicacao da Org A recusadas (404)", self.api(pb, f"/content/publications/{p2_id}/metrics")["status"] == 404)
        self.goto(pb, "/conteudo")
        pb.get_by_text("Nenhum conteúdo cadastrado").first.wait_for(timeout=15000)
        self.ok("J", "Org B: tela vazia, sem dados da Org A")

        # K ---------------------------------------------------------------
        self.scenarios.append("K - Responsividade 390 px")
        admin.set_viewport_size({"width": 390, "height": 800})
        for path, label in [("/conteudo", "lista"), (f"/conteudo/{item_id}", "detalhe")]:
            self.goto(admin, path)
            admin.wait_for_timeout(800)
            overflow = admin.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            self.check("K", f"390 px: {label} sem rolagem horizontal", overflow <= 1, f"excesso {overflow}px")
        box = admin.get_by_test_id("publication-panel").bounding_box()
        self.check("K", "390 px: painel de publicacao dentro da largura", bool(box and box["x"] >= 0 and box["x"] + box["width"] <= 391), str(box))
        mbox = admin.get_by_test_id("publication-metrics").bounding_box()
        self.check("K", "390 px: desempenho dentro da largura", bool(mbox and mbox["x"] >= 0 and mbox["x"] + mbox["width"] <= 391), str(mbox))
        self.shot(admin, "f8-k-publicacao-390.png")
        # Entregas com o contador: mesmo caminho do cenario L (aba "Entregas" quando o cliente tem projeto Asana)
        self.goto(admin, f"/projetos?clientId={CLIENT_1}")
        cards = admin.get_by_test_id("content-stages-panel")
        try:
            cards.wait_for(timeout=8000)
        except Exception:  # noqa: BLE001
            admin.get_by_role("button", name="Entregas").first.click()
        try:
            cards.get_by_test_id("content-stage-received").wait_for(timeout=20000)
            admin.wait_for_timeout(500)
            overflow = admin.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            self.check("K", "390 px: Entregas com contador sem rolagem horizontal", overflow <= 1, f"excesso {overflow}px")
            r1 = cards.get_by_test_id("content-stage-received").bounding_box()
            r2 = cards.get_by_test_id("content-stage-sent").bounding_box()
            self.check("K", "390 px: cartoes do contador em duas colunas",
                       bool(r1 and r2 and abs(r1["y"] - r2["y"]) < 2 and r2["x"] > r1["x"]), f"{r1} {r2}")
            self.shot(admin, "f8-k-contador-390.png")
        except Exception as exc:  # noqa: BLE001
            self.fail("K", "390 px: contador visivel em Entregas", f"{type(exc).__name__}: {exc}")
        pub3 = self.open_public(browser, url1, width=390)
        pub3.get_by_test_id("approval-result").wait_for(timeout=15000)
        pub3.wait_for_timeout(500)
        overflow = pub3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        self.check("K", "390 px: pagina publica sem rolagem horizontal", overflow <= 1, f"excesso {overflow}px")
        self.shot(pub3, "f8-k-publica-390.png")
        pub3.context.close()


if __name__ == "__main__":
    sys.exit(ContentGate().run())
