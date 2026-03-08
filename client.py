from steam.client import SteamClient
from steam.client.gc import GameCoordinator
from steam.core.msg import GCMsgHdrProto
from csgo.client import CSGOClient
from csgo.enums import EGCBaseClientMsg, GCConnectionStatus, ESOMsg
from csgo.proto_enums import ECsgoGCMsg
from csgo.msg import get_emsg_enum, find_proto
from csgo.protobufs import gcsdk_gcmessages_pb2 as gcsdk_pb2
import gevent
import logging
logger = logging.getLogger(__name__)

# Hello 消息升级序列：4006(标准) → 4013(R2) → 4014(R3) → 4015(R4)
_HELLO_SEQUENCE = [
    EGCBaseClientMsg.EMsgGCClientHello,
    EGCBaseClientMsg.EMsgGCClientHelloR2,
    EGCBaseClientMsg.EMsgGCClientHelloR3,
    EGCBaseClientMsg.EMsgGCClientHelloR4,
]

# 兼容旧版 csgo.msg.find_proto 对 SO 消息返回 None 的情况。
_SO_FALLBACK_PROTO = {
    ESOMsg.Create: gcsdk_pb2.CMsgSOSingleObject,
    ESOMsg.Update: gcsdk_pb2.CMsgSOSingleObject,
    ESOMsg.Destroy: gcsdk_pb2.CMsgSOSingleObject,
    ESOMsg.UpdateMultiple: gcsdk_pb2.CMsgSOMultipleObjects,
    ESOMsg.CacheSubscribed: gcsdk_pb2.CMsgSOCacheSubscribed,
    ESOMsg.CacheUnsubscribed: gcsdk_pb2.CMsgSOCacheUnsubscribed,
}


class _PatchedCSGOClient(CSGOClient):
    """
    覆盖 _knock_on_gc：
    - 依次尝试 EMsgGCClientHello / R2 / R3 / R4
    - 收到 ClientLogonFatalError(errorcode=4) 时升级到下一个 Hello 变体
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._hello_idx = 0      # 当前使用的 Hello 消息索引
        self._need_reset = False # 需要重置游戏会话
        self.on(EGCBaseClientMsg.EMsgGCClientConnectionStatus, self._debug_conn_status)
        self.on(ECsgoGCMsg.EMsgGCCStrike15_v2_ClientLogonFatalError, self._handle_logon_fatal)

    def _debug_conn_status(self, msg):
        logger.debug("GC ConnectionStatus: status=%s queue_pos=%s queue_size=%s session_need=%s",
                     msg.status, msg.queue_position, msg.queue_size, msg.client_session_need)

    def _handle_logon_fatal(self, msg):
        logger.warning("GC LogonFatalError: errorcode=%s country=%s message=%s",
                       msg.errorcode, msg.country, msg.message)
        if msg.errorcode == 4:
            next_idx = self._hello_idx + 1
            if next_idx < len(_HELLO_SEQUENCE):
                logger.warning("GC 拒绝 (errorcode=4)，升级 Hello → %s",
                               _HELLO_SEQUENCE[next_idx].name)
                self._hello_idx = next_idx
                self._need_reset = True
            else:
                logger.error("所有 Hello 变体均被拒绝，放弃重连")

    def _knock_on_gc(self):
        n = 1
        while True:
            if not self.ready:
                if self._need_reset:
                    self._need_reset = False
                    logger.debug("重置游戏会话...")
                    self.steam.games_played([])
                    gevent.sleep(2)
                    self.steam.games_played([self.app_id])
                    gevent.sleep(1)

                hello_msg = _HELLO_SEQUENCE[self._hello_idx]
                logger.debug("GC Hello: %s (version=2000244)", hello_msg.name)
                self.send(hello_msg, {
                    'version': 2000244,
                    'client_session_need': 0,
                    'client_launcher': 0,
                })
                self.wait_event('ready', timeout=3 + (2 ** n))
                n = min(n + 1, 4)
            else:
                self.wait_event('notready')
                n = 1
                self._hello_idx = 0
                self._need_reset = False
                gevent.sleep(1)

    def _process_gc_message(self, emsg, header, payload):
        raw_event = get_emsg_enum(emsg)
        event_id = self._normalize_event_id(raw_event)
        proto = self._resolve_proto(event_id)

        if proto is None:
            self._LOG.debug("Incoming raw GC message: %s", repr(event_id))
            self.emit(event_id, payload)
            if not isinstance(event_id, int):
                self.emit(int(event_id), payload)

            if header.proto.job_id_target != 18446744073709551615:
                self.emit(f"job_{header.proto.job_id_target}", payload)
            return

        message = proto()
        message.ParseFromString(payload)

        if self.verbose_debug:
            self._LOG.debug(
                "Incoming: %s\n%s\n---------\n%s",
                repr(event_id),
                str(header),
                str(message),
            )
        else:
            self._LOG.debug("Incoming: %s", repr(event_id))

        self.emit(event_id, message)
        if not isinstance(event_id, int):
            self.emit(int(event_id), message)

        if header.proto.job_id_target != 18446744073709551615:
            self.emit(f"job_{header.proto.job_id_target}", message)

    @staticmethod
    def _normalize_event_id(event_id):
        if isinstance(event_id, int):
            try:
                return ESOMsg(event_id)
            except Exception:
                return event_id
        return event_id

    @staticmethod
    def _resolve_proto(event_id):
        proto = find_proto(event_id)
        if proto is not None:
            return proto
        try:
            if isinstance(event_id, int):
                event_id = ESOMsg(event_id)
        except Exception:
            return None
        return _SO_FALLBACK_PROTO.get(event_id)

    def send_raw_gc(self, emsg: int, payload: bytes, jobid: int | None = None):
        if not isinstance(payload, (bytes, bytearray)):
            raise TypeError("payload must be bytes")

        header = GCMsgHdrProto(int(emsg))
        if jobid is not None:
            header.proto.job_id_source = jobid

        if self.verbose_debug:
            self._LOG.debug("Outgoing raw GC msg: %s (len=%d)", emsg, len(payload))

        GameCoordinator.send(self, header, bytes(payload))


class CS2Client:
    def __init__(self, steam: SteamClient):
        self.steam = steam
        self.cs2 = _PatchedCSGOClient(self.steam)
        self.cs2.verbose_debug = True

    def launch(self, timeout: int = 60):
        """Launch CS2 GC and wait SO cache ready."""
        self.cs2.launch()
        if self.cs2.wait_event('ready', timeout=timeout) is None:
            raise TimeoutError("CS2 GC connect timeout, SO cache not ready")

    def disconnect(self, logout: bool = False):
        """Disconnect GC; optionally logout Steam."""
        self.cs2.exit()
        if logout:
            self.steam.logout()
