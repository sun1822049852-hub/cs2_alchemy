"""
测试自动登录功能（使用已保存的 refresh_token）
"""
import logging
import json
logging.basicConfig(level=logging.DEBUG, format='%(name)s %(levelname)s %(message)s')

from auth import login

# 读取已保存的账号
with open("login_keys.json", "r", encoding="utf-8") as f:
    tokens = json.load(f)
    if not tokens:
        print("没有保存的账号，请先运行 test_login.py 完成首次登录")
        exit(1)

    username = list(tokens.keys())[0]
    print(f"使用账号: {username}")

# 读取密码（虽然不会用到，但函数签名需要）
with open("accounts.json", "r", encoding="utf-8") as f:
    accounts = json.load(f)
    password = accounts["accounts"][username]["password"]

print("\n尝试使用 refresh_token 自动登录...")
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
