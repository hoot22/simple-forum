// 防止重复提交：一次提交在途时，后续 submit 事件一律丢弃。
//
// 为什么监听在 capture 阶段：image-preview.js 也监听 submit，并在有图片时
// preventDefault + 异步压缩后再 form.submit()。它在“压缩中”遇到第二次 submit 会
// 直接 return（不阻止默认行为），那次原生提交会带着未压缩的原图发出去。capture
// 阶段的监听器先于它执行，可以在源头挡掉这种重复提交。
;(function () {
  'use strict'

  // 提交在途时的兜底解锁时间。正常情况下页面会跳转，这段逻辑不会执行到；它只用于
  // 覆盖“提交被拦下但页面没跳转”的情况，避免按钮永久禁用。
  var UNLOCK_DELAY_MS = 20000

  var inFlight = null

  function isDialogForm(form) {
    // <form method="dialog"> 只关闭弹窗、不导航，不能锁定，否则关闭按钮会永久禁用。
    return (form.getAttribute('method') || 'get').toLowerCase() === 'dialog'
  }

  function lock(form) {
    form.setAttribute('aria-busy', 'true')
    var buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]')
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i]
      // 带 name 的按钮（例如个人页的 isAdmin 切换）一旦 disabled，字段值就不会随
      // 表单提交，服务端会读不到。这类按钮只做重复提交拦截，不改它的状态。
      if (button.disabled || button.hasAttribute('name')) continue
      button.disabled = true
      button.setAttribute('data-guard-disabled', 'true')
    }
  }

  function unlock(form) {
    if (inFlight === form) inFlight = null
    form.removeAttribute('aria-busy')
    var buttons = form.querySelectorAll('[data-guard-disabled]')
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = false
      buttons[i].removeAttribute('data-guard-disabled')
    }
  }

  function onSubmit(event) {
    var form = event.target
    if (!form || form.nodeName !== 'FORM') return
    if (isDialogForm(form)) return
    if (inFlight) {
      // 已有提交在途：丢弃这一次，包括第二次点击触发的原生提交。
      event.preventDefault()
      return
    }
    inFlight = form
    lock(form)
    window.setTimeout(function () {
      if (inFlight === form) unlock(form)
    }, UNLOCK_DELAY_MS)
  }

  document.addEventListener('submit', onSubmit, true)

  // 从往返缓存回到页面时，DOM 是离开前的旧状态，可能残留锁定。
  window.addEventListener('pageshow', function (event) {
    if (event.persisted && inFlight) unlock(inFlight)
  })
})()
