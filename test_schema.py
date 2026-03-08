"""
测试 schema 加载功能
"""
import sys
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from schema import load_schema

print("测试 schema 加载...")
try:
    schema = load_schema()
    print(f"\n[OK] Schema 加载成功！")
    print(f"  武器数量: {len(schema['weapons'])}")
    print(f"  皮肤数量: {len(schema['paints'])}")

    # 显示一些示例
    print(f"\n示例武器（前5个）:")
    for i, (def_idx, name) in enumerate(list(schema['weapons'].items())[:5]):
        print(f"  {def_idx}: {name}")

    print(f"\n示例皮肤（前5个）:")
    for i, (paint_idx, name) in enumerate(list(schema['paints'].items())[:5]):
        print(f"  {paint_idx}: {name}")

except Exception as e:
    print(f"\n[FAIL] Schema 加载失败: {e}")
    import traceback
    traceback.print_exc()
