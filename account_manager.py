import json
import sys
from pathlib import Path

ACCOUNTS_FILE = Path("accounts.json")


def _safe_input(prompt: str) -> str:
    while True:
        try:
            return input(prompt)
        except KeyboardInterrupt:
            print("\n检测到 Ctrl+C，是否退出程序？(y/n): ", end="", flush=True)
            try:
                confirm = input()
                if confirm.strip().lower() == 'y':
                    raise SystemExit(0)
                print()
            except KeyboardInterrupt:
                raise SystemExit(0)


class AccountManager:
    def __init__(self):
        self.accounts = self._load()

    def _load(self) -> dict:
        if ACCOUNTS_FILE.exists():
            return json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
        return {"accounts": {}, "active": None}

    def _save(self):
        ACCOUNTS_FILE.write_text(
            json.dumps(self.accounts, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    def get_active_name(self) -> str | None:
        active = self.accounts.get("active")
        if active and active in self.accounts["accounts"]:
            return active
        return None

    def get_active_credentials(self) -> tuple[str, str] | None:
        name = self.get_active_name()
        if name:
            info = self.accounts["accounts"][name]
            return name, info["password"]
        return None

    def add_account(self):
        """新增账号：输入账号密码 + 令牌码完成初始化登录，保存 login_key"""
        from auth import login_with_totp, _clear_refresh_token as _clear_login_key
        print("\n=== 新增账号 ===")
        try:
            username = _safe_input("Steam 用户名: ").strip()
            password = _safe_input("密码: ").strip()
        except EOFError:
            return

        # 先保存账号信息
        self.accounts["accounts"][username] = {"password": password}
        self.accounts["active"] = username
        self._save()

        # 立即做初始化登录，获取 login_key
        print(f"\n正在连接 Steam，请准备好手机令牌 App...")
        while True:
            totp = _safe_input("请输入手机令牌验证码（5位）: ").strip()
            try:
                client = login_with_totp(username, password, totp)
                client.disconnect()
                print(f"账号 {username} 初始化成功，login_key 已保存，后续无需令牌码")
                break
            except ValueError as e:
                print(f"登录失败：{e}")
                retry = _safe_input("重试？(y/n): ").strip().lower()
                if retry != 'y':
                    print("跳过初始化，下次进入炼金时仍需令牌码")
                    break
            except ConnectionError as e:
                print(f"网络错误：{e}")
                break

    def switch_account(self):
        """切换账号"""
        saved = self.accounts["accounts"]
        if not saved:
            print("暂无已保存账号")
            return

        print("\n=== 切换账号 ===")
        names = list(saved.keys())
        for i, name in enumerate(names):
            tag = " ← 当前" if name == self.accounts.get("active") else ""
            print(f"  {i + 1}. {name}{tag}")

        choice = _safe_input("\n请选择: ").strip()
        try:
            idx = int(choice) - 1
        except ValueError:
            print("无效输入")
            return

        if 0 <= idx < len(names):
            username = names[idx]
            self.accounts["active"] = username
            self._save()
            print(f"已切换到账号：{username}")
        else:
            print("无效选择")

    def delete_account(self):
        """删除账号"""
        saved = self.accounts["accounts"]
        if not saved:
            print("暂无已保存账号")
            return

        print("\n=== 删除账号 ===")
        names = list(saved.keys())
        for i, name in enumerate(names):
            tag = " ← 当前" if name == self.accounts.get("active") else ""
            print(f"  {i + 1}. {name}{tag}")

        choice = _safe_input("\n请选择要删除的账号: ").strip()
        try:
            idx = int(choice) - 1
        except ValueError:
            print("无效输入")
            return

        if 0 <= idx < len(names):
            username = names[idx]
            confirm = _safe_input(f"确认删除账号 {username}？(y/n): ").strip().lower()
            if confirm == 'y':
                from auth import _clear_refresh_token as _clear_login_key, disconnect_account
                disconnect_account(username)
                _clear_login_key(username)
                del self.accounts["accounts"][username]
                # 如果删除的是当前账号，清空 active
                if self.accounts.get("active") == username:
                    remaining = list(self.accounts["accounts"].keys())
                    self.accounts["active"] = remaining[0] if remaining else None
                self._save()
                print(f"账号 {username} 已删除")
        else:
            print("无效选择")

    def show_management_menu(self):
        """账号管理子菜单"""
        while True:
            print("\n=== 账号管理 ===")
            active = self.get_active_name()
            print(f"当前账号：{active or '无'}")
            print("  1. 切换账号")
            print("  2. 新增账号")
            print("  3. 删除账号")
            print("  0. 返回主菜单")

            choice = _safe_input("\n请选择: ").strip()
            if choice == '1':
                self.switch_account()
            elif choice == '2':
                self.add_account()
            elif choice == '3':
                self.delete_account()
            elif choice == '0':
                return
            else:
                print("无效选择")
