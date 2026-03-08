import json
import threading
import logging
import time
import tkinter as tk
import traceback
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from tkinter import messagebox, simpledialog, ttk
from typing import Any, Callable

from auth import disconnect_account, disconnect_all, login, login_with_totp
from client import CS2Client
from component_manager import ComponentManager
from inventory import get_inventory, save_processed_inventory_snapshot
from schema import load_schema

logger = logging.getLogger("main_ui")

ACCOUNTS_FILE = Path("accounts.json")
PREHEAT_CARDS = 100
INVENTORY_UI_STATE_FILE = Path("inventory_ui_state.json")
AUTO_REFRESH_INTERVAL_SECONDS = 30 * 60

QUALITY_MAP = {1: "Genuine", 4: "Normal", 9: "StatTrak", 11: "Souvenir"}
RARITY_MAP = {
    1: "Consumer",
    2: "Industrial",
    3: "Mil-Spec",
    4: "Restricted",
    5: "Classified",
    6: "Covert",
    7: "Contraband",
}


class DedupLogFilter(logging.Filter):
    """短时间窗口内过滤重复日志行。"""

    def __init__(self, window_seconds: float = 1.0):
        super().__init__()
        self.window_seconds = float(window_seconds)
        self._last_key: tuple[str, int, str] | None = None
        self._last_ts = 0.0

    def filter(self, record: logging.LogRecord) -> bool:
        now = time.monotonic()
        msg = record.getMessage()
        key = (record.name, int(record.levelno), msg)
        if self._last_key == key and (now - self._last_ts) <= self.window_seconds:
            return False
        self._last_key = key
        self._last_ts = now
        return True


def configure_ui_logging():
    level_name = "DEBUG"
    try:
        from config import LOG_LEVEL  # type: ignore

        level_name = str(LOG_LEVEL or "DEBUG").upper().strip()
    except Exception:
        pass

    level = getattr(logging, level_name, logging.DEBUG)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        force=True,
    )
    dedup_filter = DedupLogFilter(window_seconds=1.2)
    root = logging.getLogger()
    for handler in root.handlers:
        handler.addFilter(dedup_filter)

    # 保留业务日志，降低第三方底层连接噪声。
    logging.getLogger("urllib3.connectionpool").setLevel(logging.INFO)
    logging.getLogger("steam").setLevel(logging.INFO)

    logger.info("UI logging initialized: level=%s", logging.getLevelName(level))


def format_exception_message(prefix: str, exc: BaseException) -> str:
    err_type = type(exc).__name__
    err_text = str(exc).strip() or "无详细信息"
    return f"{prefix}：{err_type}: {err_text}"


class AccountStore:
    def __init__(self, file_path: Path = ACCOUNTS_FILE):
        self.file_path = file_path
        self._data = self._load()

    def _load(self) -> dict:
        if not self.file_path.exists():
            return {"accounts": {}, "active": None}
        try:
            data = json.loads(self.file_path.read_text(encoding="utf-8"))
        except Exception:
            return {"accounts": {}, "active": None}
        if not isinstance(data, dict):
            return {"accounts": {}, "active": None}
        accounts = data.get("accounts")
        if not isinstance(accounts, dict):
            accounts = {}
        normalized = {}
        for username, info in accounts.items():
            if not isinstance(info, dict):
                normalized[username] = {"password": "", "remark": username}
                continue
            normalized[username] = {
                "password": str(info.get("password", "")),
                "remark": str(info.get("remark", username)) or username,
            }
        active = data.get("active")
        return {"accounts": normalized, "active": active if active in normalized else None}

    def save(self):
        self.file_path.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8")

    def list_accounts(self) -> list[dict]:
        active = self._data.get("active")
        rows = []
        for username, info in self._data["accounts"].items():
            rows.append(
                {
                    "username": username,
                    "password": str(info.get("password", "")),
                    "remark": str(info.get("remark", username)) or username,
                    "is_active": username == active,
                }
            )
        rows.sort(key=lambda x: (not x["is_active"], x["remark"].lower(), x["username"].lower()))
        return rows

    def get(self, username: str) -> dict | None:
        info = self._data["accounts"].get(username)
        if info is None:
            return None
        return {
            "username": username,
            "password": str(info.get("password", "")),
            "remark": str(info.get("remark", username)) or username,
            "is_active": username == self._data.get("active"),
        }

    def get_active(self) -> dict | None:
        active = self._data.get("active")
        if not active:
            return None
        return self.get(active)

    def upsert(self, username: str, password: str, remark: str):
        self._data["accounts"][username] = {"password": password, "remark": remark or username}
        self._data["active"] = username
        self.save()

    def set_active(self, username: str | None):
        if username is not None and username not in self._data["accounts"]:
            return
        self._data["active"] = username
        self.save()

    def update_remark(self, username: str, remark: str):
        if username not in self._data["accounts"]:
            return
        self._data["accounts"][username]["remark"] = remark or username
        self.save()

    def delete(self, username: str) -> bool:
        if username not in self._data["accounts"]:
            return False
        self._data["accounts"].pop(username, None)
        if self._data.get("active") == username:
            self._data["active"] = None
        self.save()
        return True


