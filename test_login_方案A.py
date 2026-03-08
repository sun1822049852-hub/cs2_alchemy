"""
测试方案 A：使用 ValvePython/steam 原生的 login_key 参数

使用方法：
1. 首次登录：python test_login_方案A.py --init
   - 需要输入账号、密码、手机令牌
   - 成功后会保存 refresh_token

2. 自动登录：python test_login_方案A.py
   - 使用保存的 refresh_token 自动登录
   - 无需输入任何信息
"""
import logging
import sys
logging.basicConfig(level=logging.DEBUG, format='%(name)s %(levelname)s %(message)s')

from auth import login, login_with_totp

def test_init_login():
    """首次登录：获取并保存 refresh_token"""
    print("\n=== 首次登录（获取 refresh_token）===")
    username = input("Steam 用户名: ").strip()
    password = input("密码: ").strip()
    totp = input("手机令牌验证码（5位）: ").strip()

    try:
        client = login_with_totp(username, password, totp)
        print(f"\n✓ 首次登录成功！")
        print(f"  用户名: {client.username}")
        print(f"  Steam ID: {client.steam_id}")
        print(f"  已登录: {client.logged_on}")
        print(f"\nrefresh_token 已保存到 login_keys.json")
        print(f"下次可以直接运行: python test_login_方案A.py")

        # 保持连接 5 秒测试稳定性
        print("\n保持连接 5 秒测试稳定性...")
        import time
        time.sleep(5)
        print(f"  连接状态: {client.connected}")
        print(f"  登录状态: {client.logged_on}")

        client.disconnect()
        print("\n✓ 测试完成")
    except Exception as e:
        print(f"\n✗ 登录失败: {e}")
        import traceback
        traceback.print_exc()

def test_auto_login():
    """自动登录：使用保存的 refresh_token"""
    import json
    from pathlib import Path

    # 读取保存的账号
    login_keys_file = Path("login_keys.json")
    if not login_keys_file.exists():
        print("未找到 login_keys.json，请先运行首次登录：")
        print("  python test_login_方案A.py --init")
        return

    tokens = json.loads(login_keys_file.read_text(encoding="utf-8"))
    if not tokens:
        print("login_keys.json 为空，请先运行首次登录")
        return

    username = list(tokens.keys())[0]
    print(f"\n=== 自动登录（使用 refresh_token）===")
    print(f"使用账号: {username}")

    # 读取密码（虽然不会用到，但函数签名需要）
    accounts_file = Path("accounts.json")
    if accounts_file.exists():
        accounts = json.loads(accounts_file.read_text(encoding="utf-8"))
        password = accounts["accounts"][username]["password"]
    else:
        password = ""  # login_key 模式不需要密码

    try:
        client = login(username, password)
        print(f"\n✓ 自动登录成功！")
        print(f"  用户名: {client.username}")
        print(f"  Steam ID: {client.steam_id}")
        print(f"  已登录: {client.logged_on}")

        # 保持连接 10 秒测试稳定性
        print("\n保持连接 10 秒测试稳定性...")
        import time
        time.sleep(10)
        print(f"  连接状态: {client.connected}")
        print(f"  登录状态: {client.logged_on}")

        client.disconnect()
        print("\n✓ 测试完成")
    except Exception as e:
        print(f"\n✗ 登录失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--init":
        test_init_login()
    else:
        test_auto_login()
