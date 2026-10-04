# 📅 Calendar

一个极简的日历：**把你关心的日期写进一个 JSON 文件**，日历会高亮它们，
并且 **GitHub Actions 每天自动检查，命中当天就开一个 Issue 提醒你**。

- 🌐 **在线日历**：<https://drheeheamgary.github.io/Calendar/>
- 🔔 **提醒 Issue**：仓库 Issues 里标着 `calendar-reminder` 的那个
- 🪶 **零依赖**：不需要 `npm install`，只用 Node 内置能力

---

## 本仓库当前的部署状态

| | |
| --- | --- |
| 仓库 | <https://github.com/DRheEheAMGary/Calendar> |
| 在线日历 | <https://drheeheamgary.github.io/Calendar/> |
| 提醒 Issue | [#1 📅 日历提醒](https://github.com/DRheEheAMGary/Calendar/issues/1)（标着 `calendar-reminder`） |
| 定时任务 | 每天 UTC 22:00（北京时间 06:00） |

**第一次使用请先做这件事：** 打开 [`data/dates.json`](data/dates.json)，
把里面 6 条 `示例：…` 演示数据换成你自己的日期，然后 `git push`。
演示数据留着的话，日历上会一直显示它们。

### 怎么确认一切都正常

1. `node scripts/test.mjs` —— 本地跑 89 项检查；
2. 打开在线日历 —— 带圆点的日子就是被标记的日期；
3. **Actions ▸ Reminder ▸ Run workflow** —— 手动触发一次，跑完去 Issues 看有没有提醒；
4. 想彩排某一天，在上面那个手动触发里把 `date` 填成 `2026-11-30` 再运行。

---

## 它是怎么工作的

```
data/dates.json  ──┐
                   ├─→ scripts/generate-reminders.mjs ─→ data/reminder.json
data/config.json ──┘                                        │
                                                            ├─→ Actions 开 Issue 提醒
                                                            └─→ scripts/build-web.mjs → dist/ → GitHub Pages
```

| 文件 | 作用 |
| --- | --- |
| [`data/dates.json`](data/dates.json) | **你唯一需要改的文件** —— 所有要提醒的日期 |
| [`data/config.json`](data/config.json) | 时区、提前几天提醒、列表条数 |
| [`scripts/`](scripts) | 校验 / 生成提醒 / 构建网页 / 发 Issue |
| [`web/`](web) | 日历页面源码（HTML + CSS + 原生 JS） |
| [`.github/workflows/reminder.yml`](.github/workflows/reminder.yml) | 每天定时检查并开 Issue |
| [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) | 构建并发布日历到 Pages |

---

## 怎么加一个日期

编辑 [`data/dates.json`](data/dates.json)，往数组里加一条，然后 `git push`。
推送后 Pages 会自动重建页面，提醒任务也会重新读取。

```json
[
  {
    "id": "tax-2026",
    "date": "2026-11-30",
    "title": "报税截止",
    "repeat": "none",
    "note": "记得提前准备材料",
    "color": "amber"
  },
  {
    "id": "birthday-mom",
    "date": "1970-05-20",
    "title": "妈妈生日",
    "repeat": "yearly",
    "color": "rose"
  }
]
```

### 字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `date` | ✅ | `YYYY-MM-DD`。`repeat: "yearly"` 时只取**月-日**，年份随便填 |
| `title` | ✅ | 标题，最多 80 字 |
| `id` | 每年重复时必填 | 稳定标识符；改标题不影响它，便于日后加「跳过某一年」这类功能 |
| `repeat` | | `"none"`（默认，一次性）或 `"yearly"`（每年重复） |
| `leadDays` | | 提前几天开始提醒。不填就用 `config.json` 的 `noticeLeadDays` |
| `note` | | 备注，会显示在日历悬停、网页列表和 Issue 里 |
| `color` | | `blue` / `green` / `amber` / `rose` / `violet` |
| `active` | | 设为 `false` 可以临时停用，不必删掉 |

改完之后本地验证一下（不改文件，只检查）：

```bash
node scripts/validate-dates.mjs
```

写错了它会明确告诉你是**第几条、哪个字段**的问题，Actions 也会在第一步就拦下来，
不会发出一个内容奇怪的提醒。

---

## 提醒是怎么发的

[`.github/workflows/reminder.yml`](.github/workflows/reminder.yml) 每天 **UTC 22:00**
（= 北京时间次日 06:00）跑一次：

1. 校验两个数据文件；
2. 用**配置的时区**算出「今天」，找出所有落在今天的日期；
3. 如果今天有要提醒的事，就创建 / 更新当天的 Issue；否则**不开新 Issue**，
   并且把之前遗留的提醒 Issue 关掉 —— 所以 Issues 列表里最多只有一条打开的提醒。

Issue 里是带复选框的清单，你勾掉之后**下次运行仍会保留勾选状态**（脚本会读回旧正文）。

手动试跑：**Actions ▸ Reminder ▸ Run workflow**，可以填一个日期来「彩排」某一天：

```
date: 2026-11-30
```

### ⚠️ 两个必须知道的坑

1. **GitHub 会在仓库 60 天没有任何活动后停用定时任务。**
   让它重新生效：Actions ▸ Reminder ▸ Run workflow，手动跑一次即可。
   这个仓库每次运行都会更新 Issue，所以只要你有别的事情也在用，通常不会触发。
2. **定时任务可能延迟 5–20 分钟。** 脚本是用**运行时刻的时间戳**反推「今天是哪天」，
   所以延迟不会导致检查错日期。

---

## 网页

[`web/`](web) 是纯静态页面：原生 JS、无框架、无构建工具，深色/浅色跟随系统。
由 [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) 构建到 `dist/` 后发布到 GitHub Pages。

页面可以直接双击 `dist/index.html` 打开，也可以在本地起个静态服务器：

```bash
npm run build      # 校验 + 生成提醒 + 构建 + 检查
npx serve dist     # 或者 python -m http.server -d dist 8000
```

> 首次部署需要在 **Settings ▸ Pages ▸ Build and deployment ▸ Source** 里选
> **GitHub Actions**（本仓库已通过 API 设置好）。

---

## 本地命令

| 命令 | 作用 |
| --- | --- |
| `npm test` | 跑完整测试套件（89 项检查） |
| `npm run check` | 只校验 `data/*.json` |
| `npm run remind` | 打印今天的提醒 JSON |
| `npm run build` | 完整构建 + 产物检查（等同于 CI 做的事） |
| `npm run preview` | 构建但不做严格检查（缺少提醒数据也能出页面） |
| `npm run verify` | 测试 + 构建，提交前跑一遍最省心 |

调试某一天：

```bash
node scripts/generate-reminders.mjs --date 2026-11-30 --summary
```

发布 Issue 前先干跑一次（不会碰 issue，不需要 token）：

```bash
node scripts/publish-reminder-issue.mjs --dry-run
```

环境变量覆盖：`TZ_OVERRIDE=Asia/Tokyo`、`NOTICE_LEAD_DAYS=3`。

---

## 常见问题

**闰日生日怎么办？**
`repeat: "yearly"` 且日期是 `02-29` 时，闰年在 2/29 提醒，平年自动按 **2/28** 提醒，
不会消失也不会报错。

**想要提前几天预告？**
改 [`data/config.json`](data/config.json) 的 `noticeLeadDays`，或给某一条单独设 `leadDays`。

**想让提醒发到手机 / 邮箱？**
GitHub 的 Issue 通知会按你账号的通知设置发邮件或推送到 GitHub App。
想接微信/钉钉/Bark，在 `reminder.yml` 里加一个推送步骤，webhook 放仓库 Secrets 里即可。

**为什么提醒 Issue 自己关了？**
那天没有要提醒的日期，脚本会主动关掉上一条，保持 Issues 列表干净。

---

## 许可

[MIT](LICENSE)