class AccountManagementPage(ttk.Frame):
    def __init__(self, master, on_use_account=None, on_delete_account=None):
        super().__init__(master, padding=12)
        self.store = AccountStore()
        self.selected_username: str | None = None
        self.runtime_active_username: str | None = None
        self._account_action_busy = False
        self.password_visible = False
        self.on_use_account = on_use_account
        self.on_delete_account = on_delete_account

        self.username_var = tk.StringVar()
        self.password_var = tk.StringVar()
        self.totp_var = tk.StringVar()
        self.status_var = tk.StringVar(value="准备就绪")

        self.columnconfigure(0, weight=3)
        self.columnconfigure(1, weight=2)
        self.rowconfigure(0, weight=1)

        self._build_form()
        self._build_list()
        self._render_saved_accounts()

    def _build_form(self):
        left = ttk.Frame(self)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 10))
        left.columnconfigure(0, weight=1)
        left.rowconfigure(4, weight=1)

        ttk.Label(left, text="账号管理", font=("Microsoft YaHei UI", 14, "bold")).grid(row=0, column=0, sticky="w", pady=(0, 12))

        form = ttk.Frame(left)
        form.grid(row=1, column=0, sticky="ew")
        form.columnconfigure(1, weight=1)

        ttk.Label(form, text="Steam 账号").grid(row=0, column=0, sticky="w", padx=(0, 10), pady=8)
        ttk.Entry(form, textvariable=self.username_var).grid(row=0, column=1, sticky="ew", pady=8)

        ttk.Label(form, text="密码").grid(row=1, column=0, sticky="w", padx=(0, 10), pady=8)
        self.password_entry = ttk.Entry(form, textvariable=self.password_var, show="*")
        self.password_entry.grid(row=1, column=1, sticky="ew", pady=8)
        self.eye_btn = ttk.Button(form, text="👁", width=3, command=self._toggle_password_visibility)
        self.eye_btn.grid(row=1, column=2, sticky="w", padx=(6, 0), pady=8)

        ttk.Label(form, text="令牌码").grid(row=2, column=0, sticky="w", padx=(0, 10), pady=8)
        ttk.Entry(form, textvariable=self.totp_var).grid(row=2, column=1, sticky="ew", pady=8)

        bar = ttk.Frame(left)
        bar.grid(row=2, column=0, sticky="ew", pady=(14, 10))
        bar.columnconfigure((0, 1), weight=1)

        self.login_btn = ttk.Button(bar, text="登录并保存", command=self._on_login_clicked)
        self.login_btn.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ttk.Button(bar, text="清空输入", command=self._clear_inputs).grid(row=0, column=1, sticky="ew", padx=(8, 0))

        tips = "规则:\n1. 成功获取 token 才保存账号。\n2. 失败只显示原因，不保存账号。\n3. 备注名在右侧列表里编辑。"
        ttk.Label(left, text=tips, foreground="#444").grid(row=3, column=0, sticky="w")

        wrap = ttk.Frame(left)
        wrap.grid(row=4, column=0, sticky="nsew", pady=(8, 0))
        wrap.columnconfigure(0, weight=1)

        ttk.Label(wrap, text="状态").grid(row=0, column=0, sticky="w")
        self.status_label = tk.Label(wrap, textvariable=self.status_var, fg="#0a5", justify="left", anchor="nw", wraplength=520)
        self.status_label.grid(row=1, column=0, sticky="nsew", pady=(4, 0))

    def _build_list(self):
        right = ttk.Frame(self)
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        right.rowconfigure(1, weight=1)

        ttk.Label(right, text="已保存账号", font=("Microsoft YaHei UI", 14, "bold")).grid(row=0, column=0, sticky="w", pady=(0, 10))

        holder = ttk.Frame(right)
        holder.grid(row=1, column=0, sticky="nsew")
        holder.columnconfigure(0, weight=1)
        holder.rowconfigure(0, weight=1)

        self.canvas = tk.Canvas(holder, highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        ybar = ttk.Scrollbar(holder, orient="vertical", command=self.canvas.yview)
        ybar.grid(row=0, column=1, sticky="ns")
        self.canvas.configure(yscrollcommand=ybar.set)

        self.cards_frame = ttk.Frame(self.canvas)
        self.canvas_window = self.canvas.create_window((0, 0), window=self.cards_frame, anchor="nw")
        self.cards_frame.bind("<Configure>", lambda _e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(self.canvas_window, width=e.width))

    def _render_saved_accounts(self):
        for child in self.cards_frame.winfo_children():
            child.destroy()

        rows = self.store.list_accounts()
        active_username = self.runtime_active_username
        rows.sort(
            key=lambda x: (
                x["username"] != (active_username or ""),
                x["remark"].lower(),
                x["username"].lower(),
            )
        )
        if not rows:
            ttk.Label(self.cards_frame, text="暂无已保存账号", foreground="#666").pack(fill="x", pady=8)
            return

        for row in rows:
            username = row["username"]
            is_in_use = username == active_username
            action_disabled = is_in_use or self._account_action_busy
            bg = "#e6f2ff" if username == self.selected_username else "#fff"
            card = tk.Frame(self.cards_frame, bd=1, relief="solid", bg=bg, padx=10, pady=8, cursor="hand2")
            card.pack(fill="x", pady=4)

            header = tk.Frame(card, bg=bg)
            header.pack(fill="x")

            title = row["remark"] + ("  (当前)" if is_in_use else "")
            top = tk.Label(header, text=title, font=("Microsoft YaHei UI", 10, "bold"), bg=bg, fg="#1d3557", anchor="w")
            top.pack(side="left", fill="x", expand=True)

            edit_btn = tk.Button(header, text="✎", font=("Microsoft YaHei UI", 8, "bold"), width=2, bg=bg, fg="#1d3557", bd=0, relief="flat", cursor="hand2", command=lambda u=username: self._edit_remark(u))
            edit_btn.pack(side="right")

            del_btn = tk.Button(
                header,
                text="删除",
                font=("Microsoft YaHei UI", 8),
                bg=bg,
                fg="#b00020",
                bd=1,
                relief="solid",
                cursor="hand2",
                state="disabled" if self._account_action_busy else "normal",
                command=lambda u=username: self._on_delete_account_clicked(u),
            )
            del_btn.pack(side="right", padx=(0, 6))

            if is_in_use:
                use_text = "使用中"
            elif self._account_action_busy:
                use_text = "处理中"
            else:
                use_text = "使用该账号"
            use_btn = tk.Button(
                header,
                text=use_text,
                font=("Microsoft YaHei UI", 8),
                bg=bg,
                fg="#1d3557",
                bd=1,
                relief="solid",
                cursor="hand2",
                state="disabled" if action_disabled else "normal",
                command=lambda u=username: self._on_use_account_clicked(u),
            )
            use_btn.pack(side="right", padx=(0, 6))

            bottom = tk.Label(card, text=username, font=("Microsoft YaHei UI", 8), bg=bg, fg="#8a8a8a", anchor="w")
            bottom.pack(fill="x", pady=(2, 0))

            for widget in (card, header, top, bottom):
                widget.bind("<Button-1>", lambda _e, u=username: self._on_account_selected(u))

    def on_page_shown(self):
        self.store = AccountStore()
        self._render_saved_accounts()

    def on_active_account_changed(self, username: str | None):
        self.store = AccountStore()
        self.runtime_active_username = username
        if username:
            self.selected_username = username
        self._render_saved_accounts()

    def on_inventory_refreshing_changed(self, busy: bool):
        self._account_action_busy = bool(busy)
        self._render_saved_accounts()

    def _on_account_selected(self, username: str):
        info = self.store.get(username)
        if not info:
            return
        self.selected_username = username
        self.username_var.set(info["username"])
        self.password_var.set(info["password"])
        self.totp_var.set("")
        self.status_var.set(f"已选中账号：{info['remark']}（{username}）")
        self._set_status_color(True)
        self._render_saved_accounts()

    def _clear_inputs(self):
        self.selected_username = None
        self.username_var.set("")
        self.password_var.set("")
        self.totp_var.set("")
        if self.password_visible:
            self._toggle_password_visibility()
        self.status_var.set("输入已清空")
        self._set_status_color(True)
        self._render_saved_accounts()

    def _toggle_password_visibility(self):
        self.password_visible = not self.password_visible
        self.password_entry.configure(show="" if self.password_visible else "*")
        self.eye_btn.configure(text="🙈" if self.password_visible else "👁")

    def _edit_remark(self, username: str):
        info = self.store.get(username)
        if not info:
            return
        new_remark = simpledialog.askstring("修改备注名", f"账号：{username}\n请输入新的备注名：", initialvalue=info["remark"], parent=self)
        if new_remark is None:
            return
        self.store.update_remark(username, new_remark.strip() or username)
        self.status_var.set("备注已更新")
        self._set_status_color(True)
        self._render_saved_accounts()

    def _set_busy(self, busy: bool):
        self.login_btn.config(state="disabled" if busy else "normal")

    def _on_use_account_clicked(self, username: str):
        if self._account_action_busy:
            return

        info = self.store.get(username)
        if not info:
            self.status_var.set(f"账号不存在：{username}")
            self._set_status_color(False)
            return

        self.selected_username = username
        self.username_var.set(info["username"])
        self.password_var.set(info["password"])
        self.totp_var.set("")
        self._render_saved_accounts()

        if callable(self.on_use_account):
            try:
                ok, msg = self.on_use_account(username)
            except BaseException as exc:
                ok, msg = False, f"切换账号失败：{type(exc).__name__}: {exc}"
            self.status_var.set(msg)
            self._set_status_color(ok)
            return

        self.runtime_active_username = username
        self._render_saved_accounts()
        self.status_var.set(f"已设为当前账号：{info['remark']}（{username}）")
        self._set_status_color(True)

    def _on_delete_account_clicked(self, username: str):
        if self._account_action_busy:
            self.status_var.set("库存刷新中，暂时无法删除账号")
            self._set_status_color(False)
            return

        info = self.store.get(username)
        if not info:
            self.status_var.set(f"账号不存在：{username}")
            self._set_status_color(False)
            self._render_saved_accounts()
            return

        ok = messagebox.askyesno(
            "删除账号",
            f"确认删除账号“{info['remark']}（{username}）”？\n该操作会移除本地保存的密码与账号记录。",
            parent=self,
        )
        if not ok:
            return

        if callable(self.on_delete_account):
            try:
                callback_result = self.on_delete_account(username)
            except BaseException as exc:
                callback_result = (False, f"删除失败：{type(exc).__name__}: {exc}")

            if isinstance(callback_result, tuple) and len(callback_result) >= 2:
                cb_ok, cb_msg = bool(callback_result[0]), str(callback_result[1])
            else:
                cb_ok, cb_msg = True, ""

            if not cb_ok:
                self.status_var.set(cb_msg or "删除失败")
                self._set_status_color(False)
                return

        if not self.store.delete(username):
            self.status_var.set(f"账号不存在：{username}")
            self._set_status_color(False)
            self._render_saved_accounts()
            return

        self.runtime_active_username = None if self.runtime_active_username == username else self.runtime_active_username
        if self.selected_username == username:
            self.selected_username = None
            self.username_var.set("")
            self.password_var.set("")
            self.totp_var.set("")
        self.status_var.set(f"已删除账号：{info['remark']}（{username}）")
        self._set_status_color(True)
        self._render_saved_accounts()

    def _on_login_clicked(self):
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()
        totp = self.totp_var.get().strip()
        if not username:
            self.status_var.set("请输入 Steam 账号")
            self._set_status_color(False)
            return
        if not password:
            self.status_var.set("请输入密码")
            self._set_status_color(False)
            return
        if not totp:
            self.status_var.set("请输入令牌码")
            self._set_status_color(False)
            return

        self._set_busy(True)
        self.status_var.set("正在登录并获取 token，请稍候...")
        self._set_status_color(True)
        threading.Thread(target=self._login_worker, args=(username, password, totp), daemon=True).start()

    def _login_worker(self, username: str, password: str, totp: str):
        try:
            client = login_with_totp(username, password, totp)
            try:
                client.disconnect()
            except Exception:
                pass
            self.after(0, lambda: self._on_login_done(True, username, password, "登录成功，已获取并保存 token"))
        except Exception as exc:
            err_message = format_exception_message("登录失败", exc)
            self.after(0, lambda msg=err_message: self._on_login_done(False, username, password, msg))

    def _on_login_done(self, success: bool, username: str, password: str, message: str):
        self._set_busy(False)
        if success:
            existing = self.store.get(username)
            remark = existing["remark"] if existing else username
            self.store.upsert(username=username, password=password, remark=remark)
            self.selected_username = username
            self.totp_var.set("")
            self._render_saved_accounts()
            self._set_status_color(True)
        else:
            self._set_status_color(False)
        self.status_var.set(message)

    def _set_status_color(self, success: bool):
        self.status_label.configure(fg="#0a5" if success else "#c1121f")


@dataclass
class InventoryEntry:
    asset_id: int
    def_index: int
    paint_index: int
    paint_seed: int
    float_value: float
    quality: int
    rarity: int
    origin: int
    flags: int
    inventory: int
    tradable_after: int
    name: str
    hidden_reason: str | None
    market_hash_name: str = ""
    alchemy_name: str = ""
    collection: str = ""
    alchemy_rarity: str = ""
    minfloat: float | None = None
    maxfloat: float | None = None
    isstattrak: int = 0
    wear_range: float | None = None
    is_craftable: bool = False
    craftable_reason: str = ""
    casket_id: str = ""
    casket_contained_item_count: int = 0
    search_text_cached: str = ""
    has_wear_cached: bool | None = None

    @classmethod
    def from_item(cls, item, *, hidden_reason: str | None = None):
        name = str(getattr(item, "full_name", getattr(item, "name", ""))) or f"def#{int(getattr(item, 'def_index', 0))}"
        market_hash_name = str(getattr(item, "market_hash_name", "")).strip()
        alchemy_name = str(getattr(item, "alchemy_name", "")).strip()
        minfloat = getattr(item, "alchemy_minfloat", getattr(item, "minfloat", None))
        maxfloat = getattr(item, "alchemy_maxfloat", getattr(item, "maxfloat", None))
        if minfloat is not None or maxfloat is not None:
            has_wear_cached = bool(minfloat is not None and maxfloat is not None)
        else:
            lower_name = str(name).lower()
            has_wear_cached = any(
                tag in lower_name
                for tag in ("(factory new)", "(minimal wear)", "(field-tested)", "(well-worn)", "(battle-scarred)")
            )
        return cls(
            asset_id=int(getattr(item, "asset_id", 0)),
            def_index=int(getattr(item, "def_index", 0)),
            paint_index=int(getattr(item, "paint_index", 0)),
            paint_seed=int(getattr(item, "paint_seed", 0)),
            float_value=float(getattr(item, "float_value", 0.0)),
            quality=int(getattr(item, "quality", 0)),
            rarity=int(getattr(item, "rarity", 0)),
            origin=int(getattr(item, "origin", 0)),
            flags=int(getattr(item, "flags", 0)),
            inventory=int(getattr(item, "inventory_raw", getattr(item, "inventory", 0))),
            tradable_after=int(getattr(item, "tradable_after", 0)),
            name=name,
            hidden_reason=hidden_reason,
            market_hash_name=market_hash_name,
            alchemy_name=alchemy_name,
            collection=str(getattr(item, "alchemy_collection", getattr(item, "collection", ""))).strip(),
            alchemy_rarity=str(getattr(item, "alchemy_rarity", "")).strip(),
            minfloat=minfloat,
            maxfloat=maxfloat,
            isstattrak=int(getattr(item, "alchemy_isstattrak", getattr(item, "isstattrak", 0)) or 0),
            wear_range=getattr(item, "alchemy_wear_range", getattr(item, "wear_range", None)),
            is_craftable=bool(getattr(item, "is_craftable", False)),
            craftable_reason=str(getattr(item, "craftable_reason", "")).strip(),
            casket_id=str(getattr(item, "casket_id", "")).strip(),
            casket_contained_item_count=int(getattr(item, "casket_contained_item_count", 0) or 0),
            search_text_cached=f"{name} {market_hash_name} {alchemy_name}".lower().strip(),
            has_wear_cached=has_wear_cached,
        )

    @classmethod
    def from_row_dict(cls, row: dict, *, hidden_reason_default: str | None = None):
        hidden = row.get("hidden_reason")
        if hidden is None:
            hidden = row.get("reason")
        if hidden is None:
            hidden = hidden_reason_default
        name = str(row.get("name", "")).strip() or f"def#{int(row.get('def_index', 0))}"
        market_hash_name = str(row.get("market_hash_name", "")).strip()
        alchemy_name = str(row.get("alchemy_name", "")).strip()
        minfloat = (float(row["minfloat"]) if row.get("minfloat") is not None else None)
        maxfloat = (float(row["maxfloat"]) if row.get("maxfloat") is not None else None)
        if minfloat is not None or maxfloat is not None:
            has_wear_cached = bool(minfloat is not None and maxfloat is not None)
        else:
            lower_name = str(name).lower()
            has_wear_cached = any(
                tag in lower_name
                for tag in ("(factory new)", "(minimal wear)", "(field-tested)", "(well-worn)", "(battle-scarred)")
            )
        return cls(
            asset_id=int(row.get("asset_id", row.get("id", 0))),
            def_index=int(row.get("def_index", 0)),
            paint_index=int(row.get("paint_index", 0)),
            paint_seed=int(row.get("paint_seed", 0)),
            float_value=float(row.get("float_value", 0.0)),
            quality=int(row.get("quality", 0)),
            rarity=int(row.get("rarity", 0)),
            origin=int(row.get("origin", 0)),
            flags=int(row.get("flags", 0)),
            inventory=int(row.get("inventory", 0)),
            tradable_after=int(row.get("tradable_after", 0)),
            name=name,
            hidden_reason=(str(hidden).strip() if hidden is not None else None),
            market_hash_name=market_hash_name,
            alchemy_name=alchemy_name,
            collection=str(row.get("collection", row.get("alchemy_collection", ""))).strip(),
            alchemy_rarity=str(row.get("alchemy_rarity", "")).strip(),
            minfloat=minfloat,
            maxfloat=maxfloat,
            isstattrak=int(row.get("isstattrak", 0) or 0),
            wear_range=(float(row["wear_range"]) if row.get("wear_range") is not None else None),
            is_craftable=bool(row.get("is_craftable", False)),
            craftable_reason=str(row.get("craftable_reason", "")).strip(),
            casket_id=str(row.get("casket_id", "")).strip(),
            casket_contained_item_count=int(row.get("casket_contained_item_count", 0) or 0),
            search_text_cached=f"{name} {market_hash_name} {alchemy_name}".lower().strip(),
            has_wear_cached=has_wear_cached,
        )


class InventoryLoader:
    def __init__(self):
        self.schema = load_schema()

    @staticmethod
    def from_live_items(items: list, excluded_records: list[dict] | None = None) -> list[InventoryEntry]:
        rows: list[InventoryEntry] = []
        for item in items:
            rows.append(InventoryEntry.from_item(item, hidden_reason=None))

        for row in excluded_records or []:
            rows.append(InventoryEntry.from_row_dict(row, hidden_reason_default="hidden"))

        rows.sort(key=lambda x: x.asset_id)
        return rows


class SessionManager:
    def __init__(self):
        self._lock = threading.RLock()
        self._active_cs2_client: CS2Client | None = None
        self._active_username: str | None = None

    @staticmethod
    def _is_cs2_client_alive(client: CS2Client | None) -> bool:
        if client is None:
            return False
        try:
            steam = getattr(client, "steam", None)
            gc = getattr(client, "cs2", None)
            return bool(
                steam
                and gc
                and getattr(steam, "connected", False)
                and getattr(steam, "channel_secured", False)
                and getattr(steam, "logged_on", False)
                and getattr(gc, "ready", False)
            )
        except Exception:
            return False

    def is_connected(self, username: str | None) -> bool:
        with self._lock:
            return bool(
                username
                and self._active_username == username
                and self._is_cs2_client_alive(self._active_cs2_client)
            )

    def get_active_pair(self) -> tuple[CS2Client | None, str | None]:
        with self._lock:
            client = self._active_cs2_client
            username = self._active_username
        if client is not None and not self._is_cs2_client_alive(client):
            # 失效会话不复用，直接清空引用
            self.drop_if_username(username, disconnect_cached_session=True)
            return None, None
        return client, username

    def set_active_pair(self, client: CS2Client | None, username: str | None):
        with self._lock:
            self._active_cs2_client = client
            self._active_username = username

    def disconnect_active(self, *, disconnect_cached_session: bool):
        with self._lock:
            client = self._active_cs2_client
            username = self._active_username
            self._active_cs2_client = None
            self._active_username = None
        if client is not None:
            try:
                client.disconnect(logout=False)
            except Exception:
                pass
        if disconnect_cached_session and username:
            try:
                disconnect_account(username)
            except Exception:
                pass

    def drop_if_username(self, username: str | None, *, disconnect_cached_session: bool) -> bool:
        username = str(username or "").strip()
        if not username:
            return False
        with self._lock:
            if self._active_username != username:
                return False
            client = self._active_cs2_client
            self._active_cs2_client = None
            self._active_username = None
        if client is not None:
            try:
                client.disconnect(logout=False)
            except Exception:
                pass
        if disconnect_cached_session:
            try:
                disconnect_account(username)
            except Exception:
                pass
        return True

    def get_or_connect(
        self,
        username: str,
        password: str,
        *,
        stop_event,
        post_progress: Callable[[str, str, str | None], None],
    ) -> CS2Client:
        username = str(username or "").strip()
        if not username:
            raise ValueError("username is empty")

        old_client: CS2Client | None = None
        old_username: str | None = None
        with self._lock:
            active_client = self._active_cs2_client
            active_username = self._active_username
            if active_username == username and self._is_cs2_client_alive(active_client):
                return active_client
            if active_client is not None:
                old_client = active_client
                old_username = active_username
                self._active_cs2_client = None
                self._active_username = None

        if old_client is not None:
            if old_username and old_username != username:
                post_progress(username, "正在断开旧账号连接...", "连接状态：切换账号中")
            else:
                post_progress(username, "检测到旧会话失效，正在重建连接...", "连接状态：连接中")
            try:
                old_client.disconnect(logout=False)
            except Exception:
                pass
            if old_username:
                try:
                    disconnect_account(old_username)
                except Exception:
                    pass

        post_progress(username, "正在登录 Steam...", "连接状态：连接中")
        steam_client = login(username, password, stop_event=stop_event)
        if stop_event.is_set():
            try:
                steam_client.disconnect()
            except Exception:
                pass
            raise ConnectionAbortedError("连接已取消（窗口关闭）")

        post_progress(username, "Steam 已登录，正在启动 CS2 GC...", "连接状态：连接中")
        cs2_client = CS2Client(steam_client)
        cs2_client.launch()
        if stop_event.is_set():
            try:
                cs2_client.disconnect(logout=False)
            except Exception:
                pass
            raise ConnectionAbortedError("连接已取消（窗口关闭）")

        with self._lock:
            self._active_cs2_client = cs2_client
            self._active_username = username
        post_progress(username, "CS2 GC 已连接，正在同步库存...", "连接状态：已连接（同步中）")
        return cs2_client


class InventoryOverviewPage(ttk.Frame):
    def __init__(self, master, on_active_account_changed=None, on_refreshing_changed=None):
        super().__init__(master, padding=12)
        self.loader = InventoryLoader()
        self.component_manager = ComponentManager()
        self.on_active_account_changed = on_active_account_changed
        self.on_refreshing_changed = on_refreshing_changed
        self.snapshot_path: Path | None = None
        self.entries: list[InventoryEntry] = []
        self.filtered_entries: list[InventoryEntry] = []

        self.mode_var = tk.StringVar(value="cards")
        self.search_var = tk.StringVar()
        self.include_hidden_var = tk.BooleanVar(value=False)
        self.wear_min_var = tk.StringVar()
        self.wear_max_var = tk.StringVar()
        self.rarity_filter_text_var = tk.StringVar(value="全部")
        self.collection_filter_text_var = tk.StringVar(value="全部")
        self.selected_rarity_filters: set[str] = set()
        self.selected_collection_filters: set[str] = set()
        self._rarity_filter_vars: dict[str, tk.BooleanVar] = {}
        self._collection_filter_vars: dict[str, tk.BooleanVar] = {}
        self._collection_filter_values: list[str] = []
        self.filter_drawer_open_var = tk.BooleanVar(value=False)
        self.filter_drawer_btn_text_var = tk.StringVar(value="展开筛选")
        self.wear_sort_var = tk.StringVar(value="asc")
        self.rarity_sort_var = tk.StringVar(value="desc")
        self.wear_filter_hint_var = tk.StringVar(value="")
        self.show_component_items_var = tk.BooleanVar(value=False)
        self.component_select_var = tk.StringVar(value="")
        self.component_hint_var = tk.StringVar(value="暂无可管理组件")
        self._component_selector_ids: list[str | None] = []
        self.component_summary_map: dict[str, Any] = {}
        self.component_item_map: dict[str, list[InventoryEntry]] = {}
        self.component_item_cache: dict[str, list[InventoryEntry]] = {}
        self._non_component_rows_cache: list[InventoryEntry] = []
        self._component_cache_key: tuple[int, int] = (0, 0)
        self._component_auto_show_items = False
        self._filter_cache_key: tuple | None = None
        self._filter_cache_rows: list[InventoryEntry] = []
        self._group_rows_cache_key: tuple | None = None
        self._group_rows_cache: list[dict[str, Any]] = []
        self._group_render_cache_key: tuple | None = None

        self.path_var = tk.StringVar(value="快照：未选择")
        self.current_account_var = tk.StringVar(value="当前账号：未选择")
        self.account_select_var = tk.StringVar(value="")
        self.connection_status_var = tk.StringVar(value="连接状态：未连接")
        self.refresh_btn_text_var = tk.StringVar(value="连接并刷新库存信息")
        self.fetch_time_var = tk.StringVar(value="库存获取时间：-")
        self.summary_var = tk.StringVar(value="尚未加载库存")
        self._search_after_id: str | None = None
        self._virtual_after_id: str | None = None
        self._last_virtual_refresh_at = 0.0
        self._last_scroll_at = time.perf_counter()
        self._last_scroll_top = 0.0
        self._scroll_speed_px_s = 0.0
        self._last_refresh_click_ts = 0.0
        self._refreshing = False
        self.current_username: str | None = None
        self.current_password: str = ""
        self.selected_account_username: str | None = None
        self._selector_usernames: list[str] = []
        self._selector_syncing = False
        self._empty_hint = "请选用一个账号"
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="inventory_refresh")
        self.session_manager = SessionManager()
        self._ui_state = self._load_ui_state()
        self._shutdown_event = threading.Event()
        self._refresh_phase_text: str = ""

        # 虚拟渲染参数
        self.card_columns = 3
        self.card_gap_x = 12
        self.card_gap_y = 12
        self.card_height = 138
        self.card_min_height = 126
        self.card_max_height = 220
        self.card_width = 340
        self._card_height_calibrated = False
        self._last_calibrated_width = 0
        self.pool_extra_rows = 2
        self.card_pool: list[dict] = []
        self.empty_text_id: int | None = None

        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        self._build_top()
        self._build_controls()
        self._build_views()
        self._set_no_account_state()

    def _build_top(self):
        top = ttk.Frame(self)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(6, weight=1)

        ttk.Label(top, text="库存总览", font=("Microsoft YaHei UI", 14, "bold")).grid(row=0, column=0, sticky="w", padx=(0, 10))
        ttk.Label(top, text="当前账号").grid(row=0, column=1, sticky="w")
        self.account_selector = ttk.Combobox(
            top,
            state="readonly",
            width=24,
            textvariable=self.account_select_var,
        )
        self.account_selector.grid(row=0, column=2, sticky="w", padx=(6, 8))
        self.account_selector.bind("<<ComboboxSelected>>", self._on_account_selector_changed)
        ttk.Label(top, textvariable=self.connection_status_var, foreground="#1d3557").grid(row=0, column=3, sticky="w", padx=(0, 8))
        ttk.Label(top, textvariable=self.fetch_time_var, foreground="#555").grid(row=0, column=4, sticky="w", padx=(0, 8))
        self.refresh_btn = ttk.Button(top, textvariable=self.refresh_btn_text_var, command=self._on_refresh_inventory_clicked)
        self.refresh_btn.grid(row=0, column=5, padx=(0, 8))
        ttk.Label(top, textvariable=self.path_var, foreground="#555").grid(row=0, column=6, sticky="w")

    def _load_ui_state(self) -> dict:
        state = {"last_selected_username": None, "accounts": {}}
        try:
            if INVENTORY_UI_STATE_FILE.exists():
                loaded = json.loads(INVENTORY_UI_STATE_FILE.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    accounts = loaded.get("accounts", {})
                    if isinstance(accounts, dict):
                        state["accounts"] = accounts
                    last_selected = loaded.get("last_selected_username")
                    if isinstance(last_selected, str) and last_selected:
                        state["last_selected_username"] = last_selected
        except Exception:
            pass
        return state

    def _save_ui_state(self):
        try:
            INVENTORY_UI_STATE_FILE.write_text(
                json.dumps(self._ui_state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass

    def _refresh_account_selector(self, prefer_username: str | None = None):
        rows = AccountStore().list_accounts()
        self._selector_usernames = [row["username"] for row in rows]
        remarks = [str(row.get("remark", row["username"])) for row in rows]
        self.account_selector.configure(values=remarks)

        if not self._selector_usernames:
            self._selector_syncing = True
            self.account_select_var.set("")
            self._selector_syncing = False
            return

        target = (
            prefer_username
            or self.selected_account_username
            or self.current_username
            or self._ui_state.get("last_selected_username")
            or self._selector_usernames[0]
        )
        if target not in self._selector_usernames:
            target = self._selector_usernames[0]

        idx = self._selector_usernames.index(target)
        self._selector_syncing = True
        self.account_selector.current(idx)
        self._selector_syncing = False
        self.selected_account_username = target

    def _selected_username_from_selector(self) -> str | None:
        idx = self.account_selector.current()
        if idx < 0 or idx >= len(self._selector_usernames):
            return None
        return self._selector_usernames[idx]

    def _on_account_selector_changed(self, _event=None):
        if self._selector_syncing:
            return
        username = self._selected_username_from_selector()
        if not username:
            return
        self._switch_account_view(username, auto_refresh_if_stale=True, force_refresh=False)

    def _is_username_connected(self, username: str | None) -> bool:
        return self.session_manager.is_connected(username)

    def _get_active_client_pair(self) -> tuple[CS2Client | None, str | None]:
        return self.session_manager.get_active_pair()

    def _set_active_client_pair(self, client: CS2Client | None, username: str | None):
        self.session_manager.set_active_pair(client, username)

    def _update_connection_ui(self):
        if self._refresh_phase_text:
            self.connection_status_var.set(self._refresh_phase_text)
            return

        username = self.selected_account_username
        if not username:
            self.current_account_var.set("当前账号：未选择")
            self.connection_status_var.set("连接状态：未连接")
            self.refresh_btn_text_var.set("连接并刷新库存信息")
            return

        self.current_account_var.set(f"当前账号：{username}")
        if self._is_username_connected(username):
            self.connection_status_var.set("连接状态：已连接")
            self.refresh_btn_text_var.set("刷新库存信息")
        else:
            self.connection_status_var.set("连接状态：未连接")
            self.refresh_btn_text_var.set("连接并刷新库存信息")

    def _set_refresh_phase(self, text: str):
        self._refresh_phase_text = str(text or "").strip()
        self._update_connection_ui()

    def _clear_refresh_phase(self):
        self._refresh_phase_text = ""
        self._update_connection_ui()

    def _post_refresh_progress(self, username: str, summary_text: str, connection_text: str | None = None):
        if self._shutdown_event.is_set():
            return
        if connection_text:
            logger.info("refresh progress (%s): %s | %s", username, summary_text, connection_text)
        else:
            logger.info("refresh progress (%s): %s", username, summary_text)

        def _apply():
            if self._shutdown_event.is_set():
                return
            # 只更新当前目标账号，避免切换账号后状态串线
            target_username = self.selected_account_username or self.current_username
            if target_username and target_username != username:
                return
            self.summary_var.set(summary_text)
            if connection_text:
                self._set_refresh_phase(connection_text)

        self._safe_after(_apply)

    def _safe_after(self, callback):
        if self._shutdown_event.is_set():
            return False
        try:
            self.after(0, callback)
            return True
        except Exception:
            return False

    def _parse_time(self, value: str | None) -> datetime | None:
        if not value:
            return None
        text = str(value).strip()
        if not text:
            return None
        for fmt in ("%Y-%m-%d %H:%M:%S",):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                pass
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            return None

    def _load_entries_from_snapshot(self, snapshot_path: str | None) -> tuple[list[InventoryEntry], Path | None, str | None]:
        if not snapshot_path:
            return [], None, None

        path = Path(snapshot_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        if not path.exists():
            return [], None, None

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return [], None, None

        if not isinstance(payload, dict):
            return [], None, None
        items = payload.get("items", [])
        if not isinstance(items, list):
            return [], None, None

        rows: list[InventoryEntry] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            rows.append(InventoryEntry.from_row_dict(item))

        rows.sort(key=lambda x: x.asset_id)
        generated_at = payload.get("generated_at")
        return rows, path, (str(generated_at).strip() if generated_at else None)

    def _show_cached_inventory(self, username: str):
        account_cache = self._ui_state.get("accounts", {}).get(username, {})
        snapshot_path = account_cache.get("snapshot_path")
        rows, resolved_path, generated_at = self._load_entries_from_snapshot(snapshot_path)

        if rows:
            self.entries = rows
            self._refresh_collection_filter_options()
            self._refresh_component_controls()
            self.snapshot_path = resolved_path
            self.path_var.set(f"快照：{resolved_path}" if resolved_path else "快照：未选择")
            self.fetch_time_var.set(f"库存获取时间：{generated_at or account_cache.get('fetch_time') or '-'}")
            self._empty_hint = "当前条件下无物品"
            self._refresh_view()
            self.summary_var.set(f"已显示该账号上次库存，共 {len(rows)} 条")
            return

        self.entries = []
        self.filtered_entries = []
        self._refresh_collection_filter_options()
        self._refresh_component_controls()
        self.snapshot_path = None
        self.path_var.set("快照：未选择")
        self.fetch_time_var.set("库存获取时间：-")
        self._empty_hint = "当前账号未连接"
        self._refresh_view()
        self.summary_var.set("当前账号未连接（暂无上次库存信息）")

    def _need_auto_refresh(self, username: str) -> bool:
        account_cache = self._ui_state.get("accounts", {}).get(username, {})
        ts = self._parse_time(account_cache.get("fetch_time"))
        if ts is None:
            return False
        return (datetime.now() - ts).total_seconds() > AUTO_REFRESH_INTERVAL_SECONDS

    def _switch_account_view(self, username: str, *, auto_refresh_if_stale: bool, force_refresh: bool):
        if not username:
            return

        self.selected_account_username = username
        self.current_username = username
        info = AccountStore().get(username) or {}
        self.current_password = str(info.get("password", "")).strip()

        self._refresh_account_selector(prefer_username=username)
        self._show_cached_inventory(username)
        self._update_connection_ui()

        self._ui_state["last_selected_username"] = username
        self._save_ui_state()

        if self._refreshing:
            return

        stale = self._need_auto_refresh(username)
        connected = self._is_username_connected(username)
        should_refresh = force_refresh or (auto_refresh_if_stale and connected and stale)
        if should_refresh:
            if not self.current_password:
                self.summary_var.set("当前账号缺少密码，无法连接并刷新库存")
                return
            self.summary_var.set("库存超过30分钟未更新，正在自动刷新..." if not force_refresh else "正在刷新库存，请稍候...")
            self._start_refresh(username, self.current_password)
            return

        if auto_refresh_if_stale and stale and not connected and not force_refresh:
            self.summary_var.set("库存超过30分钟，但当前账号未连接，未自动刷新")

    def _build_controls(self):
        ctl = ttk.Frame(self)
        ctl.grid(row=1, column=0, sticky="ew", pady=(10, 10))
        ctl.columnconfigure(4, weight=1)
        ctl.columnconfigure(9, weight=1)

        ttk.Radiobutton(ctl, text="分散大图视图", variable=self.mode_var, value="cards", command=self._refresh_view).grid(row=0, column=0, sticky="w", padx=(0, 12))
        ttk.Radiobutton(ctl, text="归类折叠视图", variable=self.mode_var, value="grouped", command=self._refresh_view).grid(row=0, column=1, sticky="w", padx=(0, 12))
        ttk.Checkbutton(ctl, text="包含被过滤条目", variable=self.include_hidden_var, command=self._refresh_view).grid(row=0, column=2, sticky="w", padx=(0, 12))

        ttk.Label(ctl, text="搜索").grid(row=0, column=3, sticky="e")
        search = ttk.Entry(ctl, textvariable=self.search_var)
        search.grid(row=0, column=4, sticky="ew", padx=(6, 10))
        search.bind("<KeyRelease>", lambda _e: self._schedule_refresh())

        ttk.Label(ctl, text="预热: 100（固定）", foreground="#555").grid(row=0, column=5, sticky="w", padx=(6, 8))
        ttk.Button(ctl, textvariable=self.filter_drawer_btn_text_var, command=self._toggle_filter_drawer).grid(row=0, column=6, sticky="w", padx=(0, 8))
        ttk.Label(ctl, textvariable=self.summary_var, foreground="#1d3557").grid(row=0, column=9, sticky="e")

        self.filter_drawer = ttk.LabelFrame(ctl, text="筛选抽屉")
        self.filter_drawer.grid(row=1, column=0, columnspan=10, sticky="ew", pady=(8, 0))
        self.filter_drawer.columnconfigure(7, weight=1)

        ttk.Label(self.filter_drawer, text="磨损范围").grid(row=0, column=0, sticky="w", padx=(8, 6), pady=(8, 8))
        wear_values = [f"{x / 100:.2f}" for x in range(0, 101)]
        self.wear_min_entry = ttk.Combobox(
            self.filter_drawer,
            state="readonly",
            width=7,
            textvariable=self.wear_min_var,
            values=wear_values,
        )
        self.wear_min_entry.grid(row=0, column=1, sticky="w", pady=(8, 8))
        ttk.Label(self.filter_drawer, text="-").grid(row=0, column=2, sticky="w", pady=(8, 8))
        self.wear_max_entry = ttk.Combobox(
            self.filter_drawer,
            state="readonly",
            width=7,
            textvariable=self.wear_max_var,
            values=wear_values,
        )
        self.wear_max_entry.grid(row=0, column=3, sticky="w", pady=(8, 8))
        self.wear_min_entry.bind("<<ComboboxSelected>>", lambda e: self._on_wear_input_changed(e, changed_side="min"))
        self.wear_max_entry.bind("<<ComboboxSelected>>", lambda e: self._on_wear_input_changed(e, changed_side="max"))

        ttk.Label(self.filter_drawer, text="稀有度").grid(row=0, column=4, sticky="e", padx=(10, 6), pady=(8, 8))
        self.rarity_filter_btn = tk.Menubutton(
            self.filter_drawer,
            textvariable=self.rarity_filter_text_var,
            relief="raised",
            width=14,
            direction="below",
        )
        self.rarity_filter_btn.grid(row=0, column=5, sticky="w", pady=(8, 8))
        self.rarity_filter_menu = tk.Menu(self.rarity_filter_btn, tearoff=False)
        self.rarity_filter_btn.configure(menu=self.rarity_filter_menu)
        self._build_rarity_filter_menu()

        ttk.Label(self.filter_drawer, text="收藏品").grid(row=0, column=6, sticky="e", padx=(10, 6), pady=(8, 8))
        self.collection_filter_btn = tk.Menubutton(
            self.filter_drawer,
            textvariable=self.collection_filter_text_var,
            relief="raised",
            width=28,
            direction="below",
        )
        self.collection_filter_btn.grid(row=0, column=7, sticky="ew", padx=(0, 8), pady=(8, 8))
        self.collection_filter_menu = tk.Menu(self.collection_filter_btn, tearoff=False)
        self.collection_filter_btn.configure(menu=self.collection_filter_menu)

        ttk.Label(ctl, text="磨损").grid(row=2, column=4, sticky="e", pady=(8, 0))
        wear_sort_box = tk.Frame(ctl)
        wear_sort_box.grid(row=2, column=5, sticky="w", padx=(6, 8), pady=(8, 0))
        self.wear_sort_up_btn = tk.Button(
            wear_sort_box,
            text="▲",
            width=2,
            relief="flat",
            bd=0,
            cursor="hand2",
            command=lambda: self._set_wear_sort("asc"),
        )
        self.wear_sort_up_btn.pack(side="left")
        self.wear_sort_down_btn = tk.Button(
            wear_sort_box,
            text="▼",
            width=2,
            relief="flat",
            bd=0,
            cursor="hand2",
            command=lambda: self._set_wear_sort("desc"),
        )
        self.wear_sort_down_btn.pack(side="left")

        ttk.Label(ctl, text="稀有度").grid(row=2, column=6, sticky="e", pady=(8, 0))
        rarity_sort_box = tk.Frame(ctl)
        rarity_sort_box.grid(row=2, column=7, sticky="w", padx=(6, 8), pady=(8, 0))
        self.rarity_sort_up_btn = tk.Button(
            rarity_sort_box,
            text="▲",
            width=2,
            relief="flat",
            bd=0,
            cursor="hand2",
            command=lambda: self._set_rarity_sort("asc"),
        )
        self.rarity_sort_up_btn.pack(side="left")
        self.rarity_sort_down_btn = tk.Button(
            rarity_sort_box,
            text="▼",
            width=2,
            relief="flat",
            bd=0,
            cursor="hand2",
            command=lambda: self._set_rarity_sort("desc"),
        )
        self.rarity_sort_down_btn.pack(side="left")

        ttk.Label(ctl, textvariable=self.wear_filter_hint_var, foreground="#c1121f").grid(row=2, column=9, sticky="e", pady=(8, 0))

        component_panel = ttk.LabelFrame(ctl, text="组件管理")
        component_panel.grid(row=3, column=0, columnspan=10, sticky="w", pady=(10, 0))
        self.component_panel = component_panel

        ttk.Label(component_panel, text="组件").grid(row=0, column=0, sticky="w", padx=(8, 6), pady=(8, 8))
        self.component_selector = ttk.Combobox(
            component_panel,
            state="readonly",
            width=28,
            textvariable=self.component_select_var,
        )
        self.component_selector.grid(row=0, column=1, sticky="w", pady=(8, 8))
        self.component_selector.bind("<<ComboboxSelected>>", self._on_component_selector_changed)

        ttk.Label(component_panel, textvariable=self.component_hint_var, foreground="#1d3557").grid(
            row=0, column=2, sticky="w", padx=(8, 8), pady=(8, 8)
        )
        ttk.Checkbutton(
            component_panel,
            text="显示组件内物品",
            variable=self.show_component_items_var,
            command=self._on_component_toggle_changed,
        ).grid(row=0, column=3, sticky="w", padx=(8, 10), pady=(8, 8))

        self._refresh_collection_filter_options()
        self._refresh_component_controls()
        self._update_filter_drawer_visibility()
        self._update_component_panel_visibility()
        self._refresh_sort_arrow_styles()

    def _toggle_filter_drawer(self):
        self.filter_drawer_open_var.set(not bool(self.filter_drawer_open_var.get()))
        self._update_filter_drawer_visibility()

    def _update_filter_drawer_visibility(self):
        opened = bool(self.filter_drawer_open_var.get())
        if opened:
            self.filter_drawer.grid()
            self.filter_drawer_btn_text_var.set("收起筛选")
        else:
            self.filter_drawer.grid_remove()
            self.filter_drawer_btn_text_var.set("展开筛选")

    def _build_rarity_filter_menu(self):
        values = [RARITY_MAP[k] for k in sorted(RARITY_MAP.keys())]
        self.selected_rarity_filters = {x for x in self.selected_rarity_filters if x in values}
        self._rarity_filter_vars = {}

        self.rarity_filter_menu.delete(0, "end")
        self.rarity_filter_menu.add_command(label="全选", command=self._select_all_rarity_filters)
        self.rarity_filter_menu.add_command(label="清空", command=self._clear_rarity_filters)
        self.rarity_filter_menu.add_separator()
        for label in values:
            var = tk.BooleanVar(value=(label in self.selected_rarity_filters))
            self._rarity_filter_vars[label] = var
            self.rarity_filter_menu.add_checkbutton(
                label=label,
                variable=var,
                command=self._on_rarity_filter_menu_changed,
            )
        self._refresh_rarity_filter_text()

    def _select_all_rarity_filters(self):
        for label, var in self._rarity_filter_vars.items():
            var.set(True)
            self.selected_rarity_filters.add(label)
        self._refresh_rarity_filter_text()
        self._refresh_view()

    def _clear_rarity_filters(self):
        for var in self._rarity_filter_vars.values():
            var.set(False)
        self.selected_rarity_filters.clear()
        self._refresh_rarity_filter_text()
        self._refresh_view()

    def _on_rarity_filter_menu_changed(self):
        self.selected_rarity_filters = {
            label for label, var in self._rarity_filter_vars.items() if bool(var.get())
        }
        self._refresh_rarity_filter_text()
        self._refresh_view()

    def _refresh_rarity_filter_text(self):
        total = len(self._rarity_filter_vars)
        selected = len(self.selected_rarity_filters)
        if selected <= 0 or selected >= total:
            self.rarity_filter_text_var.set("全部")
            return
        if selected == 1:
            self.rarity_filter_text_var.set(next(iter(self.selected_rarity_filters)))
            return
        self.rarity_filter_text_var.set(f"已选{selected}项")

    def _refresh_collection_filter_options(self):
        values = sorted(
            {
                str(item.collection).strip()
                for item in self.entries
                if str(item.collection).strip()
            }
        )
        self._collection_filter_values = values
        self.selected_collection_filters = {x for x in self.selected_collection_filters if x in values}
        self._collection_filter_vars = {}

        self.collection_filter_menu.delete(0, "end")
        self.collection_filter_menu.add_command(label="全选", command=self._select_all_collection_filters)
        self.collection_filter_menu.add_command(label="清空", command=self._clear_collection_filters)
        self.collection_filter_menu.add_separator()
        for label in values:
            var = tk.BooleanVar(value=(label in self.selected_collection_filters))
            self._collection_filter_vars[label] = var
            self.collection_filter_menu.add_checkbutton(
                label=label,
                variable=var,
                command=self._on_collection_filter_menu_changed,
            )
        self._refresh_collection_filter_text()

    def _select_all_collection_filters(self):
        for label, var in self._collection_filter_vars.items():
            var.set(True)
            self.selected_collection_filters.add(label)
        self._refresh_collection_filter_text()
        self._refresh_view()

    def _clear_collection_filters(self):
        for var in self._collection_filter_vars.values():
            var.set(False)
        self.selected_collection_filters.clear()
        self._refresh_collection_filter_text()
        self._refresh_view()

    def _on_collection_filter_menu_changed(self):
        self.selected_collection_filters = {
            label for label, var in self._collection_filter_vars.items() if bool(var.get())
        }
        self._refresh_collection_filter_text()
        self._refresh_view()

    def _refresh_collection_filter_text(self):
        total = len(self._collection_filter_values)
        selected = len(self.selected_collection_filters)
        if selected <= 0 or selected >= total:
            self.collection_filter_text_var.set("全部")
            return
        if selected == 1:
            self.collection_filter_text_var.set(next(iter(self.selected_collection_filters)))
            return
        self.collection_filter_text_var.set(f"已选{selected}项")

    def _selected_component_id(self) -> str | None:
        idx = self.component_selector.current()
        if idx < 0 or idx >= len(self._component_selector_ids):
            return None
        return self._component_selector_ids[idx]

    @staticmethod
    def _compact_component_name(name: str) -> str:
        text = str(name or "").strip()
        if not text:
            return "未命名组件"

        lower = text.lower()
        if lower.startswith("storage unit"):
            text = text[len("Storage Unit"):].strip()
            if text.startswith("|"):
                text = text[1:].strip()

        if text.startswith("(") and text.endswith(")"):
            text = text[1:-1].strip()

        return text or "未命名组件"

    def _refresh_component_controls(self):
        self._rebuild_component_scope_cache()
        old_selected = self._selected_component_id()

        options: list[tuple[str, str | None]] = [("全部组件", None)]
        for component_id, summary in sorted(
            self.component_summary_map.items(),
            key=lambda x: (x[1].name.lower(), int(x[1].asset_id)),
        ):
            compact_name = self._compact_component_name(summary.name)
            loaded = int(summary.loaded_count)
            expected = int(summary.expected_count)
            tail = f"{loaded}/{expected}" if expected > 0 else f"{loaded}"
            options.append((f"{compact_name} [{tail}]", component_id))

        if len(options) <= 1:
            self.component_selector.configure(values=["无可管理组件"], state="disabled")
            self._component_selector_ids = [None]
            self.component_select_var.set("无可管理组件")
            self.component_hint_var.set("0个/0件")
            return

        labels = [x[0] for x in options]
        ids = [x[1] for x in options]
        self.component_selector.configure(values=labels, state="readonly")
        self._component_selector_ids = ids

        target_id = old_selected if old_selected in set(ids) else None
        if target_id is None:
            target_idx = 0
        else:
            target_idx = ids.index(target_id)
        self.component_selector.current(target_idx)

        total_components = len(self.component_summary_map)
        loaded_items = sum(len(v) for v in self.component_item_map.values())
        self.component_hint_var.set(f"{total_components}个/{loaded_items}件")

    def _rebuild_component_scope_cache(self):
        self.component_summary_map, self.component_item_map = self.component_manager.build_component_index(self.entries)
        self.component_item_cache = {
            str(component_id): sorted(list(items), key=lambda x: x.asset_id)
            for component_id, items in self.component_item_map.items()
        }
        self._non_component_rows_cache = [
            x for x in self.entries if not str(getattr(x, "casket_id", "") or "").strip()
        ]
        self._component_cache_key = (id(self.entries), len(self.entries))

    def _on_component_selector_changed(self, _event=None):
        selected_component_id = self._selected_component_id()
        if selected_component_id:
            # 选择具体组件时，直接进入组件视图（只看组件内物品）。
            if not bool(self.show_component_items_var.get()):
                self.show_component_items_var.set(True)
                self._component_auto_show_items = True
        else:
            # 回到“全部组件”时，若是自动开启的组件显示，自动恢复关闭，避免全量数据导致卡顿。
            if self._component_auto_show_items:
                self.show_component_items_var.set(False)
                self._component_auto_show_items = False
        self._refresh_view()

    def _on_component_toggle_changed(self):
        # 用户手动改动后，取消自动开关托管。
        self._component_auto_show_items = False
        self._refresh_view()

    def _rows_for_component_scope(self) -> list[InventoryEntry]:
        cache_key = (id(self.entries), len(self.entries))
        if cache_key != self._component_cache_key:
            self._rebuild_component_scope_cache()

        selected_component_id = self._selected_component_id()
        if selected_component_id:
            return self.component_item_cache.get(selected_component_id, [])

        if bool(self.show_component_items_var.get()):
            return self.entries

        return self._non_component_rows_cache

    @staticmethod
    def _rows_stamp(rows: list[InventoryEntry]) -> tuple[int, int, int, int]:
        if not rows:
            return (id(rows), 0, 0, 0)
        return (id(rows), len(rows), int(rows[0].asset_id), int(rows[-1].asset_id))

    def _match_component_scope(self, item: InventoryEntry) -> bool:
        selected_component_id = self._selected_component_id()
        casket_id = str(getattr(item, "casket_id", "") or "").strip()
        if selected_component_id:
            return casket_id == selected_component_id
        if not casket_id:
            return True
        if not bool(self.show_component_items_var.get()):
            return False
        return True

    def _update_component_panel_visibility(self):
        if not hasattr(self, "component_panel"):
            return
        if self.mode_var.get() == "cards":
            self.component_panel.grid()
        else:
            self.component_panel.grid_remove()

    def _build_views(self):
        holder = ttk.Frame(self)
        holder.grid(row=2, column=0, sticky="nsew")
        holder.columnconfigure(0, weight=1)
        holder.rowconfigure(0, weight=1)

        self.cards_view = ttk.Frame(holder)
        self.grouped_view = ttk.Frame(holder)
        for view in (self.cards_view, self.grouped_view):
            view.grid(row=0, column=0, sticky="nsew")
            view.columnconfigure(0, weight=1)
            view.rowconfigure(0, weight=1)

        self._build_cards()
        self._build_grouped()

    def _build_cards(self):
        wrap = ttk.Frame(self.cards_view)
        wrap.grid(row=0, column=0, sticky="nsew")
        wrap.columnconfigure(0, weight=1)
        wrap.rowconfigure(0, weight=1)

        self.cards_canvas = tk.Canvas(wrap, highlightthickness=0)
        self.cards_canvas.grid(row=0, column=0, sticky="nsew")

        self.cards_ybar = ttk.Scrollbar(wrap, orient="vertical", command=self._on_cards_scrollbar)
        self.cards_ybar.grid(row=0, column=1, sticky="ns")
        self.cards_canvas.configure(yscrollcommand=self._on_cards_yview)

        self.cards_canvas.bind("<Configure>", self._on_cards_canvas_configure)
        self.cards_canvas.bind("<MouseWheel>", self._on_mouse_wheel_cards)
        self.cards_canvas.bind("<Button-4>", self._on_mouse_wheel_cards)
        self.cards_canvas.bind("<Button-5>", self._on_mouse_wheel_cards)

        self.empty_text_id = self.cards_canvas.create_text(12, 12, anchor="nw", text="", fill="#555", font=("Microsoft YaHei UI", 11))
        self.cards_canvas.itemconfigure(self.empty_text_id, state="hidden")

    def _build_grouped(self):
        wrap = ttk.Frame(self.grouped_view)
        wrap.grid(row=0, column=0, sticky="nsew")
        wrap.columnconfigure(0, weight=1)
        wrap.rowconfigure(0, weight=1)

        cols = ("name", "collection", "count", "seed", "wear", "cooldown")
        self.group_tree = ttk.Treeview(wrap, columns=cols, show="tree headings")
        self.group_tree.grid(row=0, column=0, sticky="nsew")

        self.group_tree.heading("#0", text="稀有度")
        for cid, text, width in (
            ("name", "名称", 280),
            ("collection", "收藏品", 180),
            ("count", "数量(可用/冷却中)", 120),
            ("seed", "种子", 90),
            ("wear", "磨损", 140),
            ("cooldown", "冷却", 220),
        ):
            self.group_tree.heading(cid, text=text)
            self.group_tree.column(cid, width=width, anchor="center")
        self.group_tree.column("#0", width=120, anchor="w")

        ybar = ttk.Scrollbar(wrap, orient="vertical", command=self.group_tree.yview)
        ybar.grid(row=0, column=1, sticky="ns")
        self.group_tree.configure(yscrollcommand=ybar.set)

    @staticmethod
    def _quality_name(qid: int) -> str:
        return QUALITY_MAP.get(qid, f"Unknown({qid})")

    @staticmethod
    def _rarity_name(rid: int) -> str:
        return RARITY_MAP.get(rid, f"Unknown({rid})")

    @staticmethod
    def _cooldown_end_text(unlock_ts: int) -> str:
        return datetime.fromtimestamp(int(unlock_ts)).strftime("%m月%d日")

    @staticmethod
    def _item_has_wear(item: InventoryEntry) -> bool:
        cached = getattr(item, "has_wear_cached", None)
        if cached is not None:
            return bool(cached)
        if item.minfloat is not None and item.maxfloat is not None:
            return True
        name = (item.name or "").lower()
        wear_tags = (
            "(factory new)",
            "(minimal wear)",
            "(field-tested)",
            "(well-worn)",
            "(battle-scarred)",
        )
        return any(tag in name for tag in wear_tags)

    @staticmethod
    def _item_display_name(item: InventoryEntry) -> str:
        localized = str(getattr(item, "alchemy_name", "") or "").strip()
        if localized:
            return localized
        return str(getattr(item, "name", "") or "").strip()

    @staticmethod
    def _item_search_text(item: InventoryEntry) -> str:
        cached = str(getattr(item, "search_text_cached", "") or "").strip()
        if cached:
            return cached
        parts = [
            str(getattr(item, "name", "") or ""),
            str(getattr(item, "market_hash_name", "") or ""),
            str(getattr(item, "alchemy_name", "") or ""),
        ]
        return " ".join(parts).lower()

    def _group_needs_expand(self, items: list[InventoryEntry]) -> bool:
        if len(items) <= 1:
            return True
        base = items[0]
        base_has_wear = self._item_has_wear(base)
        base_seed = int(base.paint_seed)
        base_quality = int(base.quality)
        base_rarity = int(base.rarity)
        base_unlock = int(base.tradable_after)
        base_float = float(base.float_value)

        for item in items[1:]:
            if int(item.paint_seed) != base_seed:
                return True
            if int(item.quality) != base_quality or int(item.rarity) != base_rarity:
                return True
            if int(item.tradable_after) != base_unlock:
                return True
            has_wear = self._item_has_wear(item)
            if has_wear != base_has_wear:
                return True
            if has_wear and abs(float(item.float_value) - base_float) > 1e-9:
                return True
        return False

    def _cooling_unlock_ts(self, item: InventoryEntry) -> int:
        unlock_ts = int(getattr(item, "tradable_after", 0) or 0)
        if unlock_ts <= int(time.time()):
            return 0
        return unlock_ts

    def _cooldown_text(self, item: InventoryEntry, *, compact: bool = False) -> str:
        unlock_ts = self._cooling_unlock_ts(item)
        if unlock_ts <= 0:
            return "无"
        end_text = self._cooldown_end_text(unlock_ts)
        if compact:
            return f"冷却中 {end_text}结束"
        return f"冷却中 {end_text} 结束"

    def _group_cooldown_text(self, items: list[InventoryEntry]) -> str:
        now_ts = int(time.time())
        cooling = [x for x in items if int(getattr(x, "tradable_after", 0) or 0) > now_ts]
        if not cooling:
            return "无"
        earliest = min(cooling, key=lambda x: int(getattr(x, "tradable_after", 0) or 0))
        if len(cooling) == 1:
            return self._cooldown_text(earliest, compact=False)
        earliest_text = self._cooldown_end_text(int(earliest.tradable_after))
        return f"{len(cooling)}件冷却中，最早{earliest_text}结束"

    def _component_name_by_id(self, component_id: str) -> str:
        component_id = str(component_id or "").strip()
        if not component_id:
            return ""
        summary = self.component_summary_map.get(component_id)
        if summary is None:
            return component_id
        return summary.name

    @staticmethod
    def _group_collection_text(items: list[InventoryEntry]) -> str:
        collections = sorted({str(x.collection).strip() for x in items if str(x.collection).strip()})
        if not collections:
            return ""
        if len(collections) == 1:
            return collections[0]
        return "多收藏品"

    @staticmethod
    def _parse_float_input(text: str) -> float | None:
        value = (text or "").strip()
        if not value:
            return None
        try:
            parsed = float(value)
        except ValueError:
            return None
        return parsed

    def _validate_wear_filter(self, *, changed_side: str | None = None, auto_fix: bool = False) -> tuple[float | None, float | None, bool]:
        min_text = self.wear_min_var.get().strip()
        max_text = self.wear_max_var.get().strip()
        min_value = self._parse_float_input(min_text)
        max_value = self._parse_float_input(max_text)

        if min_text and min_value is None:
            self.wear_filter_hint_var.set("磨损前项格式无效")
            return None, None, False
        if max_text and max_value is None:
            self.wear_filter_hint_var.set("磨损后项格式无效")
            return None, None, False

        if min_value is not None and not (0.0 <= min_value <= 1.0):
            self.wear_filter_hint_var.set("磨损前项需在 0.00~1.00")
            return None, None, False
        if max_value is not None and not (0.0 <= max_value <= 1.0):
            self.wear_filter_hint_var.set("磨损后项需在 0.00~1.00")
            return None, None, False

        if min_value is not None and max_value is not None and max_value <= min_value:
            if auto_fix:
                if changed_side == "max":
                    fixed_min = max(0.0, round(max_value - 0.01, 2))
                    if fixed_min >= max_value:
                        max_value = 0.01
                        self.wear_max_var.set(f"{max_value:.2f}")
                        fixed_min = 0.00
                    min_value = fixed_min
                    self.wear_min_var.set(f"{min_value:.2f}")
                else:
                    fixed_max = min(1.0, round(min_value + 0.01, 2))
                    if fixed_max <= min_value:
                        min_value = 0.99
                        self.wear_min_var.set(f"{min_value:.2f}")
                        fixed_max = 1.00
                    max_value = fixed_max
                    self.wear_max_var.set(f"{max_value:.2f}")
            else:
                self.wear_filter_hint_var.set("磨损后项必须大于前项")
                return None, None, False

        self.wear_filter_hint_var.set("")
        return min_value, max_value, True

    def _on_wear_input_changed(self, _event=None, changed_side: str | None = None):
        min_text = self.wear_min_var.get().strip()
        max_text = self.wear_max_var.get().strip()
        min_value = self._parse_float_input(min_text)
        max_value = self._parse_float_input(max_text)

        if changed_side == "min" and min_value is not None and max_value is None:
            fixed_max = min(1.0, round(min_value + 0.01, 2))
            if fixed_max <= min_value:
                min_value = 0.99
                self.wear_min_var.set(f"{min_value:.2f}")
                fixed_max = 1.00
            self.wear_max_var.set(f"{fixed_max:.2f}")
        elif changed_side == "max" and max_value is not None and min_value is None:
            fixed_min = max(0.0, round(max_value - 0.01, 2))
            if fixed_min >= max_value:
                max_value = 0.01
                self.wear_max_var.set(f"{max_value:.2f}")
                fixed_min = 0.00
            self.wear_min_var.set(f"{fixed_min:.2f}")

        self._validate_wear_filter(changed_side=changed_side, auto_fix=True)
        self._schedule_refresh()

    def _set_wear_sort(self, order: str):
        if order not in ("asc", "desc"):
            return
        self.wear_sort_var.set(order)
        self._refresh_sort_arrow_styles()
        self._refresh_view()

    def _set_rarity_sort(self, order: str):
        if order not in ("asc", "desc"):
            return
        self.rarity_sort_var.set(order)
        self._refresh_sort_arrow_styles()
        self._refresh_view()

    def _refresh_sort_arrow_styles(self):
        wear_mode = self.wear_sort_var.get().strip()
        rarity_mode = self.rarity_sort_var.get().strip()

        if hasattr(self, "wear_sort_up_btn"):
            self.wear_sort_up_btn.configure(fg="#111" if wear_mode == "asc" else "#666")
        if hasattr(self, "wear_sort_down_btn"):
            self.wear_sort_down_btn.configure(fg="#111" if wear_mode == "desc" else "#666")
        if hasattr(self, "rarity_sort_up_btn"):
            self.rarity_sort_up_btn.configure(fg="#111" if rarity_mode == "asc" else "#666")
        if hasattr(self, "rarity_sort_down_btn"):
            self.rarity_sort_down_btn.configure(fg="#111" if rarity_mode == "desc" else "#666")

    def _apply_filter(self):
        keyword = self.search_var.get().strip().lower()
        all_rows = self._rows_for_component_scope()
        selected_component_id = self._selected_component_id()
        if selected_component_id:
            self._empty_hint = "该组件暂无已缓存物品，请先刷新库存" if not all_rows else "该组件在当前条件下无物品"
        elif bool(self.show_component_items_var.get()):
            self._empty_hint = "当前条件下无物品"
        else:
            self._empty_hint = "当前条件下无物品（已隐藏组件内物品）"
        wear_min, wear_max, wear_valid = self._validate_wear_filter(auto_fix=False)
        wear_mode = self.wear_sort_var.get().strip()
        rarity_mode = self.rarity_sort_var.get().strip()

        cache_key = (
            self._rows_stamp(all_rows),
            bool(self.include_hidden_var.get()),
            keyword,
            tuple(sorted(self.selected_rarity_filters)),
            tuple(sorted(self.selected_collection_filters)),
            len(self._rarity_filter_vars),
            len(self._collection_filter_values),
            wear_min,
            wear_max,
            bool(wear_valid),
            wear_mode,
            rarity_mode,
            selected_component_id or "",
            bool(self.show_component_items_var.get()),
        )
        if cache_key == self._filter_cache_key:
            self.filtered_entries = self._filter_cache_rows
            return

        wear_rows = [x for x in all_rows if self._item_has_wear(x)]
        no_wear_rows = [x for x in all_rows if not self._item_has_wear(x)]

        # 无磨损物品不受任何筛选条件影响；筛选仅作用于有磨损物品。
        rows = wear_rows
        if not self.include_hidden_var.get():
            rows = [x for x in rows if x.hidden_reason is None or str(getattr(x, "casket_id", "") or "").strip()]
        if keyword:
            rows = [x for x in rows if keyword in self._item_search_text(x)]
        if self.selected_rarity_filters and len(self.selected_rarity_filters) < len(self._rarity_filter_vars):
            rows = [x for x in rows if self._rarity_name(x.rarity) in self.selected_rarity_filters]
        if self.selected_collection_filters and len(self.selected_collection_filters) < len(self._collection_filter_values):
            rows = [x for x in rows if str(x.collection).strip() in self.selected_collection_filters]
        if wear_valid:
            if wear_min is not None:
                rows = [x for x in rows if x.float_value >= wear_min]
            if wear_max is not None:
                rows = [x for x in rows if x.float_value <= wear_max]
        rows = sorted(
            rows,
            key=lambda x: (
                (-x.rarity if rarity_mode == "desc" else x.rarity),
                (-x.float_value if wear_mode == "desc" else x.float_value),
                x.asset_id,
            ),
        )
        no_wear_rows = sorted(no_wear_rows, key=lambda x: x.asset_id)
        self.filtered_entries = rows + no_wear_rows
        self._filter_cache_key = cache_key
        self._filter_cache_rows = self.filtered_entries

    def _schedule_refresh(self):
        if self._search_after_id:
            self.after_cancel(self._search_after_id)
        self._search_after_id = self.after(180, self._refresh_view)

    def _set_refresh_busy(self, busy: bool):
        self._refreshing = busy
        self.refresh_btn.configure(state="disabled" if busy else "normal")
        if not busy:
            self._clear_refresh_phase()
        if callable(self.on_refreshing_changed):
            try:
                self.on_refreshing_changed(bool(busy))
            except Exception:
                pass

    def _disconnect_active_client(self, *, disconnect_cached_session: bool):
        self.session_manager.disconnect_active(disconnect_cached_session=disconnect_cached_session)
        self._update_connection_ui()

    def shutdown(self):
        self._shutdown_event.set()
        self._set_refresh_busy(False)
        self._disconnect_active_client(disconnect_cached_session=True)
        try:
            self._executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            self._executor.shutdown(wait=False)

    def on_page_shown(self):
        self._refresh_account_selector(prefer_username=self.selected_account_username)
        target = (
            self.selected_account_username
            or self.current_username
            or self._ui_state.get("last_selected_username")
            or self._selected_username_from_selector()
        )
        if target:
            self._switch_account_view(target, auto_refresh_if_stale=False, force_refresh=False)
        else:
            self._set_no_account_state()

    def _set_no_account_state(self):
        self._disconnect_active_client(disconnect_cached_session=True)
        self.current_username = None
        self.current_password = ""
        self.selected_account_username = None
        self.entries = []
        self.filtered_entries = []
        self._refresh_collection_filter_options()
        self._refresh_component_controls()
        self.snapshot_path = None
        self.current_account_var.set("当前账号：未选择")
        self.path_var.set("快照：未选择")
        self.fetch_time_var.set("库存获取时间：-")
        self.summary_var.set("请选用一个账号")
        self._empty_hint = "请选用一个账号"
        self._refresh_account_selector(prefer_username=None)
        self._update_connection_ui()
        self._refresh_view()
        if callable(self.on_active_account_changed):
            self.on_active_account_changed(None)

    def use_account(self, username: str) -> tuple[bool, str]:
        if self._refreshing:
            return False, "库存刷新中，请稍后再试"

        info = AccountStore().get(username)
        if not info:
            return False, f"账号不存在：{username}"

        password = str(info.get("password", "")).strip()
        if not password:
            return False, "该账号未保存密码，请先更新账号信息"
        self._switch_account_view(username, auto_refresh_if_stale=True, force_refresh=True)
        return True, f"正在使用账号：{username}"

    def on_account_deleted(self, username: str) -> tuple[bool, str]:
        username = str(username or "").strip()
        if not username:
            return False, "删除失败：账号为空"
        if self._refreshing:
            return False, "库存刷新中，请稍后再删除账号"

        # 删除账号时，确保清理该账号连接与本地 UI 缓存。
        try:
            disconnect_account(username)
        except Exception:
            pass

        accounts_state = self._ui_state.get("accounts", {})
        if isinstance(accounts_state, dict):
            accounts_state.pop(username, None)
        if self._ui_state.get("last_selected_username") == username:
            self._ui_state["last_selected_username"] = None
        self._save_ui_state()

        should_reset = (
            self.current_username == username
            or self.selected_account_username == username
            or self._get_active_client_pair()[1] == username
        )
        if should_reset:
            self._set_no_account_state()
            return True, f"已删除账号：{username}"

        self._refresh_account_selector(prefer_username=self.selected_account_username)
        self._update_connection_ui()
        return True, f"已删除账号：{username}"

    def _start_refresh(self, username: str, password: str):
        if self._shutdown_event.is_set():
            return
        self._set_refresh_busy(True)
        self._empty_hint = "正在获取库存，请稍候..."
        self._last_refresh_click_ts = time.time()
        logger.info("start inventory refresh: username=%s", username)
        if self._is_username_connected(username):
            self._set_refresh_phase("连接状态：已连接（刷新中）")
            self.summary_var.set("已连接，正在刷新库存...")
        else:
            self._set_refresh_phase("连接状态：连接中")
            self.summary_var.set("正在建立连接并刷新库存...")
        self._executor.submit(self._refresh_inventory_worker, username, password)

    def _on_refresh_inventory_clicked(self):
        if self._refreshing:
            return
        now = time.time()
        remaining = 10 - (now - self._last_refresh_click_ts)
        if remaining > 0:
            self.summary_var.set(f"刷新过于频繁，请在 {int(remaining) + 1}s 后再试")
            return

        target_username = self.selected_account_username or self.current_username
        if not target_username:
            self.summary_var.set("请选用一个账号")
            self._empty_hint = "请选用一个账号"
            self._refresh_view()
            return
        if self.current_username != target_username:
            self.current_username = target_username
            self.current_password = ""
        if not self.current_password:
            info = AccountStore().get(target_username)
            self.current_password = str((info or {}).get("password", "")).strip()
        if not self.current_password:
            self.summary_var.set("当前账号缺少密码，请先在账号管理更新")
            return
        self.summary_var.set("正在刷新库存，请稍候...")
        self._start_refresh(target_username, self.current_password)

    def _refresh_inventory_worker(self, username: str, password: str):
        if self._shutdown_event.is_set():
            return
        logger.info("refresh worker started: username=%s", username)
        try:
            active_client = self.session_manager.get_or_connect(
                username,
                password,
                stop_event=self._shutdown_event,
                post_progress=self._post_refresh_progress,
            )
            if active_client is None:
                raise RuntimeError("active client unavailable")
            else:
                self._post_refresh_progress(username, "正在拉取最新库存数据...", "连接状态：已连接（刷新中）")

            if self._shutdown_event.is_set():
                return

            try:
                self._post_refresh_progress(username, "正在加载组件内容...", "连接状态：已连接（刷新中）")
                self.component_manager.preload_component_contents(active_client)
            except Exception:
                pass

            if self._shutdown_event.is_set():
                return
            self._post_refresh_progress(username, "正在读取 SO 库存缓存...", "连接状态：已连接（刷新中）")
            excluded_records: list[dict] = []
            items = get_inventory(
                active_client,
                self.loader.schema,
                dump_raw_path=None,
                excluded_records=excluded_records,
            )
            if self._shutdown_event.is_set():
                return
            self._post_refresh_progress(username, "正在写入库存快照...", "连接状态：已连接（刷新中）")
            rows = self.loader.from_live_items(items, excluded_records=excluded_records)
            snapshot_path, _saved_rows = save_processed_inventory_snapshot(items, excluded_records=excluded_records)
            logger.info("refresh worker completed: username=%s items=%d", username, len(rows))
            self._safe_after(lambda: self._on_refresh_inventory_done(True, username, password, rows, snapshot_path, "刷新成功"))
        except Exception as exc:
            if self._shutdown_event.is_set():
                return
            logger.exception("refresh worker failed: username=%s error=%s", username, exc)
            # 当前账号刷新失败时丢弃连接，避免后续复用异常连接
            self.session_manager.drop_if_username(username, disconnect_cached_session=True)
            err_message = format_exception_message("刷新失败", exc)
            self._safe_after(
                lambda msg=err_message: self._on_refresh_inventory_done(
                    False, username, password, [], None, msg
                )
            )

    def _on_refresh_inventory_done(self, success: bool, username: str, password: str, rows: list[InventoryEntry], snapshot_path: Path | None, message: str):
        self._set_refresh_busy(False)
        logger.info("refresh done: username=%s success=%s message=%s rows=%d", username, success, message, len(rows))
        if success:
            now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            self.current_username = username
            self.selected_account_username = username
            self.current_password = password
            AccountStore().set_active(username)
            self.current_account_var.set(f"当前账号：{username}")
            if callable(self.on_active_account_changed):
                self.on_active_account_changed(username)
            self.entries = rows
            self._refresh_collection_filter_options()
            self._refresh_component_controls()
            self.snapshot_path = snapshot_path
            if snapshot_path is not None:
                self.path_var.set(f"快照：{snapshot_path}")
            self.fetch_time_var.set(f"库存获取时间：{now_text}")
            accounts_state = self._ui_state.setdefault("accounts", {})
            account_state = accounts_state.setdefault(username, {})
            account_state["snapshot_path"] = str(snapshot_path) if snapshot_path is not None else ""
            account_state["fetch_time"] = now_text
            self._ui_state["last_selected_username"] = username
            self._save_ui_state()
            self._refresh_account_selector(prefer_username=username)
            self._update_connection_ui()
            self._empty_hint = "当前条件下无物品"
            self._refresh_view()
            self.summary_var.set(f"{message}，共 {len(rows)} 条")
            return
        self.selected_account_username = username
        self.current_username = username
        self.current_password = password
        self._refresh_account_selector(prefer_username=username)
        self._show_cached_inventory(username)
        self._update_connection_ui()
        self.summary_var.set(message)

    def _on_cards_canvas_configure(self, _event):
        if abs(self.cards_canvas.winfo_width() - self._last_calibrated_width) > 8:
            self._card_height_calibrated = False
        self._schedule_virtual_refresh(immediate=True)

    def _on_cards_scrollbar(self, *args):
        self.cards_canvas.yview(*args)
        self._update_scroll_speed()
        self._schedule_virtual_refresh(immediate=True)

    def _on_cards_yview(self, first, last):
        self.cards_ybar.set(first, last)
        self._update_scroll_speed()
        self._schedule_virtual_refresh(immediate=False)

    def _on_mouse_wheel_cards(self, event):
        delta = getattr(event, "delta", 0)
        if delta:
            steps = -int(delta / 120) if abs(delta) >= 120 else (-1 if delta > 0 else 1)
            if steps == 0:
                steps = -1 if delta > 0 else 1
            self.cards_canvas.yview_scroll(steps, "units")
        else:
            num = getattr(event, "num", 0)
            if num == 4:
                self.cards_canvas.yview_scroll(-3, "units")
            elif num == 5:
                self.cards_canvas.yview_scroll(3, "units")
        self._update_scroll_speed()
        self._schedule_virtual_refresh(immediate=True)
        return "break"

    def _update_scroll_speed(self):
        now = time.perf_counter()
        top = self.cards_canvas.canvasy(0)
        dt = now - self._last_scroll_at
        if dt > 0:
            instant = abs(top - self._last_scroll_top) / dt
            self._scroll_speed_px_s = self._scroll_speed_px_s * 0.65 + instant * 0.35
        self._last_scroll_at = now
        self._last_scroll_top = top

    def _adaptive_preheat_rows(self, cols: int) -> int:
        idle = time.perf_counter() - self._last_scroll_at
        speed = self._scroll_speed_px_s
        if idle > 0.2:
            speed *= 0.5
        if idle > 0.6:
            speed *= 0.35

        max_rows = max(2, PREHEAT_CARDS // max(1, cols))
        if speed < 900:
            rows = 2
        elif speed < 2200:
            rows = 4
        elif speed < 4200:
            rows = 7
        else:
            rows = 10
        return min(max_rows, rows)

    def _calibrate_card_height(self, card_w: int, start_idx: int):
        if not self.filtered_entries:
            return
        # 使用轻量估算替代控件测量，避免高频布局开销
        end_probe = min(len(self.filtered_entries), start_idx + 80)
        sample_rows = self.filtered_entries[start_idx:end_probe] or self.filtered_entries[:1]
        sample_item = max(sample_rows, key=lambda x: len(self._item_display_name(x)))
        chars_per_line = max(12, int((card_w - 20) / 7.2))
        display_name = self._item_display_name(sample_item)
        name_lines = max(1, (len(display_name) + chars_per_line - 1) // chars_per_line)
        measured = 102 + (name_lines - 1) * 16
        measured = max(self.card_min_height, min(self.card_max_height, measured))
        self.card_height = int(round(self.card_height * 0.7 + measured * 0.3))
        self._card_height_calibrated = True
        self._last_calibrated_width = self.cards_canvas.winfo_width()

    def _schedule_virtual_refresh(self, immediate: bool):
        if self.mode_var.get() != "cards":
            return
        if self._virtual_after_id:
            self.after_cancel(self._virtual_after_id)
        if immediate:
            elapsed = time.perf_counter() - self._last_virtual_refresh_at
            delay = 0 if elapsed >= 0.016 else max(1, int((0.016 - elapsed) * 1000))
        else:
            delay = 16
        self._virtual_after_id = self.after(delay, self._refresh_virtual_cards)

    def _ensure_card_pool(self, size: int):
        while len(self.card_pool) < size:
            card = self._create_card_widget()
            self.card_pool.append(card)
        while len(self.card_pool) > size:
            card = self.card_pool.pop()
            for key in ("rect", "name", "asset", "def", "qr", "float", "hidden"):
                self.cards_canvas.delete(card[key])

    def _create_card_widget(self) -> dict:
        rect = self.cards_canvas.create_rectangle(0, 0, 0, 0, outline="#cfd6df", width=1, fill="#fff", state="hidden")
        name = self.cards_canvas.create_text(0, 0, anchor="nw", font=("Microsoft YaHei UI", 9, "bold"), fill="#111", width=0, state="hidden")
        asset = self.cards_canvas.create_text(0, 0, anchor="nw", font=("Microsoft YaHei UI", 9), fill="#222", width=0, state="hidden")
        def_line = self.cards_canvas.create_text(0, 0, anchor="nw", font=("Microsoft YaHei UI", 9), fill="#222", width=0, state="hidden")
        qr = self.cards_canvas.create_text(0, 0, anchor="nw", font=("Microsoft YaHei UI", 9), fill="#222", width=0, state="hidden")
        float_line = self.cards_canvas.create_text(0, 0, anchor="nw", font=("Microsoft YaHei UI", 9), fill="#222", width=0, state="hidden")
        hidden = self.cards_canvas.create_text(0, 0, anchor="nw", font=("Microsoft YaHei UI", 9), fill="#b54708", width=0, state="hidden")
        return {
            "rect": rect,
            "name": name,
            "asset": asset,
            "def": def_line,
            "qr": qr,
            "float": float_line,
            "hidden": hidden,
            "index": -1,
            "compact": False,
            "asset_id": None,
        }

    def _hide_card(self, card: dict):
        for key in ("rect", "name", "asset", "def", "qr", "float", "hidden"):
            self.cards_canvas.itemconfigure(card[key], state="hidden")

    def _layout_card(self, card: dict, x: int, y: int, w: int, h: int):
        self.cards_canvas.coords(card["rect"], x, y, x + w, y + h)

        text_x = x + 8
        line_y = y + 8
        line_h = 20
        text_w = max(160, w - 16)

        for key in ("name", "asset", "def", "qr", "float", "hidden"):
            self.cards_canvas.itemconfigure(card[key], width=text_w)

        self.cards_canvas.coords(card["name"], text_x, line_y)
        self.cards_canvas.coords(card["asset"], text_x, line_y + line_h)
        self.cards_canvas.coords(card["def"], text_x, line_y + line_h * 2)
        self.cards_canvas.coords(card["qr"], text_x, line_y + line_h * 3)
        self.cards_canvas.coords(card["float"], text_x, line_y + line_h * 4)
        self.cards_canvas.coords(card["hidden"], text_x, line_y + line_h * 5)

    def _bind_card_data(self, card: dict, item: InventoryEntry, compact: bool):
        self.cards_canvas.itemconfigure(card["rect"], fill="#fff", state="normal")
        self.cards_canvas.itemconfigure(card["name"], text=self._item_display_name(item), fill="#111", width=max(180, self.card_width - 20), state="normal")
        self.cards_canvas.itemconfigure(card["asset"], text=f"Asset: {item.asset_id}", fill="#222", state="normal")
        if compact:
            self.cards_canvas.itemconfigure(card["def"], text="", fill="#222", state="hidden")
            self.cards_canvas.itemconfigure(card["qr"], text="", fill="#222", state="hidden")
            self.cards_canvas.itemconfigure(card["float"], text="", fill="#222", state="hidden")
            self.cards_canvas.itemconfigure(card["hidden"], text="", fill="#b54708", state="hidden")
        else:
            self.cards_canvas.itemconfigure(card["def"], text=f"皮肤编号: {item.paint_index}  种子: {item.paint_seed}", fill="#222", state="normal")
            self.cards_canvas.itemconfigure(card["qr"], text=f"品质/稀有度: {self._quality_name(item.quality)}({item.quality}) / {self._rarity_name(item.rarity)}({item.rarity})", fill="#222", state="normal")
            if self._item_has_wear(item):
                self.cards_canvas.itemconfigure(card["float"], text=f"磨损: {item.float_value:.6f}", fill="#222", state="normal")
            else:
                self.cards_canvas.itemconfigure(card["float"], text="", fill="#222", state="hidden")
            unlock_ts = self._cooling_unlock_ts(item)
            component_id = str(getattr(item, "casket_id", "") or "").strip()
            component_prefix = ""
            if component_id:
                component_prefix = f"组件: {self._component_name_by_id(component_id)}"
            if unlock_ts > 0:
                cooling_text = f"（冷却中 {self._cooldown_end_text(unlock_ts)} 结束）"
                cooldown_fill = "#c28f00"
                cooldown_text = f"{component_prefix} {cooling_text}".strip()
            else:
                cooldown_text = component_prefix if component_prefix else "冷却: 无"
                cooldown_fill = "#666"
            self.cards_canvas.itemconfigure(card["hidden"], text=cooldown_text, fill=cooldown_fill, state="normal")

    def _refresh_virtual_cards(self):
        self._virtual_after_id = None
        if self.mode_var.get() != "cards":
            return

        total = len(self.filtered_entries)
        canvas_h = max(1, self.cards_canvas.winfo_height())
        canvas_w = max(1, self.cards_canvas.winfo_width())

        if total <= 0:
            self._ensure_card_pool(0)
            self.cards_canvas.configure(scrollregion=(0, 0, canvas_w, canvas_h))
            if self.empty_text_id is not None:
                self.cards_canvas.itemconfigure(self.empty_text_id, text=self._empty_hint, state="normal")
            self._update_summary(visible_start=0, visible_end=0)
            return

        if self.empty_text_id is not None:
            self.cards_canvas.itemconfigure(self.empty_text_id, state="hidden")

        cols = self.card_columns
        gap_x = self.card_gap_x
        gap_y = self.card_gap_y

        card_w = max(260, int((canvas_w - gap_x * (cols + 1)) / cols))
        self.card_width = card_w

        top_y = self.cards_canvas.canvasy(0)
        row_height = self.card_height + gap_y
        if (not self._card_height_calibrated) or abs(canvas_w - self._last_calibrated_width) > 8:
            rough_row = max(0, int((top_y - gap_y) // max(1, row_height)))
            self._calibrate_card_height(card_w, rough_row * cols)
            row_height = self.card_height + gap_y

        total_rows = (total + cols - 1) // cols
        content_h = gap_y + total_rows * row_height
        self.cards_canvas.configure(scrollregion=(0, 0, canvas_w, max(content_h, canvas_h)))

        start_row = max(0, int((top_y - gap_y) // row_height) - self.pool_extra_rows)
        visible_rows = (canvas_h // row_height) + 1 + self.pool_extra_rows * 2

        # 预热策略：基于滚动速度自适应扩大缓冲行，快速拖拽时减少空白
        preheat_rows = self._adaptive_preheat_rows(cols)
        visible_rows += preheat_rows

        start_idx = start_row * cols
        end_idx = min(total, start_idx + visible_rows * cols)
        needed = max(0, end_idx - start_idx)

        self._ensure_card_pool(needed)
        compact_mode = (time.perf_counter() - self._last_scroll_at) < 0.22 and self._scroll_speed_px_s > 3200

        for i, card in enumerate(self.card_pool):
            item_idx = start_idx + i
            if item_idx >= end_idx:
                self._hide_card(card)
                card["index"] = -1
                card["asset_id"] = None
                continue

            item = self.filtered_entries[item_idx]
            if (
                card["index"] != item_idx
                or card["compact"] != compact_mode
                or card.get("asset_id") != item.asset_id
            ):
                self._bind_card_data(card, item, compact=compact_mode)
                card["index"] = item_idx
                card["compact"] = compact_mode
                card["asset_id"] = item.asset_id

            r = item_idx // cols
            c = item_idx % cols
            x = gap_x + c * (card_w + gap_x)
            y = gap_y + r * row_height

            self._layout_card(card, x, y, card_w, self.card_height)

        self._update_summary(visible_start=start_idx, visible_end=end_idx)
        self._last_virtual_refresh_at = time.perf_counter()

    def _update_summary(self, visible_start: int = 0, visible_end: int = 0):
        total = len(self.entries)
        shown = len(self.filtered_entries)

        if self.mode_var.get() == "cards":
            display_start = visible_start + 1 if visible_end > visible_start else 0
            self.summary_var.set(f"匹配 {shown}/{total}，可见 {display_start}-{visible_end}")
        else:
            self.summary_var.set(f"匹配 {shown}/{total}")

    def _refresh_view(self):
        self._search_after_id = None
        self._apply_filter()
        self._update_component_panel_visibility()

        if self.mode_var.get() == "grouped":
            self.grouped_view.tkraise()
            self._render_grouped()
            self._update_summary()
        else:
            self._card_height_calibrated = False
            self.cards_view.tkraise()
            self._schedule_virtual_refresh(immediate=True)

    def _build_group_rows(self, wear_mode: str, rarity_mode: str) -> tuple[tuple, list[dict[str, Any]]]:
        rows_key = (self._rows_stamp(self.filtered_entries), wear_mode, rarity_mode)
        if rows_key == self._group_rows_cache_key:
            return rows_key, self._group_rows_cache

        groups: dict[str, list[InventoryEntry]] = defaultdict(list)
        for item in self.filtered_entries:
            groups[self._item_display_name(item)].append(item)

        wear_groups: list[tuple[str, list[InventoryEntry]]] = []
        no_wear_groups: list[tuple[str, list[InventoryEntry]]] = []
        for name, items in groups.items():
            if any(self._item_has_wear(it) for it in items):
                wear_groups.append((name, items))
            else:
                no_wear_groups.append((name, items))

        wear_rows = sorted(
            wear_groups,
            key=lambda x: (
                (-max(it.rarity for it in x[1]) if rarity_mode == "desc" else max(it.rarity for it in x[1])),
                x[0].lower(),
            ),
        )
        # 无磨损组固定置底，不参与上面的稀有度排序。
        no_wear_rows = sorted(no_wear_groups, key=lambda x: x[0].lower())
        merged_rows = wear_rows + no_wear_rows

        computed: list[dict[str, Any]] = []
        for name, items in merged_rows:
            cooling_count = sum(1 for x in items if self._cooling_unlock_ts(x) > 0)
            available_count = len(items) - cooling_count
            has_wear = any(self._item_has_wear(x) for x in items)
            needs_expand = self._group_needs_expand(items)
            if needs_expand:
                child_rows = sorted(
                    items,
                    key=lambda x: (
                        (-x.float_value if wear_mode == "desc" else x.float_value),
                        x.asset_id,
                    ),
                )
            else:
                child_rows = []

            computed.append(
                {
                    "name": name,
                    "items": items,
                    "parent_rarity": self._rarity_name(items[0].rarity),
                    "collection": self._group_collection_text(items),
                    "available_count": available_count,
                    "cooling_count": cooling_count,
                    "has_wear": has_wear,
                    "wear_range_text": (
                        f"{min(x.float_value for x in items):.6f}~{max(x.float_value for x in items):.6f}" if has_wear else ""
                    ),
                    "cooldown_text": self._group_cooldown_text(items),
                    "needs_expand": needs_expand,
                    "child_rows": child_rows,
                }
            )

        self._group_rows_cache_key = rows_key
        self._group_rows_cache = computed
        return rows_key, computed

    def _render_grouped(self):
        wear_mode = self.wear_sort_var.get().strip()
        rarity_mode = self.rarity_sort_var.get().strip()
        rows_key, grouped_rows = self._build_group_rows(wear_mode, rarity_mode)

        # 条件未变化时，直接复用当前树，避免重复重建控件导致卡顿。
        if rows_key == self._group_render_cache_key:
            return

        open_group_names: set[str] = set()
        for rid in self.group_tree.get_children():
            try:
                if bool(self.group_tree.item(rid, "open")):
                    values = self.group_tree.item(rid, "values") or ()
                    if values:
                        open_group_names.add(str(values[0]))
            except Exception:
                pass

        for rid in self.group_tree.get_children():
            self.group_tree.delete(rid)
        if not grouped_rows:
            self._group_render_cache_key = rows_key
            return

        for row in grouped_rows:
            name = str(row["name"])
            items: list[InventoryEntry] = row["items"]
            parent_rarity = str(row["parent_rarity"])
            available_count = int(row["available_count"])
            cooling_count = int(row["cooling_count"])
            needs_expand = bool(row["needs_expand"])
            parent = self.group_tree.insert(
                "",
                "end",
                text=parent_rarity,
                values=(
                    name,
                    str(row["collection"]),
                    f"{available_count}/{cooling_count}",
                    "",
                    str(row["wear_range_text"]),
                    str(row["cooldown_text"]),
                ),
                open=(name in open_group_names and needs_expand),
            )
            if not needs_expand:
                continue

            for item in row["child_rows"]:
                self.group_tree.insert(
                    parent,
                    "end",
                    text="",
                    values=(
                        f"Asset {item.asset_id}",
                        "",
                        "",
                        f"{item.paint_seed}",
                        (f"{item.float_value:.6f}" if self._item_has_wear(item) else ""),
                        self._cooldown_text(item, compact=False),
                    ),
                )
        self._group_render_cache_key = rows_key


class CraftPlaceholderPage(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=12)
        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)
        holder = ttk.Frame(self)
        holder.grid(row=0, column=0, sticky="nsew")
        holder.columnconfigure(0, weight=1)
        holder.rowconfigure((0, 1), weight=1)
        ttk.Label(holder, text="炼金汰换页面（占位）", font=("Microsoft YaHei UI", 18, "bold"), foreground="#1d3557").grid(row=0, column=0, sticky="s", pady=(120, 8))
        ttk.Label(holder, text="该页面先保留占位，后续按你的指令实现。", foreground="#555").grid(row=1, column=0, sticky="n")


class MainUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("CS2 管理界面")
        self.geometry("1320x780")
        self.minsize(1100, 700)
        self._closing = False
        self.columnconfigure(1, weight=1)
        self.rowconfigure(0, weight=1)
        self.pages: dict[str, ttk.Frame] = {}
        self.nav_buttons: dict[str, ttk.Button] = {}
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self._build_nav()
        self._build_workspace()
        self.show_page("account")

    def _build_nav(self):
        nav = tk.Frame(self, bg="#f2f6fb", bd=1, relief="solid")
        nav.grid(row=0, column=0, sticky="ns")
        nav.configure(width=210)
        nav.pack_propagate(False)
        tk.Label(nav, text="功能导航", bg="#f2f6fb", fg="#1d3557", font=("Microsoft YaHei UI", 13, "bold")).pack(fill="x", padx=12, pady=(14, 8))
        for key, title in (("account", "账号管理"), ("inventory", "库存总览"), ("craft", "炼金汰换")):
            btn = ttk.Button(nav, text=title, command=lambda k=key: self.show_page(k))
            btn.pack(fill="x", padx=12, pady=6)
            self.nav_buttons[key] = btn

    def _build_workspace(self):
        workspace = ttk.Frame(self, padding=8)
        workspace.grid(row=0, column=1, sticky="nsew")
        workspace.columnconfigure(0, weight=1)
        workspace.rowconfigure(0, weight=1)
        inventory_page = InventoryOverviewPage(workspace)
        account_page = AccountManagementPage(
            workspace,
            on_use_account=inventory_page.use_account,
            on_delete_account=inventory_page.on_account_deleted,
        )
        inventory_page.on_active_account_changed = account_page.on_active_account_changed
        inventory_page.on_refreshing_changed = account_page.on_inventory_refreshing_changed
        craft_page = CraftPlaceholderPage(workspace)
        pages = {
            "account": account_page,
            "inventory": inventory_page,
            "craft": craft_page,
        }
        for key, page in pages.items():
            page.grid(row=0, column=0, sticky="nsew")
            self.pages[key] = page

    def show_page(self, key: str):
        if key not in self.pages:
            return
        page = self.pages[key]
        if hasattr(page, "on_page_shown"):
            page.on_page_shown()
        page.tkraise()
        for name, btn in self.nav_buttons.items():
            btn.state(["disabled"] if name == key else ["!disabled"])

    def _on_close(self):
        if self._closing:
            return
        self._closing = True
        logger.info("UI closing: begin disconnect flow")
        try:
            inventory_page = self.pages.get("inventory")
            if inventory_page and hasattr(inventory_page, "shutdown"):
                try:
                    inventory_page.shutdown()
                except Exception:
                    pass
            username = getattr(inventory_page, "current_username", None) if inventory_page else None
            if username:
                try:
                    disconnect_account(username)
                except Exception:
                    pass
            try:
                disconnect_all()
            except Exception:
                pass
        finally:
            logger.info("UI closing: destroy window")
            self.destroy()

    def report_callback_exception(self, exc, val, tb):
        # Tk 回调异常兜底：打印异常并保持界面进程存活
        traceback.print_exception(exc, val, tb)
        try:
            inventory_page = self.pages.get("inventory")
            if inventory_page is not None and hasattr(inventory_page, "summary_var"):
                error_obj = val if isinstance(val, BaseException) else RuntimeError(str(val))
                inventory_page.summary_var.set(format_exception_message("界面回调异常", error_obj))
        except Exception:
            pass


def main():
    configure_ui_logging()
    logger.info("main_ui starting")
    app = MainUI()
    app.mainloop()


if __name__ == "__main__":
    main()
