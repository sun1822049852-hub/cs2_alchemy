import base64
import json
import logging
import os
import time
import threading
import socket
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import gevent
from steam.client import SteamClient
from steam.core.crypto import pkcs1v15_encrypt, rsa_publickey
from steam.core.msg import MsgProto
from steam.enums import EResult
from steam.enums.common import EOSType
from steam.enums.emsg import EMsg
from steam.steamid import SteamID
from steam.utils import ip4_to_int

logger = logging.getLogger("auth")

_TOKEN_CACHE = Path("login_keys.json")
_SENTRY_DIR = Path("sentries")
_CONNECT_TIMEOUT = 60
_CM_CONNECT_MAX_RETRIES = 3
_CM_RETRY_DELAY_SECONDS = 2
_CM_PROBE_ENABLED = True
_CM_PROBE_MAX_SERVERS = 12
_CM_PROBE_TIMEOUT_SECONDS = 0.35
_CM_PROBE_WORKERS = 8
_CHANNEL_SECURED_TIMEOUT = 10
_LOGIN_MAX_ATTEMPTS = 3
_LOGIN_RETRY_DELAY_SECONDS = 3
_STEAM_API = "https://api.steampowered.com/IAuthenticationService"
_SESSION_LOCK_DIR = Path(".session_locks")
_SESSION_CACHE: dict[str, SteamClient] = {}
_INFLIGHT_CLIENTS: set[SteamClient] = set()
_INFLIGHT_LOCK = threading.Lock()
_AUTH_HTTP_TIMEOUT = (10, 25)
_AUTH_MAX_RETRIES = 2
_AUTH_PRECHECK_ENABLED = True
_AUTH_PRECHECK_TIMEOUT = 5
_AUTH_PRECHECK_INTERVAL = 120
_AUTH_PRECHECK_STATE: dict[str, tuple[float, bool, str]] = {}
_AUTH_FAILURE_COOLDOWN_SECONDS = 60
_AUTH_NEXT_ALLOWED_AT_BY_PROXY: dict[str, float] = {}


def _should_stop(stop_event) -> bool:
    try:
        return bool(stop_event and stop_event.is_set())
    except Exception:
        return False


def _lock_file_for(username: str) -> Path:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in username.strip())
    safe = safe or "unknown"
    return _SESSION_LOCK_DIR / f"{safe}.lock"


def _is_process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False
    except Exception:
        return False


def _acquire_account_process_lock(username: str) -> tuple[bool, int | None]:
    _SESSION_LOCK_DIR.mkdir(exist_ok=True)
    lock_file = _lock_file_for(username)
    current_pid = os.getpid()

    for _ in range(2):
        try:
            fd = os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as fp:
                fp.write(json.dumps({"username": username, "pid": current_pid, "ts": int(time.time())}))
            return True, None
        except FileExistsError:
            owner_pid = None
            try:
                payload = json.loads(lock_file.read_text(encoding="utf-8"))
                owner_pid = int(payload.get("pid", 0))
            except Exception:
                owner_pid = None

            if owner_pid == current_pid:
                return True, None
            if owner_pid and _is_process_alive(owner_pid):
                return False, owner_pid
            try:
                lock_file.unlink(missing_ok=True)
            except Exception:
                return False, owner_pid
        except Exception:
            return False, None

    return False, None


def _release_account_process_lock(username: str):
    lock_file = _lock_file_for(username)
    if not lock_file.exists():
        return
    current_pid = os.getpid()

    try:
        payload = json.loads(lock_file.read_text(encoding="utf-8"))
        owner_pid = int(payload.get("pid", 0))
    except Exception:
        owner_pid = None

    if owner_pid not in (None, 0, current_pid):
        return
    try:
        lock_file.unlink(missing_ok=True)
    except Exception:
        pass


def _proxy_url() -> str | None:
    # Priority: config.py > environment variables
    try:
        from config import PROXY_URL, USE_PROXY  # type: ignore

        if USE_PROXY and PROXY_URL:
            return str(PROXY_URL)
    except Exception:
        pass

    return (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("http_proxy")
    )


