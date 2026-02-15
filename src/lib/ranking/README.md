# lib/ranking

全球轨道交通排行榜与工程里程排名计算。

## 文件说明

- **worldMetroRanking.js** — 从 Wikipedia `List of metro systems` 实时拉取全球地铁系统表格（MediaWiki Parse API），解析 `System length` 字段并输出按里程降序的排行榜。计算当前工程总里程与全球名次、前后相邻条目与里程差。
