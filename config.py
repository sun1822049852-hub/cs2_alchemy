# CS2 炼金工具配置文件

# 代理设置
# 如果你需要使用代理连接 Steam，请取消注释并配置以下选项

# SOCKS5 代理（推荐）
# PROXY_URL = "socks5://127.0.0.1:1080"

# SOCKS5 代理（带认证）
# PROXY_URL = "socks5://username:password@127.0.0.1:1080"

# SOCKS4 代理
# PROXY_URL = "socks4://127.0.0.1:1080"

# HTTP 代理
# PROXY_URL = "http://127.0.0.1:8080"

# 不使用代理（直连）
PROXY_URL = None

# 使用代理连接（True=使用代理版本，False=使用原版）
USE_PROXY = False

# 连接超时设置（秒）
CONNECT_TIMEOUT = 60

# 日志级别（DEBUG, INFO, WARNING, ERROR）
LOG_LEVEL = "DEBUG"

# 库存原始数据调试导出（调试完成后可改为 False）
DEBUG_SAVE_RAW_INVENTORY = True
RAW_INVENTORY_DUMP_DIR = "logs/raw_inventory"
