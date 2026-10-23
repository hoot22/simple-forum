/**
 * 日间 / 夜间模式切换。
 *
 * 该脚本在 <head> 中同步加载，会在样式表生效前先确定 data-theme，
 * 避免深色模式用户看到一瞬间的白屏。
 *
 * 主题优先级：localStorage 中的用户选择 > 系统偏好。
 */
(function () {
  var STORAGE_KEY = 'forum-theme'
  var root = document.documentElement

  function readStoredTheme() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY)
      return stored === 'light' || stored === 'dark' ? stored : null
    } catch (error) {
      // 无痕模式等场景下 localStorage 可能不可用，忽略即可
      return null
    }
  }

  function readSystemTheme() {
    try {
      var query = window.matchMedia('(prefers-color-scheme: dark)')
      return query && query.matches ? 'dark' : 'light'
    } catch (error) {
      return 'light'
    }
  }

  function currentTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme)
  }

  function syncButton() {
    var button = document.getElementById('theme-toggle')
    if (!button) return null

    var label = currentTheme() === 'dark' ? '切换日间模式' : '切换夜间模式'
    button.setAttribute('aria-label', label)
    button.setAttribute('title', label)
    button.classList.remove('is-inert')

    return button
  }

  // 先落主题，再解析后续样式
  applyTheme(readStoredTheme() || readSystemTheme())

  function init() {
    var button = syncButton()
    if (!button) return

    button.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark'
      applyTheme(next)

      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch (error) {
        // 存储失败不影响本次切换，只是不会被记住
      }

      syncButton()
    })

    // 用户没有显式选择时，跟随系统主题变化
    try {
      var query = window.matchMedia('(prefers-color-scheme: dark)')
      if (query && query.addEventListener) {
        query.addEventListener('change', function () {
          if (readStoredTheme()) return
          applyTheme(readSystemTheme())
          syncButton()
        })
      }
    } catch (error) {
      // matchMedia 不可用时忽略
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
