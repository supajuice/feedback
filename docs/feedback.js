/* Supa Juice: reviews and suggestions.
 * Sends to the feedback Apps Script (apps-script/Code.gs) at the address in config.js. With no
 * address (demo mode) nothing is sent: pressing Send checks the form and says thank you.
 * The toggle switches between a review and a suggestion. #suggest in the address opens the
 * suggestion side, so a link can go straight to it. */
(function () {
  'use strict';

  var MIN_LETTERS = 10;
  var STAR_WORDS = ['', 'Not for me', 'Could be better', 'Good', 'Really good', 'Love them'];

  function $(id) { return document.getElementById(id); }

  var form = $('fb-form');
  var thanks = $('fb-thanks');
  var stars = $('fb-stars');

  function kind() {
    return form.querySelector('input[name="kind"]:checked').value;
  }

  // ---------- The toggle ----------

  function showKind(k, fromHash) {
    form.querySelector('input[name="kind"][value="' + k + '"]').checked = true;
    form.setAttribute('data-kind', k);
    $('fb-review').hidden = k !== 'review';
    $('fb-suggest').hidden = k !== 'suggest';
    $('fb-send').textContent = k === 'review' ? 'Send review' : 'Send suggestion';
    // The email is needed for a review (to check the person bought gels), optional for an idea.
    $('fb-email-optional').hidden = k === 'review';
    $('fb-email-note').textContent = k === 'review'
      ? 'Don\'t worry, we won\'t spam you. It\'s only to check you bought from us.'
      : 'Only if you\'d like us to get back to you. We won\'t spam you.';
    clearErrors();
    if (!fromHash) {
      try { history.replaceState(null, '', k === 'suggest' ? '#suggest' : location.pathname + location.search); } catch (err) { /* old browser */ }
    }
  }

  Array.prototype.forEach.call(form.querySelectorAll('input[name="kind"]'), function (input) {
    input.addEventListener('change', function () { showKind(input.value); });
  });

  // ---------- Stars ----------

  function rating() {
    var on = form.querySelector('input[name="rating"]:checked');
    return on ? Number(on.value) : 0;
  }

  function paintStars(n) {
    stars.setAttribute('data-value', String(n));
    Array.prototype.forEach.call(stars.querySelectorAll('.fb-star'), function (label, i) {
      label.classList.toggle('is-on', i < n);
    });
  }

  function syncStars() {
    var n = rating();
    paintStars(n);
    $('fb-star-word').textContent = STAR_WORDS[n];
  }

  Array.prototype.forEach.call(stars.querySelectorAll('.fb-star'), function (label, i) {
    label.querySelector('input').addEventListener('change', function () {
      syncStars();
      hideError('fb-rating-error');
    });
    // With a mouse, the stars light up as you move over them.
    label.addEventListener('mouseenter', function () { paintStars(i + 1); });
  });
  stars.addEventListener('mouseleave', syncStars);

  // ---------- Letter counters ----------

  function counter(textareaId, countId) {
    var box = $(textareaId);
    var count = $(countId);
    function sync() { count.textContent = box.value.length + ' / ' + box.maxLength; }
    box.addEventListener('input', function () {
      sync();
      hideError(textareaId + '-error');
    });
    sync();
    return sync;
  }
  var syncCounts = [counter('fb-review-text', 'fb-review-count'), counter('fb-suggest-text', 'fb-suggest-count')];

  Array.prototype.forEach.call(form.querySelectorAll('input[name="topic"]'), function (input) {
    input.addEventListener('change', function () { hideError('fb-topic-error'); });
  });
  $('fb-email').addEventListener('input', function () { hideError('fb-email-error'); });
  Array.prototype.forEach.call(form.querySelectorAll('input[name="share"]'), function (input) {
    input.addEventListener('change', function () { hideError('fb-share-error'); });
  });

  function share() {
    var on = form.querySelector('input[name="share"]:checked');
    return on ? on.value : '';
  }

  // ---------- Checking ----------

  function showError(id, message, focusEl) {
    var p = $(id);
    p.textContent = message;
    p.hidden = false;
    if (focusEl && focusEl.tagName !== 'FIELDSET') focusEl.setAttribute('aria-invalid', 'true');
    return focusEl;
  }

  function hideError(id) {
    var p = $(id);
    if (p) { p.hidden = true; p.textContent = ''; }
    var field = $(id.replace(/-error$/, ''));
    if (field) field.removeAttribute('aria-invalid');
  }

  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.hint-bad'), function (p) { hideError(p.id); });
  }

  // Returns the first field with a problem, or null when the form is fine.
  function check() {
    clearErrors();
    var first = null;
    function problem(el) { if (!first) first = el; }
    var email = $('fb-email');
    var emailText = email.value.trim();
    var emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailText);
    if (kind() === 'review') {
      // A star and an email are needed. The written review is optional.
      if (!rating()) problem(showError('fb-rating-error', 'Tap a star to rate them.', stars.querySelector('input')));
      if (!share()) problem(showError('fb-share-error', 'Choose yes or no.', form.querySelector('input[name="share"]')));
      if (!emailText) problem(showError('fb-email-error', 'Enter the email you ordered with, so we can check you bought from us.', email));
      else if (!emailOk) problem(showError('fb-email-error', 'Check the email address.', email));
    } else {
      if (!form.querySelector('input[name="topic"]:checked')) problem(showError('fb-topic-error', 'Pick what your idea is about.', form.querySelector('input[name="topic"]')));
      var idea = $('fb-suggest-text');
      if (idea.value.trim().length < MIN_LETTERS) problem(showError('fb-suggest-text-error', 'Tell us a little more: at least ' + MIN_LETTERS + ' letters.', idea));
      if (emailText && !emailOk) problem(showError('fb-email-error', 'Check the email address, or leave it empty.', email));
    }
    return first;
  }

  // ---------- Sending ----------
  // To the feedback Apps Script when config.js has its address. Without one (demo mode)
  // nothing is sent: the page only says thank you.

  var endpoint = String((window.SJ_FEEDBACK || {}).endpoint || '');
  var live = /^https?:\/\//.test(endpoint);
  $('fb-demo-note').hidden = live;
  $('fb-thanks-demo').hidden = live;

  // For problems the script finds: where the message goes, and what to focus.
  var FIELD_ERRORS = {
    stars: ['fb-rating-error', 'input[name="rating"]'],
    share: ['fb-share-error', 'input[name="share"]'],
    email: ['fb-email-error', '#fb-email'],
    topic: ['fb-topic-error', 'input[name="topic"]'],
    text: ['fb-suggest-text-error', '#fb-suggest-text']
  };

  function payload() {
    var data = { action: kind(), email: $('fb-email').value.trim(), name: $('fb-name').value.trim(), website: $('fb-website').value };
    if (data.action === 'review') {
      var flavour = form.querySelector('input[name="flavour"]:checked');
      data.stars = rating();
      data.share = share();
      data.flavour = flavour ? flavour.value : '';
      data.used = Array.prototype.map.call(form.querySelectorAll('input[name="used"]:checked'), function (i) { return i.value; });
      data.text = $('fb-review-text').value.trim();
    } else {
      var topic = form.querySelector('input[name="topic"]:checked');
      data.topic = topic ? topic.value : '';
      data.text = $('fb-suggest-text').value.trim();
    }
    return data;
  }

  // POST with the JSON sent as text/plain, so the browser sends no preflight (Apps Script cannot answer one).
  async function send(data) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 30000);
    try {
      var res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(data), signal: controller.signal });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function showFormError(message) {
    var box = $('fb-form-error');
    box.textContent = message;
    box.hidden = !message;
  }

  var sending = false;
  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (sending) return;
    showFormError('');
    var bad = check();
    if (bad) {
      bad.focus();
      return;
    }
    if (live) {
      var button = $('fb-send');
      var label = button.textContent;
      sending = true;
      button.disabled = true;
      button.textContent = 'Sending…';
      var reply = null;
      try {
        reply = await send(payload());
      } catch (err) {
        reply = null;
      } finally {
        sending = false;
        button.disabled = false;
        button.textContent = label;
      }
      if (!reply || reply.ok !== true) {
        var where = reply && reply.field && reply.message && FIELD_ERRORS[reply.field];
        if (where) {
          var target = form.querySelector(where[1]);
          showError(where[0], reply.message, target);
          target.focus();
          return;
        }
        showFormError(reply && reply.message
          ? reply.message
          : 'We couldn\'t send that just now. Check your connection and try again. What you wrote is still here.');
        return;
      }
    }
    var name = $('fb-name').value.trim();
    var first = name ? name.split(/\s+/)[0] : '';
    $('fb-thanks-title').textContent = 'Thank you' + (first ? ', ' + first : '') + '!';
    $('fb-thanks-text').textContent = kind() === 'review'
      ? (share() === 'yes'
        ? 'Your ' + rating() + '-star review helps other people pick their gels. We\'ll check it against your order, then post it without any of your details.'
        : 'We\'ve got your ' + rating() + '-star review, and we\'ll keep it private. We\'ll still check it against your order.')
      : 'Good ideas like yours are how the gels get better. ' + ($('fb-email').value.trim() ? 'We\'ll get back to you by email.' : '');
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus();
    window.scrollTo({ top: document.getElementById('feedback').offsetTop - 80, behavior: 'smooth' });
  });

  $('fb-again').addEventListener('click', function () {
    var k = kind();
    form.reset();
    syncStars();
    syncCounts.forEach(function (sync) { sync(); });
    showKind(k);
    thanks.hidden = true;
    form.hidden = false;
    form.querySelector('input[name="kind"]:checked').focus();
  });

  // ---------- Start ----------

  showKind(location.hash === '#suggest' ? 'suggest' : 'review', true);
  window.addEventListener('hashchange', function () {
    showKind(location.hash === '#suggest' ? 'suggest' : 'review', true);
  });
  syncStars();
})();
