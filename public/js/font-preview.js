// 发帖字体选择：切换单选时同步预览区，做到所见即所得。
// 无脚本时表单仍可正常提交，只是没有实时预览。
(function () {
  var preview = document.querySelector('[data-font-preview]')
  var radios = document.querySelectorAll('input[data-font-radio]')
  if (!preview || radios.length === 0) return

  function sync() {
    for (var i = 0; i < radios.length; i++) {
      var radio = radios[i]
      if (!radio.checked) continue
      // 预览区复用帖子正文的 CSS 类，保证预览与发布后的渲染一致。
      var className = radio.getAttribute('data-font-class')
      var classes = ['font-preview-sample']
      if (className) classes.push(className)
      preview.className = classes.join(' ')
      preview.setAttribute('data-font-value', radio.value)
      return
    }
  }

  for (var i = 0; i < radios.length; i++) {
    radios[i].addEventListener('change', sync)
  }
  sync()
})()
