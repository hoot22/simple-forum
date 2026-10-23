/**
 * 违禁词弹窗。
 *
 * 服务端会把 open 属性直接写在 <dialog> 上，所以禁用 JavaScript 时提示依然可见
 * （此时 dialog 以文档流内的卡片形式呈现）。脚本启用后会调用 showModal()，
 * 获得遮罩、Esc 关闭和焦点圈定；并额外兜底某些浏览器不响应
 * <form method="dialog"> 的情况。
 */
;(function () {
  var dialogs = document.querySelectorAll('dialog.modal[open]')
  if (dialogs.length === 0) return

  Array.prototype.forEach.call(dialogs, function (dialog) {
    // 已经带 open 属性时直接 showModal() 会抛 InvalidStateError，需要先复位。
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.removeAttribute('open')
        dialog.showModal()
      } catch (error) {
        dialog.setAttribute('open', '')
      }
    }

    dialog.addEventListener('click', function (event) {
      var target = event.target
      // 关闭按钮兜底：即使原生 method="dialog" 未生效也能收起弹窗。
      if (target instanceof Element && target.closest('[data-dialog-close]')) {
        event.preventDefault()
        dialog.close()
        return
      }
      // 点击遮罩区域（事件目标为 dialog 自身）时关闭。
      if (target === dialog) dialog.close()
    })

    dialog.addEventListener('close', function () {
      if (document.documentElement) {
        // 关闭后把焦点交还表单，方便直接修改标题或正文。
        var field = document.querySelector('input[name="title"], textarea[name="content"]')
        if (field instanceof HTMLElement) field.focus()
      }
    })
  })
})()
