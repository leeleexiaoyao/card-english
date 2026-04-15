# 百度云 TTS 云开发配置

1. 在微信开发者工具右上角打开“云开发”。
2. 创建一个云环境，记录环境 ID。
3. 打开 `miniprogram/app.js`，把 `globalData.env` 改成该环境 ID。
4. 在云开发控制台的云函数列表里上传部署 `cloudfunctions/baiduTts`。
5. 在 `baiduTts` 云函数环境变量里新增：
   - `BAIDU_TTS_API_KEY`
   - `BAIDU_TTS_SECRET_KEY`
   - `BAIDU_TTS_APP_ID`
6. 重新编译小程序。

说明：
- 句子发音通过小程序调用云函数，再由云函数请求百度 TTS。
- 百度凭证不要写进前端代码或仓库。
- 前端会把云函数返回的音频下载到本地并缓存。
