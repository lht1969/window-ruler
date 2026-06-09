#!/usr/bin/env python3
"""
Window Ruler ICO 图标生成脚本 v2
正确生成 Windows ICO 格式图标
"""

import os
import sys
from pathlib import Path
import struct
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

def svg_to_png_data(svg_content, width, height):
    """将 SVG 转换为 PNG 字节数据"""
    png_data = cairosvg.svg2png(
        bytestring=svg_content.encode('utf-8'),
        output_width=width,
        output_height=height
    )
    return png_data

def create_proper_ico(source_svg, output_path):
    """创建正确格式的 ICO 文件"""
    print("🎨 开始生成 ICO 图标 (专业版)...\n")
    print(f"📄 源文件: {source_svg}")
    print(f"📁 输出文件: {output_path}\n")
    
    # 加载 SVG
    try:
        svg_content = load_svg(source_svg)
        print("✅ SVG 文件加载成功\n")
    except Exception as e:
        print(f"❌ 无法加载 SVG 文件: {e}")
        sys.exit(1)
    
    # ICO 需要的尺寸
    sizes = [16, 32, 48, 256]
    png_images = []
    
    print("📐 生成各种尺寸的图标...")
    for size in sizes:
        try:
            png_data = svg_to_png_data(svg_content, size, size)
            png_images.append(png_data)
            print(f"   ✅ {size}x{size} - {len(png_data):,} 字节")
        except Exception as e:
            print(f"   ❌ {size}x{size} 失败: {e}")
    
    if not png_images:
        print("\n❌ 错误：没有成功生成任何尺寸的图标")
        sys.exit(1)
    
    # 创建 ICO 文件
    try:
        with open(output_path, 'wb') as ico_file:
            # ICO 文件头
            # ICONDIR 结构
            ico_file.write(struct.pack('<HHH', 0, 1, len(png_images)))  # 保留, 类型(1=ICO), 图标数量
            
            # 计算所有图像数据的偏移量
            offset = 6 + (16 * len(png_images))  # 文件头(6字节) + 所有目录项(16字节 * 数量)
            
            # 写入 ICONDIRENTRY 结构并保存图像数据
            image_data_list = []
            for i, (png_data, size) in enumerate(zip(png_images, sizes)):
                # 获取 PNG 实际尺寸
                img = Image.open(io.BytesIO(png_data))
                actual_width = img.width
                actual_height = img.height
                
                # ICONDIRENTRY
                ico_file.write(struct.pack('<BBBBHHII',
                    actual_width if actual_width < 256 else 0,  # 宽度 (0=256)
                    actual_height if actual_height < 256 else 0,  # 高度 (0=256)
                    0,  # 颜色调色板 (0=无调色板)
                    0,  # 保留
                    1,  # 颜色平面
                    32,  # 每像素位数
                    len(png_data),  # 图像数据大小
                    offset  # 偏移量
                ))
                
                image_data_list.append(png_data)
                offset += len(png_data)
            
            # 写入实际的图像数据
            for png_data in image_data_list:
                ico_file.write(png_data)
        
        print(f"\n✅ ICO 文件创建成功: {output_path}")
        
        # 验证文件
        file_size = os.path.getsize(output_path)
        print(f"📊 文件大小: {file_size:,} 字节 ({file_size/1024:.2f} KB)")
        
        if file_size < 1000:
            print("⚠️  警告：文件大小过小，可能生成失败")
        else:
            print("✅ 文件大小正常")
        
    except Exception as e:
        print(f"\n❌ 保存 ICO 文件失败: {e}")
        import traceback
        traceback.print_exc()
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
    create_proper_ico(str(source_svg), str(output_path))

if __name__ == "__main__":
    main()
