"""The only module that does HTTP. Retries, timeouts, a Wayback Machine fallback, and politeness.

Politeness rules (every request goes through `client()`, so they apply to every script):
- One request at a time per host, with at least MIN_INTERVAL seconds between request starts.
  Don't add thread pools around fetches; the throttle would serialise them anyway.
- Retries back off exponentially and honour `Retry-After` on 429/503.
- A descriptive User-Agent pointing at the repo, so operators can see who we are.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

import httpx

USER_AGENT = "cape-town-ward-map ETL (+https://github.com/AdamZA/cape-town-ward-map)"
_client: httpx.Client | None = None

# Seconds between requests to one host. The City's own servers are small on-prem machines;
# Overpass asks for restraint in its usage policy; ArcGIS Online is a large hosted service.
DEFAULT_INTERVAL = 1.0
MIN_INTERVAL = {
    "citymaps.capetown.gov.za": 1.5,
    "esapqa.capetown.gov.za": 1.5,
    "overpass-api.de": 5.0,
    "results.elections.org.za": 1.5,
    "services6.arcgis.com": 0.5,
    "services7.arcgis.com": 0.5,
}
_host_locks: dict[str, threading.Lock] = {}
_host_last: dict[str, float] = {}
_guard = threading.Lock()


def _throttle(request: httpx.Request) -> None:
    host = request.url.host
    with _guard:
        lock = _host_locks.setdefault(host, threading.Lock())
    with lock:
        wait = (
            _host_last.get(host, 0.0) + MIN_INTERVAL.get(host, DEFAULT_INTERVAL) - time.monotonic()
        )
        if wait > 0:
            time.sleep(wait)
        _host_last[host] = time.monotonic()


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=httpx.Timeout(120, connect=30),
            follow_redirects=True,
            event_hooks={"request": [_throttle]},
        )
    return _client


def _retry_after(e: Exception) -> float | None:
    if isinstance(e, httpx.HTTPStatusError) and e.response.status_code in (429, 503):
        try:
            return min(float(e.response.headers.get("Retry-After", "")), 600)
        except ValueError:
            return 60.0
    return None


def _with_retries(fn, attempts: int = 5):
    for i in range(attempts):
        try:
            return fn()
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            if i == attempts - 1:
                raise
            wait = _retry_after(e) or 5 * 2**i  # 5, 10, 20, 40 s
            print(f"  retrying in {wait:.0f}s after {type(e).__name__}: {e}")
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


def post_json(url: str, data: dict[str, Any]) -> Any:
    """POST a form (for ArcGIS queries whose geometry is too long for a URL)."""

    def go():
        r = client().post(url, data=data, timeout=httpx.Timeout(300, connect=30))
        r.raise_for_status()
        body = r.json()
        if isinstance(body, dict) and "error" in body:
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
