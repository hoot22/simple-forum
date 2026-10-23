/**
 * 发帖正文输入框随内容自动增高。
 *
 * 只处理带 data-autogrow 的 textarea：初始高度由 CSS 的 min-height 决定，
 * 内容变长时跟着增高，但最多到 data-autogrow-max（默认 240px）。
 * 上限是刻意设置的——长文不该把「发布」按钮挤出屏幕外；
 * 到达上限后改为框内滚动，不再继续变高。
 *
 * 没有 JavaScript 时输入框保持 CSS 定高，输入与提交都不受影响，
 * 只是需要手动滚动，所以这属于渐进增强。
 */
(function () {
  var DEFAULT_MAX_HEIGHT = 240

  function maxHeightOf(el) {
    var raw = el.getAttribute('data-autogrow-max')
    var parsed = raw === null ? NaN : parseInt(raw, 10)
    return isNaN(parsed) || parsed <= 0 ? DEFAULT_MAX_HEIGHT : parsed
  }

  function resize(el) {
    var max = maxHeightOf(el)

    // 先把高度复位成 auto 再读内容高度。否则上一次设成的高度会成为新的基准，
    // 删掉内容后输入框就缩不回去了。
    el.style.height = 'auto'
    el.style.overflowY = 'hidden'

    var style = window.getComputedStyle(el)
    var borderY =
      (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    // scrollHeight 不含边框，而全局 box-sizing 是 border-box，所以要补回边框高度
    var needed = el.scrollHeight + borderY

    if (needed > max) {
      el.style.height = max + 'px'
      el.style.overflowY = 'auto'
      return
    }
    el.style.height = needed + 'px'
  }

  function resizeAll() {
    var fields = document.querySelectorAll('textarea[data-autogrow]')
    for (var i = 0; i < fields.length; i++) {
      resize(fields[i])
    }
  }

  function init() {
    var fields = document.querySelectorAll('textarea[data-autogrow]')
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i]
      if (el.dataset.autogrowReady === 'true') continue
      el.dataset.autogrowReady = 'true'
      // 打开页面时先按已有内容定高（例如违禁词拦截后回填的正文）
      resize(el)
      el.addEventListener('input', function () {
        resize(this)
      })
    }
  }

  // 屏幕旋转或窗口尺寸变化会改变换行位置，需要重新计算
  window.addEventListener('resize', resizeAll)
  // 从往返缓存返回时页面尺寸可能已经变了
  window.addEventListener('pageshow', resizeAll)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
