"""
网络连接诊断工具

用于测试到 Steam CM 服务器的连接性
"""
import socket
import ssl
import time
import sys

# Steam CM 服务器列表
CM_SERVERS = [
    ("162.254.197.42", 443, "香港 CM"),
    ("162.254.197.43", 443, "香港 CM 备用"),
    ("155.133.248.53", 443, "新加坡 CM"),
]


def test_tcp_connection(host, port, timeout=10):
    """测试 TCP 连接"""
    try:
        start = time.time()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        elapsed = time.time() - start
        sock.close()
        return True, f"{elapsed*1000:.0f}ms"
    except socket.timeout:
        return False, "超时"
    except Exception as e:
        return False, str(e)


def test_tls_connection(host, port, timeout=10):
    """测试 TLS 连接"""
    try:
        start = time.time()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))

        tls_sock = context.wrap_socket(sock, server_hostname=host)
        elapsed = time.time() - start
        tls_sock.close()
        return True, f"{elapsed*1000:.0f}ms"
    except socket.timeout:
        return False, "超时"
    except Exception as e:
        return False, str(e)


def test_websocket_upgrade(host, port, timeout=10):
    """测试 WebSocket Upgrade"""
    try:
        start = time.time()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        tls_sock = context.wrap_socket(sock, server_hostname=host)

        # 发送 WebSocket Upgrade 请求
        upgrade_request = (
            f"GET /cmsocket/ HTTP/1.1\r\n"
            f"Host: {host}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"\r\n"
        ).encode()
        tls_sock.sendall(upgrade_request)

        # 读取响应
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = tls_sock.recv(1024)
            if not chunk:
                break
            response += chunk

        elapsed = time.time() - start
        tls_sock.close()

        if b"101 Switching Protocols" in response:
            return True, f"{elapsed*1000:.0f}ms"
        else:
            return False, f"响应错误: {response[:100].decode(errors='replace')}"
    except socket.timeout:
        return False, "超时"
    except Exception as e:
        return False, str(e)


def main():
    print("=" * 70)
    print("Steam CM 网络连接诊断工具")
    print("=" * 70)
    print()

    # 检查代理配置
    import os
    proxy_env = os.environ.get('HTTP_PROXY') or os.environ.get('HTTPS_PROXY') or os.environ.get('ALL_PROXY')
    if proxy_env:
        print(f"[OK] 检测到代理配置: {proxy_env}")
    else:
        print("[WARN] 未检测到代理环境变量 (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY)")
        print("       如果你在使用代理，请确保:")
        print("       1. 使用系统级代理工具（Proxifier/SSTap/Clash TUN 模式）")
        print("       2. 或者设置环境变量（虽然 gevent 不直接支持）")
    print()

    for host, port, name in CM_SERVERS:
        print(f"测试服务器: {name} ({host}:{port})")
        print("-" * 70)

        # 测试 TCP 连接
        success, result = test_tcp_connection(host, port)
        status = "[OK]" if success else "[FAIL]"
        print(f"  {status} TCP 连接:        {result}")

        if not success:
            print(f"       无法建立 TCP 连接，跳过后续测试")
            print()
            continue

        # 测试 TLS 连接
        success, result = test_tls_connection(host, port)
        status = "[OK]" if success else "[FAIL]"
        print(f"  {status} TLS 握手:        {result}")

        if not success:
            print(f"       TLS 握手失败，跳过 WebSocket 测试")
            print()
            continue

        # 测试 WebSocket Upgrade
        success, result = test_websocket_upgrade(host, port)
        status = "[OK]" if success else "[FAIL]"
        print(f"  {status} WebSocket Upgrade: {result}")

        if success:
            print()
            print(f"  >>> 服务器 {name} 连接正常！")
            print()
            return 0

        print()

    print("=" * 70)
    print("所有服务器连接失败！")
    print()
    print("可能的原因:")
    print("1. 网络防火墙阻止了 443 端口")
    print("2. 代理配置不正确或未启用")
    print("3. Steam CM 服务器维护中")
    print("4. 本地网络问题")
    print()
    print("建议:")
    print("1. 检查防火墙设置，允许程序访问网络")
    print("2. 确认代理工具正常运行（如 Clash/V2Ray/Proxifier）")
    print("3. 尝试使用 VPN 或更换网络环境")
    print("4. 稍后重试")
    print("=" * 70)
    return 1


if __name__ == "__main__":
    sys.exit(main())
