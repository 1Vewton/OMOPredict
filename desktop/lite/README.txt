OMOPredict {{VERSION}} - 轻量包（Windows x64）
=================================================

这个包**不包含** Python 运行环境，需要你机器上已有 Python 3.12+（或 uv）。
装一次依赖即可，之后正常双击使用。

一、准备引擎（只需一次）
------------------------

方式 A：有 uv（推荐，最快）
    powershell -ExecutionPolicy Bypass -File setup-engine.ps1

方式 B：只有 Python
    1) 确认版本：python --version      （需要 3.12 或更高）
    2) 运行：    powershell -ExecutionPolicy Bypass -File setup-engine.ps1

脚本会做什么：在 resources\engine 下安装引擎依赖，然后发一次 ping 确认引擎可用。
看到 "engine ready: ping ok" 就成功了。若下载慢，脚本会提示可用的镜像参数。

二、启动
--------

双击 OMOPredict.exe。首次启动需要几秒（要拉起引擎），之后正常。

三、出问题时
------------

1) 启动时弹"引擎不可用"：
   - 重新运行 setup-engine.ps1，看它给出的具体原因；
   - 确认 Python 版本 >= 3.12，且 `python -m omo.rpc` 能启动（Ctrl+C 退出）。

2) 想自助排查：
   - 程序菜单「文件 → 打开日志目录」，看当天的日志；
   - 「文件 → 导出诊断信息…」会生成一份脱敏的诊断 JSON（含版本、路径、后端日志尾部），
     方便连同问题一起反馈；密钥类信息已自动打码。

3) 关于杀毒软件：
   本包内的引擎是源码 + 你的 Python 环境，不含 PyInstaller 打包的可执行文件，
   通常不会被误报。完整包（内置引擎）才可能出现误报。

四、体积与内容
--------------

本包约 50MB 以内，包含：Electron 壳、Go 中间层（omopredict-server.exe）、
渲染页面（resources\dist）、引擎源码（resources\engine）。

结果与"完整包"完全一致——两者只差引擎来源（本包用你机器上的 Python）。
