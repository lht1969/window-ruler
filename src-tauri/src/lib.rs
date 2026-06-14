use serde::{Deserialize, Serialize};
use tauri::{Manager, Window};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// 屏幕尺寸信息
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScreenInfo {
    pub width: u32,
    pub height: u32,
}

/// 目标窗口信息
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WindowInfo {
    pub exists: bool,
    pub title: String,
    pub rect: WindowRect,
    pub is_own_window: bool,
}

/// 窗口矩形区域
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WindowRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// 坐标点
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// 获取主显示器尺寸
#[tauri::command]
async fn get_screen_size(window: Window) -> Result<ScreenInfo, String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("无法获取当前显示器")?;

    let size = monitor.size();
    Ok(ScreenInfo {
        width: size.width,
        height: size.height,
    })
}

/// 写入剪贴板
#[tauri::command]
async fn write_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let clipboard = app.clipboard();
    clipboard
        .write_text(text)
        .map_err(|e| format!("剪贴板写入失败: {}", e))?;
    Ok(())
}

/// 设置窗口为点击穿透（鼠标事件穿透到下层窗口）
#[cfg(target_os = "windows")]
fn set_click_through(hwnd: isize, enable: bool) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TRANSPARENT,
    };
    use windows::Win32::Foundation::HWND;

    let hwnd = HWND(hwnd as *mut std::ffi::c_void);
    let mut ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;

    if enable {
        ex_style |= WS_EX_TRANSPARENT.0 as u32;
    } else {
        ex_style &= !WS_EX_TRANSPARENT.0 as u32;
    }

    unsafe {
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style as isize);
    }

    Ok(())
}

/// 启用点击穿透
#[tauri::command]
async fn enable_click_through(window: Window) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        set_click_through(hwnd, true)?;
    }
    Ok(())
}

/// 禁用点击穿透（开始测量时需要）
#[tauri::command]
async fn disable_click_through(window: Window) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        set_click_through(hwnd, false)?;
    }
    Ok(())
}

/// 检查 HWND 是否是自身应用的窗口（量尺窗口或主窗口）
#[cfg(target_os = "windows")]
fn is_own_app_window(app: &tauri::AppHandle, hwnd: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GA_ROOTOWNER};

    unsafe {
        // 检查是否是量尺窗口
        if let Some(ruler_win) = app.get_webview_window("ruler") {
            if let Ok(ruler_handle) = ruler_win.hwnd() {
                let ruler_hwnd = windows::Win32::Foundation::HWND(ruler_handle.0 as *mut std::ffi::c_void);
                if hwnd == ruler_hwnd {
                    return true;
                }
                let ancestor = GetAncestor(hwnd, GA_ROOTOWNER);
                if ancestor == ruler_hwnd {
                    return true;
                }
            }
        }

        if let Some(main_win) = app.get_webview_window("main") {
            if let Ok(main_handle) = main_win.hwnd() {
                let main_hwnd = windows::Win32::Foundation::HWND(main_handle.0 as *mut std::ffi::c_void);
                if hwnd == main_hwnd {
                    return true;
                }
                let ancestor = GetAncestor(hwnd, GA_ROOTOWNER);
                if ancestor == main_hwnd {
                    return true;
                }
            }
        }
    }
    false
}

/// Walk up the parent chain to find the top-level (root) window.
/// GetParent returns NULL for a top-level window without owner.
#[cfg(target_os = "windows")]
fn get_top_level_window(hwnd: windows::Win32::Foundation::HWND) -> windows::Win32::Foundation::HWND {
    use windows::Win32::UI::WindowsAndMessaging::GetParent;
    unsafe {
        let mut current = hwnd;
        loop {
            match GetParent(current) {
                Ok(p) if p.0 as isize != 0 => current = p,
                _ => return current,
            }
        }
    }
}

/// Get a Tauri webview window's HWND by label.
#[cfg(target_os = "windows")]
fn get_window_handle(app: &tauri::AppHandle, label: &str) -> Option<windows::Win32::Foundation::HWND> {
    app.get_webview_window(label).and_then(|w| {
        w.hwnd().ok().map(|h| windows::Win32::Foundation::HWND(h.0 as *mut std::ffi::c_void))
    })
}

