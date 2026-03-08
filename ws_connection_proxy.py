"""
支持 SOCKS 代理的 WebSocket CM 连接

使用 PySocks 库实现 SOCKS5/SOCKS4 代理支持
"""
import struct
import logging
import os
import gevent
from gevent import queue
import socks
import socket as std_socket
from gevent import ssl as gevent_ssl

logger = logging.getLogger("ws_connection_proxy")

# Steam WebSocket CM 服务器列表
WS_CM_SERVERS = [
    ("162.254.197.42", 443),
    ("162.254.197.43", 443),
    ("155.133.248.53", 443),
]


def parse_proxy_url(proxy_url: str) -> tuple:
    """
    解析代理 URL

    支持格式：
    - socks5://127.0.0.1:1080
    - socks5://user:pass@127.0.0.1:1080
    - http://127.0.0.1:8080

    Returns:
        (proxy_type, addr, port, username, password)
    """
    if not proxy_url:
        return None

    # 移除协议前缀
    if '://' in proxy_url:
        protocol, rest = proxy_url.split('://', 1)
    else:
        protocol = 'socks5'
        rest = proxy_url

    # 解析认证信息
    username = password = None
    if '@' in rest:
        auth, rest = rest.rsplit('@', 1)
        if ':' in auth:
            username, password = auth.split(':', 1)

    # 解析地址和端口
    if ':' in rest:
        addr, port = rest.rsplit(':', 1)
        port = int(port)
    else:
        addr = rest
        port = 1080

    # 确定代理类型
    proxy_type_map = {
        'socks5': socks.SOCKS5,
        'socks4': socks.SOCKS4,
        'http': socks.HTTP,
    }
    proxy_type = proxy_type_map.get(protocol.lower(), socks.SOCKS5)

    return (proxy_type, addr, port, username, password)


