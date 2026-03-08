import json
import threading
import tkinter as tk
from pathlib import Path
from tkinter import ttk

from auth import login_with_totp

ACCOUNTS_FILE = Path("accounts.json")


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
        if "accounts" not in data or not isinstance(data["accounts"], dict):
            data["accounts"] = {}
        if "active" not in data:
            data["active"] = None

        # 兼容旧结构：补齐 remark
        for username, info in data["accounts"].items():
            if not isinstance(info, dict):
                data["accounts"][username] = {"password": "", "remark": username}
                continue
            info.setdefault("password", "")
            info.setdefault("remark", username)
        return data

    def save(self):
        self.file_path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

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

    def upsert(self, username: str, password: str, remark: str):
        self._data["accounts"][username] = {
            "password": password,
            "remark": remark or username,
        }
        self._data["active"] = username
        self.save()

    def update_remark(self, username: str, remark: str):
        if username not in self._data["accounts"]:
            return
        self._data["accounts"][username]["remark"] = remark or username
        self.save()


class LoginUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("CS2 登录管理")
        self.geometry("980x620")
        self.minsize(900, 560)

        self.store = AccountStore()
        self.selected_username: str | None = None
        self._remark_auto = True
        self._updating_remark = False

        self.username_var = tk.StringVar()
        self.password_var = tk.StringVar()
        self.totp_var = tk.StringVar()
        self.remark_var = tk.StringVar()
        self.status_var = tk.StringVar(value="准备就绪")

        self.username_var.trace_add("write", self._on_username_change)

        self._build_ui()
        self._render_saved_accounts()

    def _build_ui(self):
        self.columnconfigure(0, weight=3)
        self.columnconfigure(1, weight=2)
        self.rowconfigure(0, weight=1)

        left = ttk.Frame(self, padding=16)
        left.grid(row=0, column=0, sticky="nsew")
        left.columnconfigure(0, weight=1)

        title = ttk.Label(left, text="登录流程", font=("Microsoft YaHei UI", 16, "bold"))
        title.grid(row=0, column=0, sticky="w", pady=(0, 12))

        form = ttk.Frame(left)
        form.grid(row=1, column=0, sticky="ew")
        form.columnconfigure(0, weight=0)
        form.columnconfigure(1, weight=1)

        ttk.Label(form, text="Steam 账号").grid(row=0, column=0, sticky="w", padx=(0, 10), pady=8)
        self.username_entry = ttk.Entry(form, textvariable=self.username_var)
        self.username_entry.grid(row=0, column=1, sticky="ew", pady=8)

        ttk.Label(form, text="密码").grid(row=1, column=0, sticky="w", padx=(0, 10), pady=8)
        self.password_entry = ttk.Entry(form, textvariable=self.password_var, show="*")
        self.password_entry.grid(row=1, column=1, sticky="ew", pady=8)

        ttk.Label(form, text="令牌码").grid(row=2, column=0, sticky="w", padx=(0, 10), pady=8)
        self.totp_entry = ttk.Entry(form, textvariable=self.totp_var)
        self.totp_entry.grid(row=2, column=1, sticky="ew", pady=8)

        ttk.Label(form, text="备注名").grid(row=3, column=0, sticky="w", padx=(0, 10), pady=8)
        self.remark_entry = ttk.Entry(form, textvariable=self.remark_var)
        self.remark_entry.grid(row=3, column=1, sticky="ew", pady=8)
        self.remark_entry.bind("<KeyRelease>", self._on_remark_edited)

        btn_row = ttk.Frame(left)
        btn_row.grid(row=2, column=0, sticky="ew", pady=(14, 10))
        btn_row.columnconfigure(0, weight=1)
        btn_row.columnconfigure(1, weight=1)
        btn_row.columnconfigure(2, weight=1)

        self.login_btn = ttk.Button(btn_row, text="登录并保存", command=self._on_login_clicked)
        self.login_btn.grid(row=0, column=0, sticky="ew", padx=(0, 8))

        self.remark_btn = ttk.Button(btn_row, text="保存备注", command=self._on_save_remark_clicked)
        self.remark_btn.grid(row=0, column=1, sticky="ew", padx=8)

        clear_btn = ttk.Button(btn_row, text="清空输入", command=self._clear_inputs)
        clear_btn.grid(row=0, column=2, sticky="ew", padx=(8, 0))

        tips = (
            "规则：\n"
            "1. 仅当成功获取 token 并登录成功后，才会保存账号。\n"
            "2. 失败不会保存账号，状态栏会显示失败原因。\n"
            "3. 备注名默认等于账号，可手动改。"
        )
        ttk.Label(left, text=tips, foreground="#444").grid(row=3, column=0, sticky="w", pady=(6, 6))

        status_wrap = ttk.Frame(left)
        status_wrap.grid(row=4, column=0, sticky="nsew", pady=(4, 0))
        status_wrap.columnconfigure(0, weight=1)
        left.rowconfigure(4, weight=1)

        ttk.Label(status_wrap, text="状态").grid(row=0, column=0, sticky="w")
        self.status_label = ttk.Label(
            status_wrap,
            textvariable=self.status_var,
            foreground="#0a5",
            wraplength=520,
            justify="left",
        )
        self.status_label.grid(row=1, column=0, sticky="nw", pady=(4, 0))

        right = ttk.Frame(self, padding=(10, 16, 16, 16))
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        right.rowconfigure(1, weight=1)

        ttk.Label(right, text="已保存账号", font=("Microsoft YaHei UI", 14, "bold")).grid(
            row=0, column=0, sticky="w", pady=(0, 10)
        )

        holder = ttk.Frame(right)
        holder.grid(row=1, column=0, sticky="nsew")
        holder.columnconfigure(0, weight=1)
        holder.rowconfigure(0, weight=1)

        self.canvas = tk.Canvas(holder, highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(holder, orient="vertical", command=self.canvas.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.cards_frame = ttk.Frame(self.canvas)
        self.canvas_window = self.canvas.create_window((0, 0), window=self.cards_frame, anchor="nw")

        self.cards_frame.bind("<Configure>", self._on_cards_configure)
        self.canvas.bind("<Configure>", self._on_canvas_configure)

    def _on_cards_configure(self, _event):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _on_canvas_configure(self, event):
        self.canvas.itemconfigure(self.canvas_window, width=event.width)

    def _render_saved_accounts(self):
        for child in self.cards_frame.winfo_children():
            child.destroy()

        rows = self.store.list_accounts()
        if not rows:
            empty = ttk.Label(self.cards_frame, text="暂无已保存账号", foreground="#666")
            empty.pack(fill="x", pady=8)
            return

        for row in rows:
            username = row["username"]
            remark = row["remark"]
            is_selected = username == self.selected_username
            is_active = row["is_active"]

            card = tk.Frame(
                self.cards_frame,
                bd=1,
                relief="solid",
                bg="#e6f2ff" if is_selected else "#ffffff",
                highlightthickness=0,
                padx=10,
                pady=8,
                cursor="hand2",
            )
            card.pack(fill="x", pady=4)

            top_text = remark + ("  (当前)" if is_active else "")
            top = tk.Label(
                card,
                text=top_text,
                font=("Microsoft YaHei UI", 10, "bold"),
                bg=card["bg"],
                fg="#1d3557",
                anchor="w",
            )
            top.pack(fill="x")

            bottom = tk.Label(
                card,
                text=username,
                font=("Microsoft YaHei UI", 8),
                bg=card["bg"],
                fg="#8a8a8a",
                anchor="w",
            )
            bottom.pack(fill="x", pady=(2, 0))

            for widget in (card, top, bottom):
                widget.bind("<Button-1>", lambda _e, u=username: self._on_account_selected(u))

    def _on_account_selected(self, username: str):
        info = self.store.get(username)
        if not info:
            return

        self.selected_username = username
        self._set_form_values(
            username=info["username"],
            password=info["password"],
            remark=info["remark"],
            keep_totp=False,
        )
        self.status_var.set(f"已选中账号：{info['remark']}（{username}）")
        self._set_status_color(success=True)
        self._render_saved_accounts()

    def _set_form_values(self, username: str, password: str, remark: str, keep_totp: bool):
        self._remark_auto = False
        self._updating_remark = True
        self.username_var.set(username)
        self.password_var.set(password)
        self.remark_var.set(remark)
        self._updating_remark = False
        if not keep_totp:
            self.totp_var.set("")

    def _clear_inputs(self):
        self.selected_username = None
        self._remark_auto = True
        self._updating_remark = True
        self.username_var.set("")
        self.password_var.set("")
        self.totp_var.set("")
        self.remark_var.set("")
        self._updating_remark = False
        self.status_var.set("输入已清空")
        self._set_status_color(success=True)
        self._render_saved_accounts()

    def _on_username_change(self, *_args):
        if not self._remark_auto:
            return
        if self._updating_remark:
            return
        self._updating_remark = True
        self.remark_var.set(self.username_var.get().strip())
        self._updating_remark = False

    def _on_remark_edited(self, _event):
        if self._updating_remark:
            return
        self._remark_auto = False

    def _on_save_remark_clicked(self):
        if not self.selected_username:
            self.status_var.set("请先在右侧选择一个已保存账号，再保存备注")
            self._set_status_color(success=False)
            return

        remark = self.remark_var.get().strip() or self.selected_username
        self.store.update_remark(self.selected_username, remark)
        self.status_var.set(f"备注已更新：{remark}")
        self._set_status_color(success=True)
        self._render_saved_accounts()

    def _set_busy(self, busy: bool):
        state = "disabled" if busy else "normal"
        self.login_btn.config(state=state)
        self.remark_btn.config(state=state)

    def _on_login_clicked(self):
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()
        totp = self.totp_var.get().strip()
        remark = self.remark_var.get().strip() or username

        if not username:
            self.status_var.set("请输入 Steam 账号")
            self._set_status_color(success=False)
            return
        if not password:
            self.status_var.set("请输入密码")
            self._set_status_color(success=False)
            return
        if not totp:
            self.status_var.set("请输入令牌码")
            self._set_status_color(success=False)
            return

        self._set_busy(True)
        self.status_var.set("正在登录并获取 token，请稍候...")
        self._set_status_color(success=True)

        worker = threading.Thread(
            target=self._login_worker,
            args=(username, password, totp, remark),
            daemon=True,
        )
        worker.start()

    def _login_worker(self, username: str, password: str, totp: str, remark: str):
        try:
            client = login_with_totp(username, password, totp)
            try:
                client.disconnect()
            except Exception:
                pass
            self.after(
                0,
                lambda: self._on_login_done(
                    success=True,
                    username=username,
                    password=password,
                    remark=remark,
                    message="登录成功，已获取并保存 token",
                ),
            )
        except Exception as e:
            self.after(
                0,
                lambda: self._on_login_done(
                    success=False,
                    username=username,
                    password=password,
                    remark=remark,
                    message=f"登录失败：{type(e).__name__}: {e}",
                ),
            )

    def _on_login_done(self, success: bool, username: str, password: str, remark: str, message: str):
        self._set_busy(False)
        if success:
            # 仅成功后持久化账号信息
            self.store.upsert(username=username, password=password, remark=remark or username)
            self.selected_username = username
            self._set_form_values(username=username, password=password, remark=remark or username, keep_totp=False)
            self.status_var.set(message)
            self._set_status_color(success=True)
            self._render_saved_accounts()
            return

        # 失败不保存，直接展示原因
        self.status_var.set(message)
        self._set_status_color(success=False)

    def _set_status_color(self, success: bool):
        self.status_label.configure(foreground="#0a5" if success else "#c1121f")


def main():
    app = LoginUI()
    app.mainloop()


if __name__ == "__main__":
    main()