/// 遍历 Z 序，找到包含指定屏幕坐标的第一个非自身可见顶层窗口
/// 从 Z 序最顶端的窗口开始向下遍历，返回第一个满足条件的窗口
#[cfg(target_os = "windows")]
fn find_window_at_point_by_zorder(app: &tauri::AppHandle, point: windows::Win32::Foundation::POINT) -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetDesktopWindow, GetWindow, GetWindowRect, GetWindowTextW, IsWindowVisible,
        GW_CHILD, GW_HWNDNEXT,
    };

    unsafe {
        // 获取桌面窗口，然后取其 Z 序最顶端的子窗口
        let desktop = GetDesktopWindow();
        // GW_CHILD 返回桌面的 Z 序最顶端的子窗口
        let mut current = GetWindow(desktop, GW_CHILD)
            .unwrap_or(windows::Win32::Foundation::HWND(std::ptr::null_mut()));

        let max_iter = 512;
        for _ in 0..max_iter {
            if current.0 as isize == 0 {
                return None;
            }

            // 跳过自身应用的窗口
            if is_own_app_window(app, current) {
                current = GetWindow(current, GW_HWNDNEXT)
                    .unwrap_or(windows::Win32::Foundation::HWND(std::ptr::null_mut()));
                continue;
            }

            // 必须可见
            if !IsWindowVisible(current).as_bool() {
                current = GetWindow(current, GW_HWNDNEXT)
                    .unwrap_or(windows::Win32::Foundation::HWND(std::ptr::null_mut()));
                continue;
            }

            // 必须有非空标题
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(current, &mut buf);
            if len == 0 {
                current = GetWindow(current, GW_HWNDNEXT)
                    .unwrap_or(windows::Win32::Foundation::HWND(std::ptr::null_mut()));
                continue;
            }

            // 检查鼠标是否在窗口矩形内
            let mut rect = RECT::default();
            if GetWindowRect(current, &mut rect).is_ok() {
                if point.x >= rect.left && point.x <= rect.right
                    && point.y >= rect.top && point.y <= rect.bottom
                {
                    return Some(current);
                }
            }

            current = GetWindow(current, GW_HWNDNEXT)
                .unwrap_or(windows::Win32::Foundation::HWND(std::ptr::null_mut()));
        }
        None
    }
}

/// 获取鼠标指针下的目标窗口（跳过自身应用的窗口）
#[cfg(target_os = "windows")]
fn find_target_window_under_mouse(app: &tauri::AppHandle) -> Option<WindowInfo> {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowRect, GetWindowTextW, IsWindowVisible, WindowFromPoint,
    };

    unsafe {
        let mut point = POINT::default();
        if GetCursorPos(&mut point).is_err() {
            return None;
        }

        // 1. 先尝试 WindowFromPoint（正常情况下最快）
        let hwnd = WindowFromPoint(point);
        if hwnd.0 as isize == 0 {
            return None;
        }

        let toplevel = get_top_level_window(hwnd);
        if toplevel.0 as isize == 0 {
            return None;
        }

        // 2. 如果命中的是自身窗口，通过 Z 序遍历找到鼠标位置下的真实目标窗口
        //    不再使用 SetWindowPos 临时降低/恢复窗口层级的方式，
        //    因为 SetWindowPos 后 Windows 不会立即更新 Z 序，导致 WindowFromPoint 仍返回自身窗口
        let target = if is_own_app_window(app, toplevel) {
            // 直接通过 Z 序遍历找到鼠标位置下的第一个非自身窗口
            find_window_at_point_by_zorder(app, point)?
        } else {
            toplevel
        };

        // 3. 验证目标窗口：可见 + 非空标题
        if !IsWindowVisible(target).as_bool() {
            return None;
        }
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(target, &mut buf);
        if len == 0 {
            return None;
        }
        let title = String::from_utf16_lossy(&buf[..len as usize]);

        // 4. 获取窗口矩形
        let mut rect = RECT::default();
        if GetWindowRect(target, &mut rect).is_err() {
            return None;
        }

        Some(WindowInfo {
            exists: true,
            title,
            rect: WindowRect {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
            },
            is_own_window: false,
        })
    }
}

