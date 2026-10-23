/**
 * 导航未读红点。
 *
 * 服务端只渲染「通知」入口本身（不依赖 JavaScript 也能点进去），未读红点由这里补齐：
 * 查询 /api/notifications/unread，有未读时往入口里插入一个 .nav-dot。
 *
 * 设计取舍：
 * - 未读数量需要每个页面都一致，逐个页面用服务端透传会牵动十几处渲染分支，
 *   因此统一由这个脚本处理；通知页自己算过未读数，服务端已渲染红点时这里会跳过；
 * - 无 JavaScript 时不会出现红点，但入口和通知页本身仍然可用；
 * - 任何失败都静默忽略，红点属于增强信息，不应影响页面其他部分。
 */
;(function () {
  'use strict'

  var slots = document.querySelectorAll('[data-unread-slot]')
  if (slots.length === 0) return

  // 服务端已经渲染过红点的页面不再请求，避免闪烁与多余请求
  var missing = []
  for (var i = 0; i < slots.length; i++) {
    if (!slots[i].querySelector('.nav-dot')) missing.push(slots[i])
  }
  if (missing.length === 0) return

  var endpoint = document.body.getAttribute('data-unread-endpoint')
  if (!endpoint) return

  function mark(slot, total) {
    if (slot.querySelector('.nav-dot')) return
    // 底栏的图标被 CSS mask 裁剪，红点必须挂在图标容器之外
    var holder = slot.querySelector('.bottom-nav-figure') || slot
    var dot = document.createElement('span')
    dot.className = 'nav-dot'
    dot.setAttribute('aria-hidden', 'true')
    holder.appendChild(dot)

    var label = slot.getAttribute('data-unread-label')
    if (label) slot.setAttribute('aria-label', label + '，' + total + ' 条未读')
  }

  fetch(endpoint, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
    .then(function (response) {
      return response.ok ? response.json() : null
    })
    .then(function (data) {
      var total = data && typeof data.total === 'number' ? data.total : 0
      if (total <= 0) return
      for (var i = 0; i < missing.length; i++) mark(missing[i], total)
    })
    .catch(function () {
      // 红点是增强信息，失败时保持页面原样
    })
})()