def _sleep_with_stop(seconds: float, stop_event=None):
    if seconds <= 0:
        return
    deadline = time.time() + seconds
    while time.time() < deadline:
        if _should_stop(stop_event):
            raise ConnectionAbortedError("连接已取消（窗口关闭）")
        gevent.sleep(min(0.1, max(0.0, deadline - time.time())))


def _auth_proxy_key() -> str:
    return (_proxy_url() or "").strip().lower()


def _enforce_auth_cooldown():
    remaining = _AUTH_NEXT_ALLOWED_AT_BY_PROXY.get(_auth_proxy_key(), 0.0) - time.time()
    if remaining <= 0:
        return
    raise ConnectionError(
        f"认证请求冷却中，请 {int(remaining) + 1}s 后重试（请勿连续点击，必要时更换/开启代理）"
    )


def _mark_auth_failure_cooldown():
    _AUTH_NEXT_ALLOWED_AT_BY_PROXY[_auth_proxy_key()] = time.time() + _AUTH_FAILURE_COOLDOWN_SECONDS


def _clear_auth_failure_cooldown():
    _AUTH_NEXT_ALLOWED_AT_BY_PROXY[_auth_proxy_key()] = 0.0


def _auth_proxy_hint() -> str:
    proxy = _proxy_url()
    if proxy:
        return f"（当前代理：{proxy}）"
    return "（当前未配置应用代理）"


def _precheck_auth_api(force: bool = False) -> tuple[bool, str]:
    if not _AUTH_PRECHECK_ENABLED:
        return True, "disabled"

    proxy = _proxy_url() or ""
    cache_key = proxy.strip().lower()
    now = time.time()
    cached = _AUTH_PRECHECK_STATE.get(cache_key)
    if cached and not force:
        ts, ok, msg = cached
        if (now - ts) <= _AUTH_PRECHECK_INTERVAL:
            return ok, msg

    url = "https://api.steampowered.com/IAuthenticationService/GetPasswordRSAPublicKey/v1"
    kwargs: dict[str, Any] = {
        "method": "GET",
        "url": url,
        "params": {"account_name": "precheck"},
        "timeout": _AUTH_PRECHECK_TIMEOUT,
        "headers": {
            "User-Agent": "cs2-alchemy/1.0",
            "Accept": "application/json",
        },
    }
    if proxy:
        kwargs["proxies"] = {"http": proxy, "https": proxy}

    try:
        resp = requests.request(**kwargs)
        if resp.status_code >= 500:
            raise ConnectionError(f"HTTP {resp.status_code}")
        msg = f"ok:{resp.status_code}"
        _AUTH_PRECHECK_STATE[cache_key] = (now, True, msg)
        logger.info("Auth API precheck success (%s)", msg)
        return True, msg
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        _AUTH_PRECHECK_STATE[cache_key] = (now, False, err)
        logger.warning("Auth API precheck failed: %s", err)
        return False, err


def _ensure_auth_api_reachable(*, force: bool = False):
    ok, detail = _precheck_auth_api(force=force)
    if ok:
        return
    hint = _auth_proxy_hint()
    raise ConnectionError(
        f"认证服务不可达：{detail}。请更换代理或开启代理后重试{hint}"
    )


def _request_json(url: str, method: str, *, params: dict | None = None, data: dict | None = None) -> dict:
    last_error: Exception | None = None

    kwargs = {
        "method": method,
        "url": url,
        "params": params,
        "data": data,
        "timeout": _AUTH_HTTP_TIMEOUT,
        "headers": {
            "User-Agent": "cs2-alchemy/1.0",
            "Accept": "application/json",
        },
    }

    proxy = _proxy_url()
    if proxy:
        kwargs["proxies"] = {"http": proxy, "https": proxy}

    for attempt in range(_AUTH_MAX_RETRIES):
        try:
            resp = requests.request(**kwargs)
            if resp.status_code >= 400:
                raise ValueError(f"HTTP {resp.status_code}: {resp.text[:200]}")

            try:
                payload = resp.json()
            except ValueError as e:
                raise ValueError(
                    f"认证接口返回非 JSON: HTTP {resp.status_code}, body={resp.text[:200]}"
                ) from e

            if not isinstance(payload, dict):
                raise ValueError("认证接口返回结构异常: 顶层不是 JSON object")
            _clear_auth_failure_cooldown()
            return payload.get("response", {})
        except ValueError:
            raise
        except requests.RequestException as e:
            last_error = e
            if attempt < _AUTH_MAX_RETRIES - 1:
                gevent.sleep(1 + attempt)
                continue
            break

    _mark_auth_failure_cooldown()
    raise ConnectionError(f"请求 Steam 认证接口超时或失败: {last_error}")


