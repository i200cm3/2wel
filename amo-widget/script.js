define(['jquery'], function ($) {
  var WIDGET_VERSION = '1.0.12'
  var CustomWidget = function () {
    var self = this
    var pollTimer = null
    var issuing = false
    var mounted = false

    var STEP_LABELS = {
      queued: 'Запускаем сборку',
      sync_calls: 'Подтягиваем звонки',
      probe: 'Проверяем записи',
      select: 'Отбираем звонки',
      transcribe: 'Расшифровываем разговоры',
      extract: 'Собираем профиль гостя',
      assemble: 'Собираем презентацию',
      done: 'Готово',
    }

    function settings() {
      var s = self.get_settings() || {}
      return {
        apiBase: String(s.api_base || '').trim().replace(/\/$/, ''),
        projectCode: String(s.project_code || '').trim(),
        // type=pass в amo часто не отдаёт значение в карточке — нужен type=text
        apiKey: String(s.api_key || s.apiKey || '').trim(),
      }
    }

    function leadId() {
      try {
        if (typeof APP !== 'undefined' && APP.data && APP.data.current_card && APP.data.current_card.id) {
          var id = String(APP.data.current_card.id)
          if (id && id !== '0') return id
        }
      } catch (e) {}
      try {
        if (typeof AMOCRM !== 'undefined' && AMOCRM.data && AMOCRM.data.current_card && AMOCRM.data.current_card.id) {
          var id2 = String(AMOCRM.data.current_card.id)
          if (id2 && id2 !== '0') return id2
        }
      } catch (e2) {}
      try {
        var fromUrl = String(window.location.pathname || '').match(/\/leads\/detail\/(\d+)/)
        if (fromUrl) return fromUrl[1]
      } catch (e3) {}
      return ''
    }

    function configured() {
      var s = settings()
      return Boolean(s.apiBase && s.projectCode && s.apiKey && s.apiKey.indexOf('pk_live_') === 0)
    }

    function configError() {
      var s = settings()
      if (!s.apiBase) return 'Укажите базовый URL API в настройках виджета'
      if (!s.projectCode) return 'Укажите код проекта в настройках виджета'
      if (!s.apiKey) return 'Укажите ключ pk_live_… в настройках виджета и нажмите Сохранить'
      if (s.apiKey.indexOf('pk_live_') !== 0) return 'Ключ должен начинаться с pk_live_ (полный ключ, не префикс)'
      return ''
    }

    function endpoint(lead, action) {
      var s = settings()
      var base =
        s.apiBase +
        '/api/v1/projects/' +
        encodeURIComponent(s.projectCode) +
        '/amo-widget/leads/' +
        encodeURIComponent(lead)
      return action ? base + '/' + action : base
    }

    function api(method, lead, action, body) {
      var s = settings()
      return $.ajax({
        url: endpoint(lead, action),
        method: method,
        dataType: 'json',
        contentType: 'application/json; charset=utf-8',
        headers: {
          Authorization: 'Bearer ' + s.apiKey,
          'X-Api-Key': s.apiKey,
          Accept: 'application/json',
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 60000,
      })
    }

    function stopPoll() {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    function startPoll(lead) {
      stopPoll()
      pollTimer = setInterval(function () {
        refresh(lead, false)
      }, 4000)
    }

    function statusText(data) {
      if (!data || !data.exists) return ''
      if (data.running || data.pipeline === 'pending' || data.pipeline === 'running') {
        var step = data.pipelineStep ? STEP_LABELS[data.pipelineStep] || data.pipelineStep : ''
        return step || 'Готовим презентацию…'
      }
      if (data.pipeline === 'failed') {
        return 'Ошибка: ' + (data.pipelineError || 'не удалось собрать')
      }
      if (data.ready && data.url) {
        var name = data.guestName ? ' · ' + data.guestName : ''
        return 'Готово' + name
      }
      if (data.url) return 'Готово'
      return ''
    }

    function statusClass(data) {
      if (!data || !data.exists) return ''
      if (data.pipeline === 'failed') return 'is-error'
      if (data.running || data.pipeline === 'pending' || data.pipeline === 'running') return 'is-running'
      if (data.ready) return 'is-ready'
      return ''
    }

    function root() {
      return $('.twoel-pres-widget')
    }

    function renderState(data) {
      var $el = root()
      if (!$el.length) return

      var $status = $el.find('.twoel-pres-widget__status')
      var $link = $el.find('.twoel-pres-widget__link')
      var $url = $el.find('.twoel-pres-widget__url')
      var $row = $el.find('.twoel-pres-widget__row')
      var $issue = $el.find('[data-action="issue"]')
      var $copy = $el.find('[data-action="copy"]')
      var $open = $el.find('[data-action="open"]')

      var text = statusText(data)
      var cls = statusClass(data)
      $status
        .text(text)
        .attr('class', 'twoel-pres-widget__status' + (text ? ' is-visible' : '') + (cls ? ' ' + cls : ''))

      // URL с API может прийти раньше готовности — показываем только когда ready
      var showLink = Boolean(data && data.ready && data.url && !data.running)
      if (showLink) {
        $url.attr('href', data.url).text(data.url)
        $link.addClass('is-visible').css('display', '')
        $row.addClass('is-visible').css('display', '')
        $copy.attr('aria-disabled', 'false').removeClass('is-busy')
        $open.attr('aria-disabled', 'false').removeClass('is-busy')
      } else {
        $url.attr('href', '#').text('')
        $link.removeClass('is-visible').css('display', 'none')
        $row.removeClass('is-visible').css('display', 'none')
        $copy.attr('aria-disabled', 'true')
        $open.attr('aria-disabled', 'true')
      }

      var busy = issuing || (data && data.running)
      $issue
        .attr('aria-disabled', busy ? 'true' : 'false')
        .toggleClass('is-busy', Boolean(busy))
        .text(data && data.exists ? 'Обновить презентацию' : 'Сформировать презентацию')

      if (data && data.running) startPoll(leadId())
      else stopPoll()
    }

    function refresh(lead, showErrors) {
      if (!lead || !configured()) return
      api('GET', lead)
        .done(function (data) {
          renderState(data || {})
        })
        .fail(function (xhr) {
          if (!showErrors) return
          var msg = authErrorMessage(xhr) ||
            (xhr.responseJSON && xhr.responseJSON.error) ||
            'Не удалось получить статус (' + (xhr.status || '?') + ')'
          root()
            .find('.twoel-pres-widget__status')
            .text(msg)
            .attr('class', 'twoel-pres-widget__status is-visible is-error')
        })
    }

    function authErrorMessage(xhr) {
      var err = xhr && xhr.responseJSON && xhr.responseJSON.error
      if (xhr && xhr.status === 401) {
        return 'Неверный ключ (unauthorized). Откройте настройки виджета, вставьте полный pk_live_… и Сохранить.'
      }
      if (xhr && xhr.status === 403) {
        return 'Ключ не от этого проекта (проверьте код проекта).'
      }
      return err || ''
    }

    function issue() {
      var lead = leadId()
      var cfgErr = configError()
      if (cfgErr) {
        root()
          .find('.twoel-pres-widget__status')
          .text(cfgErr)
          .attr('class', 'twoel-pres-widget__status is-visible is-error')
        return
      }
      if (!lead) {
        root()
          .find('.twoel-pres-widget__status')
          .text('Не удалось определить id сделки. Обновите страницу карточки.')
          .attr('class', 'twoel-pres-widget__status is-visible is-error')
        return
      }
      if (issuing) return
      issuing = true
      root().find('[data-action="issue"]').attr('aria-disabled', 'true').addClass('is-busy').text('Создаём…')
      renderState({ exists: true, running: true, pipeline: 'pending' })
      api('POST', lead, 'issue', {})
        .done(function (data) {
          issuing = false
          renderState(data || { exists: true, running: true, pipeline: 'pending' })
          startPoll(lead)
        })
        .fail(function (xhr) {
          issuing = false
          var msg =
            authErrorMessage(xhr) ||
            (xhr.responseJSON && xhr.responseJSON.error) ||
            'Не удалось выдать ссылку (' + (xhr.status || '?') + ')'
          root()
            .find('.twoel-pres-widget__status')
            .text(msg)
            .attr('class', 'twoel-pres-widget__status is-visible is-error')
          root()
            .find('[data-action="issue"]')
            .attr('aria-disabled', 'false')
            .removeClass('is-busy')
            .text('Сформировать презентацию')
        })
    }

    function copyUrl() {
      var href = root().find('.twoel-pres-widget__url').attr('href')
      if (!href || href === '#') return
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(href).then(
          function () {
            root().find('[data-action="copy"]').text('Скопировано')
            setTimeout(function () {
              root().find('[data-action="copy"]').text('Копировать')
            }, 1500)
          },
          function () {},
        )
        return
      }
      var $tmp = $('<input type="text" />').val(href).appendTo('body').select()
      try {
        document.execCommand('copy')
      } catch (e) {}
      $tmp.remove()
    }

    function openUrl() {
      var href = root().find('.twoel-pres-widget__url').attr('href')
      if (href && href !== '#') window.open(href, '_blank')
    }

    function html() {
      var cfgErr = configError()
      if (cfgErr) {
        return (
          '<div class="twoel-pres-widget" data-twoel-pres="1">' +
          '<p class="twoel-pres-widget__status is-visible is-error">' +
          cfgErr +
          '</p>' +
          '</div>'
        )
      }
      return (
        '<div class="twoel-pres-widget" data-twoel-pres="1">' +
        '<p class="twoel-pres-widget__status"></p>' +
        '<div class="twoel-pres-widget__link" style="display:none">' +
        '<a class="twoel-pres-widget__url" href="#" target="_blank" rel="noopener"></a>' +
        '</div>' +
        '<div class="twoel-pres-widget__actions">' +
        '<div class="twoel-pres-widget__btn twoel-pres-widget__btn--primary" data-action="issue" role="button">Сформировать презентацию</div>' +
        '<div class="twoel-pres-widget__row" style="display:none">' +
        '<div class="twoel-pres-widget__btn twoel-pres-widget__btn--ghost" data-action="copy" role="button">Копировать</div>' +
        '<div class="twoel-pres-widget__btn twoel-pres-widget__btn--ghost" data-action="open" role="button">Открыть</div>' +
        '</div>' +
        '</div>' +
        '</div>'
      )
    }

    function mountBody() {
      // Amo иногда вызывает render дважды (в т.ч. синхронно) — один инстанс.
      if (mounted || $('[data-twoel-pres="1"]').length) {
        $('[data-twoel-pres="1"]').slice(1).remove()
        mounted = true
        return false
      }
      mounted = true
      self.render_template(
        {
          caption: { class_name: 'twoel-pres-widget-wrap' },
          body: html(),
          render: '',
        },
        {},
      )
      var $after = $('[data-twoel-pres="1"]')
      if ($after.length > 1) $after.slice(1).remove()
      return true
    }

    this.callbacks = {
      render: function () {
        var area = self.system().area
        if (area === 'lcard') mountBody()
        return true
      },
      init: function () {
        var lead = leadId()
        if (lead && configured()) refresh(lead, true)
        return true
      },
      bind_actions: function () {
        $(document)
          .off('click.twoelPres')
          .on('click.twoelPres', '.twoel-pres-widget [data-action="issue"]', function (e) {
            e.preventDefault()
            issue()
          })
          .on('click.twoelPres', '.twoel-pres-widget [data-action="copy"]', function (e) {
            e.preventDefault()
            copyUrl()
          })
          .on('click.twoelPres', '.twoel-pres-widget [data-action="open"]', function (e) {
            e.preventDefault()
            openUrl()
          })
        return true
      },
      settings: function () {},
      onSave: function () {
        return true
      },
      destroy: function () {
        stopPoll()
        $(document).off('click.twoelPres')
        $('[data-twoel-pres="1"]').remove()
        mounted = false
        issuing = false
      },
    }

    return this
  }

  return CustomWidget
})
