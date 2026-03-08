"""
代理配置向导

帮助用户配置代理设置
"""
import os


def setup_proxy():
    """交互式代理配置"""
    print("=" * 70)
    print("代理配置向导")
    print("=" * 70)
    print()
    print("如果你在中国大陆或需要通过代理访问 Steam，请配置代理。")
    print()

    # 选择代理类型
    print("请选择代理类型:")
    print("  1. SOCKS5 代理（推荐，支持 Clash/V2Ray/SSR）")
    print("  2. SOCKS4 代理")
    print("  3. HTTP 代理")
    print("  4. 不使用代理（直连）")
    print()

    choice = input("请选择 (1-4): ").strip()

    if choice == '4':
        # 不使用代理
        config_content = """# CS2 炼金工具配置文件

# 代理设置
PROXY_URL = None
USE_PROXY = False

# 连接超时设置（秒）
CONNECT_TIMEOUT = 60

# 日志级别
LOG_LEVEL = "DEBUG"
"""
        with open("config.py", "w", encoding="utf-8") as f:
            f.write(config_content)
        print("\n✓ 配置已保存：不使用代理（直连）")
        return

    # 输入代理地址
    print()
    print("请输入代理服务器地址（例如：127.0.0.1）:")
    host = input("地址: ").strip() or "127.0.0.1"

    print()
    print("请输入代理服务器端口（例如：1080）:")
    port = input("端口: ").strip() or "1080"

    # 是否需要认证
    print()
    print("代理是否需要用户名和密码认证？(y/n)")
    need_auth = input("需要认证: ").strip().lower() == 'y'

    username = password = ""
    if need_auth:
        print()
        username = input("用户名: ").strip()
        password = input("密码: ").strip()

    # 生成代理 URL
    proxy_type_map = {
        '1': 'socks5',
        '2': 'socks4',
        '3': 'http',
    }
    proxy_type = proxy_type_map.get(choice, 'socks5')

    if need_auth and username:
        proxy_url = f"{proxy_type}://{username}:{password}@{host}:{port}"
    else:
        proxy_url = f"{proxy_type}://{host}:{port}"

    # 生成配置文件
    config_content = f"""# CS2 炼金工具配置文件

# 代理设置
PROXY_URL = "{proxy_url}"
USE_PROXY = True

# 连接超时设置（秒）
CONNECT_TIMEOUT = 60

# 日志级别
LOG_LEVEL = "DEBUG"
"""

    with open("config.py", "w", encoding="utf-8") as f:
        f.write(config_content)

    print()
    print("=" * 70)
    print("✓ 配置已保存")
    print("=" * 70)
    print(f"代理类型: {proxy_type.upper()}")
    print(f"代理地址: {host}:{port}")
    if need_auth:
        print(f"认证: 是（用户名: {username}）")
    else:
        print("认证: 否")
    print()
    print("配置文件已保存到: config.py")
    print("你可以随时编辑 config.py 修改配置")
    print("=" * 70)


def test_proxy():
    """测试代理连接"""
    try:
        from config import USE_PROXY, PROXY_URL
    except ImportError:
        print("错误：未找到 config.py，请先运行代理配置向导")
        return

    if not USE_PROXY:
        print("当前配置：不使用代理（直连）")
        print("运行代理配置向导以启用代理")
        return

    print("=" * 70)
    print("测试代理连接")
    print("=" * 70)
    print(f"代理配置: {PROXY_URL}")
    print()

    # 测试代理
    import socket
    import socks

    from ws_connection_proxy import parse_proxy_url

    proxy_config = parse_proxy_url(PROXY_URL)
    if not proxy_config:
        print("错误：无效的代理配置")
        return

    proxy_type, addr, port, username, password = proxy_config

    print(f"正在测试连接到 Steam CM (通过代理)...")

    try:
        # 创建 SOCKS socket
        sock = socks.socksocket(socket.AF_INET, socket.SOCK_STREAM)
        sock.set_proxy(
            proxy_type=proxy_type,
            addr=addr,
            port=port,
            username=username,
            password=password
        )
        sock.settimeout(10)

        # 测试连接到 Steam CM
        test_host = "162.254.197.42"
        test_port = 443

        print(f"连接 {test_host}:{test_port}...")
        sock.connect((test_host, test_port))
        print("✓ 连接成功！")
        sock.close()

        print()
        print("=" * 70)
        print("✓ 代理配置正常，可以运行主程序")
        print("=" * 70)

    except Exception as e:
        print(f"✗ 连接失败: {e}")
        print()
        print("可能的原因:")
        print("1. 代理服务器未运行")
        print("2. 代理地址或端口配置错误")
        print("3. 代理需要认证但未配置")
        print("4. 防火墙阻止连接")
        print()
        print("请检查代理配置后重试")


def main():
    """主菜单"""
    while True:
        print()
        print("=" * 70)
        print("代理配置工具")
        print("=" * 70)
        print("  1. 配置代理")
        print("  2. 测试代理连接")
        print("  0. 退出")
        print("=" * 70)

        choice = input("请选择: ").strip()

        if choice == '1':
            setup_proxy()
        elif choice == '2':
            test_proxy()
        elif choice == '0':
            break
        else:
            print("无效选择")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n已取消")
    except Exception as e:
        print(f"\n错误: {e}")
