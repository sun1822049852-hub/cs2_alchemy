"""
测试新的登录流程

使用方法：
1. 首次登录：python test_login.py
2. 输入账号密码和手机令牌
3. 登录成功后，login_key 和 sentry 会自动保存
4. 再次运行：python test_login.py
5. 应该自动登录，无需输入令牌
"""
import logging
logging.basicConfig(level=logging.DEBUG, format='%(name)s %(levelname)s %(message)s')

from auth import login, login_with_totp

def test_login():
    username = input("Steam 用户名: ").strip()
    password = input("密码: ").strip()

    print("\n尝试使用 login_key 自动登录...")
    try:
        client = login(username, password)
        print(f"\n✓ 自动登录成功！")
        print(f"  用户名: {client.username}")
        print(f"  Steam ID: {client.steam_id}")
        print(f"  已登录: {client.logged_on}")
        client.disconnect()
        return
    except ValueError as e:
        print(f"\n自动登录失败: {e}")
        print("需要首次初始化登录\n")
    except Exception as e:
        print(f"\n登录错误: {e}\n")
        return

    # 首次登录
    totp = input("请输入手机令牌验证码（5位）: ").strip()
    try:
        client = login_with_totp(username, password, totp)
        print(f"\n✓ 首次登录成功！")
        print(f"  用户名: {client.username}")
        print(f"  Steam ID: {client.steam_id}")
        print(f"  已登录: {client.logged_on}")
        print(f"\nlogin_key 和 sentry 已保存，下次可以自动登录")
        client.disconnect()
    except Exception as e:
        print(f"\n登录失败: {e}")

if __name__ == "__main__":
    test_login()