/// 获取鼠标指针下的窗口信息（内部函数）
#[cfg(target_os = "windows")]
fn get_window_under_mouse_internal(app: &tauri::AppHandle) -> WindowInfo {
    find_target_window_under_mouse(app).unwrap_or(WindowInfo {
        exists: false,
        title: String::new(),
        rect: WindowRect { left: 0, top: 0, right: 0, bottom: 0 },
        is_own_window: false,
    })
}



#[cfg(not(target_os = "windows"))]
fn get_window_under_mouse_internal(_app: &tauri::AppHandle) -> WindowInfo {
    WindowInfo {
        exists: false,
        title: String::from("仅支持Windows系统"),
        rect: WindowRect { left: 0, top: 0, right: 0, bottom: 0 },
        is_own_window: false,
    }
}

/// 获取鼠标下的窗口信息（前端轮询调用）
#[tauri::command]
async fn get_window_under_mouse(app: tauri::AppHandle) -> WindowInfo {
    get_window_under_mouse_internal(&app)
}

/// 创建全屏量尺覆盖窗口
/// pixel_mode: true 时自动进入十字线测量模式
#[tauri::command]
async fn create_ruler_window(app: tauri::AppHandle, pixel_mode: Option<bool>, coord_system: Option<String>) -> Result<String, String> {
    // 检查是否已存在量尺窗口
    if let Some(win) = app.get_webview_window("ruler") {
        let _ = win.close();
    }

    let monitor = app
        .get_webview_window("main")
        .ok_or("主窗口不存在")?
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("无法获取显示器")?;

    let size = monitor.size();
    let position = monitor.position();

    let coord = coord_system.unwrap_or_else(|| "screen".to_string());
    let url = if pixel_mode.unwrap_or(false) {
        tauri::WebviewUrl::App(format!("index.html?mode=ruler&pixel=1&coord={}", coord).into())
    } else {
        tauri::WebviewUrl::App(format!("index.html?mode=ruler&coord={}", coord).into())
    };

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "ruler",
        url,
    )
    .title("Screen Ruler")
    .position(position.x as f64, position.y as f64)
    .inner_size(size.width as f64, size.height as f64)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true)
    .resizable(false)
    .fullscreen(false)
    .focused(true)
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;

    // 初始启用点击穿透（让鼠标事件穿透到下层窗口）
    #[cfg(target_os = "windows")]
    {
        use tauri::Emitter;
        let hwnd_raw = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let _ = set_click_through(hwnd_raw, true);
        // WS_EX_TRANSPARENT 会使 Windows 收回键盘焦点，强制重新置前
        extern "system" {
            fn SetForegroundWindow(hWnd: isize) -> i32;
        }
        let _ = unsafe { SetForegroundWindow(hwnd_raw) };
        let _ = window.emit("ruler-ready", ());
    }

    #[cfg(not(target_os = "windows"))]
    {
        use tauri::Emitter;
        let _ = window.emit("ruler-ready", ());
    }

    Ok("量尺窗口已创建".to_string())
}

