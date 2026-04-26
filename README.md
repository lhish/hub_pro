# hub_pro

`hub_pro` 是一个用于 [Linux.do Hub](https://hub.linux.do/) Marketplace 的用户脚本，主要增强 `Channel Hub` 的筛选和浏览体验。

## 功能

- 默认进入 `Channel Hub`
- 让 `Channel Hub` 显示在 `Model Hub` 前面
- 用原页面风格增加 `Tags`、`Sort`、`Free`、模型关键字筛选
- 支持按热门度、消耗量、模型数量、名称等方式排序
- 支持只看免费 Channel
- 支持按支持的模型 ID 搜索 Channel
- 一页显示全部 Channel，不再分页
- 鼠标悬停 Channel 名称时显示支持的模型列表

## 安装

推荐从 GreasyFork 安装。发布完成后，GreasyFork 页面会提供一键安装按钮。

也可以从源码安装：

1. 安装 Tampermonkey、Violentmonkey 或其他用户脚本管理器。
2. 打开 `hub_pro.user.js`。
3. 把脚本内容添加到用户脚本管理器中。
4. 访问 <https://hub.linux.do/marketplace>。

## 友链

- [Linux.do](https://linux.do/)
- [Linux.do Hub](https://hub.linux.do/)

## 开发

运行测试：

```bash
node tests/marketplace-filter.test.mjs
node --check hub_pro.user.js
```

## 许可证

MIT License，见 [LICENSE](LICENSE)。
