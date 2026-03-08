"""
CS2 GC Craft Protocol Messages

Based on econ_gcmessages.proto from SteamDatabase/Protobufs
Message IDs: k_EMsgGCCraft (1002), k_EMsgGCCraftResponse (1003)

简化实现：直接使用 Python 类，不依赖完整的 Protobuf 描述符
"""


class CMsgGCCraft:
    """
    炼金请求消息

    Fields:
        recipe (int32): 配方 ID，由上层根据 (quality, rarity) 映射
        items (repeated uint64): 10 件材料的 asset_id 列表
    """

    def __init__(self, recipe=0, items=None):
        self.recipe = recipe
        self.items = items or []

    def SerializeToString(self):
        """序列化为 Protobuf 二进制格式（简化实现）"""
        # 这里需要根据实际 GC 协议实现序列化
        # 暂时返回空字节，实际使用时需要完整实现
        import struct
        data = b''
        # Field 1: recipe (int32)
        data += b'\x08' + self._encode_varint(self.recipe)
        # Field 2: items (repeated uint64)
        for item_id in self.items:
            data += b'\x10' + self._encode_varint(item_id)
        return data

    def _encode_varint(self, value):
        """编码 varint"""
        result = b''
        while value > 0x7F:
            result += bytes([(value & 0x7F) | 0x80])
            value >>= 7
        result += bytes([value & 0x7F])
        return result


class CMsgGCCraftResponse:
    """
    炼金响应消息

    Fields:
        recipe_def_index (int32): 使用的配方 ID
        item_ids (repeated uint64): 新生成物品的 asset_id 列表
    """

    def __init__(self, recipe_def_index=0, item_ids=None):
        self.recipe_def_index = recipe_def_index
        self.item_ids = item_ids or []

    def ParseFromString(self, data):
        """从 Protobuf 二进制格式解析（简化实现）"""
        # 这里需要根据实际 GC 协议实现反序列化
        # 暂时只解析基本字段
        self.recipe_def_index = 0
        self.item_ids = []
        pos = 0
        while pos < len(data):
            # 读取 field tag
            tag, pos = self._decode_varint(data, pos)
            field_num = tag >> 3
            wire_type = tag & 0x07

            if field_num == 1:  # recipe_def_index
                self.recipe_def_index, pos = self._decode_varint(data, pos)
            elif field_num == 2:  # item_ids
                if wire_type == 0:
                    item_id, pos = self._decode_varint(data, pos)
                    self.item_ids.append(item_id)
                elif wire_type == 2:
                    length, pos = self._decode_varint(data, pos)
                    end = pos + length
                    while pos < end:
                        item_id, pos = self._decode_varint(data, pos)
                        self.item_ids.append(item_id)
                else:
                    break
            else:
                # 跳过未知字段
                if wire_type == 0:  # varint
                    _, pos = self._decode_varint(data, pos)
                elif wire_type == 1:  # 64-bit
                    pos += 8
                elif wire_type == 2:  # length-delimited
                    length, pos = self._decode_varint(data, pos)
                    pos += length
                elif wire_type == 5:  # 32-bit
                    pos += 4
                else:
                    break

    def _decode_varint(self, data, pos):
        """解码 varint"""
        result = 0
        shift = 0
        while pos < len(data):
            byte = data[pos]
            pos += 1
            result |= (byte & 0x7F) << shift
            if (byte & 0x80) == 0:
                break
            shift += 7
        return result, pos
