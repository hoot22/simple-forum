/**
 * 发帖字体可用性检查。
 *
 * 字体文件可能与代码分离分发：缺少文件时 @font-face 会静默回退到 monospace，
 * 用户选了字体却看不出变化。
 * 这里在字体加载失败后禁用对应选项并注明原因。
 */
;(function () {
  'use strict'

  var FONTS = [
    { id: 'wqy-bitmap-song', family: 'Forum WQY Bitmap Song', sample: '16px' },
  ]

  function findInput(id) {
    return document.querySelector('input[name="font"][value="' + id + '"]')
  }

  function markMissing(id) {
    var input = findInput(id)
    if (!input) return

    input.disabled = true

    // 已选中的字体不可用时退回默认字体，避免提交一个无法生效的值。
    if (input.checked) {
      var fallback = findInput('default')
      if (fallback) fallback.checked = true
    }

    var label = input.closest('label')
    if (label && !label.querySelector('.font-missing')) {
      var note = document.createElement('span')
      note.className = 'font-missing'
      note.textContent = '（缺字体文件）'
      label.appendChild(note)
    }
  }

  function check(font) {
    var query = font.sample + ' "' + font.family + '"'

    document.fonts.load(query).then(
      function () {
        // 文件缺失时 FontFace 进入 error 状态，check 返回 false。
        if (!document.fonts.check(query)) markMissing(font.id)
      },
      function () {
        markMissing(font.id)
      },
    )
  }

  function run() {
    if (!document.fonts || typeof document.fonts.load !== 'function') return
    FONTS.forEach(check)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
