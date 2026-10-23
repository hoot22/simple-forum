/**
 * 发帖表单的图片本地预览、移除、提交前压缩，并生成列表页用的缩略图。
 *
 * 只处理用户主动选择的文件：用 URL.createObjectURL 生成预览，不读取相册、
 * 不打开相机、不申请文件系统权限。
 *
 * 图片字节最终存放在 D1 的 BLOB 列里，单行不能太大，所以提交前会在浏览器端
 * 等比缩放到最长边 1600px 并尽量压到 512 KB 以内（服务端上限 1 MiB）。
 * 这里的处理只是为了通过服务端限制，真正的安全边界仍然在服务端。
 */
;(function () {
  var input = document.getElementById('images')
  var preview = document.getElementById('image-preview')
  var notice = document.getElementById('image-notice')
  if (!input || !preview || !notice) return

  var form = input.form
  if (!form) return

  var MAX_FILES = 3
  var TARGET_BYTES = 512 * 1024
  var MAX_EDGE = 1600
  // 列表页缩略图：边长 480px、64 KiB 上限，明显低于服务端 256 KiB 的预览上限，
  // 给编码器差异留出余量（浏览器不支持 WebP 时会静默回退成 PNG）。
  var PREVIEW_EDGE = 480
  var PREVIEW_BYTES = 64 * 1024
  var PREVIEW_QUALITIES = [0.72, 0.6, 0.5, 0.38]
  var ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

  var selection = []
  var objectUrls = []
  var submitting = false

  function setNotice(text, isError) {
    notice.textContent = text || ''
    notice.setAttribute('data-state', isError ? 'error' : 'info')
  }

  function releaseObjectUrls() {
    for (var i = 0; i < objectUrls.length; i += 1) URL.revokeObjectURL(objectUrls[i])
    objectUrls = []
  }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return Math.max(1, Math.round(bytes / 1024)) + ' KB'
  }

  function canRewriteInput() {
    return typeof DataTransfer === 'function'
  }

  // 把当前选择写回 <input type="file">，随表单一起提交。
  function syncInput() {
    if (!canRewriteInput()) return
    try {
      var transfer = new DataTransfer()
      for (var i = 0; i < selection.length; i += 1) transfer.items.add(selection[i])
      input.files = transfer.files
    } catch (error) {
      // 少数浏览器不允许回写 FileList，此时仍提交用户原始选择，
      // 由服务端再做一次严格的类型与体积校验。
    }
  }

  function makeRemove(index) {
    return function () {
      selection.splice(index, 1)
      syncInput()
      render()
      if (selection.length === 0) setNotice('')
    }
  }

  function render() {
    releaseObjectUrls()
    preview.textContent = ''

    for (var i = 0; i < selection.length; i += 1) {
      var file = selection[i]
      var url = URL.createObjectURL(file)
      objectUrls.push(url)

      var item = document.createElement('li')
      item.className = 'image-preview-item'

      var thumb = document.createElement('img')
      thumb.className = 'image-preview-thumb'
      // 兜底内联样式：即使站点样式表没有覆盖缩略图，也不会撑破布局。
      thumb.setAttribute('style', 'max-width:140px;max-height:100px;width:auto;height:auto;object-fit:cover')
      thumb.src = url
      thumb.alt = ''
      thumb.loading = 'lazy'
      thumb.decoding = 'async'
      item.appendChild(thumb)

      var meta = document.createElement('span')
      meta.className = 'image-preview-meta'
      meta.textContent = (file.name || '图片') + ' · ' + formatSize(file.size)
      item.appendChild(meta)

      var remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'btn btn-ghost'
      remove.textContent = '移除'
      remove.addEventListener('click', makeRemove(i))
      item.appendChild(remove)

      preview.appendChild(item)
    }

    if (selection.length > 0) {
      setNotice(
        '已选择 ' + selection.length + ' 张，发布前会自动压缩到 ' + formatSize(TARGET_BYTES) + ' 以内。',
        false,
      )
    }
  }

  input.addEventListener('change', function () {
    var incoming = input.files ? Array.prototype.slice.call(input.files) : []
    var rejected = 0

    for (var i = 0; i < incoming.length; i += 1) {
      var file = incoming[i]
      if (ACCEPTED.indexOf(file.type) === -1) {
        rejected += 1
        continue
      }
      if (selection.length >= MAX_FILES) {
        rejected += 1
        continue
      }
      selection.push(file)
    }

    syncInput()
    render()

    if (rejected > 0) {
      setNotice(
        '已忽略 ' + rejected + ' 个文件：只支持 JPEG/PNG/WebP/GIF，最多 ' + MAX_FILES + ' 张。',
        true,
      )
    }
  })

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file)
      var image = new Image()
      image.onload = function () {
        resolve({ element: image, url: url })
      }
      image.onerror = function () {
        URL.revokeObjectURL(url)
        reject(new Error('图片无法解码'))
      }
      image.src = url
    })
  }

  function encode(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (typeof canvas.toBlob !== 'function') {
        resolve(null)
        return
      }
      canvas.toBlob(function (blob) {
        resolve(blob)
      }, type, quality)
    })
  }

  function extensionFor(type) {
    if (type === 'image/jpeg') return '.jpg'
    if (type === 'image/png') return '.png'
    if (type === 'image/gif') return '.gif'
    return '.webp'
  }

  // ---- 列表页缩略图 ----
  // 预览图与图片必须一一对应，所以放进独立的 previews 字段，由 DataTransfer
  // 按相同顺序写入，再随原生表单一起提交，保持现有的 form.submit() 路径不变。
  var previewsInput = null

  function ensurePreviewInput() {
    if (previewsInput && previewsInput.isConnected) return previewsInput
    if (!canRewriteInput()) return null
    previewsInput = document.createElement('input')
    previewsInput.type = 'file'
    previewsInput.name = 'previews'
    previewsInput.hidden = true
    previewsInput.tabIndex = -1
    previewsInput.setAttribute('aria-hidden', 'true')
    form.appendChild(previewsInput)
    return previewsInput
  }

  function setPreviews(files) {
    var target = ensurePreviewInput()
    if (!target) return
    try {
      var transfer = new DataTransfer()
      for (var i = 0; i < files.length; i += 1) transfer.items.add(files[i])
      target.files = transfer.files
    } catch (error) {
      // 写不进去就退化成「没有缩略图」：服务端会回退到原图，不影响发帖。
      target.value = ''
    }
  }

  function makePreview(file) {
    return loadImage(file)
      .then(function (loaded) {
        var element = loaded.element
        var naturalWidth = element.naturalWidth || element.width
        var naturalHeight = element.naturalHeight || element.height
        if (!naturalWidth || !naturalHeight) {
          URL.revokeObjectURL(loaded.url)
          return null
        }

        var scale = Math.min(1, PREVIEW_EDGE / Math.max(naturalWidth, naturalHeight))
        var width = Math.max(1, Math.round(naturalWidth * scale))
        var height = Math.max(1, Math.round(naturalHeight * scale))
        var canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        var context = canvas.getContext('2d')
        if (!context) {
          URL.revokeObjectURL(loaded.url)
          return null
        }
        context.drawImage(element, 0, 0, width, height)
        URL.revokeObjectURL(loaded.url)

        function tryQuality(index) {
          if (index >= PREVIEW_QUALITIES.length) return Promise.resolve(null)
          return encode(canvas, 'image/webp', PREVIEW_QUALITIES[index]).then(function (blob) {
            if (!blob) return null
            if (blob.size <= PREVIEW_BYTES) return blob
            return tryQuality(index + 1)
          })
        }

        return tryQuality(0).then(function (blob) {
          if (!blob || blob.size > PREVIEW_BYTES) return null
          // 浏览器不支持 WebP 编码时会静默产出 PNG，所以以实际 MIME 为准：
          // 声明的类型和服务端魔数不一致会导致整批上传被拒。
          var type = ACCEPTED.indexOf(blob.type) === -1 ? null : blob.type
          if (!type) return null
          var ext = type === 'image/png' ? '.png' : type === 'image/gif' ? '.gif' : '.webp'
          var name = (file.name || 'preview').replace(/\.[^.]*$/, '') + ext
          return new File([blob], name, { type: type })
        })
      })
      .catch(function () {
        return null
      })
  }

  function attachPreviews(images) {
    if (images.length === 0) {
      setPreviews([])
      return Promise.resolve()
    }

    return Promise.all(
      images.map(function (file) {
        return makePreview(file)
      }),
    ).then(function (previews) {
      for (var i = 0; i < previews.length; i += 1) {
        if (!previews[i]) {
          // 只要有一张失败就整体放弃：数量不一致会被服务端拒绝，
          // 而部分预览会让缩略图挂到别的图片上。
          setPreviews([])
          return
        }
      }
      setPreviews(previews)
    })
  }

  function compress(file) {
    // 已经足够小、且不需要转码的图片原样提交。
    if (file.size <= TARGET_BYTES && file.type !== 'image/gif') return Promise.resolve(file)

    return loadImage(file).then(function (loaded) {
      var element = loaded.element
      var naturalWidth = element.naturalWidth || element.width
      var naturalHeight = element.naturalHeight || element.height

      if (!naturalWidth || !naturalHeight) {
        URL.revokeObjectURL(loaded.url)
        return file
      }

      var scale = Math.min(1, MAX_EDGE / Math.max(naturalWidth, naturalHeight))
      var width = Math.max(1, Math.round(naturalWidth * scale))
      var height = Math.max(1, Math.round(naturalHeight * scale))

      var canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      var context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(loaded.url)
        return file
      }
      context.drawImage(element, 0, 0, width, height)
      URL.revokeObjectURL(loaded.url)

      var qualities = [0.82, 0.7, 0.6, 0.5]

      function tryQuality(index) {
        if (index >= qualities.length) return Promise.resolve(null)
        return encode(canvas, 'image/webp', qualities[index]).then(function (blob) {
          if (!blob) return null
          if (blob.size <= TARGET_BYTES) return blob
          return tryQuality(index + 1).then(function (smaller) {
            return smaller || blob
          })
        })
      }

      return tryQuality(0).then(function (best) {
        if (best) {
          if (best.size >= file.size) return file
          var name = (file.name || 'image').replace(/\.[^.]*$/, '') + extensionFor(best.type)
          return new File([best], name, { type: best.type })
        }

        return encode(canvas, 'image/jpeg', 0.8).then(function (fallback) {
          if (!fallback || fallback.size >= file.size) return file
          var fallbackName =
            (file.name || 'image').replace(/\.[^.]*$/, '') + extensionFor(fallback.type)
          return new File([fallback], fallbackName, { type: fallback.type })
        })
      })
    })
  }

  form.addEventListener('submit', function (event) {
    if (submitting || selection.length === 0) return
    if (!canRewriteInput()) return

    event.preventDefault()
    submitting = true
    setNotice('正在压缩图片…', false)

    Promise.all(
      selection.map(function (file) {
        return compress(file)
      }),
    )
      .then(function (results) {
        selection = results
        syncInput()
        // 缩略图生成失败不阻断提交：最坏退化成列表页加载原图。
        return attachPreviews(results)
      })
      .then(function () {
        setNotice('')
        form.submit()
      })
      .catch(function () {
        submitting = false
        setNotice('图片处理失败，请重新选择后再试。', true)
      })
  })

  window.addEventListener('pagehide', releaseObjectUrls)
})()