def _api_post(path: str, params: dict) -> dict:
    url = f"{_STEAM_API}/{path}/v1/"
    return _request_json(url, "POST", data=params)


def _api_get(path: str, params: dict) -> dict:
    url = f"{_STEAM_API}/{path}"
    return _request_json(url, "GET", params=params)


def _steamid_from_jwt(token: str) -> str | None:
    try:
        data = _decode_jwt_payload(token)
        return data.get("sub")
    except Exception:
        return None


def _decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    payload += "=" * ((4 - len(payload) % 4) % 4)
    decoded = base64.urlsafe_b64decode(payload)
    data = json.loads(decoded)
    if not isinstance(data, dict):
        return {}
    return data


def _is_refresh_token(token: str) -> bool:
    payload = _decode_jwt_payload(token)
    return payload.get("iss") == "steam"


def _load_tokens() -> dict:
    if not _TOKEN_CACHE.exists():
        return {}
    try:
        return json.loads(_TOKEN_CACHE.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("login_keys.json format invalid, fallback to empty cache")
        return {}


def _save_token(username: str, refresh_token: str):
    cache = _load_tokens()
    cache[username] = refresh_token
    _TOKEN_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("refresh_token saved for %s", username)


def _get_token(username: str) -> str | None:
    return _load_tokens().get(username)


def _clear_token(username: str):
    cache = _load_tokens()
    cache.pop(username, None)
    _TOKEN_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("refresh_token cleared for %s", username)


def _get_or_create_machine_id() -> bytes:
    machine_id_file = Path("machine_id.bin")
    if machine_id_file.exists():
        data = machine_id_file.read_bytes()
        if len(data) > 10 and data[0:1] == b"\x00" and data[-1:] == b"\x08":
            return data

    mid = b"\x00"
    for key in [b"BB3", b"FF2", b"3B3"]:
        value = base64.b16encode(os.urandom(20)).lower()
        mid += b"\x01" + key + b"\x00" + value + b"\x00"
    mid += b"\x08"
    machine_id_file.write_bytes(mid)
    return mid


def _make_client() -> SteamClient:
    client = SteamClient()
    _SENTRY_DIR.mkdir(exist_ok=True)
    client.set_credential_location(str(_SENTRY_DIR))
    return client


def _is_live_client(client: SteamClient | None) -> bool:
    if client is None:
        return False
    return bool(
        getattr(client, "connected", False)
        and getattr(client, "channel_secured", False)
        and getattr(client, "logged_on", False)
    )


def _drop_cached_client(username: str, *, disconnect: bool = False):
    client = _SESSION_CACHE.pop(username, None)
    if not client:
        _release_account_process_lock(username)
        return
    if not disconnect:
        _release_account_process_lock(username)
        return

    try:
        if getattr(client, "logged_on", False):
            client.logout()
    except Exception as e:
        logger.debug("logout cached client failed (%s): %s", username, e)

    try:
        client.disconnect()
    except Exception as e:
        logger.debug("disconnect cached client failed (%s): %s", username, e)
    finally:
        _release_account_process_lock(username)


def _register_inflight_client(client: SteamClient):
    with _INFLIGHT_LOCK:
        _INFLIGHT_CLIENTS.add(client)


def _unregister_inflight_client(client: SteamClient):
    with _INFLIGHT_LOCK:
        _INFLIGHT_CLIENTS.discard(client)


def _cache_client(username: str, client: SteamClient):
    # 会话仅在创建它的线程内复用，避免跨线程复用导致不稳定
    client._owner_thread_id = threading.get_ident()

    old = _SESSION_CACHE.get(username)
    if old is not None and old is not client:
        _drop_cached_client(username, disconnect=True)

    _SESSION_CACHE[username] = client

    if getattr(client, "_cache_disconnect_hooked", False):
        return

    def _on_disconnected(*_):
        if _SESSION_CACHE.get(username) is client:
            _SESSION_CACHE.pop(username, None)
            logger.info("Session cache dropped after disconnect (%s)", username)
        _release_account_process_lock(username)

    client.on(client.EVENT_DISCONNECTED, _on_disconnected)
    client._cache_disconnect_hooked = True


def _get_cached_client(username: str) -> SteamClient | None:
    client = _SESSION_CACHE.get(username)
    if _is_live_client(client):
        owner_thread_id = getattr(client, "_owner_thread_id", None)
        current_thread_id = threading.get_ident()
        if owner_thread_id is not None and owner_thread_id != current_thread_id:
            logger.info(
                "Skip cached session for %s due to thread mismatch (owner=%s current=%s)",
                username,
                owner_thread_id,
                current_thread_id,
            )
            return None
        return client
    if client is not None:
        _drop_cached_client(username, disconnect=False)
    return None


def _reset_connecting_state(client: SteamClient):
    if getattr(client, "_connecting", False) and not getattr(client, "connected", False):
        logger.warning("Reset stale _connecting state before retry")
        client._connecting = False


def _bootstrap_cm_servers_if_needed(client: SteamClient) -> bool:
    cm_servers = getattr(client, "cm_servers", None)
    if cm_servers is None:
        return False
    if len(cm_servers) > 0:
        return True

    try:
        if cm_servers.bootstrap_from_webapi():
            return True
    except Exception as e:
        logger.debug("CM bootstrap via WebAPI failed before probe: %s", e)

    try:
        return bool(cm_servers.bootstrap_from_dns())
    except Exception as e:
        logger.debug("CM bootstrap via DNS failed before probe: %s", e)
        return False


def _probe_cm_reachable(server_addr: tuple[str, int], timeout: float) -> bool:
    host, port = server_addr
    sock = None
    try:
        sock = socket.create_connection((str(host), int(port)), timeout=timeout)
        return True
    except Exception:
        return False
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass


def _prioritize_reachable_cm_servers(client: SteamClient, *, stop_event=None):
    if not _CM_PROBE_ENABLED:
        return
    if _should_stop(stop_event):
        return
    if not _bootstrap_cm_servers_if_needed(client):
        return

    cm_servers = getattr(client, "cm_servers", None)
    if cm_servers is None:
        return

    server_map = getattr(cm_servers, "list", None)
    if not server_map:
        return

    all_servers = list(server_map.keys())
    if not all_servers:
        return

    candidates = all_servers[:_CM_PROBE_MAX_SERVERS]
    if not candidates:
        return

    max_workers = min(_CM_PROBE_WORKERS, len(candidates))
    if max_workers <= 0:
        return

    reachable_set = set()
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_addr = {
            executor.submit(_probe_cm_reachable, addr, _CM_PROBE_TIMEOUT_SECONDS): addr
            for addr in candidates
        }
        for future in as_completed(future_to_addr):
            if _should_stop(stop_event):
                return
            addr = future_to_addr[future]
            try:
                if future.result():
                    reachable_set.add(addr)
            except Exception:
                continue

    if not reachable_set:
        logger.info("CM probe hit 0/%d reachable, keep default order", len(candidates))
        return

    prioritized = [addr for addr in candidates if addr in reachable_set]
    tail = [addr for addr in all_servers if addr not in reachable_set]
    reordered = prioritized + tail

    try:
        cm_servers.clear()
        cm_servers.merge_list(reordered)
        logger.info(
            "CM probe prioritized %d/%d servers before connect",
            len(prioritized),
            len(candidates),
        )
    except Exception as e:
        logger.debug("CM probe reorder failed, fallback default order: %s", e)


def _connect(client: SteamClient, *, stop_event=None) -> bool:
    if _should_stop(stop_event):
        logger.info("Connect aborted before start (shutdown requested)")
        return False

    _reset_connecting_state(client)
    _prioritize_reachable_cm_servers(client, stop_event=stop_event)

    try:
        with gevent.Timeout(_CONNECT_TIMEOUT):
            # 单次连接尝试，避免底层在同一实例无限循环；外层控制重试。
            ok = client.connect(retry=1)
            if ok:
                logger.info("Connected to CM: %s:%d", *client.current_server_addr)
                return True
            logger.warning("Connect returned without success")
    except gevent.Timeout:
        logger.warning("Connect timeout (%d sec)", _CONNECT_TIMEOUT)
        _reset_connecting_state(client)
    except Exception as e:
        logger.warning("Connect error: %s: %s", type(e).__name__, e)
        _reset_connecting_state(client)

    try:
        client.disconnect()
    except Exception as e:
        logger.debug("Disconnect after failed connect failed: %s", e)
    _reset_connecting_state(client)
    return False


def _new_connected_client(max_retries: int = _CM_CONNECT_MAX_RETRIES, *, stop_event=None) -> SteamClient:
    last_error: Exception | None = None

    for attempt in range(max_retries):
        if _should_stop(stop_event):
            raise ConnectionAbortedError("连接已取消（窗口关闭）")

        if attempt > 0:
            logger.info("Reconnect attempt %d/%d (fresh SteamClient)", attempt + 1, max_retries)
            deadline = time.time() + _CM_RETRY_DELAY_SECONDS
            while time.time() < deadline:
                if _should_stop(stop_event):
                    raise ConnectionAbortedError("连接已取消（窗口关闭）")
                gevent.sleep(0.1)

        client = _make_client()
        logger.info("new SteamClient created id=%s attempt=%d/%d", id(client), attempt + 1, max_retries)
        _register_inflight_client(client)

        try:
            if not _connect(client, stop_event=stop_event):
                if _should_stop(stop_event):
                    raise ConnectionAbortedError("连接已取消（窗口关闭）")
                last_error = ConnectionError("无法连接到 Steam CM 服务器")
                continue

            if not client.channel_secured:
                resp = None
                deadline = time.time() + _CHANNEL_SECURED_TIMEOUT
                while time.time() < deadline:
                    if _should_stop(stop_event):
                        try:
                            client.disconnect()
                        except Exception:
                            pass
                        raise ConnectionAbortedError("连接已取消（窗口关闭）")
                    part = client.wait_event(client.EVENT_CHANNEL_SECURED, timeout=0.3)
                    if part is not None:
                        resp = part
                        break
                if resp is None:
                    last_error = ConnectionError("加密通道建立超时")
                    try:
                        client.disconnect()
                    except Exception as e:
                        logger.debug("Disconnect after channel-secured timeout failed: %s", e)
                    continue

            return client
        finally:
            _unregister_inflight_client(client)

    if last_error is None:
        last_error = ConnectionError("无法连接到 Steam CM 服务器")
    logger.error("Failed to build connected Steam client after %d retries", max_retries)
    raise last_error


def _get_tokens_via_totp(username: str, password: str, totp_code: str) -> tuple[str, str]:
    rsa_resp = _api_get("GetPasswordRSAPublicKey/v1", {"account_name": username})
    key = rsa_publickey(int(rsa_resp["publickey_mod"], 16), int(rsa_resp["publickey_exp"], 16))
    enc_pw = base64.b64encode(pkcs1v15_encrypt(key, password.encode("utf-8"))).decode("ascii")

    begin_resp = _api_post(
        "BeginAuthSessionViaCredentials",
        {
            "account_name": username,
            "encrypted_password": enc_pw,
            "encryption_timestamp": rsa_resp["timestamp"],
            "remember_login": "true",
            "platform_type": "1",
            "persistence": "1",
            "website_id": "Client",
        },
    )

    client_id = begin_resp["client_id"]
    request_id = begin_resp["request_id"]
    steamid = begin_resp["steamid"]

    _api_post(
        "UpdateAuthSessionWithSteamGuardCode",
        {
            "client_id": client_id,
            "steamid": steamid,
            "code": totp_code,
            "code_type": "3",
        },
    )

    for _ in range(10):
        poll_resp = _api_post(
            "PollAuthSessionStatus",
            {
                "client_id": client_id,
                "request_id": request_id,
            },
        )
        if "refresh_token" in poll_resp and "access_token" in poll_resp:
            return poll_resp["refresh_token"], poll_resp["access_token"]
        gevent.sleep(1)

    raise ValueError("PollAuthSessionStatus timeout, tokens not returned")


def _login_with_access_token(client: SteamClient, username: str, access_token: str) -> EResult:
    steamid_str = _steamid_from_jwt(access_token)
    if steamid_str:
        actual_steamid = SteamID(int(steamid_str))
    else:
        actual_steamid = SteamID(type="Individual", universe="Public")

    message = MsgProto(EMsg.ClientLogon)
    message.header.steamid = actual_steamid
    message.body.protocol_version = 65580
    message.body.client_package_version = 1561159470
    message.body.client_os_type = EOSType.Windows10
    message.body.client_language = "english"
    message.body.chat_mode = client.chat_mode
    message.body.machine_id = _get_or_create_machine_id()
    if not _is_refresh_token(access_token):
        message.body.account_name = username
    message.body.access_token = access_token
    message.body.client_supplied_steam_id = int(actual_steamid)
    message.body.supports_rate_limit_response = True
    message.body.eresult_sentryfile = EResult.FileNotFound
    message.body.obfuscated_private_ip.v4 = ip4_to_int(client.connection.local_address) ^ 0xF00DBAAD

    client.username = username
    client.send(message)

    resp = client.wait_msg(EMsg.ClientLogOnResponse, timeout=30)
    if not resp:
        return EResult.Fail

    result = EResult(resp.body.eresult)
    if result == EResult.OK:
        client.logged_on = True
        client.sleep(0.5)
        client.emit(client.EVENT_LOGGED_ON)
    return result


def login(username: str, password: str, stop_event=None) -> SteamClient:
    cached = _get_cached_client(username)
    if cached:
        logger.info("Reusing active Steam session (%s)", username)
        return cached

    _enforce_auth_cooldown()
    _ensure_auth_api_reachable(force=True)

    locked, owner_pid = _acquire_account_process_lock(username)
    if not locked:
        if owner_pid:
            raise ValueError(f"账号 {username} 正在被另一个进程使用（PID={owner_pid}），请先断开后再试")
        raise ValueError(f"账号 {username} 当前被占用，请稍后重试")

    success = False
    try:
        refresh_token = _get_token(username)
        if not refresh_token:
            raise ValueError("未找到 refresh_token，请在账号管理中先完成初始化登录")

        for attempt in range(1, _LOGIN_MAX_ATTEMPTS + 1):
            if _should_stop(stop_event):
                raise ConnectionAbortedError("连接已取消（窗口关闭）")

            client: SteamClient | None = None
            try:
                client = _new_connected_client(stop_event=stop_event)
                result = _login_with_access_token(client, username, refresh_token)
            except Exception:
                if client is not None:
                    try:
                        client.disconnect()
                    except Exception:
                        pass
                if attempt < _LOGIN_MAX_ATTEMPTS:
                    delay = _LOGIN_RETRY_DELAY_SECONDS * attempt
                    logger.warning(
                        "Auto login attempt %d/%d failed, retry in %ss (%s)",
                        attempt,
                        _LOGIN_MAX_ATTEMPTS,
                        delay,
                        username,
                    )
                    _sleep_with_stop(delay, stop_event)
                    continue
                raise

            if result == EResult.OK:
                logger.info("Auto login success (%s)", username)
                _cache_client(username, client)
                _clear_auth_failure_cooldown()
                success = True
                return client

            try:
                client.disconnect()
            except Exception:
                pass

            if result == EResult.AccessDenied and attempt < _LOGIN_MAX_ATTEMPTS:
                delay = _LOGIN_RETRY_DELAY_SECONDS * attempt
                logger.warning(
                    "Auto login denied (%s), retry %d/%d in %ss (%s)",
                    result.name,
                    attempt,
                    _LOGIN_MAX_ATTEMPTS,
                    delay,
                    username,
                )
                _sleep_with_stop(delay, stop_event)
                continue

            logger.warning("Auto login failed (%s), refresh_token is kept.", result.name)
            _mark_auth_failure_cooldown()
            raise ValueError(f"登录失败：{result.name}，请在账号管理中重新初始化")
    finally:
        if not success:
            _release_account_process_lock(username)


def login_with_totp(username: str, password: str, totp_code: str, stop_event=None) -> SteamClient:
    _enforce_auth_cooldown()
    _ensure_auth_api_reachable(force=True)

    locked, owner_pid = _acquire_account_process_lock(username)
    if not locked:
        if owner_pid:
            raise ValueError(f"账号 {username} 正在被另一个进程使用（PID={owner_pid}），请先断开后再试")
        raise ValueError(f"账号 {username} 当前被占用，请稍后重试")

    success = False
    try:
        refresh_token, _access_token = _get_tokens_via_totp(username, password, totp_code)
        _save_token(username, refresh_token)

        cached = _get_cached_client(username)
        if cached:
            logger.info("Reuse existing session after token refresh (%s)", username)
            success = True
            return cached

        for attempt in range(1, _LOGIN_MAX_ATTEMPTS + 1):
            if _should_stop(stop_event):
                raise ConnectionAbortedError("连接已取消（窗口关闭）")

            client: SteamClient | None = None
            try:
                client = _new_connected_client(stop_event=stop_event)
                # Keep CM login token type consistent with auto-login: always use refresh_token.
                result = _login_with_access_token(client, username, refresh_token)
            except Exception:
                if client is not None:
                    try:
                        client.disconnect()
                    except Exception:
                        pass
                if attempt < _LOGIN_MAX_ATTEMPTS:
                    delay = _LOGIN_RETRY_DELAY_SECONDS * attempt
                    logger.warning(
                        "Initial login attempt %d/%d failed, retry in %ss (%s)",
                        attempt,
                        _LOGIN_MAX_ATTEMPTS,
                        delay,
                        username,
                    )
                    _sleep_with_stop(delay, stop_event)
                    continue
                raise

            if result == EResult.OK:
                logger.info("Initial login success (%s)", username)
                _cache_client(username, client)
                _clear_auth_failure_cooldown()
                success = True
                return client

            try:
                client.disconnect()
            except Exception:
                pass

            if result == EResult.AccessDenied and attempt < _LOGIN_MAX_ATTEMPTS:
                delay = _LOGIN_RETRY_DELAY_SECONDS * attempt
                logger.warning(
                    "Initial login denied (%s), retry %d/%d in %ss (%s)",
                    result.name,
                    attempt,
                    _LOGIN_MAX_ATTEMPTS,
                    delay,
                    username,
                )
                _sleep_with_stop(delay, stop_event)
                continue

            _mark_auth_failure_cooldown()
            raise ValueError(f"CM 登录失败：{result.name}")
    finally:
        if not success:
            _release_account_process_lock(username)


def disconnect_account(username: str):
    _drop_cached_client(username, disconnect=True)


def disconnect_all():
    for username in list(_SESSION_CACHE.keys()):
        _drop_cached_client(username, disconnect=True)
    with _INFLIGHT_LOCK:
        inflight = list(_INFLIGHT_CLIENTS)
        _INFLIGHT_CLIENTS.clear()
    for client in inflight:
        try:
            client.disconnect()
        except Exception as e:
            logger.debug("disconnect inflight client failed: %s", e)


_clear_refresh_token = _clear_token
