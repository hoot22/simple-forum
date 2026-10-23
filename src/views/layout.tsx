import type { User } from '../types'
import {
  CONTACT_LINKS,
  FRIEND_LINKS,
  isExternalLink,
  normalizeFooterLinks,
  type FooterLink,
} from '../site/footer'

export const css = `
  /* 发帖可选字体：文件见 public/fonts/，清单见 src/fonts/post-fonts.ts */
  @font-face {
    font-family: 'Forum WQY Bitmap Song';
    src: url('/fonts/WenQuanYi.Bitmap.Song.16px.ttf') format('truetype');
    font-display: swap;
  }
  :root {
    color-scheme: light;
    /* 日间色值取自 theme-color-scheme.md 的 Studio token */
    --fg: #141414;
    --muted: #737373;
    --line: #d6d6d6;
    /* Studio 主题色 #478cbf 在白底仅 3.6:1，故文字/边框改用同色板 active 档 */
    --accent: #3d78a4;
    --accent-dark: #356a91;
    /* 白字实心按钮用独立变量，避免夜间沿用 #478cbf 时对比度不足 */
    --accent-solid: #3d78a4;
    --accent-solid-hover: #356a91;
    --accent-subtle: rgb(71 140 191 / 10%);
    --accent-ring: rgb(71 140 191 / 25%);
    --bg: #f5f5f5;
    --card: #ffffff;
    --danger: #c9302c;
    --danger-bg: rgb(255 77 79 / 10%);
    --danger-line: rgb(255 77 79 / 30%);
    --danger-solid: #d9363e;
    --danger-solid-hover: #b92b33;
    --warning: #faad14;
    --warning-bg: rgb(250 173 20 / 14%);
    --warning-line: rgb(250 173 20 / 38%);
    --warning-text: #8a6100;
    --control-hover: #f0f0f0;
    --radius: 8px;
  }

  /* ---------- 夜间模式调色板 ---------- */

  /* 用户手动切换后由 data-theme 显式生效 */
  :root[data-theme='dark'] {
    color-scheme: dark;
    --fg: #e8e8e8;
    --muted: #8c8c8c;
    --line: #3b3b3b;
    --accent: #478cbf;
    --accent-dark: #649ec9;
    --accent-solid: #417fae;
    --accent-solid-hover: #4a89bb;
    --accent-subtle: rgb(71 140 191 / 16%);
    --accent-ring: rgb(71 140 191 / 40%);
    --bg: #141414;
    --card: #1b1b1b;
    --danger: #ff4d4f;
    --danger-bg: rgb(255 77 79 / 16%);
    --danger-line: rgb(255 77 79 / 40%);
    --danger-solid: #d9363e;
    --danger-solid-hover: #b92b33;
    --warning: #faad14;
    --warning-bg: rgb(250 173 20 / 16%);
    --warning-line: rgb(250 173 20 / 40%);
    --warning-text: #faad14;
    --control-hover: #242424;
  }

  /* 尚未手动选择主题时跟随系统偏好 */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme]) {
      color-scheme: dark;
      --fg: #e8e8e8;
      --muted: #8c8c8c;
      --line: #3b3b3b;
      --accent: #478cbf;
      --accent-dark: #649ec9;
      --accent-solid: #417fae;
      --accent-solid-hover: #4a89bb;
      --accent-subtle: rgb(71 140 191 / 16%);
      --accent-ring: rgb(71 140 191 / 40%);
      --bg: #141414;
      --card: #1b1b1b;
      --danger: #ff4d4f;
      --danger-bg: rgb(255 77 79 / 16%);
      --danger-line: rgb(255 77 79 / 40%);
      --danger-solid: #d9363e;
      --danger-solid-hover: #b92b33;
      --warning: #faad14;
      --warning-bg: rgb(250 173 20 / 16%);
      --warning-line: rgb(250 173 20 / 40%);
      --warning-text: #faad14;
      --control-hover: #242424;
    }
  }

  /* 固定色值已全部收敛到上面的主题变量，不再需要夜间覆盖 */


  /* ---------- 日间 / 夜间切换按钮 ---------- */
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--card);
    color: var(--muted);
    cursor: pointer;
  }
  .theme-toggle:hover { background: var(--control-hover); color: var(--fg); }
  .theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .theme-toggle img { width: 18px; height: 18px; display: block; }
  /* 没有脚本时切换按钮不可用，直接隐藏，避免出现死控件 */
  .theme-toggle.is-inert { display: none; }
  /* 浅色模式显示月亮（点击切到夜间），深色模式显示太阳 */
  .theme-toggle .icon-moon { display: block; }
  .theme-toggle .icon-sun { display: none; }
  :root[data-theme='dark'] .theme-toggle .icon-moon { display: none; }
  :root[data-theme='dark'] .theme-toggle .icon-sun { display: block; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme]) .theme-toggle .icon-moon { display: none; }
    :root:not([data-theme]) .theme-toggle .icon-sun { display: block; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.6;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: var(--accent-dark); text-decoration: underline; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 0 16px; }

  .site-header { background: var(--card); border-bottom: 1px solid var(--line); }
  .header-inner { display: flex; align-items: center; justify-content: space-between; min-height: 52px; gap: 12px; }
  .brand { font-size: 18px; font-weight: 700; color: var(--fg); }
  .brand:hover { text-decoration: none; }

  /* ---------- 通知入口：顶栏铃铛与未读红点 ---------- */
  .nav-bell {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--card);
    color: var(--muted);
  }
  .nav-bell:hover { color: var(--fg); text-decoration: none; }
  .nav-bell:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* 图标用 mask 上色，颜色取 currentColor，因此日间/夜间都自动跟随主题 */
  .nav-bell-icon {
    display: block;
    width: 18px;
    height: 18px;
    background-color: currentColor;
    -webkit-mask-image: url('/icons/notification.svg');
    mask-image: url('/icons/notification.svg');
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
  }
  /* 未读红点：仅在存在未读时渲染这个元素，无未读时不会占位 */
  .nav-dot {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--danger);
    box-shadow: 0 0 0 2px var(--card);
  }
  .nav { display: flex; align-items: center; gap: 12px; font-size: 14px; }
  .nav-user { display: inline-flex; align-items: center; gap: 10px; }
  .nav-username { font-weight: 600; color: var(--fg); }
  .inline-form { display: inline; margin: 0; }

  main.wrap { padding-top: 20px; padding-bottom: 40px; min-height: 60vh; }
  footer.wrap {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: start;
    gap: 4px 24px;
    color: var(--muted);
    font-size: 13px;
    padding-bottom: 24px;
  }
  .footer-brand { text-align: center; white-space: nowrap; }
  /* 竖排：栏目名一行，条目逐行向下排列 */
  .footer-group { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
  .footer-group-end { align-items: flex-end; }
  .footer-group-label { color: var(--muted); }
  .footer-link { color: var(--muted); text-decoration: none; }
  .footer-link:hover { color: var(--accent); text-decoration: underline; }
  /* 名称 + 纯文本内容，例如「邮箱 a13825021878@163.com」 */
  .footer-item { color: var(--muted); }
  .footer-key { margin-right: 6px; }
  .footer-value { color: var(--fg); }

  .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .toolbar h1 { font-size: 20px; margin: 0; }

  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 18px;
    margin-bottom: 12px;
  }
  .empty { color: var(--muted); text-align: center; }

  /* ---------- 通知与公告 ---------- */
  .tabs {
    display: flex;
    gap: 4px;
    margin: 0 0 14px;
    border-bottom: 1px solid var(--line);
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover { color: var(--fg); text-decoration: none; }
  .tab.is-active {
    color: var(--fg);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
  .tab-badge {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--danger-solid);
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
  }
  .notice-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .notice {
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .notice:last-child { border-bottom: none; }
  .notice-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .notice-title { font-weight: 600; }
  .notice.is-unread .notice-title::before {
    content: '';
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--danger);
    vertical-align: middle;
  }
  .notice-time { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .notice-text {
    margin: 6px 0 0;
    color: var(--fg);
    word-break: break-word;
    white-space: pre-wrap;
  }

  .btn {
    display: inline-block;
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: 14px;
    cursor: pointer;
    background: var(--card);
    color: var(--fg);
    text-decoration: none;
    line-height: 1.5;
  }
  .btn:hover { text-decoration: none; }
  .btn-primary { background: var(--accent-solid); color: #fff; }
  .btn-primary:hover { background: var(--accent-solid-hover); color: #fff; }
  .btn-ghost { border-color: var(--line); }
  .btn-ghost:hover { background: var(--control-hover); }
  .btn-sm { padding: 3px 10px; font-size: 13px; }
  .btn-danger-ghost { border-color: var(--danger); color: var(--danger); }
  .btn-danger-ghost:hover { background: var(--danger-bg); color: var(--danger); }

  .topic-title { margin: 0 0 4px; font-size: 17px; }
  .topic-title a { color: var(--fg); }
  .topic-title a:hover { color: var(--accent); }
  .topic-excerpt { margin: 6px 0 8px; color: var(--muted); font-size: 14px; white-space: pre-line; }
  .meta { color: var(--muted); font-size: 12.5px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

  .post-content { white-space: pre-wrap; word-break: break-word; }
  .post-images { display: grid; gap: 12px; margin-top: 12px; }
  .post-image { display: block; max-width: 100%; height: auto; border-radius: 8px; }
  .form-hint { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
  .image-preview { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 10px 0 0; padding: 0; }
  .image-preview-item { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--line); border-radius: 8px; padding: 8px; background: var(--card); }
  .image-preview-item img { display: block; width: 100%; height: 96px; object-fit: cover; border-radius: 6px; }
  .image-preview-meta { font-size: 12px; color: var(--muted); word-break: break-all; }
  .image-preview-remove { align-self: flex-start; border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 6px; padding: 2px 8px; font-size: 12px; cursor: pointer; }
  .image-notice { margin: 8px 0 0; font-size: 13px; color: var(--danger); }
  .image-notice:empty { display: none; }
  .reply-list { margin-top: 4px; }
  .reply-item { padding: 12px 0; border-top: 1px solid var(--line); }
  .reply-item:first-of-type { border-top: none; }
  .reply-body { white-space: pre-wrap; word-break: break-word; margin: 6px 0 0; }

  /* 嵌套回复：分隔线移到外层，子回复缩进一级并带竖线引导 */
  .reply-thread { border-top: 1px solid var(--line); }
  .reply-thread:first-of-type { border-top: none; }
  .reply-thread .reply-item { border-top: none; padding-bottom: 8px; }
  .reply-children {
    margin: 0 0 8px 10px;
    padding-left: 12px;
    border-left: 2px solid var(--line);
  }
  .reply-children .reply-item { padding: 8px 0; }
  .reply-target { margin: 4px 0 0; font-size: 13px; color: var(--muted); }

  /* ---------- 置顶 / 公告 ---------- */
  .badge {
    display: inline-block;
    margin-right: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.6;
    vertical-align: middle;
  }
  .badge-pinned { background: var(--danger-bg); color: var(--danger); }
  .badge-announcement { background: var(--bg); color: var(--accent-dark); }
  .topic-flags { display: inline-flex; gap: 4px; margin-right: 6px; vertical-align: middle; }
  .pinned-section { margin-bottom: 16px; }

  /* 管理操作条：与标题栏同排会挤在一起，因此单独一行 */
  .toolbar-manage {
    justify-content: flex-start;
    gap: 8px;
    margin: -6px 0 12px;
  }
  .toolbar-manage form { margin: 0; }
  .announce-compose { margin-bottom: 16px; }
  .reply-target-name { color: var(--accent); }
  .reply-actions { margin: 6px 0 0; font-size: 13px; }
  .reply-actions a { color: var(--muted); }
  .reply-actions a:hover { color: var(--accent); }
  .reply-compose-target {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--card);
    border: 1px solid var(--line);
    font-size: 13px;
    color: var(--muted);
  }
  .reply-compose-target strong { color: var(--accent); }

  .alert { padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 14px; }
  .alert-error { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-line); }
  .alert-info { background: var(--accent-subtle); color: var(--accent); border: 1px solid var(--accent-ring); }

  .auth-card { max-width: 380px; margin: 32px auto; }
  .auth-card h1 { font-size: 20px; margin: 0 0 4px; }
  .auth-hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
  .form-row { margin-bottom: 14px; }
  .form-row label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .form-row input[type="text"],
  .form-row input[type="password"],
  .form-row input:not([type]),
  .form-row textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    background: var(--card);
    color: var(--fg);
  }
  .form-row textarea { min-height: 140px; resize: vertical; }
  /* 自增高输入框：高度由脚本按内容设定，禁掉手拖以免两种方式互相覆盖 */
  /* 帖子字体：类名与 src/fonts/post-fonts.ts 一一对应。
     文泉驿点阵宋是点阵字，只有设计尺寸（16px）才点对点清晰，
     行高取设计尺寸的整数倍；非整数倍缩放会让点阵字发虚。 */
  .post-font-wqy { font-family: 'Forum WQY Bitmap Song', monospace; font-size: 16px; line-height: 24px; }
  /* 字体文件缺失时由 font-availability.js 标注 */
  .font-missing { margin-left: 4px; color: var(--muted); font-size: 12px; }
  /* 发帖页字体选择与预览 */
  .font-options { display: flex; flex-wrap: wrap; gap: 8px; }
  .font-option { display: flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
  .font-option:has(input:checked) { border-color: var(--accent); background: var(--bg); }
  .font-option input { margin: 0; }
  .font-option-hint { color: var(--muted); font-size: 12px; }
  .font-preview-sample { padding: 10px 12px; border: 1px dashed var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); overflow-x: auto; margin-top: 8px; }
  .font-preview-label { color: var(--muted); font-size: 12px; }
  .form-row textarea[data-autogrow] { resize: none; overflow-y: hidden; }
  .form-row input:focus, .form-row textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
  .form-actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .btn[data-guard-disabled] { opacity: 0.65; cursor: progress; }
  .form-switch { font-size: 13.5px; color: var(--muted); }

  .profile-head { display: flex; gap: 16px; align-items: center; padding: 18px; }
  .avatar {
    width: 64px; height: 64px; border-radius: 50%;
    background: var(--accent-solid); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 700; flex: none;
  }
  .profile-name { font-size: 22px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 10px; }
  .badge-self { font-size: 12px; font-weight: 500; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 1px 8px; }
  .profile-meta { color: var(--muted); font-size: 13px; margin: 4px 0 0; }
  .stats { display: flex; gap: 0; border-top: 1px solid var(--line); }
  .stat { flex: 1; text-align: center; padding: 12px 0; border-right: 1px solid var(--line); }
  .stat:last-child { border-right: none; }
  .stat-num { font-size: 20px; font-weight: 700; }
  .stat-label { font-size: 12.5px; color: var(--muted); }
  .section-title { font-size: 16px; margin: 20px 0 10px; }
  /* 个人页「展开更多」：<details> 原生折叠，无脚本也能展开 */
  .collapse-more { margin: 4px 0 0; }
  .collapse-more > summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--accent);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 999px;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  .collapse-more > summary::-webkit-details-marker { display: none; }
  .collapse-more > summary::after {
    content: '▾';
    font-size: 11px;
    line-height: 1;
    transition: transform 0.15s ease;
  }
  .collapse-more[open] > summary::after { transform: rotate(180deg); }
  .collapse-more > summary:hover { border-color: var(--accent); }
  .collapse-more-body { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
  /* 折叠区首个回复的分隔线：.reply-item:first-of-type 原本会去掉它 */
  .collapse-more-body .reply-item:first-of-type { border-top: 1px solid var(--line); }
  .reply-item-title { margin: 0 0 4px; font-size: 14.5px; }

  .pagination { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 16px 0 4px; }

  .toolbar-actions { display: flex; align-items: center; gap: 8px; }
  .btn-danger { background: var(--danger-solid); color: #fff; }
  .btn-danger:hover { background: var(--danger-solid-hover); color: #fff; }
  .badge-owner { font-size: 12px; font-weight: 500; color: var(--warning-text); border: 1px solid var(--warning-line); border-radius: 999px; padding: 1px 8px; background: var(--warning-bg); }
  .badge-admin { font-size: 12px; font-weight: 500; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; background: var(--bg); }

  /* ---------- 移动端适配（窄屏优先，桌面样式不受影响） ---------- */
  @media (max-width: 640px) {
    body { -webkit-text-size-adjust: 100%; }

    .wrap { padding: 0 12px; }
    .header-inner { flex-wrap: wrap; row-gap: 8px; min-height: 48px; }
    .brand { font-size: 17px; }
    .nav { flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
    .nav-user { gap: 8px; }
    .nav-username { max-width: 34vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .theme-toggle { width: 40px; height: 40px; }
    .theme-toggle img { width: 20px; height: 20px; }

    main.wrap { padding-top: 14px; padding-bottom: 32px; }

    .toolbar { flex-wrap: wrap; gap: 10px; }
    .toolbar h1 { font-size: 18px; }
    .toolbar-actions { flex-wrap: wrap; gap: 6px; }

    .card { padding: 12px 14px; border-radius: 10px; }

    .btn { padding: 9px 14px; }
    .btn-sm { padding: 7px 10px; font-size: 13px; }

    .topic-title { font-size: 16px; word-break: break-word; }
    .reply-item-title { font-size: 14px; }

    .post-images { gap: 8px; }

    .image-preview { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }

    .auth-card { margin: 20px auto; }

    /* 输入框保持 16px：低于该值 iOS 聚焦时会自动放大页面 */
    .form-row input[type="text"],
    .form-row input[type="password"],
    .form-row input:not([type]),
    .form-row textarea { font-size: 16px; }
    .form-row input[type="file"] { max-width: 100%; }
    .form-row textarea { min-height: 120px; }
    .form-actions { flex-wrap: wrap; gap: 10px; }
    .form-actions .btn { flex: 1 1 140px; text-align: center; }

    .profile-head { gap: 12px; padding: 14px; }
    .avatar { width: 56px; height: 56px; font-size: 24px; }
    .profile-name { font-size: 19px; }
    .stat-num { font-size: 18px; }

    .pagination { gap: 6px; }
    .alert { font-size: 13.5px; }
  }

  @media (max-width: 400px) {
    .wrap { padding: 0 10px; }
    .card { padding: 12px; }
    .image-preview { grid-template-columns: 1fr; }
    .stat { padding: 10px 0; }
    .stat-num { font-size: 17px; }
    .stat-label { font-size: 12px; }
  }

  /* ---------- 违禁词弹窗 ---------- */
  .banned-word-block { margin-bottom: 14px; }
  /* 默认是文档流内的卡片：无 JavaScript 时提示依然可见，且不会挡住表单 */
  dialog.modal {
    position: static;
    margin: 0 auto 0 0;
    max-width: 560px;
    padding: 18px 20px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    color: var(--fg);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  }
  /* 脚本调用 showModal() 后升级为居中模态框 */
  dialog.modal:modal {
    position: fixed;
    inset: 0;
    margin: auto;
    max-width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow: auto;
  }
  dialog.modal::backdrop { background: rgba(0, 0, 0, 0.45); }
  .modal-title { margin: 0 0 8px; font-size: 17px; }
  .modal-text { margin: 0 0 12px; color: var(--muted); font-size: 14px; line-height: 1.6; }
  .modal-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 14px;
    padding: 0;
    list-style: none;
  }
  .modal-list li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--danger);
    border-radius: 999px;
    background: var(--danger-bg);
    font-size: 13px;
  }
  .modal-field { color: var(--danger); }
  .modal-word { font-weight: 600; word-break: break-all; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }

  /* ---------- 新公告弹窗（announcement-popup.js 动态插入） ---------- */
  .announcement-modal {
    max-width: min(560px, calc(100vw - 32px));
    box-sizing: border-box;
  }
  .announcement-item {
    margin: 0 0 12px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
  }
  .announcement-item-title {
    margin: 0 0 6px;
    font-size: 15px;
    line-height: 1.4;
  }
  .announcement-item-body {
    margin: 0;
    font-size: 14px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .announcement-item-meta {
    margin: 8px 0 0;
    color: var(--muted);
    font-size: 12px;
  }
  .announcement-item-link {
    display: inline-block;
    margin-top: 6px;
    font-size: 13px;
  }

  /* ---------- 移动端底部快捷导航（桌面端不显示） ---------- */
  .bottom-nav {
    display: none;
  }

  @media (max-width: 640px) {
    body {
      /* 给固定底栏留出空间，避免遮挡页脚与正文 */
      padding-bottom: calc(50px + env(safe-area-inset-bottom));
    }

    .bottom-nav {
      display: flex;
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 50;
      border-top: 1px solid var(--line);
      background: var(--card);
      padding-bottom: env(safe-area-inset-bottom);
    }

    .bottom-nav-item {
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-height: 50px;
      padding: 4px 4px 2px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.1;
      text-decoration: none;
      -webkit-tap-highlight-color: transparent;
    }

    .bottom-nav-item.is-active {
      color: var(--accent);
    }

    .bottom-nav-icon {
      display: block;
      width: 24px;
      height: 24px;
      background-color: currentColor;
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
      -webkit-mask-position: center;
      mask-position: center;
      -webkit-mask-size: contain;
      mask-size: contain;
    }

    .bottom-nav-item[data-nav='home'] .bottom-nav-icon {
      -webkit-mask-image: url('/icons/home.svg');
      mask-image: url('/icons/home.svg');
    }

    .bottom-nav-item[data-nav='profile'] .bottom-nav-icon {
      -webkit-mask-image: url('/icons/user.svg');
      mask-image: url('/icons/user.svg');
    }

    .bottom-nav-item[data-nav='notifications'] .bottom-nav-icon {
      -webkit-mask-image: url('/icons/notification.svg');
      mask-image: url('/icons/notification.svg');
    }

    /* 图标外面再包一层：mask 会把子元素一并裁剪，红点必须放在图标容器之外 */
    .bottom-nav-figure {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .bottom-nav-figure .nav-dot {
      top: -2px;
      right: -3px;
      box-shadow: 0 0 0 2px var(--bg);
    }

    /* 窄屏下页脚改为单列居中，避免三栏挤压后断行错位 */
    footer.wrap {
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 10px;
      text-align: center;
    }
    /* 竖排布局下，水平居中改由 align-items 控制 */
    .footer-group,
    .footer-group-end { align-items: center; }

    /* 移动端已有底栏入口，顶栏铃铛隐藏，避免同一功能出现两个入口 */
    .nav-bell { display: none; }
  }
`

