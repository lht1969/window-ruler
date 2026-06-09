# Window Ruler (窗口量尺)

[English](README.md) | 简体中文

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [使用方法](#使用方法)
- [键盘快捷键](#键盘快捷键)
- [项目结构](#项目结构)
- [构建说明](#构建说明)
- [核心实现原理](#核心实现原理)
- [无障碍支持](#无障碍支持)
- [隐私声明](#隐私声明)
- [许可证](#许可证)

---

## 项目简介

**Window Ruler** 是一款专为 Windows 系统设计的轻量级屏幕量尺工具，基于 Tauri v2 框架和 Rust 语言开发。它能够精确测量屏幕上任意两点之间的距离、矩形的宽高，以及测量区域到屏幕四边缘的精确距离。

### 设计目标

- **精确测量**：提供像素级精度的屏幕测量功能
- **智能检测**：自动检测鼠标下的目标窗口，智能切换坐标系
- **无打扰**：透明窗口设计，不会遮挡测量区域
- **轻量高效**：基于 Rust 和 Tauri，性能卓越，资源占用极低
- **无障碍**：遵循 WCAG 2.1 AA 级无障碍标准

---

## 功能特性

### 1. 矩形测量模式

拖拽鼠标即可测量两点间的直线距离和矩形区域的长宽尺寸。适合测量 UI 元素的尺寸、间距等。

**功能说明**：
- 鼠标拖拽确定测量起点和终点
- 实时显示欧几里得距离
- 显示矩形宽高尺寸
- 显示起点和终点坐标

### 2. 十字线像素测量模式

通过检测鼠标位置处像素的颜色，自动识别并测量同色像素区域的边界范围。

**功能说明**：
- 读取屏幕像素颜色作为基准
- 沿四个方向（上下左右）扫描同色像素
- 自动计算同色区域的宽高
- 显示基准颜色预览

### 3. 双坐标系支持

支持屏幕坐标系和窗口坐标系两种测量参考系。

**屏幕坐标系**：
- 以整个屏幕左上角为原点 (0, 0)
- 所有坐标值相对于整个显示器
- 适合测量屏幕级别的元素

**窗口坐标系**：
- 以当前目标窗口左上角为原点
- 坐标值相对于目标窗口内部
- 自动检测鼠标下的目标窗口
- 适合测量应用程序窗口内的元素

### 4. 边缘距离测量

实时显示鼠标位置到屏幕四边缘的精确距离。

**显示内容**：
- 到左边缘的距离
- 到右边缘的距离
- 到上边缘的距离
- 到下边缘的距离

### 5. 数据保存

支持一键将测量数据保存到系统剪贴板。

**保存格式**：
```
距离: XXX px
宽度: XXX px
高度: XXX px
X: XXX
Y: XXX
```

### 6. 信息面板交互

可拖动、可折叠的信息面板。

**功能说明**：
- 拖动信息面板到任意位置
- 点击收起/展开按钮
- 位置和状态自动保存

---

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Window Ruler                          │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────┐    ┌───────────────────────────┐ │
│  │   工具栏窗口       │    │   量尺覆盖窗口（全屏）    │ │
│  │   (Toolbar)       │    │   (Ruler Overlay)         │ │
│  │                   │    │                           │ │
│  │ [矩形测量]        │    │   Canvas 绘制层           │ │
│  │ [十字线测量]      │    │   + 测量信息面板          │ │
│  │ [坐标系切换]      │    │   + 坐标跟随提示          │ │
│  │ [退出]            │    │                           │ │
│  └────────┬──────────┘    └───────────┬───────────────┘ │
│           │                            │                  │
│           │   Tauri IPC               │                  │
│           └────────────┬───────────────┘                  │
│                        ▼                                   │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Rust 后端核心逻辑 (lib.rs)              ││
│  │                                                       ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ ││
│  │  │ 窗口检测    │  │ 点击穿透    │  │ 像素捕获    │ ││
│  │  │ Window     │  │ Click-     │  │ Screen      │ ││
│  │  │ Detection  │  │ Through    │  │ Capture     │ ││
│  │  └─────────────┘  └─────────────┘  └──────────────┘ ││
│  │                                                       ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ ││
│  │  │ 坐标计算    │  │ 剪贴板管理  │  │ 窗口管理    │ ││
│  │  │ Coord      │  │ Clipboard   │  │ Window      │ ││
│  │  │ Calculation│  │ Manager     │  │ Manager     │ ││
│  │  └─────────────┘  └─────────────┘  └──────────────┘ ││
│  └─────────────────────────────────────────────────────┘│
│                        ▼                                   │
│  ┌─────────────────────────────────────────────────────┐│
│  │           Windows API (Win32 SDK)                   ││
│  │                                                       ││
│  │  GetCursorPos  WindowFromPoint  GetWindowRect        ││
│  │  SetWindowLongPtr  BitBlt  CreateDIBSection         ││
│  │  GetDesktopWindow  SetForegroundWindow              ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Tauri v2 | 轻量级桌面应用框架 |
| 后端 | Rust | 高性能、安全的系统编程语言 |
| 前端 | HTML5 + CSS3 + JavaScript | 标准 Web 技术 |
| Windows API | Win32 SDK | 原生 Windows 功能调用 |
| 构建 | NSIS | Windows 安装包打包 |

### 核心技术点

#### 1. 窗口检测

使用 Windows API 遍历 Z 序，检测鼠标下的目标窗口：

```rust
// 遍历桌面窗口 Z 序
// GetWindow(hwnd, GW_HWNDNEXT) 遍历兄弟窗口
// GetWindowRect 获取窗口矩形
// GetWindowTextW 获取窗口标题
// IsWindowVisible 检查可见性
```

#### 2. 点击穿透

通过设置窗口扩展样式实现鼠标事件穿透：

```rust
// WS_EX_TRANSPARENT (0x00000020)
// 使窗口忽略鼠标事件，传递到下层窗口
```

#### 3. 像素测量

使用 DWM 合成截图读取屏幕像素：

```rust
// SetWindowDisplayAffinity 排除量尺窗口
// BitBlt 捕获 DWM 合成结果
// CreateDIBSection 创建直接可读的位图
// 四方向扫描同色像素边界
```

#### 4. 双窗口架构

```
┌─────────────────────────────────────────────────┐
│  主窗口 (main)                                   │
│  - 工具栏界面                                    │
│  - 半透明毛玻璃效果                              │
│  - 透明无边框窗口                                │
│  - 位于屏幕顶部中央                              │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  量尺窗口 (ruler)                               │
│  - 全屏覆盖层                                   │
│  - Canvas 绘制测量图形                          │
│  - 信息面板悬浮显示                             │
│  - 透明背景，点击穿透                           │
└─────────────────────────────────────────────────┘
```

---

## 快速开始

### 环境要求

- Windows 10/11 (64-bit)
- WebView2 Runtime (Windows 11 自带，Windows 10 可自动下载)

### 运行程序

#### 方式一：使用已编译的安装包

1. 下载最新的 `Window-Ruler_x.x.x_x64-setup.exe` 安装包
2. 双击运行安装程序
3. 按照提示完成安装
4. 从开始菜单或桌面快捷方式启动程序

#### 方式二：从源码运行

```bash
# 克隆项目
git clone https://github.com/your-username/window-ruler.git
cd window-ruler

# 安装依赖（Windows）
# 确保已安装 Rust 和 Node.js

# 运行开发模式
npm run tauri dev
```

### 构建发布版本

```bash
# 构建 Windows 安装包
npm run tauri build
```

安装包将生成在 `src-tauri/target/release/bundle/nsis/` 目录下。

---

## 使用方法

### 启动程序

1. 双击桌面快捷方式或从开始菜单启动 Window Ruler
2. 程序启动后，工具栏窗口显示在屏幕顶部中央
3. 工具栏包含四个功能按钮

### 矩形测量

1. 点击工具栏上的 **「矩形测量」** 按钮
2. 屏幕将进入量尺模式，鼠标变为十字线
3. 在测量起点按住鼠标左键
4. 拖动到测量终点
5. 松开鼠标完成测量
6. 测量数据将显示在信息面板中
7. 按 **C** 键切换坐标系
8. 按 **S** 键保存数据到剪贴板
9. 按 **ESC** 键退出量尺模式

### 十字线像素测量

1. 点击工具栏上的 **「十字线测量」** 按钮
2. 程序进入十字线测量模式
3. 移动鼠标，系统将实时检测同色像素区域
4. 信息面板显示检测结果：
   - 基准颜色预览
   - 同色区域宽度和高度
   - 到屏幕边缘的距离
   - 到窗口边缘的距离
5. 按 **C** 键切换坐标系
6. 按 **S** 键保存数据
7. 按 **ESC** 键退出

### 坐标系切换

1. 在量尺模式下，按 **C** 键切换坐标系
2. 或点击工具栏上的 **「坐标系切换」** 按钮
3. **屏幕坐标系**：坐标相对于整个屏幕
4. **窗口坐标系**：坐标相对于当前目标窗口
5. 切换时会有提示信息

### 信息面板操作

- **拖动面板**：按住面板头部区域拖动
- **收起面板**：点击面板右上角的收起按钮
- **展开面板**：再次点击收起按钮
- 位置和状态会自动保存

---

## 键盘快捷键

| 快捷键 | 功能 | 适用场景 |
|--------|------|----------|
| S | 保存测量数据到剪贴板 | 量尺模式 |
| C | 切换坐标系（屏幕↔窗口） | 量尺模式 |
| ESC | 退出量尺模式 | 量尺模式 |
| 左键拖拽 | 测量矩形区域 | 矩形测量模式 |
| 移动鼠标 | 测量十字线像素 | 十字线测量模式 |

---

## 项目结构

```
window-ruler/
├── src/                          # 前端源码目录
│   ├── index.html               # 主 HTML 文件
│   ├── main.js                  # 前端核心逻辑
│   ├── styles.css               # 样式表
│   └── assets/                   # 静态资源
│       ├── javascript.svg
│       └── tauri.svg
│
├── src-tauri/                    # Tauri/Rust 后端目录
│   ├── Cargo.toml               # Rust 依赖配置
│   ├── build.rs                 # 构建脚本
│   ├── tauri.conf.json          # Tauri 配置文件
│   │
│   ├── src/                     # Rust 源码
│   │   ├── main.rs             # 程序入口
│   │   └── lib.rs              # 核心逻辑库
│   │
│   ├── capabilities/            # 权限配置
│   │   └── default.json
│   │
│   └── icons/                   # 应用图标
│       ├── icon.ico
│       ├── icon.png
│       └── ... (其他尺寸)
│
├── icons/                        # 前端使用的图标资源
│   ├── app-icon.svg
│   ├── rect-measure.svg
│   ├── crosshair-measure.svg
│   └── ...
│
├── .gitignore                   # Git 忽略文件
├── package.json                 # Node.js 依赖
└── README.md                    # 项目说明文档
```

### 文件说明

| 文件 | 说明 |
|------|------|
| `src/index.html` | HTML 主文件，定义工具栏和量尺覆盖层结构 |
| `src/main.js` | 前端逻辑，处理用户交互、Canvas 绘制、状态管理 |
| `src/styles.css` | 样式表，包含工具栏、量尺、信息面板的样式定义 |
| `src-tauri/src/lib.rs` | Rust 后端核心，包含窗口检测、点击穿透、像素捕获等 |
| `src-tauri/tauri.conf.json` | Tauri 配置，定义窗口属性、打包设置等 |

---

## 构建说明

### 环境配置

#### 安装 Rust

```bash
# 使用 rustup 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 或在 Windows 上下载 rustup-init.exe
```

#### 安装 Node.js

推荐使用 Node.js 18+ 版本。

#### 安装 WebView2

Windows 10 用户可能需要安装 WebView2 Runtime：
- 下载地址：https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### 构建步骤

```bash
# 1. 克隆项目
git clone https://github.com/your-username/window-ruler.git
cd window-ruler

# 2. 安装前端依赖
npm install

# 3. 开发模式运行
npm run tauri dev

# 4. 构建发布版本
npm run tauri build
```

### 构建配置

安装包格式在 `src-tauri/tauri.conf.json` 中配置：

```json
{
  "bundle": {
    "active": true,
    "targets": "nsis",
    "windows": {
      "nsis": null
    }
  }
}
```

---

## 核心实现原理

### 1. 窗口检测原理

Window Ruler 使用以下算法检测鼠标下的目标窗口：

```
1. 调用 GetCursorPos 获取鼠标屏幕坐标
2. 调用 WindowFromPoint 获取鼠标下的窗口句柄
3. 遍历 Z 序向上查找顶层窗口
4. 检查窗口可见性和标题
5. 获取窗口矩形区域
6. 若检测到自身窗口，通过 Z 序遍历找到真实目标
```

**关键 API**：
- `GetCursorPos` - 获取鼠标位置
- `WindowFromPoint` - 获取指定点的窗口
- `GetParent` / `GetAncestor` - 查找父窗口/顶层窗口
- `GetDesktopWindow` - 获取桌面窗口
- `GetWindow` - 遍历 Z 序查找窗口

### 2. 点击穿透原理

点击穿透通过设置窗口扩展样式实现：

```
1. 获取窗口句柄 (HWND)
2. 调用 GetWindowLongPtr 获取当前扩展样式
3. 设置 WS_EX_TRANSPARENT (0x00000020)
4. 调用 SetWindowLongPtr 应用新样式
5. 鼠标事件将穿透此窗口到达下层窗口
```

**注意**：WS_EX_TRANSPARENT 会导致窗口失去键盘焦点，需要调用 SetForegroundWindow 重新获取。

### 3. 像素测量原理

像素测量使用 DWM 合成截图实现：

```
1. 调用 SetWindowDisplayAffinity 排除量尺窗口
2. 创建内存 DC 和 DIBSection
3. 调用 BitBlt 捕获 DWM 合成桌面
4. 恢复窗口捕获属性
5. 读取 DIBSection 像素数据
6. 以鼠标位置颜色为基准
7. 四方向扫描同色像素边界
```

**技术要点**：
- 使用 `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` 排除量尺窗口
- `BitBlt` 捕获的是 DWM 合成后的桌面，包括所有窗口
- `CreateDIBSection` 创建的位图可直接读取像素数据
- 颜色容差设置为 10，使用 `abs_diff` 比较

### 4. 坐标系转换

```
屏幕坐标 → 窗口坐标：
    window_x = screen_x - window_left
    window_y = screen_y - window_top

画布坐标（量尺窗口）：
    canvas_x = screen_x - ruler_window_x
    canvas_y = screen_y - ruler_window_y
```

---

## 无障碍支持

Window Ruler 遵循 **WCAG 2.1 AA** 级无障碍标准：

### 语义化 HTML

```html
<!-- 使用语义化标签和 ARIA 属性 -->
<button aria-label="矩形测量">矩形测量</button>
<div role="status" aria-live="polite">测量信息</div>
<div role="tooltip" aria-hidden="true">坐标提示</div>
```

### 键盘可访问

- 所有交互元素可通过 Tab 键聚焦
- 使用 `:focus-visible` 提供焦点样式
- 支持键盘快捷键操作

### 屏幕阅读器支持

- 按钮包含 `aria-label` 描述
- 信息面板使用 `aria-live` 实时播报
- 颜色预览提供文本替代

### 对比度

- 文本与背景对比度 ≥ 4.5:1
- 信息面板使用半透明深色背景
- 测量线条使用高对比度颜色

### 色彩使用

| 用途 | 颜色 | 对比度 |
|------|------|--------|
| 主文本 | #f8fafc (白) | - |
| 背景 | rgba(15, 23, 42, 0.85) | 14.4:1 ✓ |
| 测量线 | #ef4444 (红) | - |
| 辅助线 | #3b82f6 (蓝) | - |

---

## 隐私声明

### 数据收集

**Window Ruler 不会收集、存储或传输任何用户数据。**

- 测量数据仅保存在系统剪贴板中，不会发送到任何服务器
- 窗口检测功能仅在本地运行，不涉及网络请求
- 程序不包含任何追踪器、广告或第三方服务

### 权限使用

本程序请求以下系统权限：

| 权限 | 用途 | 说明 |
|------|------|------|
| 窗口管理 | 检测目标窗口 | 仅读取窗口信息，不修改 |
| 屏幕截图 | 像素颜色测量 | 仅在量尺运行时临时使用 |
| 剪贴板 | 保存测量数据 | 仅在用户主动操作时写入 |

### 安全建议

1. 仅从官方渠道下载和安装程序
2. 杀毒软件可能将程序误报为风险软件（因使用了 Windows API）
3. 如有疑虑，可查看源码自行编译

---

## 许可证

### MIT 许可证

```
MIT License

Copyright (c) 2024 Window Ruler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 简体中文解释

MIT 许可证是一种宽松的开源许可证，允许您：

- ✓ 自由使用、复制、修改本软件
- ✓ 自由分发本软件的副本
- ✓ 自由将本软件用于商业目的
- ✓ 自由将本软件授权给他人

条件是：

- ⚠ 必须在分发时保留原始版权声明
- ⚠ 必须在分发时包含许可证全文

本软件按「原样」提供，不提供任何明示或暗示的保证。

---

## 免责声明

**使用本软件即表示您同意以下条款：**

### 1. 按原样提供

本软件「Window Ruler」按原样提供，不提供任何明示或暗示的保证，包括但不限于：

- 对适销性、特定用途适用性的暗示保证
- 对软件无缺陷、无错误的保证
- 对软件安全性、可靠性或性能的保证

### 2. 使用风险

您了解并同意：

- 使用本软件的唯一风险由您自己承担
- 作者和版权持有人不对任何直接、间接、偶然、特殊、惩戒性或后果性损害负责
- 包括但不限于：利润损失、数据丢失、业务中断或其他商业损害

### 3. 准确性

本软件用于屏幕测量，测量结果仅供参考：

- 实际像素值可能因显示缩放、DPI 设置等因素略有差异
- 建议在关键场景中交叉验证测量结果
- 作者不对测量不准确导致的任何损失负责

### 4. 兼容性问题

- 本软件仅在 Windows 10/11 (64位) 上测试
- 不保证与其他软件或系统的兼容性
- 杀毒软件可能误报本软件为风险软件

### 5. 终止使用

如果您不同意以上任何条款，请立即停止使用本软件。

### 6. 变更权利

作者保留随时修改此免责声明的权利，恕不另行通知。继续使用本软件即表示接受修改后的条款。

---

## 联系我们

- 项目主页：https://github.com/your-username/window-ruler
- 问题反馈：https://github.com/your-username/window-ruler/issues
- 功能建议：欢迎提交 Issue 或 Pull Request

---

**最后更新：2026年6月1日**
