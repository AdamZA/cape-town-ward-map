"""The only module that does HTTP. Retries, timeouts and a Wayback Machine fallback."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import httpx

USER_AGENT = "cape-town-ward-map ETL (+https://github.com/AdamZA/cape-town-ward-map)"
_client: httpx.Client | None = None


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=httpx.Timeout(120, connect=30),
            follow_redirects=True,
        )
    return _client


def _with_retries(fn, attempts: int = 4):
    for i in range(attempts):
        try:
            return fn()
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            if i == attempts - 1:
                raise
            wait = 2 ** (i + 1)
            print(f"  retrying in {wait}s after {type(e).__name__}: {e}")
            time.sleep(wait)
    raise AssertionError("unreachable")


def get_json(url: str, params: dict[str, Any] | None = None) -> Any:
    def go():
        r = client().get(url, params=params)
        r.raise_for_status()
        body = r.json()
        if isinstance(body, dict) and "error" in body:
            # ArcGIS reports errors with HTTP 200.
            raise httpx.HTTPStatusError(str(body["error"]), request=r.request, response=r)
        return body

    return _with_retries(go)


def wayback_url(url: str) -> str:
    # "id_" returns the original bytes; the 2-digit timestamp means "closest to now".
    return f"https://web.archive.org/web/2id_/{url}"


def download(url: str, dest: Path, *, wayback: bool = False) -> str:
    """Download url to dest. Returns the method used ("download" or "wayback")."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    candidates = [("download", url)] + ([("wayback", wayback_url(url))] if wayback else [])
    last: Exception | None = None
    for method, u in candidates:
        try:
            print(f"  GET {u}")
            tmp = dest.with_suffix(dest.suffix + ".part")
            with client().stream("GET", u, timeout=httpx.Timeout(600, connect=30)) as r:
                r.raise_for_status()
                with tmp.open("wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
            tmp.replace(dest)
            return method
        except httpx.HTTPError as e:
            print(f"  failed: {e}")
            last = e
    raise RuntimeError(f"could not download {url}: {last}")
