"""
模块导入测试脚本
验证所有依赖和自定义模块是否正常加载
"""
import sys
import os

# 设置 UTF-8 输出
if sys.platform == 'win32':
    os.system('chcp 65001 >nul 2>&1')

def test_imports():
    print("=" * 50)
    print("CS2 炼金工具 - 模块导入测试")
    print("=" * 50)

    modules = [
        ("steam.client", "Steam 客户端"),
        ("csgo.client", "CSGO 客户端"),
        ("csgo.enums", "CSGO 枚举"),
        ("csgo.proto_enums", "CSGO 协议枚举"),
        ("gevent", "Gevent 协程库"),
        ("pyotp", "TOTP 认证"),
        ("requests", "HTTP 请求"),
        ("auth", "认证模块"),
        ("client", "CS2 客户端"),
        ("account_manager", "账号管理"),
        ("inventory", "库存管理"),
        ("schema", "Schema 加载"),
        ("craft", "炼金执行器"),
        ("proto_messages", "GC 协议消息"),
        ("ws_connection", "WebSocket 连接"),
    ]

    success = 0
    failed = 0

    for module_name, description in modules:
        try:
            __import__(module_name)
            print(f"[OK] {description:20s} ({module_name})")
            success += 1
        except Exception as e:
            print(f"[FAIL] {description:20s} ({module_name})")
            print(f"       错误: {e}")
            failed += 1

    print("=" * 50)
    print(f"测试完成: {success} 成功, {failed} 失败")
    print("=" * 50)

    if failed == 0:
        print("\n所有模块加载正常，可以运行主程序！")
        print("运行命令: python main.py")
        print("或双击: run.bat")
        return 0
    else:
        print(f"\n有 {failed} 个模块加载失败，请检查依赖安装")
        return 1

if __name__ == "__main__":
    sys.exit(test_imports())