/// 最小化主窗口
#[tauri::command]
async fn minimize_main_window(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// 关闭量尺窗口
#[tauri::command]
async fn close_ruler_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("ruler") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 手动将键盘焦点设置到量尺窗口
#[tauri::command]
async fn focus_ruler_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(win) = app.get_webview_window("ruler") {
            if let Ok(hwnd) = win.hwnd() {
                let raw: isize = hwnd.0 as isize;
                extern "system" {
                    fn SetForegroundWindow(hWnd: isize) -> i32;
                }
                let _ = unsafe { SetForegroundWindow(raw) };
                return Ok(());
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
    Err("量尺窗口不存在或无法获取焦点".to_string())
}

// ============================================
// 像素颜色检测测量功能
// ============================================

/// 像素颜色测量结果
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PixelMeasureResult {
    /// 基准颜色 (RGB)
    pub base_color: [u8; 3],
    /// 水平方向左边界（相对于屏幕）
    pub left: i32,
    /// 水平方向右边界（相对于屏幕）
    pub right: i32,
    /// 垂直方向上边界（相对于屏幕）
    pub top: i32,
    /// 垂直方向下边界（相对于屏幕）
    pub bottom: i32,
    /// 水平方向总宽度（像素数）
    pub width: i32,
    /// 垂直方向总高度（像素数）
    pub height: i32,
    /// 鼠标位置屏幕坐标 X
    pub cursor_x: i32,
    /// 鼠标位置屏幕坐标 Y
    pub cursor_y: i32,
}

/// 透过量尺窗口读取屏幕像素颜色。
/// 用 SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) 将量尺窗口排除在截图之外，
/// 然后 BitBlt 捕获 DWM 合成桌面 → 读入 CreateDIBSection 的直接像素指针。
/// 量尺全程保持可见，不闪烁。
#[cfg(target_os = "windows")]
fn capture_screen_under_ruler(ruler_hwnd_raw: isize, cursor_x: i32, cursor_y: i32) -> Option<PixelMeasureResult> {
    extern "system" {
        fn GetDC(hWnd: isize) -> isize;
        fn ReleaseDC(hWnd: isize, hDC: isize) -> i32;
        fn CreateCompatibleDC(hDC: isize) -> isize;
        fn DeleteDC(hDC: isize) -> i32;
        fn SelectObject(hDC: isize, h: isize) -> isize;
        fn DeleteObject(h: isize) -> i32;
        fn BitBlt(dest: isize, x: i32, y: i32, w: i32, h: i32, src: isize, x1: i32, y1: i32, rop: u32) -> i32;
        fn GetDeviceCaps(hDC: isize, index: i32) -> i32;
        fn SetWindowDisplayAffinity(hWnd: isize, affinity: u32) -> i32;
        fn CreateDIBSection(hdc: isize, bmi: *const BITMAPINFO, usage: u32, bits: *mut *mut std::ffi::c_void, section: isize, offset: u32) -> isize;
    }

    const SRCCOPY: u32 = 0x00CC0020;
    const HORZRES: i32 = 8;
    const VERTRES: i32 = 10;
    const WDA_NONE: u32 = 0x00000000;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x00000011;
    const DIB_RGB_COLORS: u32 = 0;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct BMIH {
        size: u32,
        w: i32,
        h: i32,
        planes: u16,
        bpp: u16,
        compression: u32,
        image_size: u32,
        x_ppm: i32,
        y_ppm: i32,
        used: u32,
        important: u32,
    }
    #[repr(C)]
    struct BITMAPINFO {
        header: BMIH,
        colors: [u32; 1],
    }

    // --- 1. 排除量尺窗口：SetWindowDisplayAffinity ---
    unsafe {
        SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_EXCLUDEFROMCAPTURE);
    }

    // --- 2. 获取屏幕 DC 和尺寸 ---
    let hdc_screen;
    let sw;
    let sh;
    unsafe {
        hdc_screen = GetDC(0);
        if hdc_screen == 0 {
            SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
            return None;
        }
        sw = GetDeviceCaps(hdc_screen, HORZRES);
        sh = GetDeviceCaps(hdc_screen, VERTRES);
    }

    // --- 3. 创建内存 DC 和 DIBSection（32-bit top-down）---
    let hdc_mem;
    let hbmp;
    let old_bmp;
    let mut bits_ptr: *mut std::ffi::c_void = std::ptr::null_mut();

    unsafe {
        hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem == 0 {
            ReleaseDC(0, hdc_screen);
            SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
            return None;
        }

        let bmi = BITMAPINFO {
            header: BMIH {
                size: std::mem::size_of::<BMIH>() as u32,
                w: sw,
                h: -sh,  // top-down: 第一行 = 屏幕顶部
                planes: 1,
                bpp: 32,
                compression: 0,
                ..std::mem::zeroed()
            },
            colors: [0; 1],
        };

        hbmp = CreateDIBSection(
            hdc_screen,
            &bmi as *const BITMAPINFO,
            DIB_RGB_COLORS,
            &mut bits_ptr,
            0,
            0,
        );
        if hbmp == 0 {
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
            return None;
        }

        old_bmp = SelectObject(hdc_mem, hbmp);
    }

    // --- 4. BitBlt 捕获 DWM 合成桌面（量尺已被排除）---
    let ok;
    unsafe {
        ok = BitBlt(hdc_mem, 0, 0, sw, sh, hdc_screen, 0, 0, SRCCOPY);
    }
    if ok == 0 {
        unsafe {
            SelectObject(hdc_mem, old_bmp);
            DeleteObject(hbmp);
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
        }
        return None;
    }

    // --- 5. 恢复量尺窗口的捕获属性 ---
    unsafe {
        SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
    }

    // --- 6. bits_ptr 指向 DIBSection 的像素数据（BGR 32bpp）---
    //     必须在 DeleteObject(hbmp) 之前读取全部像素，否则内存被释放
    let stride = ((sw * 32 + 31) / 32) * 4;
    let buf_size = (stride * sh) as usize;
    let mut pixels: Vec<u8> = Vec::with_capacity(buf_size);
    unsafe {
        pixels.set_len(buf_size);
        std::ptr::copy_nonoverlapping(bits_ptr as *const u8, pixels.as_mut_ptr(), buf_size);
    }

    // --- 7. 清理 GDI 资源 ---
    unsafe {
        SelectObject(hdc_mem, old_bmp);
        DeleteObject(hbmp);
        DeleteDC(hdc_mem);
        ReleaseDC(0, hdc_screen);
    }

    // --- 8. 读取基准颜色 ---
    if cursor_x < 0 || cursor_x >= sw || cursor_y < 0 || cursor_y >= sh {
        return None;
    }
    let idx = (cursor_y * stride + cursor_x * 4) as usize;
    let b = pixels[idx];
    let g = pixels[idx + 1];
    let r = pixels[idx + 2];
    let base_color = [r, g, b];

    let tolerance: u8 = 10;

    // --- 9. 向左扫描 ---
    let mut left = cursor_x;
    while left > 0 {
        let test_x = left - 1;
        let ti = (cursor_y * stride + test_x * 4) as usize;
        let pr = pixels[ti + 2];
        let pg = pixels[ti + 1];
        let pb = pixels[ti];
        if pr.abs_diff(base_color[0]) <= tolerance
            && pg.abs_diff(base_color[1]) <= tolerance
            && pb.abs_diff(base_color[2]) <= tolerance
        {
            left = test_x;
        } else {
            break;
        }
    }

    // --- 向右 ---
    let mut right = cursor_x;
    while right < sw - 1 {
        let test_x = right + 1;
        let ti = (cursor_y * stride + test_x * 4) as usize;
        let pr = pixels[ti + 2];
        let pg = pixels[ti + 1];
        let pb = pixels[ti];
        if pr.abs_diff(base_color[0]) <= tolerance
            && pg.abs_diff(base_color[1]) <= tolerance
            && pb.abs_diff(base_color[2]) <= tolerance
        {
            right = test_x;
        } else {
            break;
        }
    }

    // --- 向上 ---
    let mut top = cursor_y;
    while top > 0 {
        let test_y = top - 1;
        let ti = (test_y * stride + cursor_x * 4) as usize;
        let pr = pixels[ti + 2];
        let pg = pixels[ti + 1];
        let pb = pixels[ti];
        if pr.abs_diff(base_color[0]) <= tolerance
            && pg.abs_diff(base_color[1]) <= tolerance
            && pb.abs_diff(base_color[2]) <= tolerance
        {
            top = test_y;
        } else {
            break;
        }
    }

    // --- 向下 ---
    let mut bottom = cursor_y;
    while bottom < sh - 1 {
        let test_y = bottom + 1;
        let ti = (test_y * stride + cursor_x * 4) as usize;
        let pr = pixels[ti + 2];
        let pg = pixels[ti + 1];
        let pb = pixels[ti];
        if pr.abs_diff(base_color[0]) <= tolerance
            && pg.abs_diff(base_color[1]) <= tolerance
            && pb.abs_diff(base_color[2]) <= tolerance
        {
            bottom = test_y;
        } else {
            break;
        }
    }

    Some(PixelMeasureResult {
        base_color,
        left,
        right,
        top,
        bottom,
        width: right - left + 1,
        height: bottom - top + 1,
        cursor_x,
        cursor_y,
    })
}

#[cfg(not(target_os = "windows"))]
fn capture_screen_under_ruler(_hwnd: isize, _x: i32, _y: i32) -> Option<PixelMeasureResult> {
    None
}

// ============================================
// 截屏功能：截取指定矩形区域到剪贴板（DIB 格式图片）
// ============================================

/// 截取指定屏幕区域到剪贴板（排除量尺窗口自身）
#[cfg(target_os = "windows")]
fn capture_region_to_clipboard_impl(ruler_hwnd_raw: isize, left: i32, top: i32, right: i32, bottom: i32) -> Result<(), String> {
    extern "system" {
        fn GetDC(hWnd: isize) -> isize;
        fn ReleaseDC(hWnd: isize, hDC: isize) -> i32;
        fn CreateCompatibleDC(hDC: isize) -> isize;
        fn DeleteDC(hDC: isize) -> i32;
        fn SelectObject(hDC: isize, h: isize) -> isize;
        fn DeleteObject(h: isize) -> i32;
        fn BitBlt(dest: isize, x: i32, y: i32, w: i32, h: i32, src: isize, x1: i32, y1: i32, rop: u32) -> i32;
        fn GetDeviceCaps(hDC: isize, index: i32) -> i32;
        fn SetWindowDisplayAffinity(hWnd: isize, affinity: u32) -> i32;
        fn CreateDIBSection(hdc: isize, bmi: *const BITMAPINFO, usage: u32, bits: *mut *mut std::ffi::c_void, section: isize, offset: u32) -> isize;
        fn OpenClipboard(hWnd: isize) -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, hMem: isize) -> isize;
        fn CloseClipboard() -> i32;
        fn GlobalAlloc(flags: u32, size: usize) -> isize;
        fn GlobalLock(hMem: isize) -> *mut std::ffi::c_void;
        fn GlobalUnlock(hMem: isize) -> i32;
    }

    const SRCCOPY: u32 = 0x00CC0020;
    const HORZRES: i32 = 8;
    const VERTRES: i32 = 10;
    const WDA_NONE: u32 = 0x00000000;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x00000011;
    const DIB_RGB_COLORS: u32 = 0;
    const CF_DIB: u32 = 8;
    const GMEM_MOVEABLE: u32 = 0x0002;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct BMIH {
        size: u32,
        w: i32,
        h: i32,
        planes: u16,
        bpp: u16,
        compression: u32,
        image_size: u32,
        x_ppm: i32,
        y_ppm: i32,
        used: u32,
        important: u32,
    }
    #[repr(C)]
    struct BITMAPINFO {
        header: BMIH,
        colors: [u32; 1],
    }

    let rw = right - left;
    let rh = bottom - top;
    if rw <= 0 || rh <= 0 {
        return Err("无效的截屏区域".to_string());
    }

    // --- 1. 排除量尺窗口 ---
    unsafe {
        SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_EXCLUDEFROMCAPTURE);
    }

    // --- 2. 获取屏幕 DC 和尺寸 ---
    let hdc_screen;
    let sw;
    let sh;
    unsafe {
        hdc_screen = GetDC(0);
        if hdc_screen == 0 {
            SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
            return Err("获取屏幕 DC 失败".to_string());
        }
        sw = GetDeviceCaps(hdc_screen, HORZRES);
        sh = GetDeviceCaps(hdc_screen, VERTRES);
    }

    // --- 3. 创建内存 DC 和 DIBSection（top-down，全屏）---
    let hdc_mem;
    let hbmp;
    let old_bmp;
    let mut bits_ptr: *mut std::ffi::c_void = std::ptr::null_mut();

    unsafe {
        hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem == 0 {
            ReleaseDC(0, hdc_screen);
            SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
            return Err("创建内存 DC 失败".to_string());
        }

        let bmi = BITMAPINFO {
            header: BMIH {
                size: std::mem::size_of::<BMIH>() as u32,
                w: sw,
                h: -sh,
                planes: 1,
                bpp: 32,
                compression: 0,
                ..std::mem::zeroed()
            },
            colors: [0; 1],
        };

        hbmp = CreateDIBSection(hdc_screen, &bmi as *const BITMAPINFO, DIB_RGB_COLORS, &mut bits_ptr, 0, 0);
        if hbmp == 0 {
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
            return Err("创建 DIBSection 失败".to_string());
        }

        old_bmp = SelectObject(hdc_mem, hbmp);
    }

    // --- 4. BitBlt 捕获全屏 ---
    let ok;
    unsafe {
        ok = BitBlt(hdc_mem, 0, 0, sw, sh, hdc_screen, 0, 0, SRCCOPY);
    }
    if ok == 0 {
        unsafe {
            SelectObject(hdc_mem, old_bmp);
            DeleteObject(hbmp);
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
        }
        return Err("BitBlt 截屏失败".to_string());
    }

    // --- 5. 恢复量尺窗口 ---
    unsafe {
        SetWindowDisplayAffinity(ruler_hwnd_raw, WDA_NONE);
    }

    // --- 6. 读取全屏像素数据 ---
    let stride = ((sw * 32 + 31) / 32) * 4;
    let buf_size = (stride * sh) as usize;
    let mut full_pixels: Vec<u8> = Vec::with_capacity(buf_size);
    unsafe {
        full_pixels.set_len(buf_size);
        std::ptr::copy_nonoverlapping(bits_ptr as *const u8, full_pixels.as_mut_ptr(), buf_size);
    }

    // --- 7. 清理 GDI 资源 ---
    unsafe {
        SelectObject(hdc_mem, old_bmp);
        DeleteObject(hbmp);
        DeleteDC(hdc_mem);
        ReleaseDC(0, hdc_screen);
    }

    // --- 8. 裁剪区域并构造 DIB（bottom-up）---
    // 裁剪区域必须在屏幕范围内
    let left = left.max(0).min(sw - 1);
    let top = top.max(0).min(sh - 1);
    let right = right.max(left + 1).min(sw);
    let bottom = bottom.max(top + 1).min(sh);
    let rw = right - left;
    let rh = bottom - top;

    let header_size = std::mem::size_of::<BMIH>() as u32;
    let row_bytes = (rw * 4) as usize;
    let pixel_data_size = row_bytes * (rh as usize);
    let dib_size = header_size as usize + pixel_data_size;

    unsafe {
        let h_mem = GlobalAlloc(GMEM_MOVEABLE, dib_size);
        if h_mem == 0 {
            return Err("GlobalAlloc 失败".to_string());
        }
        let p_mem = GlobalLock(h_mem) as *mut u8;
        if p_mem.is_null() {
            GlobalUnlock(h_mem);
            return Err("GlobalLock 失败".to_string());
        }

        // 写入 BITMAPINFOHEADER（正高度 = bottom-up）
        let header = BMIH {
            size: header_size,
            w: rw,
            h: rh,
            planes: 1,
            bpp: 32,
            compression: 0,
            ..std::mem::zeroed()
        };
        std::ptr::copy_nonoverlapping(&header as *const BMIH as *const u8, p_mem, header_size as usize);

        // 写入像素数据（转换为 bottom-up）
        let dst = p_mem.add(header_size as usize);
        let src_stride = stride as usize;
        for out_y in 0..rh {
            // source row in top-down: top + (rh - 1 - out_y)
            let src_row = (top + (rh - 1 - out_y)) as usize;
            let src_offset = src_row * src_stride + (left as usize) * 4;
            let dst_offset = (out_y as usize) * row_bytes;
            std::ptr::copy_nonoverlapping(
                full_pixels.as_ptr().add(src_offset),
                dst.add(dst_offset),
                row_bytes,
            );
        }

        GlobalUnlock(h_mem);

        // 打开剪贴板并设置 DIB 数据
        if OpenClipboard(0) == 0 {
            return Err("打开剪贴板失败".to_string());
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            return Err("清空剪贴板失败".to_string());
        }
        if SetClipboardData(CF_DIB, h_mem) == 0 {
            CloseClipboard();
            return Err("设置剪贴板数据失败".to_string());
        }
        CloseClipboard();
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn capture_region_to_clipboard_impl(_hwnd: isize, _left: i32, _top: i32, _right: i32, _bottom: i32) -> Result<(), String> {
    Err("截屏功能仅支持 Windows 系统".to_string())
}

/// Tauri 命令：截取指定屏幕区域到剪贴板
#[allow(unused_variables)]
#[tauri::command]
async fn capture_region_to_clipboard(app: tauri::AppHandle, left: i32, top: i32, right: i32, bottom: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let ruler_hwnd = get_window_handle(&app, "ruler")
            .map(|hwnd| hwnd.0 as isize)
            .unwrap_or(0);
        if ruler_hwnd == 0 {
            return Err("量尺窗口不存在".to_string());
        }
        capture_region_to_clipboard_impl(ruler_hwnd, left, top, right, bottom)?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, left, top, right, bottom);
        return Err("截屏功能仅支持 Windows 系统".to_string());
    }
    Ok(())
}

