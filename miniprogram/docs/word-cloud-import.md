# 词库导入到云开发

1. 打开微信开发者工具，确认云环境是 `cloud1-4gsbdd828457096e`。
2. 进入云开发数据库，新建集合 `words`。
3. 先导入测试文件 `/Users/zb/Documents/小程序/vibe coding/卡片英语学习/cloud-data/words/ecdict.mini.csv`。
4. 验证单词页能正常加载后，再导入完整文件 `/Users/zb/Documents/小程序/vibe coding/卡片英语学习/cloud-data/words/ecdict.csv`。
5. 重新部署云函数 `quickstartFunctions`。

当前单词页和单词详情页会读取 `words` 集合里的这些字段：

- `word`
- `phonetic`
- `translation`
- `definition`
- `detail`
- `pos`
- `exchange`
- `audio`
- `collins`
- `oxford`
- `bnc`
- `frq`
- `tag`

页面默认每次从云端取 200 条，取到的数据会写入本地缓存。