class WebSocketConnectionWithProxy:
    """支持 SOCKS 代理的 WebSocket 连接"""

    def __init__(self, proxy_url: str = None):
        """
        Args:
            proxy_url: 代理 URL，格式如 socks5://127.0.0.1:1080
                      如果为 None，从环境变量读取
        """
        self.sock = None
        self.local_address = None
        self.send_queue = queue.Queue()
        self.recv_queue = queue.Queue()
        self._send_greenlet = None
        self._recv_greenlet = None

        # 解析代理配置
        if proxy_url is None:
            # 从环境变量读取
            proxy_url = (os.environ.get('ALL_PROXY') or
                        os.environ.get('HTTPS_PROXY') or
                        os.environ.get('HTTP_PROXY'))

        self.proxy_config = parse_proxy_url(proxy_url) if proxy_url else None

        if self.proxy_config:
            proxy_type, addr, port, user, pwd = self.proxy_config
            logger.info("使用代理: %s:%d (类型: %s)", addr, port,
                       {socks.SOCKS5: 'SOCKS5', socks.SOCKS4: 'SOCKS4',
                        socks.HTTP: 'HTTP'}.get(proxy_type, 'Unknown'))
        else:
            logger.warning("未配置代理，将尝试直连")

    def connect(self, server: tuple[str, int]) -> bool:
        """连接到 WebSocket CM 服务器（支持代理）"""
        host, port = server
        try:
            logger.info("正在连接 WebSocket CM: %s:%d", host, port)

            # 1. 创建 socket（支持代理）
            if self.proxy_config:
                proxy_type, proxy_addr, proxy_port, username, password = self.proxy_config
                logger.debug("步骤 1/4: 通过代理建立 TCP 连接...")

                # 创建 SOCKS socket
                raw_sock = socks.socksocket(std_socket.AF_INET, std_socket.SOCK_STREAM)
                raw_sock.set_proxy(
                    proxy_type=proxy_type,
                    addr=proxy_addr,
                    port=proxy_port,
                    username=username,
                    password=password
                )
            else:
                logger.debug("步骤 1/4: 建立 TCP 连接（直连）...")
                raw_sock = std_socket.socket(std_socket.AF_INET, std_socket.SOCK_STREAM)

            raw_sock.settimeout(15)
            logger.debug("正在连接 %s:%d (超时 15 秒)...", host, port)
            raw_sock.connect((host, port))
            self.local_address = raw_sock.getsockname()[0]
            logger.debug("TCP 连接成功，本地地址: %s", self.local_address)

            # 2. 升级到 TLS
            logger.debug("步骤 2/4: 升级到 TLS...")
            context = gevent_ssl.SSLContext(gevent_ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = gevent_ssl.CERT_NONE

            # 包装成 gevent socket
            from gevent.socket import socket as gevent_socket
            gevent_raw_sock = gevent_socket(_sock=raw_sock)
            self.sock = context.wrap_socket(gevent_raw_sock, server_hostname=host)
            logger.debug("TLS 握手成功")

            # 3. 发送 WebSocket Upgrade 请求
            logger.debug("步骤 3/4: 发送 WebSocket Upgrade 请求...")
            upgrade_request = (
                f"GET /cmsocket/ HTTP/1.1\r\n"
                f"Host: {host}\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                f"Sec-WebSocket-Version: 13\r\n"
                f"\r\n"
            ).encode()
            self.sock.sendall(upgrade_request)

            # 4. 读取 Upgrade 响应
            logger.debug("步骤 4/4: 等待 Upgrade 响应...")
            response = b""
            self.sock.settimeout(10)
            while b"\r\n\r\n" not in response:
                chunk = self.sock.recv(1024)
                if not chunk:
                    raise ConnectionError("WebSocket upgrade failed: connection closed")
                response += chunk

            if b"101 Switching Protocols" not in response:
                raise ConnectionError(f"WebSocket upgrade failed: {response[:200].decode(errors='replace')}")

            logger.info("✓ WebSocket 连接成功: %s:%d", host, port)

            # 5. 启动发送和接收协程
            self._send_greenlet = gevent.spawn(self._send_loop)
            self._recv_greenlet = gevent.spawn(self._recv_loop)

            return True

        except Exception as e:
            logger.error("✗ WebSocket 连接失败: %s:%d", host, port)
            logger.error("   错误类型: %s", type(e).__name__)
            logger.error("   错误详情: %s", e)
            if self.sock:
                try:
                    self.sock.close()
                except:
                    pass
                self.sock = None
            return False

    def disconnect(self):
        """断开连接并清理资源"""
        if self._send_greenlet:
            self._send_greenlet.kill(block=False)
            self._send_greenlet = None
        if self._recv_greenlet:
            self._recv_greenlet.kill(block=False)
            self._recv_greenlet = None
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
            self.sock = None
        while not self.send_queue.empty():
            try:
                self.send_queue.get_nowait()
            except:
                break
        self.recv_queue.put(StopIteration)

    def put_message(self, data: bytes):
        """将消息放入发送队列"""
        self.send_queue.put(data)

    def _send_loop(self):
        """发送循环"""
        try:
            while self.sock:
                data = self.send_queue.get()
                if data is StopIteration:
                    break
                self._send_frame(data)
        except Exception as e:
            logger.error("Send loop error: %s", e)
            self.disconnect()

    def _recv_loop(self):
        """接收循环"""
        try:
            while self.sock:
                frame_data = self._recv_frame()
                if frame_data:
                    self.recv_queue.put(frame_data)
                else:
                    break
        except Exception as e:
            logger.error("Recv loop error: %s", e)
        finally:
            self.recv_queue.put(StopIteration)

    def _send_frame(self, data: bytes):
        """发送 WebSocket 帧"""
        if not self.sock:
            return

        payload_len = len(data)
        frame = bytearray([0x82])  # FIN=1, opcode=2 (binary)

        if payload_len < 126:
            frame.append(0x80 | payload_len)
        elif payload_len < 65536:
            frame.append(0x80 | 126)
            frame.extend(struct.pack(">H", payload_len))
        else:
            frame.append(0x80 | 127)
            frame.extend(struct.pack(">Q", payload_len))

        mask_key = b'\x00\x00\x00\x00'
        frame.extend(mask_key)

        masked_data = bytearray(data)
        for i in range(len(masked_data)):
            masked_data[i] ^= mask_key[i % 4]
        frame.extend(masked_data)

        self.sock.sendall(bytes(frame))

    def _recv_frame(self) -> bytes | None:
        """接收 WebSocket 帧"""
        if not self.sock:
            return None

        header = self._recv_exact(2)
        if not header:
            return None

        opcode = header[0] & 0x0F
        payload_len = header[1] & 0x7F

        if payload_len == 126:
            ext_len = self._recv_exact(2)
            if not ext_len:
                return None
            payload_len = struct.unpack(">H", ext_len)[0]
        elif payload_len == 127:
            ext_len = self._recv_exact(8)
            if not ext_len:
                return None
            payload_len = struct.unpack(">Q", ext_len)[0]

        payload = self._recv_exact(payload_len)
        if not payload:
            return None

        if opcode == 0x8:  # Close
            return None
        elif opcode == 0x9:  # Ping
            self._send_pong(payload)
            return self._recv_frame()
        elif opcode == 0xA:  # Pong
            return self._recv_frame()

        return payload

    def _send_pong(self, data: bytes):
        """发送 Pong 帧"""
        frame = bytearray([0x8A, len(data)])
        frame.extend(data)
        self.sock.sendall(bytes(frame))

    def _recv_exact(self, n: int) -> bytes | None:
        """精确接收 n 字节"""
        data = b""
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                return None
            data += chunk
        return data
