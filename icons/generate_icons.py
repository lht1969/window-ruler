#!/usr/bin/env python3
"""
Window Ruler 图标生成脚本
使用 Pillow 和其他图像库生成 Tauri 项目所需的各种尺寸图标
"""

import os
import sys
from pathlib import Path

# 尝试导入图像处理库
try:
    from PIL import Image
    import io
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False
    print("❌ 错误：需要安装 Pillow 库")
    print("请运行：pip install Pillow")
    sys.exit(1)

# 尝试导入 SVG 处理库
try:
    import cairosvg
    HAS_CAIRO = True
except ImportError:
    try:
        from svglib.svglib import svg2rlg
        from reportlab.graphics import renderPM
        HAS_SVGLIB = True
        HAS_CAIRO = False
    except ImportError:
        HAS_SVGLIB = False
        print("❌ 错误：需要安装 SVG 处理库")
        print("请选择安装：")
        print("  pip install cairosvg          (推荐)")
        print("  或")
        print("  pip install svglib reportlab")
        sys.exit(1)

# 图标尺寸配置
ICON_SIZES = [
    {"name": "icon", "width": 256, "height": 256},
    {"name": "32x32", "width": 32, "height": 32},
    {"name": "128x128", "width": 128, "height": 128},
    {"name": "128x128@2x", "width": 256, "height": 256},
    {"name": "Square30x30", "width": 30, "height": 30},
    {"name": "Square44x44", "width": 44, "height": 44},
    {"name": "Square71x71", "width": 71, "height": 71},
    {"name": "Square89x89", "width": 89, "height": 89},
    {"name": "Square107x107", "width": 107, "height": 107},
    {"name": "Square142x142", "width": 142, "height": 142},
    {"name": "Square150x150", "width": 150, "height": 150},
    {"name": "Square284x284", "width": 284, "height": 284},
    {"name": "Square310x310", "width": 310, "height": 310},
    {"name": "StoreLogo", "width": 50, "height": 50},
]

def load_svg(svg_path):
    """加载 SVG 文件内容"""
    with open(svg_path, 'r', encoding='utf-8') as f:
        return f.read()

def svg_to_png_cairo(svg_content, width, height):
    """使用 cairosvg 将 SVG 转换为 PNG"""
    png_data = cairosvg.svg2png(
        bytestring=svg_content.encode('utf-8'),
        output_width=width,
        output_height=height
    )
    return Image.open(io.BytesIO(png_data))

def svg_to_png_svglib(svg_content, width, height):
    """使用 svglib 将 SVG 转换为 PNG"""
    import io
    drawing = svg2rlg(io.StringIO(svg_content))
    if drawing is None:
        raise ValueError("无法解析 SVG 内容")
    
    scaling_factor = width / drawing.width
    drawing.width = width
    drawing.height = height
    drawing.scale(scaling_factor, scaling_factor)
    
    png_data = renderPM.drawToString(drawing, fmt='PNG')
    return Image.open(io.BytesIO(png_data))

def svg_to_png(svg_content, width, height):
    """将 SVG 转换为 PNG（自动选择可用库）"""
    try:
        if HAS_CAIRO:
            return svg_to_png_cairo(svg_content, width, height)
        else:
            return svg_to_png_svglib(svg_content, width, height)
    except Exception as e:
        print(f"      转换失败: {e}")
        raise

def generate_icons(source_svg, output_dir):
    """生成所有尺寸的图标"""
    print("🚀 开始生成 Window Ruler 图标...\n")
    print(f"📄 源文件: {source_svg}")
    print(f"📁 输出目录: {output_dir}\n")
    
    # 确保输出目录存在
    os.makedirs(output_dir, exist_ok=True)
    
    # 加载 SVG
    try:
        svg_content = load_svg(source_svg)
        print(f"✅ SVG 文件加载成功\n")
    except Exception as e:
        print(f"❌ 无法加载 SVG 文件: {e}")
        sys.exit(1)
    
    # 生成各种尺寸
    success = 0
    failed = 0
    
    for icon_spec in ICON_SIZES:
        name = icon_spec["name"]
        width = icon_spec["width"]
        height = icon_spec["height"]
        output_path = os.path.join(output_dir, f"{name}.png")
        
        print(f"📐 生成 {name}.png ({width}×{height})...", end=" ")
        
        try:
            img = svg_to_png(svg_content, width, height)
            img.save(output_path, "PNG")
            print(f"✅")
            success += 1
        except Exception as e:
            print(f"❌ 失败: {e}")
            failed += 1
    
    print(f"\n{'='*50}")
    print(f"📊 生成完成!")
    print(f"   ✅ 成功: {success} 个图标")
    if failed > 0:
        print(f"   ❌ 失败: {failed} 个图标")
    print(f"\n📁 所有图标已保存到: {output_dir}")
    print(f"{'='*50}")

def main():
    # 路径配置
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    icons_dir = project_root / "icons"
    source_svg = icons_dir / "app-icon.svg"
    output_dir = project_root / "src-tauri" / "icons"
    
    # 检查源文件
    if not source_svg.exists():
        print(f"❌ 错误：找不到源 SVG 文件: {source_svg}")
        sys.exit(1)
    
    # 生成图标
    generate_icons(str(source_svg), str(output_dir))

if __name__ == "__main__":
    main()
