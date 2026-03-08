"""
WebSocket CM (Connection Manager) 实现

Steam CM 支持 WebSocket 连接，用于在受限网络环境下连接 Steam 服务器。
使用 wss:// 协议，端口 443，可绕过大部分防火墙限制。

代理支持说明：
- gevent 的 socket 不直接支持 HTTP/SOCKS 代理
- 如果需要代理，请使用系统级代理（如 Proxifier、SSTap、Clash TUN 模式）
- 或者配置环境变量: HTTP_PROXY, HTTPS_PROXY
"""
import struct
import logging
import os
import gevent
from gevent import queue, socket
from gevent import ssl as gevent_ssl

logger = logging.getLogger("ws_connection")

# 检查代理配置
_PROXY_ENV = os.environ.get('HTTP_PROXY') or os.environ.get('HTTPS_PROXY') or os.environ.get('ALL_PROXY')
if _PROXY_ENV:
    logger.info("检测到代理配置: %s", _PROXY_ENV)
    logger.warning("注意: gevent socket 不直接支持 HTTP/SOCKS 代理")
    logger.warning("      请使用系统级代理工具（Proxifier/SSTap/Clash TUN 模式）")
else:
    logger.debug("未检测到代理环境变量 (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY)")

# Steam WebSocket CM 服务器列表（香港节点，中国大陆可访问）
WS_CM_SERVERS = [
    ("162.254.197.42", 443),   # 香港 CM
    ("162.254.197.43", 443),   # 香港 CM 备用
    ("155.133.248.53", 443),   # 新加坡 CM
]


