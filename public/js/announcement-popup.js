/**
 * 新公告弹窗。
 *
 * 访问页面时查询 /api/announcements/unread：
 * - 未登录、没有未读公告或接口失败时什么也不做；
 * - 有未读公告时弹出对话框展示，并立刻把公告标记为已读，
 *   所以同一条公告只会弹一次（已读记在服务端，换浏览器也仍然只弹一次）。
 *
 * 公告标题、正文、时间一律用 textContent 写入，不拼接 HTML。
 * 没有 JavaScript 时不会弹窗，公告仍可在「通知与公告」页查看。
 */
;(() => {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return

  // 公告页自己会列出所有公告并标记已读，这里不重复弹窗。
  if (window.location.pathname === '/notifications') return

  const UNREAD_ENDPOINT = '/api/announcements/unread'
  const READ_ENDPOINT = '/api/announcements/read'
  let shown = false

  /** JSON API 的 CSRF 令牌放在可读 cookie 里（见 src/middleware/csrf.ts）。 */
  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)forum_csrf=([^;]*)/)
    return match ? decodeURIComponent(match[1]) : ''
  }

  function buildDialog(announcements) {
    const dialog = document.createElement('dialog')
    dialog.className = 'modal announcement-modal'

    const title = document.createElement('h2')
    title.className = 'modal-title'
    title.textContent = '新公告'
    dialog.appendChild(title)

    announcements.forEach((item) => {
      const article = document.createElement('article')
      article.className = 'announcement-item'

      const heading = document.createElement('h3')
      heading.className = 'announcement-item-title'
      heading.textContent = item.title
      article.appendChild(heading)

      const body = document.createElement('p')
      body.className = 'announcement-item-body'
      body.textContent = item.body
      article.appendChild(body)

      if (item.createdAtText) {
        const meta = document.createElement('p')
        meta.className = 'announcement-item-meta'
        meta.textContent = item.createdAtText
        article.appendChild(meta)
      }

      if (item.link) {
        const link = document.createElement('a')
        link.className = 'announcement-item-link'
        link.href = item.link
        link.textContent = '查看相关主题'
        article.appendChild(link)
      }

      dialog.appendChild(article)
    })

    const actions = document.createElement('div')
    actions.className = 'modal-actions'

    const linkAll = document.createElement('a')
    linkAll.className = 'btn btn-ghost'
    linkAll.href = '/notifications'
    linkAll.textContent = '查看全部公告'
    actions.appendChild(linkAll)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'btn'
    close.textContent = '知道了'
    close.addEventListener('click', () => dialog.close())
    actions.appendChild(close)

    dialog.appendChild(actions)
    dialog.addEventListener('close', () => dialog.remove())
    return dialog
  }

  /** 标记已读失败时静默处理：最坏情况是下次访问再弹一次，不影响页面。 */
  function markRead() {
    const token = csrfToken()
    return fetch(READ_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: token ? { 'x-csrf-token': token } : {},
    }).catch(() => {})
  }

  fetch(UNREAD_ENDPOINT, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (shown) return
      const announcements =
        data && Array.isArray(data.announcements) ? data.announcements : []
      if (announcements.length === 0) return
      shown = true

      const dialog = buildDialog(announcements)
      document.body.appendChild(dialog)
      // 老浏览器没有 showModal 时退回 open 属性，弹窗依然可见（只是非模态）。
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')

      markRead()
    })
    .catch(() => {
      // 弹窗是增强信息，失败时保持页面原样
    })
})()