export interface LayoutProps {
  title?: string
  user: User | null
  children: any
  /** CSRF 令牌：头部「退出」表单提交时需要携带 */
  csrf: string
  /** 移动端底部导航当前高亮项；桌面端不显示该导航 */
  activeNav?: 'home' | 'profile' | 'notifications' | undefined
  /**
   * 未读通知与公告总数。
   *
   * 大于 0 时在通知入口渲染红点；未传或为 0 时红点元素根本不渲染，
   * 因此无未读时不会留下占位或空节点。
   */
  unreadNotifications?: number
  /**
   * 页脚联系方式。仅首页展示；不传时读取 src/site/footer.ts 的 CONTACT_LINKS，
   * 留空数组则页脚左侧不显示该区块。
   */
  contactLinks?: readonly FooterLink[]
  /**
   * 页脚友情链接。仅首页展示；不传时读取 src/site/footer.ts 的 FRIEND_LINKS，
   * 留空数组则页脚右侧不显示该区块。
   */
  friendLinks?: readonly FooterLink[]
  /**
   * 是否展示页脚的联系方式与友情链接。只有首页传 true；
   * 其余页面不传，页脚只保留站点名，避免每页重复同样的链接。
   */
  showFooterLinks?: boolean
}

// 样式表 URL 带内容指纹：CSS 内容变化时 URL 随之变化，
// 避免浏览器或 CDN 继续复用缓存中的旧样式（例如新增的移动端底部导航规则）。
function cssFingerprint(source: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export const cssHref = `/assets/forum.css?v=${cssFingerprint(css)}`

export function Layout(props: LayoutProps) {
  const user = props.user
  const unread = props.unreadNotifications ?? 0
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title ?? 'Simple Forum'}</title>
        <script src="/js/theme.js"></script>
        <link rel="stylesheet" href={cssHref} />
      </head>
      <body data-unread-endpoint="/api/notifications/unread">
        <header class="site-header">
          <div class="wrap header-inner">
            <a class="brand" href="/">Simple Forum</a>
            <nav class="nav">
              {user ? (
                /* 退出登录已移到个人页（仅本人可见），页头只保留用户名入口 */
                <span class="nav-user">
                  <a class="nav-username" href="/me">{user.username}</a>
                </span>
              ) : (
                <span class="nav-user">
                  <a href="/login">登录</a>
                  <a class="btn btn-primary btn-sm" href="/register">注册</a>
                </span>
              )}
            <button
              type="button"
              id="theme-toggle"
              class="theme-toggle is-inert"
              aria-label="切换夜间模式"
              title="切换夜间模式"
            >
              <img class="icon-sun" src="/icons/light-mode.svg" alt="" width="18" height="18" />
              <img class="icon-moon" src="/icons/dark-mode.svg" alt="" width="18" height="18" />
            </button>
          </nav>
          <a
            class="nav-bell"
            href="/notifications"
            data-unread-slot
            data-unread-label="通知与公告"
            aria-label={unread > 0 ? `通知与公告，${unread} 条未读` : '通知与公告'}
            title="通知与公告"
          >
            <span class="nav-bell-icon" aria-hidden="true"></span>
            {unread > 0 ? <span class="nav-dot" aria-hidden="true"></span> : null}
          </a>
          </div>
        </header>
        <main class="wrap">{props.children}</main>
        <SiteFooter
          contactLinks={props.showFooterLinks ? props.contactLinks ?? CONTACT_LINKS : []}
          friendLinks={props.showFooterLinks ? props.friendLinks ?? FRIEND_LINKS : []}
        />
        <nav class="bottom-nav" aria-label="快捷导航">
          <a
            class={props.activeNav === 'home' ? 'bottom-nav-item is-active' : 'bottom-nav-item'}
            data-nav="home"
            href="/"
            aria-current={props.activeNav === 'home' ? 'page' : 'false'}
          >
            <span class="bottom-nav-figure">
              <span class="bottom-nav-icon" aria-hidden="true"></span>
            </span>
            <span>首页</span>
          </a>
          <a
            class={
              props.activeNav === 'notifications' ? 'bottom-nav-item is-active' : 'bottom-nav-item'
            }
            data-nav="notifications"
            href="/notifications"
            data-unread-slot
            data-unread-label="通知"
            aria-current={props.activeNav === 'notifications' ? 'page' : 'false'}
            aria-label={unread > 0 ? `通知，${unread} 条未读` : '通知'}
          >
            <span class="bottom-nav-figure">
              <span class="bottom-nav-icon" aria-hidden="true"></span>
              {unread > 0 ? <span class="nav-dot" aria-hidden="true"></span> : null}
            </span>
            <span>通知</span>
          </a>
          <a
            class={props.activeNav === 'profile' ? 'bottom-nav-item is-active' : 'bottom-nav-item'}
            data-nav="profile"
            href={user ? '/me' : '/login'}
            aria-current={props.activeNav === 'profile' ? 'page' : 'false'}
          >
            <span class="bottom-nav-figure">
              <span class="bottom-nav-icon" aria-hidden="true"></span>
            </span>
            <span>个人</span>
          </a>
        </nav>
        <script src="/js/form-guard.js" defer></script>
        <script src="/js/notifications-badge.js" defer></script>
        <script src="/js/announcement-popup.js" defer></script>
      </body>
    </html>
  )
}

