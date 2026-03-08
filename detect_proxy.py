"""
自动检测本地代理端口

尝试常见的代理端口，找到可用的 SOCKS5 代理
"""
import socket
import socks
import sys


def test_socks5_port(port):
    """测试指定端口是否为可用的 SOCKS5 代理"""
    try:
        # 创建 SOCKS socket
        sock = socks.socksocket(socket.AF_INET, socket.SOCK_STREAM)
        sock.set_proxy(
            proxy_type=socks.SOCKS5,
            addr="127.0.0.1",
            port=port
        )
        sock.settimeout(3)

        # 尝试连接 Steam CM
        sock.connect(("162.254.197.42", 443))
        sock.close()
        return True
    except Exception as e:
        return False


def main():
    print("=" * 70)
    print("自动检测本地代理端口")
    print("=" * 70)
    print()

    # 常见的 SOCKS5 代理端口
    common_ports = [
        (1080, "V2Ray/Shadowsocks 默认"),
        (7890, "Clash 默认"),
        (7891, "Clash 备用"),
        (10808, "ViewTurbo/其他工具"),
        (1086, "SSR 默认"),
        (2080, "备用端口"),
        (8080, "备用端口"),
        (9050, "Tor 默认"),
    ]

    print("正在测试常见端口...\n")

    found_ports = []

    for port, desc in common_ports:
        sys.stdout.write(f"测试端口 {port:5d} ({desc:25s}) ... ")
        sys.stdout.flush()

        if test_socks5_port(port):
            print("[成功] ✓")
            found_ports.append(port)
        else:
            print("[失败]")

    print()
    print("=" * 70)

    if found_ports:
        print(f"找到 {len(found_ports)} 个可用的 SOCKS5 代理端口:")
        print()
        for port in found_ports:
            print(f"  ✓ 127.0.0.1:{port}")
        print()
        print("=" * 70)
        print()
        print("请运行以下命令配置代理:")
        print()
        print("  .venv\\Scripts\\python setup_proxy.py")
        print()
        print(f"配置时使用端口: {found_ports[0]}")
    else:
        print("未找到可用的 SOCKS5 代理端口")
        print()
        print("可能的原因:")
        print("1. ViewTurbo 未运行或未启用代理")
        print("2. ViewTurbo 使用的是 HTTP 代理而非 SOCKS5")
        print("3. 代理端口不在常见范围内")
        print()
        print("建议:")
        print("1. 检查 ViewTurbo 是否正在运行")
        print("2. 查看 ViewTurbo 设置中的端口配置")
        print("3. 尝试使用 Clash 或 V2Ray 等支持 SOCKS5 的代理工具")

    print("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n已取消")
    except Exception as e:
        print(f"\n错误: {e}")