class WebSocketConnection:
    """
    WebSocket 连接封装，实现 Steam CM 协议的 WebSocket 传输层

    Steam WebSocket 协议：
    1. 建立 TLS 连接到 CM 服务器 443 端口
    2. 发送 HTTP Upgrade 请求升级到 WebSocket
    3. 使用 WebSocket 帧格式传输 Steam 消息
    """

    def __init__(self):
        self.sock = None
        self.local_address = None
        self.send_queue = queue.Queue()
        self.recv_queue = queue.Queue()
        self._send_greenlet = None
        self._recv_greenlet = None

    def connect(self, server: tuple[str, int]) -> bool:
        """
        连接到 WebSocket CM 服务器

        Args:
            server: (host, port) 元组

        Returns:
            bool: 连接是否成功
        """
        host, port = server
        try:
            logger.info("正在连接 WebSocket CM: %s:%d", host, port)

            # 1. 建立 TCP 连接
            logger.debug("步骤 1/4: 建立 TCP 连接...")
            raw_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            raw_sock.settimeout(15)  # 增加超时时间到 15 秒

            logger.debug("正在连接 %s:%d (超时 15 秒)...", host, port)
            raw_sock.connect((host, port))
            self.local_address = raw_sock.getsockname()[0]
            logger.debug("TCP 连接成功，本地地址: %s", self.local_address)

            # 2. 升级到 TLS
            logger.debug("步骤 2/4: 升级到 TLS...")
            context = gevent_ssl.SSLContext(gevent_ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = gevent_ssl.CERT_NONE
            self.sock = context.wrap_socket(raw_sock, server_hostname=host)
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
            logger.debug("发送 Upgrade 请求:\n%s", upgrade_request.decode())
            self.sock.sendall(upgrade_request)

            # 4. 读取 Upgrade 响应
            logger.debug("步骤 4/4: 等待 Upgrade 响应...")
            response = b""
            self.sock.settimeout(10)  # 设置接收超时
            while b"\r\n\r\n" not in response:
                chunk = self.sock.recv(1024)
                if not chunk:
                    raise ConnectionError("WebSocket upgrade failed: connection closed")
                response += chunk
                logger.debug("收到响应数据: %d 字节", len(chunk))

            logger.debug("收到完整响应:\n%s", response[:500].decode(errors='replace'))

            if b"101 Switching Protocols" not in response:
                raise ConnectionError(f"WebSocket upgrade failed: {response[:200].decode(errors='replace')}")

            logger.info("✓ WebSocket 连接成功: %s:%d", host, port)

            # 5. 启动发送和接收协程
            self._send_greenlet = gevent.spawn(self._send_loop)
            self._recv_greenlet = gevent.spawn(self._recv_loop)

            return True

        except socket.timeout as e:
            logger.error("✗ 连接超时: %s:%d - %s", host, port, e)
            logger.error("   可能原因: 1) 代理未正确配置 2) 防火墙阻止 3) 服务器不可达")
            if self.sock:
                self.sock.close()
                self.sock = None
            return False
        except Exception as e:
            logger.error("✗ WebSocket 连接失败: %s:%d", host, port)
            logger.error("   错误类型: %s", type(e).__name__)
            logger.error("   错误详情: %s", e)
            if self.sock:
                self.sock.close()
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
        # 清空队列
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
        """发送循环：从队列取消息并发送"""
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
        """接收循环：接收 WebSocket 帧并放入队列"""
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
        """
        发送 WebSocket 数据帧

        WebSocket 帧格式（客户端发送，需要 mask）：
        - FIN=1, opcode=2 (binary)
        - Mask=1, payload length
        - Masking key (4 bytes)
        - Masked payload
        """
        if not self.sock:
            return

        payload_len = len(data)
        frame = bytearray()

        # Byte 0: FIN=1, RSV=0, opcode=2 (binary)
        frame.append(0x82)

        # Byte 1: Mask=1, payload length
        if payload_len < 126:
            frame.append(0x80 | payload_len)
        elif payload_len < 65536:
            frame.append(0x80 | 126)
            frame.extend(struct.pack(">H", payload_len))
        else:
            frame.append(0x80 | 127)
            frame.extend(struct.pack(">Q", payload_len))

        # Masking key (4 bytes, 简单使用固定值)
        mask_key = b'\x00\x00\x00\x00'
        frame.extend(mask_key)

        # Masked payload (XOR with mask key)
        masked_data = bytearray(data)
        for i in range(len(masked_data)):
            masked_data[i] ^= mask_key[i % 4]
        frame.extend(masked_data)

        self.sock.sendall(bytes(frame))

    def _recv_frame(self) -> bytes | None:
        """
        接收 WebSocket 数据帧

        WebSocket 帧格式（服务器发送，无 mask）：
        - FIN=1, opcode=2 (binary)
        - Mask=0, payload length
        - Payload
        """
        if not self.sock:
            return None

        # 读取前 2 字节
        header = self._recv_exact(2)
        if not header:
            return None

        # Byte 0: FIN, RSV, opcode
        fin = (header[0] & 0x80) != 0
        opcode = header[0] & 0x0F

        # Byte 1: Mask, payload length
        mask = (header[1] & 0x80) != 0
        payload_len = header[1] & 0x7F

        # 扩展 payload length
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

        # 读取 payload
        payload = self._recv_exact(payload_len)
        if not payload:
            return None

        # 服务器发送的帧通常不带 mask
        if mask:
            mask_key = self._recv_exact(4)
            if not mask_key:
                return None
            payload = bytearray(payload)
            for i in range(len(payload)):
                payload[i] ^= mask_key[i % 4]
            payload = bytes(payload)

        # 处理控制帧
        if opcode == 0x8:  # Close
            logger.debug("WebSocket close frame received")
            return None
        elif opcode == 0x9:  # Ping
            self._send_pong(payload)
            return self._recv_frame()  # 继续接收下一帧
        elif opcode == 0xA:  # Pong
            return self._recv_frame()  # 继续接收下一帧

        return payload

    def _send_pong(self, data: bytes):
        """发送 Pong 帧响应 Ping"""
        frame = bytearray([0x8A, len(data)])  # FIN=1, opcode=0xA (pong)
        frame.extend(data)
        self.sock.sendall(bytes(frame))

    def _recv_exact(self, n: int) -> bytes | None:
        """精确接收 n 字节数据"""
        data = b""
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                return None
            data += chunk
        return data