/// Tauri 命令：测量鼠标位置处同色像素的边界范围
/// 临时隐藏量尺窗口 → BitBlt 捕获 DWM 合成桌面 → 恢复 → 扫描内存缓存
#[allow(unused_variables)]
#[tauri::command]
async fn measure_pixel_bounds(app: tauri::AppHandle, cursor_x: i32, cursor_y: i32) -> Result<Option<PixelMeasureResult>, String> {
    #[cfg(target_os = "windows")]
    {
        let ruler_hwnd = get_window_handle(&app, "ruler")
            .map(|hwnd| hwnd.0 as isize)
            .unwrap_or(0);
        if ruler_hwnd != 0 {
            return Ok(capture_screen_under_ruler(ruler_hwnd, cursor_x, cursor_y));
        }
    }
    Ok(None)
}

/// 将工具栏窗口定位到主显示器顶部中央
#[tauri::command]
async fn position_toolbar(window: Window) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("无法获取当前显示器")?;
    let pos = monitor.position();
    let size = monitor.size();
    let toolbar_w = 520i32;
    let x = pos.x + (size.width as i32 - toolbar_w) / 2;
    window
        .set_position(tauri::PhysicalPosition::new(x, pos.y))
        .map_err(|e| e.to_string())?;
    // 先定位再显示，避免白屏闪烁
    window.show().map_err(|e| e.to_string())
}

