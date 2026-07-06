@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ╔════════════════════════════════════════╗
echo ║       地图智能分析系统 - 启动脚本       ║
echo ╚════════════════════════════════════════╝
echo.

if not exist ".env" (
    echo [!] 未找到 .env 文件，正在从模板创建...
    copy ".env.example" ".env" >nul
    echo [!] 请先编辑 .env 文件，填写 AMAP_KEY 和 OLLAMA_MODEL
    echo.
    notepad .env
)

echo [*] 安装 Python 依赖...
pip install -r requirements.txt -q

echo [*] 安装 Playwright Chromium 浏览器...
playwright install chromium

echo.
echo [✓] 启动服务，访问 http://localhost:8000
echo.
python main.py

pause