function SiteFooter(props: {
  contactLinks?: readonly FooterLink[]
  friendLinks?: readonly FooterLink[]
}) {
  const contacts = normalizeFooterLinks(props.contactLinks ?? CONTACT_LINKS)
  const friends = normalizeFooterLinks(props.friendLinks ?? FRIEND_LINKS)

  return (
    <footer class="wrap">
      <FooterGroup label="联系方式" links={contacts} />
      <div class="footer-brand">Simple Forum</div>
      <FooterGroup label="友情链接" links={friends} end />
    </footer>
  )
}

/**
 * 页脚左右两栏。条目为空时只渲染空容器（保持三栏网格，
 * 中间站点名仍然居中），不输出标题和多余空节点。
 */
function FooterGroup(props: { label: string; links: readonly FooterLink[]; end?: boolean }) {
  return (
    <div class={props.end ? 'footer-group footer-group-end' : 'footer-group'}>
      {props.links.length > 0 ? <span class="footer-group-label">{props.label}</span> : null}
      {props.links.map((link) => (
        <FooterLinkItem link={link} />
      ))}
    </div>
  )
}

function FooterLinkItem(props: { link: FooterLink }) {
  const { label, value, href } = props.link
  // value 存在时以「名称 + 内容」呈现，例如「邮箱 a13825021878@163.com」
  const body =
    value === undefined ? (
      label
    ) : (
      <span class="footer-text">
        <span class="footer-key">{label}</span>
        <span class="footer-value">{value}</span>
      </span>
    )
  // 没有 href 的条目只是文本行，不生成链接
  if (href === undefined) {
    return <span class="footer-item">{body}</span>
  }
  // 显式分成两个分支，不依赖 JSX 对 undefined 属性的处理
  if (isExternalLink(href)) {
    return (
      <a class="footer-link" href={href} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    )
  }
  return (
    <a class="footer-link" href={href}>
      {body}
    </a>
  )
}
