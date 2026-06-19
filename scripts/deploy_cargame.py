#!/usr/bin/env python3
from __future__ import annotations

import re
import shlex
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]
FUWUQI_WORKSPACE = Path(r"D:\Project\FUWUQI")
LOGIN_DOC = FUWUQI_WORKSPACE / "Login-Server_DOC.md"
RUNBOOK = FUWUQI_WORKSPACE / "SERVER_CONNECTION_RUNBOOK.md"
DOMAIN = "cargame.162.211.183.146.sslip.io"
REMOTE_APP = "/opt/cargame"
REMOTE_TARBALL = "/tmp/cargame-deploy.tar.gz"

INCLUDE_ROOTS = [
    "dist",
    "server",
    "src",
    "index.html",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.server.json",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""


def extract_credentials() -> tuple[str, str, str]:
    docs = "\n".join([read_text(LOGIN_DOC), read_text(RUNBOOK)])
    ip_match = re.search(r"(?:公网 IP|服务器 IP)\s*[：:]\s*`?(\d{1,3}(?:\.\d{1,3}){3})`?", docs)
    user_match = re.search(r"(?:远程用户|SSH 用户)\s*[：:]\s*`?([A-Za-z0-9_.-]+)`?", docs)
    password_match = re.search(r"(?:登录密码|密码)\s*[：:]?\s*`?\s*([A-Za-z0-9_.!@#$%^&*+=-]{8,})`?", docs)
    if not ip_match or not user_match or not password_match:
        raise RuntimeError("Missing server credentials in FUWUQI local docs.")
    return ip_match.group(1), user_match.group(1), password_match.group(1)


def make_tarball() -> Path:
    temp = tempfile.NamedTemporaryFile(prefix="cargame-", suffix=".tar.gz", delete=False)
    temp.close()
    tar_path = Path(temp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for item in INCLUDE_ROOTS:
            path = ROOT / item
            if path.exists():
                tar.add(path, arcname=item)
    return tar_path


def run(client: paramiko.SSHClient, command: str, timeout: int = 300) -> None:
    print(f"== remote: {command.splitlines()[0][:90]} ==")
    _, stdout, stderr = client.exec_command("bash -lc " + shlex.quote(command), timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("stderr:")
        print(err.rstrip())
    status = stdout.channel.recv_exit_status()
    if status != 0:
        raise RuntimeError(f"Remote command failed with exit status {status}")


def upload(client: paramiko.SSHClient, tar_path: Path) -> None:
    print("== upload project tarball ==")
    sftp = client.open_sftp()
    try:
        sftp.put(str(tar_path), REMOTE_TARBALL)
    finally:
        sftp.close()


def deploy() -> None:
    host, username, password = extract_credentials()
    tar_path = make_tarball()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=username, password=password, timeout=15, banner_timeout=15, auth_timeout=15)
        upload(client, tar_path)
        run(
            client,
            f"""
set -euo pipefail
rm -rf {REMOTE_APP}
mkdir -p {REMOTE_APP}
tar -xzf {REMOTE_TARBALL} -C {REMOTE_APP}
rm -f {REMOTE_TARBALL}
cd {REMOTE_APP}
pnpm install --frozen-lockfile
pnpm build
cat >/etc/systemd/system/cargame.service <<'SERVICE'
[Unit]
Description=CarGame multiplayer server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cargame
Environment=HOST=127.0.0.1
Environment=PORT=8790
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/pnpm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable --now cargame.service
systemctl restart cargame.service
""",
            timeout=420,
        )
        http_nginx_conf = f"""
server {{
    listen 80;
    listen [::]:80;
    server_name {DOMAIN};

    location / {{
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600;
    }}
}}
"""
        https_nginx_conf = f"""
server {{
    listen 80;
    listen [::]:80;
    server_name {DOMAIN};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name {DOMAIN};

    ssl_certificate /etc/letsencrypt/live/{DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {{
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600;
    }}
}}
"""
        run(
            client,
            f"""
set -euo pipefail
cat > /etc/nginx/sites-available/cargame <<'NGINX'
{http_nginx_conf}
NGINX
ln -sfn /etc/nginx/sites-available/cargame /etc/nginx/sites-enabled/cargame
nginx -t
systemctl reload nginx
if [ ! -f /etc/letsencrypt/live/{DOMAIN}/fullchain.pem ]; then
  certbot --nginx -d {DOMAIN} --non-interactive --agree-tos --register-unsafely-without-email
fi
cat > /etc/nginx/sites-available/cargame <<'NGINX'
{https_nginx_conf}
NGINX
nginx -t
systemctl reload nginx
systemctl is-active cargame
""",
            timeout=420,
        )
    finally:
        client.close()
        tar_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        deploy()
    except Exception as exc:
        print(f"deploy failed: {exc}", file=sys.stderr)
        raise