/// 隐藏工具栏窗口
#[tauri::command]
async fn hide_main_window(window: Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// 显示并聚焦工具栏窗口
/// 注意：此命令可能从 ruler 窗口调用，因此不能用 Window 参数（会绑定到 ruler）
#[tauri::command]
async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 退出整个应用程序
#[tauri::command]
async fn exit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// 创建关于窗口
#[tauri::command]
async fn create_about_window(app: tauri::AppHandle) -> Result<(), String> {
    // 如果关于窗口已存在，则聚焦并返回
    if let Some(win) = app.get_webview_window("about") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // 获取主窗口所在的显示器信息
    let monitor = app
        .get_webview_window("main")
        .ok_or("主窗口不存在")?
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("无法获取显示器")?;

    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();

    // 计算窗口居中位置
    let window_width = 380.0;
    let window_height = 420.0;
    let x = monitor_pos.x as f64 + (monitor_size.width as f64 - window_width) / 2.0;
    let y = monitor_pos.y as f64 + (monitor_size.height as f64 - window_height) / 2.0;

    // 创建关于窗口
    tauri::WebviewWindowBuilder::new(
        &app,
        "about",
        tauri::WebviewUrl::App("about.html".into()),
    )
    .title("关于 Window Ruler")
    .inner_size(window_width, window_height)
    .position(x, y)
    .resizable(false)
    .maximizable(false)
    .minimizable(true)
    .visible(true)
    .focused(true)
    .decorations(true)
    .always_on_top(true)
    .build()
    .map_err(|e| format!("创建关于窗口失败: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_screen_size,
            write_clipboard,
            create_ruler_window,
            close_ruler_window,
            focus_ruler_window,
            minimize_main_window,
            hide_main_window,
            show_main_window,
            position_toolbar,
            exit_app,
            create_about_window,
            enable_click_through,
            disable_click_through,
            get_window_under_mouse,
            measure_pixel_bounds,
            capture_region_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
