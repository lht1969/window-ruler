#!/usr/bin/env python3
"""
Window Ruler ICO 图标生成脚本
基于 app-icon.svg 生成 Windows ICO 格式图标
"""

import os
import sys
from pathlib import Path
import io

try:
    from PIL import Image
    import cairosvg
except ImportError as e:
    print(f"❌ 缺少必要的库: {e}")
    print("请安装必要的库：")
    print("  pip install Pillow cairosvg")
    sys.exit(1)

def load_svg(svg_path):
    """加载 SVG 文件内容"""
    with open(svg_path, 'r', encoding='utf-8') as f:
        return f.read()

def svg_to_png(svg_content, width, height):
    """将 SVG 转换为 PNG"""
    png_data = cairosvg.svg2png(
        bytestring=svg_content.encode('utf-8'),
        output_width=width,
        output_height=height
    )
    return Image.open(io.BytesIO(png_data))

def create_ico(source_svg, output_path):
    """创建 ICO 文件"""
    print("🎨 开始生成 ICO 图标...\n")
    print(f"📄 源文件: {source_svg}")
    print(f"📁 输出文件: {output_path}\n")
    
    # 加载 SVG
    try:
        svg_content = load_svg(source_svg)
        print("✅ SVG 文件加载成功\n")
    except Exception as e:
        print(f"❌ 无法加载 SVG 文件: {e}")
        sys.exit(1)
    
    # ICO 文件需要多种尺寸的图标
    sizes = [16, 32, 48, 64, 128, 256]
    images = []
    
    print("📐 生成各种尺寸的图标...")
    for size in sizes:
        try:
            img = svg_to_png(svg_content, size, size)
            # 确保图像是 RGBA 模式（支持透明）
            if img.mode != 'RGBA':
                img = img.convert('RGBA')
            images.append(img)
            print(f"   ✅ {size}x{size}")
        except Exception as e:
            print(f"   ❌ {size}x{size} 失败: {e}")
    
    if not images:
        print("\n❌ 错误：没有成功生成任何尺寸的图标")
        sys.exit(1)
    
    # 保存 ICO 文件
    try:
        # Pillow 的 ICO 保存会自动处理多尺寸
        images[0].save(
            output_path,
            format='ICO',
            sizes=[(img.width, img.height) for img in images]
        )
        print(f"\n✅ ICO 文件创建成功: {output_path}")
        
        # 验证文件
        file_size = os.path.getsize(output_path)
        print(f"📊 文件大小: {file_size:,} 字节 ({file_size/1024:.2f} KB)")
        
    except Exception as e:
        print(f"\n❌ 保存 ICO 文件失败: {e}")
        sys.exit(1)

def main():
    # 路径配置
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    icons_dir = project_root / "icons"
    source_svg = icons_dir / "app-icon.svg"
    output_path = project_root / "src-tauri" / "icons" / "icon.ico"
    
    # 检查源文件
    if not source_svg.exists():
        print(f"❌ 错误：找不到源 SVG 文件: {source_svg}")
        sys.exit(1)
    
    # 创建 ICO
    create_ico(str(source_svg), str(output_path))

if __name__ == "__main__":
    main()
