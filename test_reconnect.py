"""
测试断联后重连功能

测试场景：
1. 使用 refresh_token 登录
2. 保持连接 5 秒
3. 主动断开连接
4. 等待 2 秒
5. 使用相同的 refresh_token 重新连接
6. 验证是否能成功重连
"""
import logging
import time
import json
from pathlib import Path
import sys

# 设置标准输出编码为 UTF-8
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

logging.basicConfig(level=logging.INFO, format='%(name)s %(levelname)s %(message)s')

from auth import login

def test_reconnect():
    """测试断联后重连"""
    # 读取保存的账号
    login_keys_file = Path("login_keys.json")
    if not login_keys_file.exists():
        print("未找到 login_keys.json，请先运行首次登录")
        return

    tokens = json.loads(login_keys_file.read_text(encoding="utf-8"))
    if not tokens:
        print("login_keys.json 为空，请先运行首次登录")
        return

    username = list(tokens.keys())[0]

    # 读取密码（虽然不会用到，但函数签名需要）
    accounts_file = Path("accounts.json")
    if accounts_file.exists():
        accounts = json.loads(accounts_file.read_text(encoding="utf-8"))
        password = accounts["accounts"][username]["password"]
    else:
        password = ""  # refresh_token 模式不需要密码

    print(f"\n{'='*60}")
    print("第一次连接：使用 refresh_token 登录")
    print(f"{'='*60}")

    try:
        client = login(username, password)
        print(f"\n[OK] 第一次登录成功！")
        print(f"  用户名: {client.username}")
        print(f"  Steam ID: {client.steam_id}")
        print(f"  已登录: {client.logged_on}")

        # 保持连接 5 秒
        print("\n保持连接 5 秒...")
        time.sleep(5)
        print(f"  连接状态: {client.connected}")
        print(f"  登录状态: {client.logged_on}")

        # 主动断开
        print("\n主动断开连接...")
        client.disconnect()
        print("[OK] 已断开")

    except Exception as e:
        print(f"\n[FAIL] 第一次登录失败: {e}")
        import traceback
        traceback.print_exc()
        return

    # 等待 2 秒
    print("\n等待 2 秒后重连...")
    time.sleep(2)

    print(f"\n{'='*60}")
    print("第二次连接：断联后重连")
    print(f"{'='*60}")

    try:
        client = login(username, password)
        print(f"\n[OK] 重连成功！")
        print(f"  用户名: {client.username}")
        print(f"  Steam ID: {client.steam_id}")
        print(f"  已登录: {client.logged_on}")

        # 保持连接 10 秒测试稳定性
        print("\n保持连接 10 秒测试稳定性...")
        time.sleep(10)
        print(f"  连接状态: {client.connected}")
        print(f"  登录状态: {client.logged_on}")

        client.disconnect()
        print("\n[OK] 断联重连测试完成")

    except Exception as e:
        print(f"\n[FAIL] 重连失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_reconnect()
